'use strict';
// Normalização de mensagens da Gmail API (format=full) e montagem de MIME para envio.
// Sem dependências externas: o mesmo código roda nos testes (Node) e nos nós Code do n8n.

function b64urlDecode(data) {
  if (!data) return '';
  return Buffer.from(String(data).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function b64urlEncode(str) {
  return Buffer.from(str, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function headerMap(headers) {
  const map = {};
  for (const h of headers || []) {
    const k = String(h.name || '').toLowerCase();
    if (!k) continue;
    map[k] = map[k] ? map[k] + ', ' + h.value : String(h.value || '');
  }
  return map;
}

// "Fulano de Tal" <fulano@x.com>, outro@y.com -> [{name, address}]
function parseAddressList(value) {
  if (!value) return [];
  const out = [];
  const re = /\s*(?:"?([^"<,]*?)"?\s*<([^>]+)>|([^,\s<>]+@[^,\s<>]+))\s*(?:,|$)/g;
  let m;
  while ((m = re.exec(value)) !== null) {
    if (m[0] === '') { re.lastIndex++; continue; }
    const address = (m[2] || m[3] || '').trim().toLowerCase();
    if (address) out.push({ name: (m[1] || '').trim(), address });
  }
  return out;
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function collectParts(part, acc) {
  if (!part) return acc;
  const mime = String(part.mimeType || '').toLowerCase();
  const isAttachment = part.filename && part.filename.length > 0;
  if (!isAttachment && part.body && part.body.data) {
    if (mime === 'text/plain') acc.text.push(b64urlDecode(part.body.data));
    else if (mime === 'text/html') acc.html.push(b64urlDecode(part.body.data));
  }
  if (isAttachment) acc.attachments.push({ filename: part.filename, mimeType: mime, size: (part.body && part.body.size) || 0 });
  for (const p of part.parts || []) collectParts(p, acc);
  return acc;
}

// Remove o histórico citado ("Em ... escreveu:", linhas com ">") para enviar só o texto novo à IA.
function stripQuoted(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (/^\s*(Em .+escreveu:|On .+wrote:|-----\s*Original Message|De:\s.+|From:\s.+)$/i.test(line) && out.length > 0) break;
    if (/^\s*>/.test(line)) continue;
    out.push(line);
  }
  return out.join('\n').trim();
}

function normalizeGmailMessage(msg) {
  const payload = msg.payload || {};
  const h = headerMap(payload.headers);
  const parts = collectParts(payload, { text: [], html: [], attachments: [] });
  const fullText = parts.text.length ? parts.text.join('\n') : stripHtml(parts.html.join('\n'));
  const from = parseAddressList(h['from'])[0] || { name: '', address: '' };
  return {
    gmail_message_id: msg.id,
    gmail_thread_id: msg.threadId,
    label_ids: msg.labelIds || [],
    internal_date: msg.internalDate ? new Date(Number(msg.internalDate)).toISOString() : null,
    rfc822_message_id: (h['message-id'] || '').trim(),
    in_reply_to: (h['in-reply-to'] || '').trim(),
    references: (h['references'] || '').trim(),
    subject: h['subject'] || '',
    from_name: from.name,
    from_email: from.address,
    reply_to: (parseAddressList(h['reply-to'])[0] || {}).address || '',
    to: parseAddressList(h['to']).map(a => a.address),
    cc: parseAddressList(h['cc']).map(a => a.address),
    headers: h,
    content_type: (h['content-type'] || payload.mimeType || '').toLowerCase(),
    body_text: fullText.slice(0, 20000),
    body_new_text: stripQuoted(fullText).slice(0, 8000),
    attachments: parts.attachments,
    snippet: msg.snippet || '',
  };
}

function encodeHeader(value) {
  // RFC 2047 apenas quando necessário (acentos no assunto/nome).
  return /^[\x20-\x7e]*$/.test(value) ? value : '=?UTF-8?B?' + Buffer.from(value, 'utf8').toString('base64') + '?=';
}

function formatAddress(name, address) {
  return name ? `${encodeHeader(name.includes(',') ? `"${name}"` : name)} <${address}>` : address;
}

function replySubject(subject) {
  const s = String(subject || '').trim();
  return /^(re|res|resp):/i.test(s) ? s : `Re: ${s || '(sem assunto)'}`;
}

function newMessageId(domain, uuid) {
  return `<agente.${uuid}@${domain}>`;
}

// Monta a mensagem RFC 5322 e devolve o campo `raw` (base64url) aceito por users.messages.send.
function buildRawEmail(o) {
  const lines = [];
  lines.push(`From: ${formatAddress(o.fromName, o.fromEmail)}`);
  lines.push(`To: ${(o.to || []).join(', ')}`);
  if (o.cc && o.cc.length) lines.push(`Cc: ${o.cc.join(', ')}`);
  if (o.replyTo) lines.push(`Reply-To: ${o.replyTo}`);
  lines.push(`Subject: ${encodeHeader(o.subject || '')}`);
  lines.push(`Message-ID: ${o.messageId}`);
  lines.push(`Date: ${new Date(o.date || Date.now()).toUTCString().replace('GMT', '+0000')}`);
  if (o.inReplyTo) lines.push(`In-Reply-To: ${o.inReplyTo}`);
  if (o.references) lines.push(`References: ${o.references}`);
  // RFC 3834: identifica a mensagem como automática; evita ciclos com outros robôs.
  lines.push('Auto-Submitted: auto-replied');
  lines.push(`X-Agente-Atendimento: ${o.agentTag || 'agente'}`);
  lines.push('MIME-Version: 1.0');
  lines.push('Content-Type: text/plain; charset=UTF-8');
  lines.push('Content-Transfer-Encoding: base64');
  lines.push('');
  lines.push(Buffer.from(o.bodyText || '', 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n'));
  return b64urlEncode(lines.join('\r\n'));
}

module.exports = {
  b64urlDecode, b64urlEncode, headerMap, parseAddressList, stripHtml, stripQuoted,
  normalizeGmailMessage, buildRawEmail, replySubject, newMessageId, encodeHeader,
};
