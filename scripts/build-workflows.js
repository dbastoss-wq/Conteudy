#!/usr/bin/env node
'use strict';
// Gera os workflows n8n (workflows/*.json) a partir de src/ e prompts/.
// O código dos nós Code é o mesmo coberto pelos testes unitários: os módulos de src/ são embutidos no build.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'workflows');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

// ---------------------------------------------------------------- identificadores fixos
const WF = {
  enviar: 'AgEnviarEmail001',
  processar: 'AgProcessarMsg01',
  caixa: 'AgCaixaEntrada01',
  calendly: 'AgCalendlyHook01',
  reconciliar: 'AgReconciliar001',
  alertas: 'AgAlertas0000001',
  setup: 'AgConfigInicial1',
};
const CRED = {
  postgres: { postgres: { id: 'agPostgres000001', name: 'Agente Postgres' } },
  gmail: { gmailOAuth2: { id: 'agGmailOAuth0001', name: 'Agente Gmail OAuth2' } },
  anthropic: { httpHeaderAuth: { id: 'agAnthropicKey01', name: 'Agente Anthropic API' } },
  calendly: { httpHeaderAuth: { id: 'agCalendlyPat001', name: 'Agente Calendly PAT' } },
};

// ---------------------------------------------------------------- código embutido
function lib(...mods) {
  const parts = mods.map(m => {
    const src = read(`src/${m}.js`).replace(/^'use strict';\n/, '');
    return `const ${m} = (() => { const module = { exports: {} }; ${src}\n return module.exports; })();`;
  });
  return parts.join('\n');
}
const PROMPT = `const SYSTEM_PROMPT_TEMPLATE = ${JSON.stringify(read('prompts/system-prompt.md'))};`;

// ---------------------------------------------------------------- fábrica de nós
let pos = 0;
function node(name, type, typeVersion, parameters, extra = {}) {
  pos += 1;
  const n = {
    id: crypto.createHash('md5').update(name + type + pos).digest('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*/, '$1-$2-$3-$4-$5'),
    name, type, typeVersion, position: [pos * 220, (pos % 4) * 140], parameters,
  };
  return Object.assign(n, extra);
}
const code = (name, js, extra) => node(name, 'n8n-nodes-base.code', 2, { mode: 'runOnceForAllItems', jsCode: js }, extra);
const sql = (name, query, param, extra) => node(name, 'n8n-nodes-base.postgres', 2.6, {
  operation: 'executeQuery', query,
  options: param ? { queryReplacement: `={{ [JSON.stringify(${param})] }}` } : {},
}, Object.assign({ credentials: CRED.postgres, retryOnFail: true, maxTries: 3, waitBetweenTries: 2000 }, extra));
const ifTrue = (name, expr) => node(name, 'n8n-nodes-base.if', 2.2, {
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
    conditions: [{ id: crypto.randomUUID(), leftValue: `={{ ${expr} }}`, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
    combinator: 'and',
  },
  options: {},
});
function http(name, o) {
  const p = {
    method: o.method || 'GET',
    url: o.url,
    authentication: o.cred === 'gmail' ? 'predefinedCredentialType' : 'genericCredentialType',
    sendQuery: !!o.query,
    sendHeaders: !!o.headers,
    sendBody: !!o.body,
    // Com retry, erros HTTP precisam lançar exceção para o n8n repetir; sem retry, o status é tratado no nó seguinte.
    options: { timeout: o.timeout || 30000, response: { response: { fullResponse: true, neverError: !o.retry } } },
  };
  if (o.cred === 'gmail') p.nodeCredentialType = 'gmailOAuth2'; else p.genericAuthType = 'httpHeaderAuth';
  if (o.query) p.queryParameters = { parameters: Object.entries(o.query).map(([name, value]) => ({ name, value })) };
  if (o.headers) p.headerParameters = { parameters: Object.entries(o.headers).map(([name, value]) => ({ name, value })) };
  if (o.body) { p.specifyBody = 'json'; p.jsonBody = o.body; }
  if (o.pagination) p.options.pagination = { pagination: o.pagination };
  const extra = { credentials: CRED[o.cred], onError: 'continueRegularOutput', alwaysOutputData: false };
  // Leituras são idempotentes: novas tentativas automáticas. Envios nunca são repetidos automaticamente.
  if (o.retry) Object.assign(extra, { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000 });
  return node(name, 'n8n-nodes-base.httpRequest', 4.2, p, extra);
}
const execWf = (name, wfId, extra) => node(name, 'n8n-nodes-base.executeWorkflow', 1.2, {
  workflowId: { __rl: true, value: wfId, mode: 'id' },
  workflowInputs: { mappingMode: 'defineBelow', value: {}, matchingColumns: [], schema: [], attemptToConvertTypes: false, convertFieldsToString: true },
  mode: 'each',
  options: { waitForSubWorkflow: true },
}, extra);
const subTrigger = () => node('Entrada', 'n8n-nodes-base.executeWorkflowTrigger', 1.1, { inputSource: 'passthrough' });

function workflow(id, name, nodes, edges, opts = {}) {
  const connections = {};
  for (const [from, to, outIdx = 0] of edges) {
    connections[from] = connections[from] || { main: [] };
    while (connections[from].main.length <= outIdx) connections[from].main.push([]);
    connections[from].main[outIdx].push({ node: to, type: 'main', index: 0 });
  }
  const names = new Set(nodes.map(n => n.name));
  for (const [from, to] of edges) if (!names.has(from) || !names.has(to)) throw new Error(`${name}: conexão inválida ${from} -> ${to}`);
  const settings = { executionOrder: 'v1', saveManualExecutions: true, saveDataErrorExecution: 'all', saveDataSuccessExecution: 'all', callerPolicy: 'workflowsFromSameOwner' };
  if (id !== WF.alertas) settings.errorWorkflow = WF.alertas;
  return { id, name, active: false, isArchived: false, nodes, connections, settings, pinData: {}, meta: { templateCredsSetupCompleted: false }, tags: [], ...opts };
}

// Expressões utilitárias para os nós HTTP.
const GMAIL = "{{ $('Configuração').first().json.r.api.gmail_base }}/gmail/v1/users/me";
const CAL = "{{ $('Configuração').first().json.r.api.calendly_base }}";
const SETTINGS_SQL = 'SELECT agente.settings_get() AS r';

// Trecho comum: resposta HTTP -> {ok, status, body, error}.
const HTTP_RESULT = `
function httpResult(j) {
  if (!j || j.error) {
    const e = (j && j.error) || {};
    return { ok: false, status: Number(e.httpCode || e.status || 0) || 0, body: null, error: String(e.message || e.description || e || 'erro_de_rede').slice(0, 500) };
  }
  const status = Number(j.statusCode || 0);
  return { ok: status >= 200 && status < 300, status, body: j.body, error: status >= 200 && status < 300 ? null : JSON.stringify(j.body || {}).slice(0, 500) };
}`;

// ================================================================ 1. Enviar e-mail idempotente
function wfEnviar() {
  pos = 0;
  const nodes = [
    subTrigger(),
    code('Preparar', `${lib('email')}
const i = $input.first().json;
const s = i.settings;
const rfc = email.newMessageId(s.agent.message_id_domain || s.agent.email.split('@')[1], require('crypto').randomUUID());
return [{ json: { input: i, prepare: {
  idempotency_key: i.idempotency_key, kind: i.kind, conversation_id: i.conversation_id || '', source_message_id: i.source_message_id || '',
  to: i.to, subject: i.subject, body_text: i.body_text, rfc822_message_id: rfc, max_attempts: (s.limits || {}).max_attempts || 3 } } }];`),
    sql('Reservar envio', 'SELECT agente.prepare_outbound($1::jsonb) AS r', "$json.prepare"),
    code('Montar mensagem', `${lib('email')}
const p = $('Preparar').first().json.input;
const r = $input.first().json.r;
const s = p.settings;
if (!r.should_send) return [{ json: { send: false, needs_verification: false, outbound: r } }];
const raw = email.buildRawEmail({
  fromName: s.agent.name, fromEmail: s.agent.email, to: r.to, cc: p.cc || [], replyTo: p.reply_to || '',
  subject: r.subject, messageId: r.rfc822_message_id, inReplyTo: p.in_reply_to || '', references: p.references || '',
  bodyText: r.body_text, agentTag: s.agent.name });
const body = { raw };
if (p.thread_id) body.threadId = p.thread_id;
return [{ json: { send: true, needs_verification: !!r.needs_verification, outbound: r, gmail_body: body,
  verify_query: 'rfc822msgid:' + r.rfc822_message_id.replace(/[<>]/g, '') } }];`),
    code('Configuração', "return [{ json: Object.assign({ r: $('Preparar').first().json.input.settings }, $input.first().json) }];"),
    ifTrue('Deve enviar?', '$json.send'),
    ifTrue('Verificar antes?', '$json.needs_verification'),
    http('Buscar enviado', { url: `=${GMAIL}/messages`, cred: 'gmail', retry: true, query: { q: "={{ $('Montar mensagem').first().json.verify_query }}", includeSpamTrash: 'true' } }),
    code('Avaliar verificação', `${HTTP_RESULT}
const m = $('Montar mensagem').first().json;
const r = httpResult($input.first().json);
if (!r.ok) throw new Error('Falha ao verificar envio anterior: ' + r.error);
const found = (r.body.messages || [])[0];
return [{ json: { already_sent: !!found, record: found ? { outbound_id: m.outbound.outbound_id, status: 'enviado', gmail_message_id: found.id,
  gmail_thread_id: found.threadId, verified_by: 'busca_rfc822msgid', workflow: 'enviar_email', execution_id: $execution.id } : null } }];`),
    ifTrue('Já enviado?', '$json.already_sent'),
    http('Enviar pela Gmail API', { method: 'POST', url: `=${GMAIL}/messages/send`, cred: 'gmail', body: "={{ JSON.stringify($('Montar mensagem').first().json.gmail_body) }}", timeout: 45000 }),
    code('Interpretar envio', `${HTTP_RESULT}
const m = $('Montar mensagem').first().json;
const r = httpResult($input.first().json);
let status;
if (r.ok && r.body && r.body.id) status = 'enviado';
else if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) status = 'falhou';  // rejeição definitiva
else status = 'desconhecido';  // timeout/5xx: pode ter sido aceito; a próxima tentativa verifica antes de reenviar
return [{ json: { record: { outbound_id: m.outbound.outbound_id, status, gmail_message_id: r.ok ? r.body.id : null,
  gmail_thread_id: r.ok ? r.body.threadId : null, error: r.error, http_status: r.status,
  from_email: $('Preparar').first().json.input.settings.agent.email, workflow: 'enviar_email', execution_id: $execution.id } } }];`),
    sql('Registrar resultado', 'SELECT agente.record_send_result($1::jsonb) AS r', '$json.record'),
    code('Resultado', 'return [{ json: $input.first().json.r }];'),
    code('Resultado sem envio', 'const o = $input.first().json.outbound; return [{ json: { outbound_id: o.outbound_id, status: o.status, gmail_message_id: o.gmail_message_id || null, attempts: o.attempts || null } }];'),
  ];
  // "Configuração" expõe as URLs base para os nós HTTP com o mesmo nome usado nos outros workflows.
  const edges = [
    ['Entrada', 'Preparar'], ['Preparar', 'Reservar envio'], ['Reservar envio', 'Montar mensagem'], ['Montar mensagem', 'Configuração'],
    ['Configuração', 'Deve enviar?'], ['Deve enviar?', 'Verificar antes?', 0], ['Deve enviar?', 'Resultado sem envio', 1],
    ['Verificar antes?', 'Buscar enviado', 0], ['Verificar antes?', 'Enviar pela Gmail API', 1],
    ['Buscar enviado', 'Avaliar verificação'], ['Avaliar verificação', 'Já enviado?'],
    ['Já enviado?', 'Registrar resultado', 0], ['Já enviado?', 'Enviar pela Gmail API', 1],
    ['Enviar pela Gmail API', 'Interpretar envio'], ['Interpretar envio', 'Registrar resultado'], ['Registrar resultado', 'Resultado'],
  ];
  return workflow(WF.enviar, 'Agente | Enviar e-mail idempotente', nodes, edges);
}

// ================================================================ 2. Processar mensagem
function wfProcessar() {
  pos = 0;
  const route = (name, value) => ifTrue(name, `$json.route === '${value}'`);
  const nodes = [
    subTrigger(),
    code('Configuração', "return [{ json: { r: $input.first().json.settings } }];"),
    http('Ler mensagem', { url: `=${GMAIL}/messages/{{ $('Entrada').first().json.gmail_message_id }}`, cred: 'gmail', retry: true, query: { format: 'full' } }),
    code('Normalizar', `${lib('email')}
${HTTP_RESULT}
const s = $('Configuração').first().json.r;
const r = httpResult($input.first().json);
if (!r.ok) return [{ json: { route: 'erro_leitura', error: r.error } }];
const msg = email.normalizeGmailMessage(r.body);
const L = s.limits || {};
return [{ json: { route: 'ok', msg, claim: { gmail_message_id: msg.gmail_message_id, gmail_thread_id: msg.gmail_thread_id,
  rfc822_message_id: msg.rfc822_message_id, from_email: msg.from_email, from_name: msg.from_name, to: msg.to,
  subject: msg.subject, body_text: msg.body_text, internal_date: msg.internal_date, max_attempts: L.max_attempts || 3, lock_minutes: L.lock_minutes || 15 } } }];`),
    route('Leitura ok?', 'ok'),
    code('Falha de leitura', "return [{ json: { result: 'erro_leitura', error: $input.first().json.error } }];"),
    sql('Reivindicar mensagem', 'SELECT agente.claim_message($1::jsonb) AS r', '$json.claim'),
    code('Avaliar reivindicação', `const c = $input.first().json.r;
const s = $('Configuração').first().json.r;
const ids = s.gmail_label_ids || {};
let route = 'nada';
if (c.claimed) route = 'processar';
else if (c.exhausted) route = 'esgotada';
else if (['concluida', 'ignorada', 'escalada', 'descartada'].includes(c.status)) route = 'reaplicar_rotulos';
const labels = { concluida: [ids.processado], ignorada: [ids.processado, ids.ignorado], escalada: [ids.processado, ids.escalado],
  descartada: [ids.processado, ids.erro] }[route === 'esgotada' ? 'descartada' : c.status] || [];
return [{ json: { route, claim: c, labels: labels.filter(Boolean) } }];`),
    route('Processar?', 'processar'),
    route('Esgotada?', 'esgotada'),
    route('Reaplicar rótulos?', 'reaplicar_rotulos'),
    http('Rótulos (reaplicar)', { method: 'POST', url: `=${GMAIL}/messages/{{ $('Entrada').first().json.gmail_message_id }}/modify`, cred: 'gmail', retry: true, body: "={{ JSON.stringify({ addLabelIds: $json.labels }) }}" }),
    sql('Descartar mensagem', 'SELECT agente.finish_message($1::jsonb) AS r',
      "{ message_id: $json.claim.message_id, status: 'descartada', error: 'tentativas_esgotadas', workflow: 'processar_mensagem', execution_id: $execution.id }"),
    http('Rótulos (erro)', { method: 'POST', url: `=${GMAIL}/messages/{{ $('Entrada').first().json.gmail_message_id }}/modify`, cred: 'gmail', retry: true, body: "={{ JSON.stringify({ addLabelIds: $('Avaliar reivindicação').first().json.labels }) }}" }),
    code('Montar alerta', `const s = $('Configuração').first().json.r;
const m = $('Normalizar').first().json.msg;
const c = $('Avaliar reivindicação').first().json.claim;
return [{ json: { settings: s, kind: 'alerta', idempotency_key: 'alerta:esgotada:' + c.message_id, to: [s.alert_email || s.escalation.contact_email],
  subject: '[Agente] Mensagem não processada após ' + c.attempts + ' tentativas: ' + (m.subject || '(sem assunto)'),
  body_text: 'O agente não conseguiu processar uma mensagem e parou de tentar.\\n\\nRemetente: ' + m.from_email + '\\nAssunto: ' + m.subject +
    '\\nGmail: https://mail.google.com/mail/u/0/#all/' + m.gmail_thread_id + '\\nID interno: ' + c.message_id +
    '\\n\\nConsulte agente.messages.last_error e agente.action_log para o detalhe. A mensagem recebeu o rótulo de erro e precisa de resposta manual.' } }];`),
    execWf('Enviar alerta', WF.enviar),
    sql('Carregar contexto', 'SELECT agente.get_context($1::jsonb) AS r',
      "{ conversation_id: $('Avaliar reivindicação').first().json.claim.conversation_id, message_id: $('Avaliar reivindicação').first().json.claim.message_id, timezone: $('Configuração').first().json.r.timezone }"),
    code('Filtrar', `${lib('filters')}
const s = $('Configuração').first().json.r;
const msg = $('Normalizar').first().json.msg;
const ctx = $input.first().json.r;
const f = filters.shouldSkip(msg, s, ctx);
const route = !f.skip ? 'ia' : (f.escalate ? 'escalar' : 'ignorar');
return [{ json: { route, ctx, decision: null, policy: f.skip ? { final: route === 'escalar' ? 'escalate' : 'none', reasons: [f.reason], ack_text: null } : null,
  skip_reason: f.reason } }];`),
    route('Usar IA?', 'ia'),
    code('Montar requisição IA', `${lib('ai')}
${PROMPT}
const s = $('Configuração').first().json.r;
const msg = $('Normalizar').first().json.msg;
const ctx = $input.first().json.ctx;
return [{ json: { request: ai.buildRequest(SYSTEM_PROMPT_TEMPLATE, s, msg, ctx) } }];`),
    http('Claude API', { method: 'POST', url: "={{ $('Configuração').first().json.r.api.anthropic_base }}/v1/messages", cred: 'anthropic', retry: true, timeout: 180000,
      headers: { 'anthropic-version': '2023-06-01', 'anthropic-beta': 'server-side-fallback-2026-07-01' }, body: '={{ JSON.stringify($json.request) }}' }),
    code('Aplicar política', `${lib('ai', 'policy')}
${HTTP_RESULT}
const s = $('Configuração').first().json.r;
const msg = $('Normalizar').first().json.msg;
const ctx = $('Filtrar').first().json.ctx;
const r = httpResult($input.first().json);
if (!r.ok) {
  // Falha temporária (rede, 429, 5xx): devolve para nova tentativa no próximo ciclo.
  if (r.status === 0 || r.status === 429 || r.status >= 500) return [{ json: { route: 'falhou', ctx, error: 'ia_indisponivel: ' + r.error } }];
  return [{ json: { route: 'escalar', ctx, decision: null, policy: { final: 'escalate', reasons: ['ia_erro_' + r.status], ack_text: null }, error: r.error } }];
}
const parsed = ai.parseResponse(r.body);
if (!parsed.ok) return [{ json: { route: 'escalar', ctx, decision: null, policy: { final: 'escalate', reasons: [parsed.error], ack_text: null } } }];
const policy = policy_ = policy.applyPolicy(parsed.decision, s, msg, ctx);
const route = { reply: 'responder', escalate: 'escalar', none: 'ignorar' }[policy_.final];
return [{ json: { route, ctx, decision: parsed.decision, policy: policy_, usage: parsed.usage, model: parsed.model, skip_reason: route === 'ignorar' ? 'ia_nao_responder' : null } }];`
      .replace('const policy = policy_ = policy.applyPolicy', 'const policy_ = policy.applyPolicy')),
    code('Estado', 'return [{ json: $input.first().json }];'),
    route('Responder?', 'responder'),
    route('Escalar?', 'escalar'),
    route('Falhou?', 'falhou'),
    code('Montar resposta', `${lib('email')}
const s = $('Configuração').first().json.r;
const msg = $('Normalizar').first().json.msg;
const st = $('Estado').first().json;
const c = $('Avaliar reivindicação').first().json.claim;
return [{ json: { settings: s, kind: 'resposta', idempotency_key: c.message_id + ':resposta', conversation_id: c.conversation_id, source_message_id: c.message_id,
  to: [msg.reply_to || msg.from_email], subject: email.replySubject(msg.subject), body_text: st.policy.reply_text, thread_id: msg.gmail_thread_id,
  in_reply_to: msg.rfc822_message_id, references: [msg.references, msg.rfc822_message_id].filter(Boolean).join(' ') } }];`),
    execWf('Enviar resposta', WF.enviar),
    code('Após resposta', `const s = $('Configuração').first().json.r;
const st = $('Estado').first().json;
const c = $('Avaliar reivindicação').first().json.claim;
const sent = $input.first().json.status === 'enviado';
const d = st.decision || {};
return [{ json: { sent, labels: [(s.gmail_label_ids || {}).processado].filter(Boolean), finish: {
  message_id: c.message_id, status: sent ? 'concluida' : 'falhou', intent: d.intent || null,
  error: sent ? null : 'envio_' + $input.first().json.status, workflow: 'processar_mensagem', execution_id: $execution.id,
  conversation: sent ? { status: d.action === 'perguntar' || d.action === 'enviar_link_agendamento' ? 'aguardando_contato' : 'aberta',
    summary: d.summary, next_action: d.next_action, last_intent: d.intent } : undefined,
  detail: { policy: st.policy && st.policy.reasons, link: st.policy && st.policy.link, model: st.model, usage: st.usage, outbound: $input.first().json } } } }];`),
    ifTrue('Resposta enviada?', '$json.sent'),
    http('Rótulos (concluída)', { method: 'POST', url: `=${GMAIL}/messages/{{ $('Entrada').first().json.gmail_message_id }}/modify`, cred: 'gmail', retry: true, body: "={{ JSON.stringify({ addLabelIds: $json.labels }) }}" }),
    sql('Finalizar concluída', 'SELECT agente.finish_message($1::jsonb) AS r', "$('Após resposta').first().json.finish"),
    sql('Finalizar falha de envio', 'SELECT agente.finish_message($1::jsonb) AS r', "$('Após resposta').first().json.finish"),
    code('Montar encaminhamento', `const s = $('Configuração').first().json.r;
const msg = $('Normalizar').first().json.msg;
const st = $('Estado').first().json;
const c = $('Avaliar reivindicação').first().json.claim;
const d = st.decision || {};
const reasons = ((st.policy && st.policy.reasons) || []).join(', ');
const body = ['Uma conversa precisa de atendimento humano.', '',
  'Contato: ' + (msg.from_name ? msg.from_name + ' <' + msg.from_email + '>' : msg.from_email),
  'Assunto: ' + msg.subject, 'Motivo: ' + reasons + (d.escalation_reason ? ' — ' + d.escalation_reason : ''),
  'Resumo: ' + (d.summary || (st.ctx.conversation && st.ctx.conversation.summary) || '(sem resumo)'),
  'Abrir no Gmail: https://mail.google.com/mail/u/0/#all/' + msg.gmail_thread_id, '',
  'Responda pela caixa do agente (ou mantenha ' + s.agent.email + ' em cópia) para que o histórico fique registrado.',
  'Enquanto a conversa estiver com status "escalada", o agente não responde automaticamente nesta conversa.', '',
  '--- Mensagem recebida ---', msg.body_new_text || msg.body_text].join('\\n');
return [{ json: { settings: s, kind: 'encaminhamento', idempotency_key: c.message_id + ':encaminhamento', conversation_id: c.conversation_id,
  source_message_id: c.message_id, to: [s.escalation.contact_email], reply_to: msg.reply_to || msg.from_email,
  subject: '[Encaminhado pelo agente] ' + (msg.subject || '(sem assunto)'), body_text: body } }];`),
    execWf('Enviar encaminhamento', WF.enviar),
    code('Montar confirmação', `${lib('email')}
const fwd = $input.first().json;
const st = $('Estado').first().json;
if (fwd.status !== 'enviado' || !st.policy || !st.policy.ack_text) return [];
const s = $('Configuração').first().json.r;
const msg = $('Normalizar').first().json.msg;
const c = $('Avaliar reivindicação').first().json.claim;
return [{ json: { settings: s, kind: 'confirmacao_encaminhamento', idempotency_key: c.message_id + ':confirmacao', conversation_id: c.conversation_id,
  source_message_id: c.message_id, to: [msg.reply_to || msg.from_email], subject: email.replySubject(msg.subject), body_text: st.policy.ack_text,
  thread_id: msg.gmail_thread_id, in_reply_to: msg.rfc822_message_id, references: [msg.references, msg.rfc822_message_id].filter(Boolean).join(' ') } }];`),
    execWf('Enviar confirmação', WF.enviar, { alwaysOutputData: true }),
    code('Após encaminhamento', `const s = $('Configuração').first().json.r;
const st = $('Estado').first().json;
const c = $('Avaliar reivindicação').first().json.claim;
const fwd = $('Enviar encaminhamento').first().json;
const ack = $input.first().json || {};
const ok = fwd.status === 'enviado';
const ids = s.gmail_label_ids || {};
const d = st.decision || {};
return [{ json: { sent: ok, labels: [ids.processado, ids.escalado].filter(Boolean), finish: {
  message_id: c.message_id, status: ok ? 'escalada' : 'falhou', intent: d.intent || null, skip_reason: st.skip_reason || null,
  error: ok ? null : 'encaminhamento_' + fwd.status, workflow: 'processar_mensagem', execution_id: $execution.id,
  conversation: ok ? { status: 'escalada', summary: d.summary, next_action: 'Aguardando resposta de ' + s.escalation.contact_email, last_intent: d.intent } : undefined,
  detail: { reasons: st.policy && st.policy.reasons, encaminhamento: fwd, confirmacao: ack.status ? ack : null, model: st.model, usage: st.usage } } } }];`),
    ifTrue('Encaminhamento enviado?', '$json.sent'),
    http('Rótulos (escalada)', { method: 'POST', url: `=${GMAIL}/messages/{{ $('Entrada').first().json.gmail_message_id }}/modify`, cred: 'gmail', retry: true, body: "={{ JSON.stringify({ addLabelIds: $json.labels }) }}" }),
    sql('Finalizar escalada', 'SELECT agente.finish_message($1::jsonb) AS r', "$('Após encaminhamento').first().json.finish"),
    sql('Finalizar falha de encaminhamento', 'SELECT agente.finish_message($1::jsonb) AS r', "$('Após encaminhamento').first().json.finish"),
    sql('Finalizar falha temporária', 'SELECT agente.finish_message($1::jsonb) AS r',
      "{ message_id: $('Avaliar reivindicação').first().json.claim.message_id, status: 'falhou', error: $json.error, workflow: 'processar_mensagem', execution_id: $execution.id }"),
    code('Montar ignorada', `const s = $('Configuração').first().json.r;
const st = $('Estado').first().json;
const c = $('Avaliar reivindicação').first().json.claim;
const ids = s.gmail_label_ids || {};
const d = st.decision || {};
return [{ json: { labels: [ids.processado, ids.ignorado].filter(Boolean), finish: { message_id: c.message_id, status: 'ignorada',
  skip_reason: st.skip_reason || 'ia_nao_responder', intent: d.intent || null, workflow: 'processar_mensagem', execution_id: $execution.id,
  detail: { reasons: st.policy && st.policy.reasons, model: st.model || null } } } }];`),
    http('Rótulos (ignorada)', { method: 'POST', url: `=${GMAIL}/messages/{{ $('Entrada').first().json.gmail_message_id }}/modify`, cred: 'gmail', retry: true, body: "={{ JSON.stringify({ addLabelIds: $json.labels }) }}" }),
    sql('Finalizar ignorada', 'SELECT agente.finish_message($1::jsonb) AS r', "$('Montar ignorada').first().json.finish"),
  ];
  const edges = [
    ['Entrada', 'Configuração'], ['Configuração', 'Ler mensagem'], ['Ler mensagem', 'Normalizar'], ['Normalizar', 'Leitura ok?'],
    ['Leitura ok?', 'Reivindicar mensagem', 0], ['Leitura ok?', 'Falha de leitura', 1],
    ['Reivindicar mensagem', 'Avaliar reivindicação'], ['Avaliar reivindicação', 'Processar?'],
    ['Processar?', 'Carregar contexto', 0], ['Processar?', 'Esgotada?', 1],
    ['Esgotada?', 'Descartar mensagem', 0], ['Esgotada?', 'Reaplicar rótulos?', 1],
    ['Reaplicar rótulos?', 'Rótulos (reaplicar)', 0],
    ['Descartar mensagem', 'Rótulos (erro)'], ['Rótulos (erro)', 'Montar alerta'], ['Montar alerta', 'Enviar alerta'],
    ['Carregar contexto', 'Filtrar'], ['Filtrar', 'Usar IA?'],
    ['Usar IA?', 'Montar requisição IA', 0], ['Usar IA?', 'Estado', 1],
    ['Montar requisição IA', 'Claude API'], ['Claude API', 'Aplicar política'], ['Aplicar política', 'Estado'],
    ['Estado', 'Responder?'], ['Responder?', 'Montar resposta', 0], ['Responder?', 'Escalar?', 1],
    ['Escalar?', 'Montar encaminhamento', 0], ['Escalar?', 'Falhou?', 1],
    ['Falhou?', 'Finalizar falha temporária', 0], ['Falhou?', 'Montar ignorada', 1],
    ['Montar resposta', 'Enviar resposta'], ['Enviar resposta', 'Após resposta'], ['Após resposta', 'Resposta enviada?'],
    ['Resposta enviada?', 'Rótulos (concluída)', 0], ['Resposta enviada?', 'Finalizar falha de envio', 1], ['Rótulos (concluída)', 'Finalizar concluída'],
    ['Montar encaminhamento', 'Enviar encaminhamento'], ['Enviar encaminhamento', 'Montar confirmação'], ['Montar confirmação', 'Enviar confirmação'],
    ['Enviar confirmação', 'Após encaminhamento'], ['Após encaminhamento', 'Encaminhamento enviado?'],
    ['Encaminhamento enviado?', 'Rótulos (escalada)', 0], ['Encaminhamento enviado?', 'Finalizar falha de encaminhamento', 1], ['Rótulos (escalada)', 'Finalizar escalada'],
    ['Montar ignorada', 'Rótulos (ignorada)'], ['Rótulos (ignorada)', 'Finalizar ignorada'],
  ];
  return workflow(WF.processar, 'Agente | Processar mensagem', nodes, edges);
}

// ================================================================ 3. Caixa de entrada (polling)
function wfCaixa() {
  pos = 0;
  const nodes = [
    node('A cada 2 minutos', 'n8n-nodes-base.scheduleTrigger', 1.2, { rule: { interval: [{ field: 'minutes', minutesInterval: 2 }] } }),
    node('Executar agora', 'n8n-nodes-base.manualTrigger', 1, {}),
    sql('Configuração', SETTINGS_SQL),
    code('Validar configuração', `const s = $input.first().json.r;
const missing = ['agent', 'company', 'escalation', 'gmail', 'api', 'meeting_types', 'knowledge_base', 'gmail_label_ids'].filter(k => !s[k]);
if (missing.length) throw new Error('Configuração incompleta em agente.settings: ' + missing.join(', ') + '. Rode seed-settings e o workflow de configuração inicial.');
if (s.paused === true) return [];
return [{ json: { ok: true } }];`),
    http('Listar mensagens', { url: `=${GMAIL}/messages`, cred: 'gmail', retry: true,
      query: { q: "={{ $('Configuração').first().json.r.gmail.query }}", maxResults: "={{ $('Configuração').first().json.r.gmail.max_per_run || 20 }}" } }),
    code('Separar mensagens', `${HTTP_RESULT}
const r = httpResult($input.first().json);
if (!r.ok) throw new Error('Gmail messages.list falhou: ' + r.status + ' ' + r.error);
const s = $('Configuração').first().json.r;
// A API devolve as mais recentes primeiro; processa na ordem de chegada.
return (r.body.messages || []).reverse().map(m => ({ json: { gmail_message_id: m.id, settings: s } }));`),
    execWf('Processar mensagem', WF.processar, { onError: 'continueRegularOutput' }),
  ];
  const edges = [['A cada 2 minutos', 'Configuração'], ['Executar agora', 'Configuração'], ['Configuração', 'Validar configuração'],
    ['Validar configuração', 'Listar mensagens'], ['Listar mensagens', 'Separar mensagens'], ['Separar mensagens', 'Processar mensagem']];
  return workflow(WF.caixa, 'Agente | Caixa de entrada (polling)', nodes, edges);
}

// ================================================================ 4. Calendly webhook
function wfCalendly() {
  pos = 0;
  const nodes = [
    node('Webhook Calendly', 'n8n-nodes-base.webhook', 2, { httpMethod: 'POST', path: 'calendly', responseMode: 'responseNode', options: { rawBody: true } },
      { webhookId: '6f1d3a52-0c2e-4f7e-9a51-7c3b2a1d9e0f' }),
    code('Validar assinatura', `${lib('calendly')}
const item = $input.first();
let raw = '';
if (item.binary && item.binary.data) raw = (await this.helpers.getBinaryDataBuffer(0, 'data')).toString('utf8');
else raw = JSON.stringify(item.json.body);
const headers = item.json.headers || {};
const v = calendly.verifySignature(headers['calendly-webhook-signature'], raw, $env.CALENDLY_WEBHOOK_SIGNING_KEY,
  Number($env.CALENDLY_WEBHOOK_TOLERANCE_SECONDS || 180));
let body = null;
try { body = JSON.parse(raw); } catch (e) { return [{ json: { valid: false, reason: 'json_invalido' } }]; }
return [{ json: { valid: v.valid, reason: v.reason, body, event: { dedupe_key: calendly.dedupeKey(body), source: 'calendly', event: body.event, payload: body } } }];`),
    ifTrue('Assinatura válida?', '$json.valid'),
    node('Responder 401', 'n8n-nodes-base.respondToWebhook', 1.1, { respondWith: 'json', responseBody: '={{ JSON.stringify({ ok: false, reason: $json.reason }) }}', options: { responseCode: 401 } }),
    sql('Registrar evento', 'SELECT agente.register_webhook_event($1::jsonb) AS r', '$json.event'),
    node('Responder 200', 'n8n-nodes-base.respondToWebhook', 1.1, { respondWith: 'json', responseBody: '={{ JSON.stringify({ ok: true, duplicate: !$json.r.is_new }) }}', options: { responseCode: 200 } }),
    ifTrue('Processar evento?', "$('Registrar evento').first().json.r.process && ['invitee.created','invitee.canceled'].includes($('Validar assinatura').first().json.body.event)"),
    sql('Configuração', SETTINGS_SQL),
    http('Buscar convidado', { url: `={{ $('Validar assinatura').first().json.body.payload.uri.replace('https://api.calendly.com', $json.r.api.calendly_base) }}`, cred: 'calendly', retry: true }),
    http('Buscar evento', { url: `={{ ($('Validar assinatura').first().json.body.payload.event || $('Validar assinatura').first().json.body.payload.scheduled_event.uri).replace('https://api.calendly.com', $('Configuração').first().json.r.api.calendly_base) }}`, cred: 'calendly', retry: true }),
    code('Montar agendamento', `${lib('calendly')}
${HTTP_RESULT}
const ev = httpResult($input.first().json);
const inv = httpResult($('Buscar convidado').first().json);
const reg = $('Registrar evento').first().json.r;
if (!inv.ok || !ev.ok) return [{ json: { ok: false, finish: { webhook_event_id: reg.webhook_event_id, status: 'falhou',
  error: 'verificacao_calendly: convidado=' + inv.status + ' evento=' + ev.status } } }];
const b = calendly.bookingFromApi(ev.body.resource, inv.body.resource, 'webhook');
b.workflow = 'calendly_webhook'; b.execution_id = $execution.id;
return [{ json: { ok: true, booking: b } }];`),
    ifTrue('Verificado?', '$json.ok'),
    sql('Gravar agendamento', 'SELECT agente.upsert_booking($1::jsonb) AS r', '$json.booking'),
    sql('Concluir evento', 'SELECT agente.finish_webhook_event($1::jsonb)', "{ webhook_event_id: $('Registrar evento').first().json.r.webhook_event_id, status: 'processado' }"),
    sql('Evento com falha', 'SELECT agente.finish_webhook_event($1::jsonb)', '$json.finish'),
    sql('Evento ignorado', 'SELECT agente.finish_webhook_event($1::jsonb)', "{ webhook_event_id: $('Registrar evento').first().json.r.webhook_event_id, status: 'processado', error: 'evento_nao_tratado_ou_duplicado' }"),
  ];
  const edges = [
    ['Webhook Calendly', 'Validar assinatura'], ['Validar assinatura', 'Assinatura válida?'],
    ['Assinatura válida?', 'Registrar evento', 0], ['Assinatura válida?', 'Responder 401', 1],
    ['Registrar evento', 'Responder 200'], ['Responder 200', 'Processar evento?'],
    ['Processar evento?', 'Configuração', 0], ['Processar evento?', 'Evento ignorado', 1],
    ['Configuração', 'Buscar convidado'], ['Buscar convidado', 'Buscar evento'], ['Buscar evento', 'Montar agendamento'], ['Montar agendamento', 'Verificado?'],
    ['Verificado?', 'Gravar agendamento', 0], ['Verificado?', 'Evento com falha', 1], ['Gravar agendamento', 'Concluir evento'],
  ];
  // Duplicatas já processadas não devem marcar o evento original; o nó "Evento ignorado" só toca eventos novos não tratados.
  nodes.find(n => n.name === 'Evento ignorado').parameters.query =
    "SELECT agente.finish_webhook_event($1::jsonb) WHERE ($1::jsonb->>'process')::boolean";
  nodes.find(n => n.name === 'Evento ignorado').parameters.options.queryReplacement =
    "={{ [JSON.stringify({ webhook_event_id: $('Registrar evento').first().json.r.webhook_event_id, status: 'processado', error: 'evento_nao_tratado', process: $('Registrar evento').first().json.r.process })] }}";
  return workflow(WF.calendly, 'Agente | Calendly webhook', nodes, edges);
}

// ================================================================ 5. Reconciliação
function wfReconciliar() {
  pos = 0;
  const nodes = [
    node('A cada 30 minutos', 'n8n-nodes-base.scheduleTrigger', 1.2, { rule: { interval: [{ field: 'minutes', minutesInterval: 30 }] } }),
    node('Executar agora', 'n8n-nodes-base.manualTrigger', 1, {}),
    sql('Configuração', SETTINGS_SQL),
    sql('Liberar travas antigas', 'SELECT agente.reset_stale($1::jsonb) AS r', "{ max_attempts: ($json.r.limits || {}).max_attempts || 3, lock_minutes: ($json.r.limits || {}).lock_minutes || 15 }"),
    code('Janela', `const s = $('Configuração').first().json.r;
const c = s.calendly || {};
if (!c.user_uri) throw new Error('calendly.user_uri ausente: rode o workflow de configuração inicial.');
const now = Date.now();
return [{ json: { min: new Date(now - (c.reconcile_days_back || 2) * 864e5).toISOString(), max: new Date(now + (c.reconcile_days_ahead || 60) * 864e5).toISOString(), user: c.user_uri } }];`),
    http('Listar eventos', { url: `=${CAL}/scheduled_events`, cred: 'calendly', retry: true,
      query: { user: '={{ $json.user }}', min_start_time: '={{ $json.min }}', max_start_time: '={{ $json.max }}', count: '100', sort: 'start_time:asc' },
      pagination: { paginationMode: 'responseContainsNextURL', nextURL: '={{ $response.body.pagination.next_page }}',
        paginationCompleteWhen: 'other', completeExpression: '={{ !$response.body.pagination || !$response.body.pagination.next_page }}', limitPagesFetched: true, maxRequests: 20 } }),
    code('Eventos', `${HTTP_RESULT}
const out = [];
for (const it of $input.all()) {
  const r = httpResult(it.json);
  if (!r.ok) throw new Error('Calendly scheduled_events falhou: ' + r.status + ' ' + r.error);
  for (const ev of r.body.collection || []) out.push({ json: { event: ev, invitees_url: ev.uri.replace('https://api.calendly.com', $('Configuração').first().json.r.api.calendly_base) + '/invitees' } });
}
return out;`),
    http('Listar convidados', { url: '={{ $json.invitees_url }}', cred: 'calendly', retry: true, query: { count: '100' } }),
    code('Montar agendamentos', `${lib('calendly')}
${HTTP_RESULT}
const events = Object.fromEntries($('Eventos').all().map(i => [i.json.event.uri, i.json.event]));
const out = [];
for (const it of $input.all()) {
  const r = httpResult(it.json);
  if (!r.ok) throw new Error('Calendly invitees falhou: ' + r.status + ' ' + r.error);
  for (const inv of r.body.collection || []) {
    const ev = events[inv.event];
    if (!ev) continue;
    const b = calendly.bookingFromApi(ev, inv, 'reconciliacao');
    b.workflow = 'reconciliacao'; b.execution_id = $execution.id;
    out.push({ json: { booking: b } });
  }
}
return out;`),
    sql('Gravar agendamentos', 'SELECT agente.upsert_booking($1::jsonb) AS r', '$json.booking'),
    code('Resumo', `const changes = {};
for (const it of $input.all()) changes[it.json.r.change] = (changes[it.json.r.change] || 0) + 1;
return [{ json: { log: { workflow: 'reconciliacao', execution_id: $execution.id, action: 'reconciliar_calendly', status: 'ok',
  detail: { total: $input.all().length, changes, stale: $('Liberar travas antigas').first().json.r } } } }];`),
    sql('Registrar reconciliação', 'SELECT agente.log($1::jsonb)', '$json.log'),
  ];
  const edges = [['A cada 30 minutos', 'Configuração'], ['Executar agora', 'Configuração'], ['Configuração', 'Liberar travas antigas'],
    ['Liberar travas antigas', 'Janela'], ['Janela', 'Listar eventos'], ['Listar eventos', 'Eventos'], ['Eventos', 'Listar convidados'],
    ['Listar convidados', 'Montar agendamentos'], ['Montar agendamentos', 'Gravar agendamentos'], ['Gravar agendamentos', 'Resumo'], ['Resumo', 'Registrar reconciliação']];
  return workflow(WF.reconciliar, 'Agente | Reconciliação', nodes, edges);
}

// ================================================================ 6. Alertas de falha (Error Workflow)
function wfAlertas() {
  pos = 0;
  const nodes = [
    node('Falha em workflow', 'n8n-nodes-base.errorTrigger', 1, {}),
    sql('Configuração', SETTINGS_SQL),
    code('Montar alerta', `const e = $('Falha em workflow').first().json;
const s = $input.first().json.r;
const exec = e.execution || {}; const wf = e.workflow || {}; const err = exec.error || (e.trigger && e.trigger.error) || {};
const id = exec.id || ('trigger-' + Date.now());
// No máximo um alerta por workflow + erro + hora: um erro persistente não vira um e-mail a cada ciclo.
const sig = require('crypto').createHash('sha1').update(String(wf.id) + '|' + String(err.message || '').replace(/\d+/g, '#')).digest('hex').slice(0, 16);
const bucket = new Date().toISOString().slice(0, 13);
return [{ json: {
  log: { workflow: wf.name, execution_id: String(id), entity_type: 'execution', entity_id: String(id), action: 'falha_workflow', status: 'erro',
    detail: { node: exec.lastNodeExecuted, message: err.message, url: exec.url } },
  mail: { settings: s, kind: 'alerta', idempotency_key: 'alerta:execucao:' + sig + ':' + bucket, to: [s.alert_email || (s.escalation || {}).contact_email],
    subject: '[Agente] Falha no workflow ' + wf.name,
    body_text: 'Workflow: ' + wf.name + '\\nExecução: ' + id + '\\nNó: ' + (exec.lastNodeExecuted || '?') + '\\nErro: ' + (err.message || '?') +
      '\\nLink: ' + (exec.url || '(sem link)') + '\\n\\nAs mensagens afetadas são reprocessadas automaticamente até o limite de tentativas.' } } }];`),
    sql('Registrar falha', 'SELECT agente.log($1::jsonb)', '$json.log'),
    code('E-mail de alerta', "return [{ json: $('Montar alerta').first().json.mail }];"),
    execWf('Enviar alerta', WF.enviar),
  ];
  const edges = [['Falha em workflow', 'Configuração'], ['Configuração', 'Montar alerta'], ['Montar alerta', 'Registrar falha'],
    ['Registrar falha', 'E-mail de alerta'], ['E-mail de alerta', 'Enviar alerta']];
  return workflow(WF.alertas, 'Agente | Alertas de falha', nodes, edges);
}

// ================================================================ 7. Configuração inicial (manual)
function wfSetup() {
  pos = 0;
  const nodes = [
    node('Executar configuração', 'n8n-nodes-base.manualTrigger', 1, {}),
    sql('Configuração', SETTINGS_SQL),
    code('Rótulos desejados', "const l = $input.first().json.r.gmail.labels; return Object.values(l).map(name => ({ json: { name } }));"),
    http('Criar rótulo', { method: 'POST', url: `=${GMAIL}/labels`, cred: 'gmail', retry: false,
      body: "={{ JSON.stringify({ name: $json.name, labelListVisibility: 'labelShow', messageListVisibility: 'show' }) }}" }),
    code('Um item', 'return [{ json: { created: $input.all().map(i => i.json.statusCode) } }];'),
    http('Listar rótulos', { url: `=${GMAIL}/labels`, cred: 'gmail', retry: true }),
    code('Mapear rótulos', `${HTTP_RESULT}
const r = httpResult($input.first().json);
if (!r.ok) throw new Error('Gmail labels.list falhou: ' + r.error);
const want = $('Configuração').first().json.r.gmail.labels;
const byName = Object.fromEntries((r.body.labels || []).map(l => [l.name, l.id]));
const ids = {};
for (const [k, name] of Object.entries(want)) { if (!byName[name]) throw new Error('Rótulo não encontrado: ' + name); ids[k] = byName[name]; }
return [{ json: { ids } }];`),
    sql('Salvar rótulos', "SELECT agente.settings_set('gmail_label_ids', $1::jsonb)", '$json.ids'),
    http('Calendly usuário', { url: `=${CAL}/users/me`, cred: 'calendly', retry: true }),
    code('Dados Calendly', `${HTTP_RESULT}
const r = httpResult($input.first().json);
if (!r.ok) throw new Error('Calendly /users/me falhou: ' + r.status + ' ' + r.error);
const u = r.body.resource;
const c = Object.assign({}, $('Configuração').first().json.r.calendly, { user_uri: u.uri, organization_uri: u.current_organization,
  scheduling_url: u.scheduling_url, timezone: u.timezone, user_name: u.name });
return [{ json: { calendly: c } }];`),
    sql('Salvar Calendly', "SELECT agente.settings_set('calendly', $1::jsonb)", '$json.calendly'),
    http('Tipos de evento', { url: `=${CAL}/event_types`, cred: 'calendly', retry: true, query: { user: "={{ $('Dados Calendly').first().json.calendly.user_uri }}", active: 'true', count: '100' } }),
    code('Resumo tipos', `${HTTP_RESULT}
const r = httpResult($input.first().json);
const types = r.ok ? (r.body.collection || []).map(t => ({ name: t.name, duration_min: t.duration, scheduling_url: t.scheduling_url, event_type_uri: t.uri, active: t.active })) : [];
return [{ json: { types } }];`),
    sql('Salvar tipos encontrados', "SELECT agente.settings_set('calendly_event_types_discovered', $1::jsonb)", '$json.types'),
    ifTrue('Webhooks habilitados?', "$('Dados Calendly').first().json.calendly.webhooks_enabled && !!$('Dados Calendly').first().json.calendly.webhook_url"),
    http('Criar assinatura webhook', { method: 'POST', url: `=${CAL}/webhook_subscriptions`, cred: 'calendly', retry: false,
      body: "={{ JSON.stringify({ url: $('Dados Calendly').first().json.calendly.webhook_url, events: ['invitee.created', 'invitee.canceled'], organization: $('Dados Calendly').first().json.calendly.organization_uri, user: $('Dados Calendly').first().json.calendly.user_uri, scope: 'user', signing_key: $env.CALENDLY_WEBHOOK_SIGNING_KEY }) }}" }),
    code('Resultado webhook', `${HTTP_RESULT}
const r = httpResult($input.first().json);
// 409 = assinatura já existe para esta URL (idempotente). 403 costuma indicar plano sem webhooks: use a reconciliação periódica.
return [{ json: { status: r.status, ok: r.ok || r.status === 409, body: r.body } }];`),
  ];
  const edges = [['Executar configuração', 'Configuração'], ['Configuração', 'Rótulos desejados'], ['Rótulos desejados', 'Criar rótulo'],
    ['Criar rótulo', 'Um item'], ['Um item', 'Listar rótulos'], ['Listar rótulos', 'Mapear rótulos'], ['Mapear rótulos', 'Salvar rótulos'],
    ['Salvar rótulos', 'Calendly usuário'], ['Calendly usuário', 'Dados Calendly'], ['Dados Calendly', 'Salvar Calendly'],
    ['Salvar Calendly', 'Tipos de evento'], ['Tipos de evento', 'Resumo tipos'], ['Resumo tipos', 'Salvar tipos encontrados'],
    ['Salvar tipos encontrados', 'Webhooks habilitados?'], ['Webhooks habilitados?', 'Criar assinatura webhook', 0], ['Criar assinatura webhook', 'Resultado webhook']];
  return workflow(WF.setup, 'Agente | Configuração inicial', nodes, edges);
}

// ---------------------------------------------------------------- saída
fs.mkdirSync(OUT, { recursive: true });
const all = { '01-enviar-email': wfEnviar(), '02-processar-mensagem': wfProcessar(), '03-caixa-de-entrada': wfCaixa(),
  '04-calendly-webhook': wfCalendly(), '05-reconciliacao': wfReconciliar(), '06-alertas': wfAlertas(), '00-configuracao-inicial': wfSetup() };
for (const [file, wf] of Object.entries(all)) fs.writeFileSync(path.join(OUT, `${file}.json`), JSON.stringify(wf, null, 2) + '\n');
console.log(`gerados ${Object.keys(all).length} workflows em ${path.relative(process.cwd(), OUT) || '.'}`);
module.exports = { WF, CRED };
