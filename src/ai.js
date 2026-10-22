'use strict';
// Monta a requisição para a Claude Messages API e interpreta a resposta estruturada.
// O template do prompt de sistema é injetado em SYSTEM_PROMPT_TEMPLATE pelo build (prompts/system-prompt.md).

const INTENTS = ['informacao', 'agendamento', 'reagendamento', 'cancelamento', 'status_agendamento', 'reclamacao', 'outro', 'spam_ou_automatico',
  'crise_ou_risco', 'violencia_ou_risco_terceiros', 'urgencia_medica', 'pedido_receita_ou_documento', 'duvida_clinica', 'duvida_teleconsulta'];
const RISK_LEVELS = ['nenhum', 'possivel', 'alto'];
const AREAS = ['geral', 'psiquiatria'];
const ACTIONS = ['responder', 'perguntar', 'enviar_link_agendamento', 'encaminhar_responsavel', 'nao_responder'];

const DECISION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'action', 'meeting_type_key', 'reply_body', 'escalation_reason', 'missing_info', 'summary', 'next_action', 'kb_grounded', 'confidence',
    'risk_level', 'area', 'menor_de_idade', 'fora_do_brasil'],
  properties: {
    intent: { type: 'string', enum: INTENTS },
    action: { type: 'string', enum: ACTIONS },
    meeting_type_key: { type: 'string', description: 'Chave do tipo de reunião, ou string vazia.' },
    reply_body: { type: 'string', description: 'Texto puro da resposta ao contato, sem assinatura e sem URLs. Use [[LINK]] para links.' },
    escalation_reason: { type: 'string' },
    missing_info: { type: 'string' },
    summary: { type: 'string' },
    next_action: { type: 'string' },
    kb_grounded: { type: 'boolean' },
    confidence: { type: 'number', description: 'Confiança de 0 a 1 na decisão.' },
    risk_level: { type: 'string', enum: RISK_LEVELS, description: 'Sinal de risco (crise, autolesão, risco a terceiros, urgência).' },
    area: { type: 'string', enum: AREAS },
    menor_de_idade: { type: 'boolean', description: 'A mensagem indica que o paciente é menor de 18 anos.' },
    fora_do_brasil: { type: 'boolean', description: 'A mensagem indica que o paciente está fora do Brasil.' },
  },
};

function fill(template, vars) {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    const v = key.split('.').reduce((o, k) => (o == null ? o : o[k]), vars);
    return v == null ? '' : String(v);
  });
}

function describeMeetingTypes(types) {
  return (types || []).map(t => `- ${t.key}: ${t.name} — ${t.duration_min} min — ${t.purpose}${t.area ? ` — área: ${t.area}` : ''}`).join('\n') || '- (nenhum tipo configurado)';
}

// Blocos {{#psiquiatria}}...{{/psiquiatria}} só entram quando psiquiatria.enabled.
function buildSystemPrompt(template, settings) {
  const psiq = !!(settings.psiquiatria && settings.psiquiatria.enabled);
  const t = String(template).replace(/\{\{#psiquiatria\}\}([\s\S]*?)\{\{\/psiquiatria\}\}/g, (_, inner) => (psiq ? inner : ''));
  return fill(t, {
    psiquiatria: settings.psiquiatria || {},
    agent: settings.agent || {},
    company: settings.company || {},
    timezone: settings.timezone || 'America/Sao_Paulo',
    meeting_types: describeMeetingTypes(settings.meeting_types),
    knowledge_base: settings.knowledge_base || '(base vazia)',
  });
}

function escapeTags(s) {
  return String(s || '').replace(/<\/?(email_recebido|historico|agendamentos_verificados)[^>]*>/gi, '[tag removida]');
}

function buildUserContent(msg, ctx) {
  const history = (ctx.history || []).map(m =>
    `[${m.at}] ${m.direction === 'out' ? 'AGENTE' : 'CONTATO'} (${m.from_email}): ${escapeTags(m.body).slice(0, 1500)}`).join('\n');
  const bookings = (ctx.bookings || []).map(b =>
    `- ${b.event_name} | status=${b.status} | início=${b.start_local} | fim=${b.end_local} | fuso=${b.timezone}`).join('\n') || '(nenhum)';
  return [
    `Contato: ${msg.from_name || '(sem nome)'} <${msg.from_email}>`,
    `Resumo anterior da conversa: ${ctx.conversation && ctx.conversation.summary ? ctx.conversation.summary : '(primeiro contato)'}`,
    `<historico>\n${history || '(sem mensagens anteriores)'}\n</historico>`,
    `<agendamentos_verificados>\n${bookings}\n</agendamentos_verificados>`,
    `<email_recebido>\nAssunto: ${escapeTags(msg.subject)}\n\n${escapeTags(msg.body_new_text || msg.body_text)}\n</email_recebido>`,
    'Decida a ação conforme as regras e responda somente no formato estruturado.',
  ].join('\n\n');
}

function buildRequest(template, settings, msg, ctx) {
  const ai = settings.ai || {};
  const body = {
    model: ai.model || 'claude-opus-5-5',
    max_tokens: ai.max_tokens || 4000,
    system: [{ type: 'text', text: buildSystemPrompt(template, settings), cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: buildUserContent(msg, ctx) }],
    output_config: { effort: ai.effort || 'medium', format: { type: 'json_schema', schema: DECISION_SCHEMA } },
  };
  if (ai.fallbacks !== false) body.fallbacks = 'default';
  return body;
}

// Retorna { ok: true, decision } ou { ok: false, error }.
function parseResponse(resp) {
  if (!resp || typeof resp !== 'object') return { ok: false, error: 'resposta_vazia' };
  if (resp.type === 'error' || resp.error) return { ok: false, error: `api_error:${(resp.error && resp.error.type) || 'desconhecido'}` };
  if (resp.stop_reason === 'refusal') return { ok: false, error: 'recusa_do_modelo' };
  if (resp.stop_reason === 'max_tokens') return { ok: false, error: 'resposta_truncada' };
  const text = (resp.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  let d;
  try { d = JSON.parse(text); } catch (e) { return { ok: false, error: 'json_invalido' }; }
  if (!ACTIONS.includes(d.action) || !INTENTS.includes(d.intent)) return { ok: false, error: 'schema_invalido' };
  if (d.risk_level != null && !RISK_LEVELS.includes(d.risk_level)) return { ok: false, error: 'schema_invalido' };
  return { ok: true, decision: d, usage: resp.usage || null, model: resp.model || null };
}

module.exports = { buildRequest, buildSystemPrompt, buildUserContent, parseResponse, DECISION_SCHEMA, INTENTS, ACTIONS, RISK_LEVELS, AREAS };
