#!/usr/bin/env node
'use strict';
// Teste de integração: n8n real + PostgreSQL real + APIs SIMULADAS (tests/mock-server.js).
// Pré-requisitos (ver docs/testes.md): servidor n8n rodando com os workflows importados e publicados,
// credenciais de teste apontando para o mock e variáveis N8N_* exportadas no ambiente.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert/strict');
const mock = require('./mock-server');
const { gmailMessage, settings } = require('./fixtures');
const calendly = require('../src/calendly');

const ROOT = path.join(__dirname, '..');
const DB = process.env.DATABASE_URL || 'postgresql://agente:agente@localhost:5432/agente';
const WEBHOOK = process.env.WEBHOOK_URL || 'http://127.0.0.1:5678/webhook/calendly';
const KEY = process.env.CALENDLY_WEBHOOK_SIGNING_KEY;
const MOCK = 'http://localhost:8099';
const CAL = 'https://api.calendly.com';

const psql = (q) => execFileSync('psql', [DB, '-At', '-q', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' }).trim();
const rows = (q) => { const out = psql(`SELECT coalesce(json_agg(t), '[]') FROM (${q}) t`); return JSON.parse(out || '[]'); };
const execFileP = require('util').promisify(require('child_process').execFile);
const run = async (id, port = 5690) => {
  try {
    return (await execFileP('n8n', ['execute', `--id=${id}`], { encoding: 'utf8', env: { ...process.env, N8N_RUNNERS_BROKER_PORT: String(port), N8N_LOG_LEVEL: 'error' }, maxBuffer: 64 << 20 })).stdout;
  } catch (e) {
    const msgs = String(e.stdout || '').match(/"message": "[^"]*"/g) || [];
    throw new Error(`n8n execute ${id} falhou: ${msgs.slice(0, 3).join(' | ') || String(e.stdout || e.stderr).slice(-800)}`);
  }
};
const poll = (port) => run('AgCaixaEntrada01', port);
const results = [];
async function step(name, fn) {
  try { await fn(); results.push(['OK', name]); console.log(`ok   - ${name}`); }
  catch (e) { results.push(['FALHOU', name, e.message]); console.log(`FALHOU - ${name}\n       ${e.message.split('\n').join('\n       ')}`); }
}

async function webhook(body, { sign = true, key = KEY } = {}) {
  const raw = JSON.stringify(body);
  const headers = { 'content-type': 'application/json' };
  if (sign) headers['calendly-webhook-signature'] = calendly.sign(raw, key);
  const r = await fetch(WEBHOOK, { method: 'POST', headers, body: raw });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const waitFor = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await new Promise(r => setTimeout(r, 500)); } return false; };

function calendlyObjects(n, { email = 'maria@cliente.com.br', utm = null, start, status = 'active', inviteeStatus = 'active', rescheduled = false, old = null } = {}) {
  const ev = { uri: `${CAL}/scheduled_events/E${n}`, name: 'Reunião inicial', status, start_time: start, end_time: new Date(new Date(start).getTime() + 30 * 60000).toISOString(),
    event_type: `${CAL}/event_types/ET1`, calendar_event: { kind: 'google', external_id: `gcal-${n}` }, location: { type: 'google_conference' }, updated_at: new Date().toISOString() };
  const inv = { uri: `${CAL}/scheduled_events/E${n}/invitees/I${n}`, event: ev.uri, email, name: 'Maria Souza', status: inviteeStatus, timezone: 'America/Sao_Paulo',
    cancel_url: `https://calendly.com/cancellations/I${n}`, reschedule_url: `https://calendly.com/reschedulings/I${n}`, rescheduled, old_invitee: old,
    tracking: { utm_content: utm }, updated_at: new Date().toISOString() };
  return { ev, inv };
}

(async () => {
  const { server, state } = await mock.start(8099);
  const inbox = (m) => { state.inbox[m.id] = { ...m, labelIds: m.labelIds || ['INBOX', 'UNREAD'] }; };
  const sentTo = (addr) => state.sent.filter(s => s.to.includes(addr));
  const aiCalls = () => state.requests.filter(r => r.path === '/v1/messages').length;

  // ---------------------------------------------------------------- preparação
  execFileSync('psql', [DB, '-q', '-c', 'DROP SCHEMA IF EXISTS agente CASCADE', '-f', path.join(ROOT, 'db/schema.sql')], { stdio: 'ignore' });
  const s = settings();
  s.api = { gmail_base: MOCK, calendly_base: MOCK, anthropic_base: MOCK };
  s.calendly = { webhooks_enabled: true, webhook_url: WEBHOOK, reconcile_days_back: 2, reconcile_days_ahead: 60 };
  const kb = s.knowledge_base; delete s.knowledge_base;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agente-'));
  fs.writeFileSync(path.join(tmp, 'c.json'), JSON.stringify(s)); fs.writeFileSync(path.join(tmp, 'kb.md'), kb);
  const seed = execFileSync('node', [path.join(ROOT, 'scripts/seed-settings.js'), path.join(tmp, 'c.json'), path.join(tmp, 'kb.md')], { encoding: 'utf8' });
  execFileSync('psql', [DB, '-q'], { input: seed, stdio: ['pipe', 'ignore', 'inherit'] });

  await step('configuração inicial: cria rótulos, lê Calendly e registra webhook com chave de assinatura', async () => {
    await run('AgConfigInicial1');
    const ids = JSON.parse(psql("SELECT value FROM agente.settings WHERE key='gmail_label_ids'"));
    assert.deepEqual(Object.keys(ids).sort(), ['erro', 'escalado', 'ignorado', 'processado']);
    const sub = state.requests.find(r => r.path === '/webhook_subscriptions');
    assert.equal(sub.body.signing_key, KEY);
    assert.deepEqual(sub.body.events, ['invitee.created', 'invitee.canceled']);
    await run('AgConfigInicial1'); // idempotente: rótulos já existem (409) e não duplicam
    assert.equal(state.labels.length, 4);
  });
  const L = JSON.parse(psql("SELECT value FROM agente.settings WHERE key='gmail_label_ids'"));

  // ---------------------------------------------------------------- e-mail
  await step('recebimento e resposta na mesma conversa (In-Reply-To, threadId, Auto-Submitted, rótulo)', async () => {
    inbox(gmailMessage({ id: 'm1', threadId: 't1', text: 'Olá, qual o horário de atendimento?' }));
    await poll();
    const out = sentTo('maria@cliente.com.br');
    assert.equal(out.length, 1);
    assert.equal(out[0].threadId, 't1');
    assert.equal(out[0].inReplyTo, '<orig-1@cliente.com.br>');
    assert.equal(out[0].autoSubmitted, 'auto-replied');
    assert.match(out[0].text, /segunda a sexta/);
    assert.ok(state.inbox.m1.labelIds.includes(L.processado));
    const [m] = rows("SELECT status, intent FROM agente.messages WHERE gmail_message_id='m1'");
    assert.deepEqual(m, { status: 'concluida', intent: 'informacao' });
  });

  await step('sem duplicidade: nova leitura da mesma mensagem não gera novo envio nem nova chamada de IA', async () => {
    const before = [state.sent.length, aiCalls()];
    state.inbox.m1.labelIds = ['INBOX']; // simula rótulo perdido: a mensagem volta a aparecer na busca
    await poll();
    assert.deepEqual([state.sent.length, aiCalls()], before);
    assert.ok(state.inbox.m1.labelIds.includes(L.processado), 'rótulo reaplicado');
  });

  let convId;
  await step('envio do link de agendamento com pré-preenchimento e utm_content = conversa', async () => {
    inbox(gmailMessage({ id: 'm2', threadId: 't2', subject: 'Reunião', messageId: '<orig-2@cliente.com.br>', text: 'Gostaria de agendar uma reunião.' }));
    await poll();
    const out = state.sent.at(-1);
    const link = out.text.match(/https:\/\/calendly\.com\/\S+/)[0];
    const u = new URL(link);
    convId = psql("SELECT id FROM agente.conversations WHERE gmail_thread_id='t2'");
    assert.equal(u.pathname, '/empresa-exemplo/reuniao-inicial');
    assert.equal(u.searchParams.get('email'), 'maria@cliente.com.br');
    assert.equal(u.searchParams.get('utm_content'), convId);
    assert.match(out.text, /30 minutos/);
    assert.equal(psql(`SELECT status FROM agente.conversations WHERE id='${convId}'`), 'aguardando_contato');
  });

  await step('ignora automáticas, listas e mensagens do próprio agente sem chamar a IA', async () => {
    const before = [state.sent.length, aiCalls()];
    inbox(gmailMessage({ id: 'm3', threadId: 't3', from: 'Maria <maria@cliente.com.br>', subject: 'Resposta automática: Reunião', headers: [{ name: 'Auto-Submitted', value: 'auto-replied' }] }));
    inbox(gmailMessage({ id: 'm4', threadId: 't4', from: 'News <news@loja.com>', headers: [{ name: 'List-Unsubscribe', value: '<mailto:u@loja.com>' }] }));
    inbox(gmailMessage({ id: 'm5', threadId: 't1', from: 'Ana <atendimento@empresa.com.br>', text: 'resposta anterior' }));
    await poll();
    assert.deepEqual([state.sent.length, aiCalls()], before);
    const r = rows("SELECT gmail_message_id, status, skip_reason FROM agente.messages WHERE gmail_message_id IN ('m3','m4','m5') ORDER BY 1");
    assert.deepEqual(r.map(x => x.skip_reason), ['automatica', 'lista_ou_massa', 'proprio_agente']);
    assert.ok(['m3', 'm4', 'm5'].every(id => state.inbox[id].labelIds.includes(L.ignorado)));
  });

  await step('encaminha ao responsável quando a IA inventa valor; contato recebe confirmação; conversa fica com humano', async () => {
    inbox(gmailMessage({ id: 'm6', threadId: 't6', from: 'Carlos <carlos@cliente.com.br>', subject: 'Preço', messageId: '<orig-6@cliente.com.br>', text: 'Vocês dão desconto?' }));
    await poll();
    const fwd = sentTo('responsavel@empresa.com.br').at(-1);
    assert.match(fwd.text, /valor_fora_da_base/);
    assert.match(fwd.text, /carlos@cliente.com.br/);
    const ack = sentTo('carlos@cliente.com.br').at(-1);
    assert.match(ack.text, /encaminhada para a nossa equipe/);
    assert.doesNotMatch(ack.text, /R\$/);
    assert.ok(state.inbox.m6.labelIds.includes(L.escalado));
    assert.equal(psql("SELECT status FROM agente.conversations WHERE gmail_thread_id='t6'"), 'escalada');
    const before = [state.sent.length, aiCalls()];
    inbox(gmailMessage({ id: 'm7', threadId: 't6', from: 'Carlos <carlos@cliente.com.br>', text: 'Alguma novidade?' }));
    await poll();
    assert.deepEqual([state.sent.length, aiCalls()], before, 'agente não interfere na conversa escalada');
    assert.equal(psql("SELECT skip_reason FROM agente.messages WHERE gmail_message_id='m7'"), 'conversa_com_humano');
  });

  // ---------------------------------------------------------------- Calendly
  const start1 = new Date(Date.now() + 3 * 864e5).toISOString();
  const b1 = calendlyObjects(1, { utm: null, start: start1 });
  b1.inv.tracking.utm_content = null;
  await step('webhook invitee.created: assinatura validada, reserva verificada na API e ligada à conversa', async () => {
    b1.inv.tracking.utm_content = convId;
    state.calendly.events[b1.ev.uri] = b1.ev; state.calendly.invitees[b1.inv.uri] = b1.inv;
    const payload = { event: 'invitee.created', created_at: new Date().toISOString(), payload: { ...b1.inv, scheduled_event: b1.ev } };
    const r = await webhook(payload);
    assert.equal(r.status, 200);
    assert.ok(await waitFor(() => psql("SELECT count(*) FROM agente.bookings") === '1'), 'reserva gravada');
    const [b] = rows('SELECT status, conversation_id, google_event_id, verified_at IS NOT NULL AS verified, cancel_url FROM agente.bookings');
    assert.deepEqual(b, { status: 'ativo', conversation_id: convId, google_event_id: 'gcal-1', verified: true, cancel_url: 'https://calendly.com/cancellations/I1' });
    assert.ok(state.requests.some(x => x.path === '/scheduled_events/E1/invitees/I1'), 'convidado consultado na API');
    // Entrega duplicada do mesmo evento
    const dup = await webhook(payload);
    assert.equal(dup.status, 200);
    assert.equal(dup.body.duplicate, true);
    assert.equal(psql('SELECT count(*) FROM agente.webhook_events'), '1');
  });

  await step('webhook com assinatura inválida ou ausente é recusado (401) e não grava nada', async () => {
    const before = psql('SELECT count(*) FROM agente.webhook_events');
    const bad = await webhook({ event: 'invitee.created', created_at: 'x', payload: { uri: 'forjado' } }, { key: 'chave-errada' });
    const none = await webhook({ event: 'invitee.created', created_at: 'y', payload: { uri: 'forjado' } }, { sign: false });
    assert.equal(bad.status, 401); assert.equal(none.status, 401);
    assert.equal(psql('SELECT count(*) FROM agente.webhook_events'), before);
  });

  await step('pedido de reagendamento responde com o link oficial da reserva verificada', async () => {
    inbox(gmailMessage({ id: 'm8', threadId: 't2', subject: 'Re: Reunião', messageId: '<orig-8@cliente.com.br>', text: 'Preciso reagendar, surgiu um imprevisto.' }));
    await poll();
    const out = state.sent.at(-1);
    assert.equal(out.threadId, 't2');
    assert.ok(out.text.includes('https://calendly.com/reschedulings/I1'), out.text);
  });

  await step('reagendamento no Calendly: antiga vira "reagendado", nova fica "ativo" na mesma conversa', async () => {
    const start2 = new Date(Date.now() + 5 * 864e5).toISOString();
    b1.inv.status = 'canceled'; b1.inv.rescheduled = true; b1.inv.new_invitee = `${CAL}/scheduled_events/E2/invitees/I2`; b1.ev.status = 'canceled';
    const b2 = calendlyObjects(2, { start: start2, old: b1.inv.uri, utm: convId });
    state.calendly.events[b2.ev.uri] = b2.ev; state.calendly.invitees[b2.inv.uri] = b2.inv;
    await webhook({ event: 'invitee.canceled', created_at: new Date().toISOString(), payload: { ...b1.inv, scheduled_event: b1.ev } });
    await webhook({ event: 'invitee.created', created_at: new Date().toISOString(), payload: { ...b2.inv, scheduled_event: b2.ev } });
    assert.ok(await waitFor(() => psql('SELECT count(*) FROM agente.bookings') === '2'));
    assert.ok(await waitFor(() => psql(`SELECT status FROM agente.bookings WHERE calendly_invitee_uri='${b1.inv.uri}'`) === 'reagendado'));
    const [n] = rows(`SELECT status, rescheduled_from_uri, conversation_id FROM agente.bookings WHERE calendly_invitee_uri='${b2.inv.uri}'`);
    assert.deepEqual(n, { status: 'ativo', rescheduled_from_uri: b1.inv.uri, conversation_id: convId });
  });

  await step('cancelamento no Calendly atualiza a reserva para "cancelado"', async () => {
    const inv = state.calendly.invitees[`${CAL}/scheduled_events/E2/invitees/I2`];
    inv.status = 'canceled'; inv.cancellation = { reason: 'Imprevisto' }; state.calendly.events[inv.event].status = 'canceled';
    await webhook({ event: 'invitee.canceled', created_at: new Date().toISOString(), payload: { ...inv } });
    assert.ok(await waitFor(() => psql(`SELECT status FROM agente.bookings WHERE calendly_invitee_uri='${inv.uri}'`) === 'cancelado'));
    assert.equal(psql(`SELECT canceled_reason FROM agente.bookings WHERE calendly_invitee_uri='${inv.uri}'`), 'Imprevisto');
  });

  await step('reconciliação (com paginação) recupera reservas cujo webhook não chegou', async () => {
    for (const n of [3, 4]) {
      const b = calendlyObjects(n, { email: `pessoa${n}@cliente.com.br`, start: new Date(Date.now() + n * 864e5).toISOString() });
      state.calendly.events[b.ev.uri] = b.ev; state.calendly.invitees[b.inv.uri] = b.inv;
    }
    await run('AgReconciliar001');
    assert.equal(psql("SELECT count(*) FROM agente.bookings WHERE last_source='reconciliacao' AND calendly_event_uri ~ '/E[34]$'"), '2');
    assert.ok(state.requests.filter(r => r.path === '/scheduled_events').length >= 4, 'percorreu as páginas');
    const before = psql('SELECT count(*) FROM agente.bookings');
    await run('AgReconciliar001');
    assert.equal(psql('SELECT count(*) FROM agente.bookings'), before, 'reconciliação idempotente');
  });

  // ---------------------------------------------------------------- falhas e recuperação
  await step('envio aceito com resposta perdida (503): não reenvia; confirma pela busca rfc822msgid', async () => {
    state.fail.sendLoseResponse = 1;
    inbox(gmailMessage({ id: 'm9', threadId: 't9', from: 'Bia <bia@cliente.com.br>', messageId: '<orig-9@cliente.com.br>', text: 'Qual o horário de vocês?' }));
    await poll();
    assert.equal(sentTo('bia@cliente.com.br').length, 1);
    assert.deepEqual(rows("SELECT status FROM agente.outbound_emails WHERE idempotency_key LIKE '%:resposta' ORDER BY created_at DESC LIMIT 1")[0], { status: 'desconhecido' });
    assert.equal(psql("SELECT status FROM agente.messages WHERE gmail_message_id='m9'"), 'falhou');
    assert.ok(!state.inbox.m9.labelIds.includes(L.processado));
    // Na prática a mensagem volta a ser processada após lock_minutes; aqui liberamos o bloqueio para o teste.
    psql("UPDATE agente.messages SET locked_at = now() - interval '1 hour' WHERE gmail_message_id='m9'");
    await poll();
    assert.equal(sentTo('bia@cliente.com.br').length, 1, 'nenhum envio duplicado');
    assert.equal(psql("SELECT status FROM agente.messages WHERE gmail_message_id='m9'"), 'concluida');
    assert.ok(psql("SELECT count(*) FROM agente.action_log WHERE detail->>'verified_by'='busca_rfc822msgid'") === '1');
    assert.ok(state.inbox.m9.labelIds.includes(L.processado));
  });

  await step('IA indisponível: tentativas automáticas e depois falha temporária; próximo ciclo conclui', async () => {
    state.fail.ai = 3; // esgota as 3 tentativas do nó
    inbox(gmailMessage({ id: 'm10', threadId: 't10', from: 'Caio <caio@cliente.com.br>', messageId: '<orig-10@cliente.com.br>', text: 'Qual o horário?' }));
    await poll();
    assert.equal(psql("SELECT status FROM agente.messages WHERE gmail_message_id='m10'"), 'falhou');
    assert.equal(sentTo('caio@cliente.com.br').length, 0);
    psql("UPDATE agente.messages SET locked_at = now() - interval '1 hour' WHERE gmail_message_id='m10'");
    await poll();
    assert.equal(psql("SELECT status FROM agente.messages WHERE gmail_message_id='m10'"), 'concluida');
    assert.equal(sentTo('caio@cliente.com.br').length, 1);
  });

  await step('rejeição definitiva repetida: após o limite, descarta, aplica rótulo de erro e alerta', async () => {
    state.fail.sendReject = 99;
    inbox(gmailMessage({ id: 'm11', threadId: 't11', from: 'Duda <duda@cliente.com.br>', messageId: '<orig-11@cliente.com.br>', text: 'Qual o horário?' }));
    for (let i = 0; i < 3; i++) { await poll(); psql("UPDATE agente.messages SET locked_at = now() - interval '1 hour' WHERE gmail_message_id='m11'"); }
    state.fail.sendReject = 0;
    await poll(); // ciclo após o esgotamento: descarta e alerta
    assert.equal(psql("SELECT status FROM agente.messages WHERE gmail_message_id='m11'"), 'descartada');
    assert.ok(state.inbox.m11.labelIds.includes(L.erro));
    const alert = sentTo('alertas@empresa.com.br').at(-1);
    assert.ok(alert && /não processada após 3 tentativas/.test(Buffer.from(alert.subject.replace(/=\?UTF-8\?B\?|\?=/g, ''), 'base64').toString('utf8')), 'alerta enviado');
    assert.equal(sentTo('duda@cliente.com.br').length, 0);
    await poll();
    assert.equal(sentTo('alertas@empresa.com.br').length, 1, 'alerta não se repete');
  });

  await step('interrupção no meio do processamento: reconciliação libera a trava e o próximo ciclo conclui', async () => {
    inbox(gmailMessage({ id: 'm12', threadId: 't12', from: 'Edu <edu@cliente.com.br>', messageId: '<orig-12@cliente.com.br>', text: 'Qual o horário?' }));
    psql(`SELECT agente.claim_message('${JSON.stringify({ gmail_message_id: 'm12', gmail_thread_id: 't12', from_email: 'edu@cliente.com.br', subject: 'x', body_text: 'x' })}'::jsonb)`);
    psql("UPDATE agente.messages SET locked_at = now() - interval '1 hour' WHERE gmail_message_id='m12'");
    await poll(); // reivindicação recusada? não: trava antiga expira e a mensagem é retomada
    assert.equal(psql("SELECT status FROM agente.messages WHERE gmail_message_id='m12'"), 'concluida');
    assert.equal(sentTo('edu@cliente.com.br').length, 1);
    psql("UPDATE agente.messages SET status='processando', locked_at = now() - interval '1 hour' WHERE gmail_message_id='m1'");
    await run('AgReconciliar001');
    assert.equal(psql("SELECT status FROM agente.messages WHERE gmail_message_id='m1'"), 'falhou');
  });

  await step('processamento concorrente da mesma mensagem: só uma execução envia', async () => {
    inbox(gmailMessage({ id: 'm13', threadId: 't13', from: 'Fê <fe@cliente.com.br>', messageId: '<orig-13@cliente.com.br>', text: 'Qual o horário?' }));
    await Promise.all([poll(5691), poll(5692)]);
    assert.equal(sentTo('fe@cliente.com.br').length, 1);
  });

  server.close();
  console.log(`\n${results.filter(r => r[0] === 'OK').length}/${results.length} cenários OK`);
  fs.writeFileSync(path.join(ROOT, 'tests', 'last-integration-run.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  process.exit(results.every(r => r[0] === 'OK') ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
