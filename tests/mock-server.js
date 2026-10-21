'use strict';
// Servidor SIMULADO de Gmail API, Calendly API e Claude API, só para testes de integração locais.
// Não substitui a validação com contas reais (ver docs/testes.md).
const http = require('http');
const { URL } = require('url');
const { b64urlDecode } = require('../src/email');

function createState() {
  return { inbox: {}, sent: [], labels: [], requests: [], fail: {}, calendly: { events: {}, invitees: {} }, aiDecisions: [], nextId: 1 };
}

function decideAI(body) {
  const text = body.messages[0].content;
  const email = (text.split('<email_recebido>')[1] || '').toLowerCase();
  const base = { intent: 'informacao', action: 'responder', meeting_type_key: '', reply_body: '', escalation_reason: '', missing_info: '',
    summary: 'Contato fez uma pergunta.', next_action: 'Aguardar retorno', kb_grounded: true, confidence: 0.9 };
  if (email.includes('reagendar')) return { ...base, intent: 'reagendamento', reply_body: 'Sem problemas. Para escolher outro horário, use este link: [[LINK]]' };
  if (email.includes('agendar')) return { ...base, intent: 'agendamento', action: 'enviar_link_agendamento', meeting_type_key: 'reuniao_inicial',
    reply_body: 'Claro! A reunião inicial tem 30 minutos e serve para entendermos sua necessidade. Escolha o melhor horário (exibido no seu fuso) aqui: [[LINK]]' };
  if (email.includes('desconto')) return { ...base, reply_body: 'Temos desconto de 50%, o valor fica R$ 10,00.' }; // inventado: a política deve barrar
  if (email.includes('reclamação')) return { ...base, intent: 'reclamacao', action: 'encaminhar_responsavel', escalation_reason: 'reclamação', reply_body: 'Encaminhamos.' };
  if (email.includes('newsletter')) return { ...base, intent: 'spam_ou_automatico', action: 'nao_responder', reply_body: '' };
  return { ...base, reply_body: 'Nosso atendimento é de segunda a sexta, das 9h às 18h.' };
}

function start(port = 8099) {
  const state = createState();
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      const u = new URL(req.url, `http://localhost:${port}`);
      const body = raw ? (() => { try { return JSON.parse(raw); } catch { return raw; } })() : null;
      state.requests.push({ method: req.method, path: u.pathname, query: Object.fromEntries(u.searchParams), headers: req.headers, body });
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      const p = u.pathname;
      let m;

      // ------------------------------------------------ controle do teste
      if (p === '/_control/state') return send(200, state);
      if (p === '/_control/reset') { Object.assign(state, createState()); return send(200, { ok: true }); }
      if (p === '/_control/inbox' && req.method === 'POST') { state.inbox[body.id] = { ...body, labelIds: body.labelIds || ['INBOX', 'UNREAD'] }; return send(200, { ok: true }); }
      if (p === '/_control/fail' && req.method === 'POST') { Object.assign(state.fail, body); return send(200, state.fail); }
      if (p === '/_control/calendly' && req.method === 'POST') {
        if (body.event) state.calendly.events[body.event.uri] = body.event;
        if (body.invitee) state.calendly.invitees[body.invitee.uri] = body.invitee;
        return send(200, { ok: true });
      }

      // ------------------------------------------------ Gmail
      if (!p.startsWith('/_control') && p.startsWith('/gmail/') && !String(req.headers.authorization || '').startsWith('Bearer ')) return send(401, { error: { code: 401 } });
      if (p === '/gmail/v1/users/me/labels' && req.method === 'GET') return send(200, { labels: state.labels });
      if (p === '/gmail/v1/users/me/labels' && req.method === 'POST') {
        if (state.labels.find(l => l.name === body.name)) return send(409, { error: { code: 409, message: 'Label name exists or conflicts' } });
        const l = { id: `Label_${state.labels.length + 1}`, name: body.name }; state.labels.push(l); return send(200, l);
      }
      if (p === '/gmail/v1/users/me/messages' && req.method === 'GET') {
        const q = u.searchParams.get('q') || '';
        if ((m = q.match(/rfc822msgid:(\S+)/))) {
          const hit = state.sent.filter(s => s.messageId.replace(/[<>]/g, '') === m[1]);
          return send(200, hit.length ? { messages: hit.map(s => ({ id: s.id, threadId: s.threadId })), resultSizeEstimate: hit.length } : { resultSizeEstimate: 0 });
        }
        const processed = (state.labels.find(l => l.name === 'agente-processado') || {}).id;
        const list = Object.values(state.inbox).filter(x => !x.labelIds.includes(processed)).sort((a, b) => b.internalDate - a.internalDate);
        return send(200, list.length ? { messages: list.map(x => ({ id: x.id, threadId: x.threadId })) } : { resultSizeEstimate: 0 });
      }
      if ((m = p.match(/^\/gmail\/v1\/users\/me\/messages\/([^/]+)$/)) && req.method === 'GET') {
        if (state.fail.read) { state.fail.read -= 1; return send(503, { error: { code: 503 } }); }
        return state.inbox[m[1]] ? send(200, state.inbox[m[1]]) : send(404, { error: { code: 404 } });
      }
      if ((m = p.match(/^\/gmail\/v1\/users\/me\/messages\/([^/]+)\/modify$/))) {
        const msg = state.inbox[m[1]]; if (!msg) return send(404, {});
        msg.labelIds = Array.from(new Set([...msg.labelIds, ...(body.addLabelIds || [])])).filter(l => !(body.removeLabelIds || []).includes(l));
        return send(200, { id: msg.id, labelIds: msg.labelIds });
      }
      if (p === '/gmail/v1/users/me/messages/send') {
        const decoded = b64urlDecode(body.raw);
        const head = decoded.split('\r\n\r\n')[0];
        const hdr = n => ((head.match(new RegExp(`^${n}: (.*)$`, 'mi')) || [])[1] || '').trim();
        const text = Buffer.from(decoded.split('\r\n\r\n').slice(1).join('').replace(/\r\n/g, ''), 'base64').toString('utf8');
        if (state.fail.sendReject) { state.fail.sendReject -= 1; return send(400, { error: { code: 400, message: 'Invalid To header' } }); }
        const rec = { id: `sent-${state.nextId++}`, threadId: body.threadId || `thread-new-${state.nextId}`, messageId: hdr('Message-ID'),
          to: hdr('To'), subject: hdr('Subject'), inReplyTo: hdr('In-Reply-To'), autoSubmitted: hdr('Auto-Submitted'), text };
        state.sent.push(rec);
        // Simula "aceito pelo servidor, mas a resposta se perdeu": o envio aconteceu, o cliente recebe 503.
        if (state.fail.sendLoseResponse) { state.fail.sendLoseResponse -= 1; return send(503, { error: { code: 503 } }); }
        return send(200, { id: rec.id, threadId: rec.threadId, labelIds: ['SENT'] });
      }

      // ------------------------------------------------ Claude API
      if (p === '/v1/messages' && req.method === 'POST') {
        if (!req.headers['x-api-key']) return send(401, { type: 'error', error: { type: 'authentication_error' } });
        if (state.fail.ai) { state.fail.ai -= 1; return send(529, { type: 'error', error: { type: 'overloaded_error' } }); }
        const d = decideAI(body); state.aiDecisions.push(d);
        return send(200, { id: 'msg_mock', type: 'message', role: 'assistant', model: body.model, stop_reason: 'end_turn',
          content: [{ type: 'text', text: JSON.stringify(d) }], usage: { input_tokens: 100, output_tokens: 50 } });
      }

      // ------------------------------------------------ Calendly
      if (p.startsWith('/users') || p.startsWith('/event_types') || p.startsWith('/scheduled_events') || p.startsWith('/webhook_subscriptions')) {
        if (!String(req.headers.authorization || '').startsWith('Bearer ')) return send(401, { title: 'Unauthenticated' });
        const base = 'https://api.calendly.com';
        if (p === '/users/me') return send(200, { resource: { uri: `${base}/users/U1`, name: 'Empresa Exemplo', current_organization: `${base}/organizations/O1`,
          scheduling_url: 'https://calendly.com/empresa-exemplo', timezone: 'America/Sao_Paulo' } });
        if (p === '/event_types') return send(200, { collection: [{ uri: `${base}/event_types/ET1`, name: 'Reunião inicial', duration: 30, active: true,
          scheduling_url: 'https://calendly.com/empresa-exemplo/reuniao-inicial' }], pagination: { next_page: null } });
        if (p === '/webhook_subscriptions') return send(201, { resource: { uri: `${base}/webhook_subscriptions/W1`, callback_url: body.url, state: 'active' } });
        if (p === '/scheduled_events') {
          const all = Object.values(state.calendly.events);
          const page = Number(u.searchParams.get('page') || 1);
          const slice = all.slice((page - 1) * 1, page * 1); // 1 por página para exercitar a paginação
          const next = page * 1 < all.length ? `http://localhost:${port}/scheduled_events?${new URLSearchParams({ ...Object.fromEntries(u.searchParams), page: page + 1 })}` : null;
          return send(200, { collection: slice, pagination: { next_page: next } });
        }
        if ((m = p.match(/^\/scheduled_events\/([^/]+)\/invitees$/))) {
          const evUri = `${base}/scheduled_events/${m[1]}`;
          return send(200, { collection: Object.values(state.calendly.invitees).filter(i => i.event === evUri), pagination: { next_page: null } });
        }
        if ((m = p.match(/^\/scheduled_events\/([^/]+)\/invitees\/([^/]+)$/))) {
          const inv = state.calendly.invitees[`${base}${p}`]; return inv ? send(200, { resource: inv }) : send(404, {});
        }
        if ((m = p.match(/^\/scheduled_events\/([^/]+)$/))) {
          const ev = state.calendly.events[`${base}${p}`]; return ev ? send(200, { resource: ev }) : send(404, {});
        }
      }
      send(404, { error: 'rota não simulada', path: p });
    });
  });
  return new Promise(resolve => server.listen(port, () => resolve({ server, state })));
}

module.exports = { start };
if (require.main === module) start(Number(process.env.MOCK_PORT || 8099)).then(() => console.log('mock em :8099'));
