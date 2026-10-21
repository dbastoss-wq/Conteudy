'use strict';
// Camada determinística entre a IA e o envio. A IA propõe; esta camada aplica as regras da empresa.
// Resultado: { final: 'reply'|'escalate'|'none', reply_text, link, reasons[], ack_text }

const CONFIRMATION_CLAIM = /(est[aá] confirmad|foi confirmad|confirmamos|reserva confirmad|reuni[aã]o (est[aá] )?(marcada|agendada)|agendad[oa] com sucesso|foi (cancelad|reagendad)|cancelamos|reagendamos)/i;
const MONEY = /R\$\s?\d[\d.,]*/g;
const URL_RE = /\bhttps?:\/\/[^\s<>()]+/gi;

// Sem URL/URLSearchParams: o sandbox dos nós Code do n8n não garante esses globais.
function buildSchedulingLink(type, msg, conversationId) {
  const params = [];
  if (msg.from_name) params.push(['name', msg.from_name]);
  if (msg.from_email) params.push(['email', msg.from_email]);
  params.push(['utm_source', 'agente-email'], ['utm_medium', 'email']);
  if (conversationId) params.push(['utm_content', conversationId]);
  const base = String(type.scheduling_url);
  const qs = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  return base + (base.includes('?') ? '&' : '?') + qs;
}

function activeBooking(ctx) {
  return (ctx.bookings || []).find(b => b.status === 'ativo' && b.verified && new Date(b.start_time) > new Date()) || null;
}

function signature(settings) {
  return settings.signature || `${(settings.agent || {}).name || 'Atendimento'}\n${(settings.company || {}).name || ''}`.trim();
}

function greeting(msg) {
  const first = String(msg.from_name || '').trim().split(/\s+/)[0];
  return first ? `Olá, ${first}!` : 'Olá!';
}

function compose(settings, msg, body) {
  const b = String(body || '').trim();
  const startsWithGreeting = /^(ol[aá]|oi|bom dia|boa tarde|boa noite|prezad)/i.test(b);
  return `${startsWithGreeting ? '' : greeting(msg) + '\n\n'}${b}\n\n${signature(settings)}\n`;
}

function applyPolicy(decision, settings, msg, ctx) {
  const reasons = [];
  const limits = settings.limits || {};
  const minConfidence = limits.min_confidence != null ? limits.min_confidence : 0.6;
  const kb = String(settings.knowledge_base || '');
  let body = String(decision.reply_body || '');
  let link = null;

  const ack = () => compose(settings, msg, settings.escalation_ack ||
    'Recebemos sua mensagem e ela foi encaminhada para a nossa equipe, que vai responder por aqui.');
  const escalate = (reason) => ({ final: 'escalate', reasons: [...reasons, reason], reply_text: null, link: null, ack_text: settings.send_escalation_ack === false ? null : ack() });

  if (decision.action === 'nao_responder') return { final: 'none', reasons: ['ia:nao_responder'], reply_text: null, link: null };
  if (decision.action === 'encaminhar_responsavel') return escalate(`ia:${decision.escalation_reason || 'sem_motivo'}`);
  if (typeof decision.confidence !== 'number' || decision.confidence < minConfidence) return escalate('baixa_confianca');
  if (!body.trim()) return escalate('resposta_vazia');
  if (body.length > (limits.max_reply_chars || 2500)) return escalate('resposta_longa_demais');

  // URLs só podem vir do sistema (marcador [[LINK]]).
  const urls = body.match(URL_RE) || [];
  const allowed = (settings.allowed_url_prefixes || []);
  if (urls.some(u => !allowed.some(p => u.startsWith(p)))) return escalate('url_nao_autorizada');

  // Valores monetários precisam existir literalmente na base de conhecimento.
  const amounts = body.match(MONEY) || [];
  const kbNorm = kb.replace(/\s/g, '');
  if (amounts.some(a => !kbNorm.includes(a.replace(/\s/g, '')))) return escalate('valor_fora_da_base');

  const booking = activeBooking(ctx);
  if (CONFIRMATION_CLAIM.test(body) && !(booking && decision.intent === 'status_agendamento')) return escalate('afirmacao_de_reserva_nao_verificada');

  if (decision.action === 'enviar_link_agendamento') {
    const type = (settings.meeting_types || []).find(t => t.key === decision.meeting_type_key);
    if (!type) return escalate('tipo_de_reuniao_invalido');
    link = buildSchedulingLink(type, msg, ctx.conversation && ctx.conversation.id);
  } else if (decision.intent === 'reagendamento' || decision.intent === 'cancelamento') {
    if (body.includes('[[LINK]]')) {
      if (!booking) return escalate('reserva_nao_encontrada');
      link = decision.intent === 'reagendamento' ? booking.reschedule_url : booking.cancel_url;
      if (!link) return escalate('link_oficial_indisponivel');
    }
  } else if (decision.action === 'responder' && !decision.kb_grounded) {
    return escalate('resposta_sem_base');
  }

  if (body.includes('[[LINK]]') && !link) return escalate('marcador_sem_link');
  if (link) body = body.includes('[[LINK]]') ? body.split('[[LINK]]').join(link) : `${body.trim()}\n\n${link}`;

  return { final: 'reply', reasons: reasons.length ? reasons : ['ok'], reply_text: compose(settings, msg, body), link, ack_text: null };
}

module.exports = { applyPolicy, buildSchedulingLink, compose, activeBooking };
