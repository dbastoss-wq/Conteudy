'use strict';
// Decide se uma mensagem recebida NÃO deve ser respondida pelo agente.
// Retorna { skip: boolean, reason: string|null, internal?: boolean }. Ordem: do motivo mais seguro ao mais específico.
// Com sinal de risco (risk=true), só os filtros anti-loop valem (automáticas, listas, bounces, próprio agente);
// limites anti-ciclo, remetente interno, SPAM/Promoções e conversa com humano não bloqueiam o alerta.

const AUTO_LOCALPART = /^(no-?reply|do-?not-?reply|nao-?responda|mailer-daemon|postmaster|bounces?|notifica(c|ç)(o|õ)es|notifications?|alerts?|daemon)([+.\-_].*)?$/i;
const AUTO_SUBJECT = /^\s*(automatic reply|auto(matic)?[- ]?reply|resposta autom[aá]tica|out of (the )?office|aus[eê]ncia|fora do escrit[oó]rio|f[eé]rias|delivery status notification|undeliverable|mail delivery failed|returned mail|n[aã]o entregue)/i;

function domainOf(address) {
  const i = String(address || '').lastIndexOf('@');
  return i >= 0 ? address.slice(i + 1).toLowerCase() : '';
}

function shouldSkip(msg, settings, ctx, risk) {
  const h = msg.headers || {};
  const from = String(msg.from_email || '').toLowerCase();
  const agent = settings.agent || {};
  const own = [agent.email, ...(agent.aliases || [])].filter(Boolean).map(s => s.toLowerCase());
  const internal = (settings.internal_addresses || []).map(s => s.toLowerCase());
  const internalDomains = (settings.internal_domains || []).map(s => s.toLowerCase());
  const ignoreDomains = (settings.ignore_sender_domains || ['calendly.com']).map(s => s.toLowerCase());

  if (!from) return { skip: true, reason: 'sem_remetente' };
  if (own.includes(from) || h['x-agente-atendimento']) return { skip: true, reason: 'proprio_agente' };
  if (!risk && (msg.label_ids || []).includes('SPAM')) return { skip: true, reason: 'spam' };
  if ((msg.label_ids || []).includes('SENT') || (msg.label_ids || []).includes('DRAFT')) return { skip: true, reason: 'proprio_agente' };
  if (h['auto-submitted'] && !/^\s*no\s*$/i.test(h['auto-submitted'])) return { skip: true, reason: 'automatica' };
  if (h['x-autoreply'] || h['x-autorespond'] || h['x-autoresponder']) return { skip: true, reason: 'automatica' };
  if (/\b(all|oof|autoreply)\b/i.test(h['x-auto-response-suppress'] || '')) return { skip: true, reason: 'automatica' };
  if (/^\s*(bulk|junk|list|auto_reply)\s*$/i.test(h['precedence'] || '')) return { skip: true, reason: 'lista_ou_massa' };
  if (h['list-id'] || h['list-unsubscribe']) return { skip: true, reason: 'lista_ou_massa' };
  if (h['feedback-id'] && /\b(campaign|newsletter|marketing)\b/i.test(h['feedback-id'])) return { skip: true, reason: 'lista_ou_massa' };
  if (/multipart\/report/.test(msg.content_type || '')) return { skip: true, reason: 'bounce' };
  if (AUTO_LOCALPART.test(from.split('@')[0])) return { skip: true, reason: 'remetente_automatico' };
  if (AUTO_SUBJECT.test(msg.subject || '')) return { skip: true, reason: 'automatica' };
  if (ignoreDomains.includes(domainOf(from))) return { skip: true, reason: 'notificacao_de_sistema' };
  const isInternal = internal.includes(from) || internalDomains.includes(domainOf(from));
  if (!String(msg.body_new_text || msg.body_text || '').trim() && !String(msg.subject || '').trim()) return { skip: true, reason: 'sem_conteudo' };
  if (risk) return { skip: false, reason: null, internal: isInternal };
  if (isInternal) return { skip: true, reason: 'remetente_interno' };
  if (settings.skip_promotions !== false && (msg.label_ids || []).includes('CATEGORY_PROMOTIONS')) return { skip: true, reason: 'promocional' };

  if (ctx) {
    // Conversa assumida por pessoa da equipe: o agente apenas registra.
    if (ctx.conversation && ctx.conversation.status === 'escalada') return { skip: true, reason: 'conversa_com_humano' };
    const limits = settings.limits || {};
    if ((ctx.auto_replies_thread_24h || 0) >= (limits.max_auto_replies_per_thread_24h || 4)) return { skip: true, reason: 'limite_respostas_conversa', escalate: true };
    if ((ctx.auto_replies_sender_24h || 0) >= (limits.max_auto_replies_per_sender_24h || 8)) return { skip: true, reason: 'limite_respostas_remetente', escalate: true };
  }
  return { skip: false, reason: null };
}

module.exports = { shouldSkip, domainOf };
