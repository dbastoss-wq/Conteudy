'use strict';
// Camada determinística entre a IA e o envio. A IA propõe; esta camada aplica as regras da empresa.
// Resultado: { final: 'reply'|'escalate'|'none'|'risk', reply_text, link, reasons[], ack_text, area, destino, include_body }
// destino do encaminhamento: 'padrao' (escalation.contact_email), 'clinico' ou 'administrativo' (área de psiquiatria).

const CONFIRMATION_CLAIM = /(est[aá] confirmad|foi confirmad|confirmamos|reserva confirmad|reuni[aã]o (est[aá] )?(marcada|agendada)|agendad[oa] com sucesso|foi (cancelad|reagendad)|cancelamos|reagendamos)/i;
const MONEY = /R\$\s?\d[\d.,]*/g;
const URL_RE = /\bhttps?:\/\/[^\s<>()]+/gi;
// Conteúdo clínico que a IA nunca pode escrever na área de psiquiatria.
const DOSE = /\b\d+([.,]\d+)?\s?(mg|mcg|ml|gotas)\b/i;
const CID = /\b(cid[- ]?(10|11)?\s*[:-]?\s*)?[A-TV-Z]\d{2}(\.\d{1,2})?\b/;
const PROMISE = /((vou|vai|v[aã]o|vamos|ir[aá]|iremos|ser[aá]|podemos|pode|conseguimos|garantimos)\s+(\w+\s+){0,3}(enviar|emitir|renovar|liberar|fazer|providenciar|entregar|prescrever)\s+(\w+\s+){0,3}(a\s+|o\s+|sua\s+|seu\s+)?(receita|atestado|laudo|relat[oó]rio|declara[cç][aã]o|prescri[cç][aã]o))|\bcur(a|ar|ado|ada)\b|((retorn|respond)\w*\s+(\w+\s+){0,3}(em at[eé]|dentro de|em)\s+\d+\s*(h\b|horas?|dias?|minutos?))/i;
const RISK_INTENTS = { crise_ou_risco: 'crise', violencia_ou_risco_terceiros: 'terceiros', urgencia_medica: 'urgencia' };
const CLINICAL_INTENTS = ['duvida_clinica', 'pedido_receita_ou_documento'];

// Textos de segurança usados só se a clínica ainda não carregou os modelos aprovados (config/templates/*.md).
const FALLBACK = {
  risco: 'Recebemos sua mensagem e ela foi enviada à nossa equipe.\n\nSe você está em perigo agora ou pensando em tirar a própria vida, ligue para o CVV no 188 (24 horas, gratuito) ou para o SAMU no 192, ou vá ao pronto-socorro mais próximo. O CAPS da sua região também pode ajudar.\n\nEste e-mail não é um canal de emergência.',
  risco_terceiros: 'Recebemos sua mensagem e ela foi enviada à nossa equipe.\n\nSe alguém está em perigo agora, ligue para a Polícia no 190 ou para o SAMU no 192. Em casos de violência contra a mulher, ligue 180; para denunciar violações de direitos humanos, Disque 100.\n\nEste e-mail não é um canal de emergência.',
  urgencia: 'Recebemos sua mensagem e ela foi enviada à nossa equipe.\n\nEm caso de urgência ou emergência, ligue para o SAMU no 192 ou vá ao pronto-socorro mais próximo.\n\nEste e-mail não é um canal de emergência.',
  ack_clinico: 'Recebemos sua mensagem e ela foi encaminhada à equipe clínica.',
};

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

function signature(settings, area) {
  const psiq = settings.psiquiatria || {};
  if (area === 'psiquiatria' && psiq.assinatura) return psiq.assinatura;
  return settings.signature || `${(settings.agent || {}).name || 'Atendimento'}\n${(settings.company || {}).name || ''}`.trim();
}

function greeting(msg) {
  const first = String(msg.from_name || '').trim().split(/\s+/)[0];
  return first ? `Olá, ${first}!` : 'Olá!';
}

function compose(settings, msg, body, area) {
  const b = String(body || '').trim();
  const startsWithGreeting = /^(ol[aá]|oi|bom dia|boa tarde|boa noite|prezad)/i.test(b);
  return `${startsWithGreeting ? '' : greeting(msg) + '\n\n'}${b}\n\n${signature(settings, area)}\n`;
}

// Modelo aprovado pela clínica (sem comentários de revisão) ou o texto de segurança padrão.
function template(settings, key) {
  const t = String(((settings.templates || {})[key]) || '').replace(/<!--[\s\S]*?-->/g, '').trim();
  return t || FALLBACK[key] || '';
}

const isUrl = u => /^https?:\/\//.test(String(u || ''));
const realAddresses = list => (Array.isArray(list) ? list : [list]).filter(a => a && /@/.test(a) && !/[\[\]]/.test(a));

// Área da conversa: uma vez psiquiatria, sempre psiquiatria.
function resolveArea(settings, msg, ctx, decision) {
  const psiq = settings.psiquiatria || {};
  if (!psiq.enabled) return 'geral';
  const conv = (ctx && ctx.conversation) || {};
  if (conv.area === 'psiquiatria') return 'psiquiatria';
  const boxes = (psiq.caixas || []).map(a => String(a).toLowerCase());
  if ((msg.to || []).some(a => boxes.includes(String(a).toLowerCase()))) return 'psiquiatria';
  const psiqTypes = (settings.meeting_types || []).filter(t => t.area === 'psiquiatria');
  if (((ctx && ctx.bookings) || []).some(b => psiqTypes.some(t => (b.event_type_uri && b.event_type_uri === t.event_type_uri) || b.event_name === t.name))) return 'psiquiatria';
  if (decision && decision.area === 'psiquiatria') return 'psiquiatria';
  return 'geral';
}

function urgentContacts(settings) {
  const psiq = settings.psiquiatria || {};
  const list = [...realAddresses(psiq.contato_clinico_urgente || []), ...realAddresses(psiq.contato_clinico || [])];
  if (!list.length) list.push(...realAddresses((settings.escalation || {}).contact_email || []));
  list.push(...realAddresses(settings.alert_email || []));
  return [...new Set(list.map(a => a.toLowerCase()))];
}

// Protocolo de risco: modelo fixo (nunca texto da IA) + alerta urgente sem conteúdo da mensagem.
function riskPolicy(settings, msg, ctx, risk, opts = {}) {
  const area = opts.area || resolveArea(settings, msg, ctx, null);
  const key = risk.categoria === 'terceiros' ? 'risco_terceiros' : risk.categoria === 'urgencia' ? 'urgencia' : 'risco';
  const alreadyReplied = ((ctx && ctx.risk_replies_thread_24h) || 0) > 0;
  const replyText = opts.internal || alreadyReplied ? null : compose(settings, msg, template(settings, key), area);
  const when = new Date().toISOString();
  const alert = {
    to: urgentContacts(settings),
    subject: '[URGENTE] Mensagem que precisa de atenção clínica',
    body_text: ['Uma mensagem recebida pelo agente precisa de atenção clínica imediata.', '',
      'Nível: ' + risk.risk, 'Tipo: ' + (risk.categoria || 'crise'),
      'Detectado por: ' + (opts.source === 'ia' ? 'classificação da IA' : 'termos de risco configurados'),
      'Recebida em: ' + (msg.internal_date || when),
      'Resposta automática ao remetente: ' + (replyText ? 'mensagem fixa de segurança enviada' : (opts.internal ? 'não enviada (remetente interno)' : 'não enviada (já enviada nas últimas 24 h)')),
      'Abrir a conversa no Gmail: https://mail.google.com/mail/u/0/#all/' + msg.gmail_thread_id, '',
      'O conteúdo da mensagem não é copiado neste alerta. Leia a conversa pela caixa do agente.'].join('\n'),
  };
  return { final: 'risk', area, risk_level: risk.risk, categoria: risk.categoria || 'crise', reasons: ['risco:' + (risk.categoria || 'crise'), 'origem:' + (opts.source || 'termos')],
    reply_text: replyText, alert, link: null, ack_text: null, destino: 'urgente', include_body: false };
}

function applyPolicy(decision, settings, msg, ctx, opts = {}) {
  const reasons = [];
  const psiq = settings.psiquiatria || {};
  const area = resolveArea(settings, msg, ctx, decision);

  // 1. Risco tem precedência sobre qualquer outra decisão. Vale o nível mais alto entre termos e IA.
  const iaCategoria = RISK_INTENTS[decision.intent] || null;
  let iaLevel = decision.risk_level || 'nenhum';
  if (iaCategoria && iaLevel === 'nenhum') iaLevel = 'possivel';
  const ia = { risk: iaLevel, categoria: iaCategoria || (iaLevel !== 'nenhum' ? 'crise' : null), matched: [] };
  const termos = opts.risk || { risk: 'nenhum', matched: [] };
  const order = ['nenhum', 'possivel', 'alto'];
  const top = order.indexOf(ia.risk) > order.indexOf(termos.risk) ? Object.assign({ source: 'ia' }, ia) : Object.assign({ source: 'termos' }, termos);
  if (top.risk === 'possivel' || top.risk === 'alto') return riskPolicy(settings, msg, ctx, top, { area, internal: opts.internal, source: top.source });

  const limits = settings.limits || {};
  const minConfidence = limits.min_confidence != null ? limits.min_confidence : 0.6;
  const kb = String(settings.knowledge_base || '');
  let body = String(decision.reply_body || '');
  let link = null;

  const ack = (destino) => compose(settings, msg, destino === 'clinico'
    ? (psiq.ack_clinico || template(settings, 'ack_clinico'))
    : (settings.escalation_ack || 'Recebemos sua mensagem e ela foi encaminhada para a nossa equipe, que vai responder por aqui.'), area);
  const escalate = (reason, destino) => {
    const d = destino || (area === 'psiquiatria' ? 'administrativo' : 'padrao');
    return { final: 'escalate', area, destino: d, include_body: d !== 'administrativo', reasons: [...reasons, reason], reply_text: null, link: null,
      ack_text: settings.send_escalation_ack === false ? null : ack(d) };
  };

  if (decision.action === 'nao_responder') return { final: 'none', area, reasons: ['ia:nao_responder'], reply_text: null, link: null };
  if (psiq.enabled) {
    // 2. Assuntos clínicos vão sempre à equipe clínica, sem resposta da IA além da confirmação.
    if (CLINICAL_INTENTS.includes(decision.intent)) return escalate(`clinico:${decision.intent}`, 'clinico');
    if (area === 'psiquiatria' && decision.menor_de_idade) return escalate('menor_de_idade', psiq.politica_menores === 'pedir_responsavel' ? 'administrativo' : 'clinico');
    if (area === 'psiquiatria' && decision.fora_do_brasil && !psiq.atende_exterior) return escalate('paciente_fora_do_brasil', 'administrativo');
  }
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

  // 3 e 4. Conteúdo clínico ou promessas no texto da IA.
  if (psiq.enabled) {
    const meds = (psiq.termos_clinicos_bloqueados || []).filter(Boolean).map(t => String(t).toLowerCase());
    const lower = body.toLowerCase();
    if (DOSE.test(body) || CID.test(body) || meds.some(m => lower.includes(m))) return escalate('texto_clinico', 'clinico');
    if (PROMISE.test(body)) return escalate('promessa_nao_autorizada', 'clinico');
  }

  const booking = activeBooking(ctx);
  if (CONFIRMATION_CLAIM.test(body) && !(booking && decision.intent === 'status_agendamento')) return escalate('afirmacao_de_reserva_nao_verificada');

  if (decision.action === 'enviar_link_agendamento') {
    const type = (settings.meeting_types || []).find(t => t.key === decision.meeting_type_key);
    if (!type) return escalate('tipo_de_reuniao_invalido');
    link = buildSchedulingLink(type, msg, ctx.conversation && ctx.conversation.id);
    // 5. Tipos que exigem termo: o sistema acrescenta o termo e as orientações.
    if (type.exige_termo) {
      const extras = [];
      if (isUrl(psiq.termo_consentimento_url)) extras.push('Termo de consentimento da teleconsulta: ' + psiq.termo_consentimento_url);
      if (isUrl(psiq.orientacoes_url)) extras.push('Orientações antes da consulta: ' + psiq.orientacoes_url);
      if (!extras.length) return escalate('termo_de_consentimento_nao_configurado');
      body = `${body.trim()}\n\n${extras.join('\n')}`;
    }
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

  return { final: 'reply', area, reasons: reasons.length ? reasons : ['ok'], reply_text: compose(settings, msg, body, area), link, ack_text: null };
}

module.exports = { applyPolicy, riskPolicy, resolveArea, urgentContacts, buildSchedulingLink, compose, activeBooking, template, FALLBACK };
