import { DateTime } from 'luxon';
import { loadConfig } from '../config.js';
import {
  getOrCreateConversation,
  updateConversation,
  recordMessage,
  getSettings,
  findAppointmentByConversation,
  updateAppointmentPayment,
  audit,
  type Conversation,
  type CollectedInfo,
} from '../db/repositories.js';
import { getRuntime } from '../runtime.js';
import { bookAppointment } from '../scheduling/booking.js';
import {
  checkRequestedSlot,
  generateFreeSlots,
  nearestAlternatives,
  formatSlotPtBr,
  type Slot,
} from '../scheduling/slots.js';
import { interpret, type NluResult } from '../llm/nlu.js';
import { detectUrgencyKeywords, looksLikeConfirmation } from './safety.js';
import { notifyDoctor } from '../notify/notifier.js';
import { sendText } from '../whatsapp/client.js';
import * as M from './messages.js';

export interface InboundMessage {
  phone: string;
  text: string;
  waMessageId?: string | null;
  msgType?: string; // 'text' | 'image' | 'document' | ...
}

/** Ponto de entrada: processa uma mensagem recebida do paciente. */
export async function handleInboundMessage(msg: InboundMessage): Promise<void> {
  const cfg = loadConfig();
  const tz = cfg.TZ;
  const settings = await getSettings();
  const conv = await getOrCreateConversation(msg.phone);

  // Deduplicação: webhooks reentregues pela Meta não são reprocessados.
  const isNew = await recordMessage({
    conversationId: conv.id,
    direction: 'inbound',
    waMessageId: msg.waMessageId,
    body: msg.text || `[${msg.msgType ?? 'media'}]`,
    msgType: msg.msgType ?? 'text',
  });
  if (!isNew) return;

  // Bot pausado = médico assumiu a conversa. Só registra, não responde.
  if (conv.botPaused) return;

  const reply = async (body: string) => {
    await sendText(msg.phone, body);
    await recordMessage({ conversationId: conv.id, direction: 'outbound', body });
  };

  const isMedia = (msg.msgType ?? 'text') !== 'text';

  // Comprovante de Pix (imagem/documento) enquanto aguarda pagamento.
  if (isMedia && conv.state === 'AGUARDANDO_PAGAMENTO') {
    const appt = await findAppointmentByConversation(conv.id);
    if (appt) {
      await updateAppointmentPayment(appt.id, { comprovanteRecebido: true, paymentStatus: 'comprovante_recebido' });
      const rt = getRuntime();
      if (rt.googleCalendar) {
        try {
          const raw = await (await import('../db/pool.js')).query('SELECT calendar_id, event_id FROM appointments WHERE id = $1', [appt.id]);
          const r: any = raw.rows[0];
          if (r) await rt.googleCalendar.appendToDescription(r.calendar_id, r.event_id, 'Comprovante de Pix: RECEBIDO');
        } catch (e) {
          console.error('[handler] falha ao anexar comprovante ao evento:', e);
        }
      }
    }
    await reply(M.MSG_COMPROVANTE_RECEBIDO);
    await notifyDoctor('comprovante_recebido', `Paciente ${conv.patientName ?? msg.phone} enviou comprovante de Pix.`);
    return;
  }

  // Interpretação (apenas extração; nenhuma decisão de agenda vem da IA).
  const nlu: NluResult = msg.text
    ? await interpret(msg.text, {
        timezone: tz,
        now: now(tz),
        jaColetado: { nome: conv.patientName, motivo: conv.collected.motivo },
        slotPendente: conv.pendingSlot ? formatSlotPtBr(conv.pendingSlot, tz) : null,
      })
    : { ...(await import('../llm/nlu.js')).NLU_FALLBACK };

  // 1) URGÊNCIA — nunca agenda; orienta SAMU/PS e notifica.
  if (detectUrgencyKeywords(msg.text) || nlu.sinais_urgencia) {
    await reply(M.MSG_URGENCIA);
    await updateConversation(conv.id, { state: 'URGENCIA' });
    await notifyDoctor('urgencia', `Possível urgência do paciente ${conv.patientName ?? msg.phone}: "${msg.text}"`);
    await audit('urgencia', 'conversation', conv.id);
    return;
  }

  // Mescla o que foi coletado (não re-perguntar o que já foi respondido).
  const collected: CollectedInfo = { ...conv.collected };
  if (nlu.nome) collected.nome = nlu.nome;
  if (nlu.motivo) collected.motivo = nlu.motivo;
  if (nlu.data_preferida) collected.dataPreferida = nlu.data_preferida;
  if (nlu.hora_preferida) collected.horaPreferida = nlu.hora_preferida;
  const patientName = nlu.nome ?? conv.patientName ?? null;
  await updateConversation(conv.id, { collected, patientName: patientName ?? undefined });

  // 2) Primeiro contato: envia a apresentação literal.
  let justSentIntro = false;
  if (!conv.sentIntro) {
    await reply(settings.messages.intro);
    await updateConversation(conv.id, { sentIntro: true, state: 'AGUARDANDO_INFO' });
    conv.sentIntro = true;
    conv.state = 'AGUARDANDO_INFO';
    justSentIntro = true;
  }

  // Estado "de trabalho" em memória para o restante do fluxo.
  const working: Conversation = {
    ...conv,
    collected,
    patientName,
    state: conv.state === 'NOVO' ? 'AGUARDANDO_INFO' : conv.state,
  };

  // 3) Pagamento.
  if (working.state === 'AGUARDANDO_PAGAMENTO') {
    await handlePayment(working, nlu, msg, reply);
    return;
  }

  // 4) Dúvida clínica — não interpreta sintoma; oferece agendar.
  if (nlu.intent === 'duvida_clinica' && !collected.dataPreferida) {
    await reply(M.MSG_DUVIDA_CLINICA);
    return;
  }

  // 5) Fora do assunto — passa para o médico.
  if (nlu.intent === 'fora_do_assunto') {
    await reply(M.MSG_FORA_DO_ASSUNTO);
    await updateConversation(conv.id, { state: 'TRANSFERIDO', botPaused: true });
    await notifyDoctor('fora_do_roteiro', `Assunto fora do roteiro de ${patientName ?? msg.phone}: "${msg.text}"`);
    await audit('handoff', 'conversation', conv.id);
    return;
  }

  // Mídia fora do contexto de pagamento.
  if (isMedia) {
    if (!justSentIntro) await reply(M.MSG_PEDIR_PREFERENCIA);
    return;
  }

  // 6) Fluxo de agendamento.
  await handleScheduling(working, nlu, msg, reply, { justSentIntro });
}

// ---------------------------------------------------------------------------
// Agendamento
// ---------------------------------------------------------------------------

async function handleScheduling(
  conv: Conversation,
  nlu: NluResult,
  msg: InboundMessage,
  reply: (body: string) => Promise<void>,
  opts: { justSentIntro: boolean },
): Promise<void> {
  const cfg = loadConfig();
  const tz = cfg.TZ;
  const settings = await getSettings();
  const rt = getRuntime();
  const calendarId = settings.googleCalendarId;

  const collected = conv.collected;

  // Já existe um slot aguardando confirmação?
  if (conv.state === 'AGUARDANDO_CONFIRMACAO' && conv.pendingSlot) {
    const confirmou = nlu.confirmou_horario || looksLikeConfirmation(msg.text);
    // Novo horário pedido substitui o pendente.
    const pediuOutro = !!(nlu.data_preferida || nlu.hora_preferida);
    if (confirmou && !pediuOutro) {
      await attemptBook(conv, conv.pendingSlot, reply);
      return;
    }
    if (!pediuOutro) {
      await reply(M.msgPropostaHorarioExato(conv.pendingSlot, tz));
      return;
    }
    // caiu para recomputar abaixo
  }

  // Aguardando nome para um slot já escolhido.
  if (conv.state === 'AGUARDANDO_NOME' && conv.pendingSlot) {
    if (collected.nome) {
      await attemptBook(conv, conv.pendingSlot, reply);
    } else {
      await reply(M.MSG_PEDIR_NOME);
    }
    return;
  }

  // Seleção de uma das alternativas propostas.
  if (conv.state === 'PROPOSTA_HORARIOS' && conv.proposedSlots.length) {
    const escolhido = selectFromProposals(conv.proposedSlots, msg.text, nlu, tz);
    if (escolhido) {
      await proceedToBook(conv, escolhido, reply);
      return;
    }
  }

  // Precisamos de uma data para propor um horário específico.
  if (!collected.dataPreferida && !collected.horaPreferida) {
    if (!opts.justSentIntro) await reply(M.MSG_PEDIR_PREFERENCIA);
    await updateConversation(conv.id, { state: 'AGUARDANDO_INFO' });
    return;
  }

  // Busca a disponibilidade real.
  const nowDt = now(tz);
  const busy = await rt.calendar.freebusy(
    calendarId,
    nowDt.toUTC().toISO()!,
    nowDt.plus({ days: settings.scheduling.horizonDays }).toUTC().toISO()!,
  );
  const freeSlots = generateFreeSlots(settings.scheduling, busy, nowDt);

  // Pedido com data + hora específicas.
  if (collected.dataPreferida && collected.horaPreferida) {
    const requestedLocal = `${collected.dataPreferida}T${collected.horaPreferida}:00`;
    const check = checkRequestedSlot(settings.scheduling, requestedLocal, busy, nowDt);
    if (check.bookable) {
      await proceedToBook(conv, check.slot, reply);
      return;
    }
    const alts = nearestAlternatives(requestedLocal, tz, freeSlots, 3);
    if (!alts.length) {
      await reply('Não encontrei horários livres nos próximos dias. Pode sugerir outra data?');
      return;
    }
    await updateConversation(conv.id, { state: 'PROPOSTA_HORARIOS', proposedSlots: alts, pendingSlot: null });
    await reply(M.msgAlternativas(alts, tz, true));
    return;
  }

  // Só a data (sem hora): oferece horários daquele dia (ou os mais próximos).
  if (collected.dataPreferida) {
    const doDia = freeSlots.filter(
      (s) => DateTime.fromISO(s.start).setZone(tz).toFormat('yyyy-LL-dd') === collected.dataPreferida,
    );
    const alts = (doDia.length ? doDia : freeSlots).slice(0, 3);
    if (!alts.length) {
      await reply('Não encontrei horários livres nesse dia. Pode sugerir outra data?');
      return;
    }
    await updateConversation(conv.id, { state: 'PROPOSTA_HORARIOS', proposedSlots: alts, pendingSlot: null });
    await reply(M.msgAlternativas(alts, tz, false));
    return;
  }

  // Só a hora, sem data: pede a data.
  await reply('Em qual dia você prefere? Pode me dizer a data que eu vejo os horários.');
}

/** Garante nome e motivo antes de reservar; senão pede o que falta. */
async function proceedToBook(conv: Conversation, slot: Slot, reply: (b: string) => Promise<void>): Promise<void> {
  if (!conv.collected.motivo) {
    await updateConversation(conv.id, { pendingSlot: slot, state: 'AGUARDANDO_CONFIRMACAO' });
    await reply(M.MSG_PEDIR_MOTIVO);
    return;
  }
  if (!conv.collected.nome) {
    await updateConversation(conv.id, { pendingSlot: slot, state: 'AGUARDANDO_NOME' });
    await reply(M.MSG_PEDIR_NOME);
    return;
  }
  await attemptBook(conv, slot, reply);
}

/** Reserva de fato (com re-checagem, lock e idempotência). */
async function attemptBook(conv: Conversation, slot: Slot, reply: (b: string) => Promise<void>): Promise<void> {
  const cfg = loadConfig();
  const tz = cfg.TZ;
  const settings = await getSettings();
  const rt = getRuntime();

  const name = conv.collected.nome;
  const reason = conv.collected.motivo ?? '(não informado)';
  if (!name) {
    await updateConversation(conv.id, { pendingSlot: slot, state: 'AGUARDANDO_NOME' });
    await reply(M.MSG_PEDIR_NOME);
    return;
  }

  const result = await bookAppointment(
    {
      calendarId: settings.googleCalendarId,
      startISO: slot.start,
      endISO: slot.end,
      timezone: tz,
      conversationId: conv.id,
      patientName: name,
      phone: conv.phone,
      reason,
      eventDescription: `Telefone: ${conv.phone}\nMotivo: ${reason}`,
      idempotencyKey: `${conv.id}|${slot.start}`,
    },
    { calendar: rt.calendar, reservations: rt.reservations, appointments: rt.appointments },
  );

  switch (result.status) {
    case 'booked':
    case 'already_booked': {
      await updateConversation(conv.id, { state: 'AGUARDANDO_PAGAMENTO', pendingSlot: null, proposedSlots: [] });
      await audit('agendado', 'conversation', conv.id, { slot: slot.start });
      // A mensagem de pagamento é também a confirmação (só é enviada após sucesso do Google).
      await reply(settings.messages.payment);
      return;
    }
    case 'slot_taken': {
      const nowDt = now(tz);
      const busy = await rt.calendar.freebusy(
        settings.googleCalendarId,
        nowDt.toUTC().toISO()!,
        nowDt.plus({ days: settings.scheduling.horizonDays }).toUTC().toISO()!,
      );
      const free = generateFreeSlots(settings.scheduling, busy, nowDt);
      const alts = nearestAlternatives(slot.start, tz, free, 3);
      await updateConversation(conv.id, { state: 'PROPOSTA_HORARIOS', proposedSlots: alts, pendingSlot: null });
      await reply(M.msgAlternativas(alts, tz, true));
      return;
    }
    case 'calendar_error': {
      await reply(M.MSG_FALHA_AGENDAMENTO);
      await updateConversation(conv.id, { pendingSlot: slot, state: 'AGUARDANDO_CONFIRMACAO' });
      await notifyDoctor(
        'falha_agendamento',
        `Falha ao agendar ${conv.collected.nome ?? conv.phone} em ${formatSlotPtBr(slot, tz)}: ${result.error.message}`,
      );
      await audit('falha_agendamento', 'conversation', conv.id, { error: result.error.message });
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Pagamento
// ---------------------------------------------------------------------------

async function handlePayment(
  conv: Conversation,
  nlu: NluResult,
  msg: InboundMessage,
  reply: (b: string) => Promise<void>,
): Promise<void> {
  const cfg = loadConfig();
  const settings = await getSettings();
  const appt = await findAppointmentByConversation(conv.id);

  if (nlu.forma_pagamento === 'pix') {
    if (appt) await updateAppointmentPayment(appt.id, { paymentMethod: 'pix', paymentStatus: 'aguardando_comprovante' });
    await reply(M.msgConfirmarPix(settings.pixKey, settings.consultPriceCents));
    return;
  }
  if (nlu.forma_pagamento === 'credito' || nlu.forma_pagamento === 'debito') {
    if (appt) await updateAppointmentPayment(appt.id, { paymentMethod: nlu.forma_pagamento, paymentStatus: 'cartao_com_medico' });
    await reply(M.MSG_CARTAO);
    await notifyDoctor('escolha_cartao', `Paciente ${conv.patientName ?? conv.phone} escolheu pagamento no ${nlu.forma_pagamento}.`);
    return;
  }
  // Não entendeu a forma: repete as opções, sem cobrar nada além disso.
  await reply('Você prefere pagar no crédito, débito ou Pix?');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(tz: string): DateTime {
  return DateTime.now().setZone(tz);
}

/** Seleção de uma alternativa: por número (1/2/3) ou por horário dito. */
function selectFromProposals(proposals: Slot[], text: string, nlu: NluResult, tz: string): Slot | null {
  const digit = text.trim().match(/^\s*([1-9])\b/);
  if (digit) {
    const idx = Number(digit[1]) - 1;
    if (idx >= 0 && idx < proposals.length) return proposals[idx]!;
  }
  if (nlu.hora_preferida) {
    const match = proposals.find((s) => DateTime.fromISO(s.start).setZone(tz).toFormat('HH:mm') === nlu.hora_preferida);
    if (match && (!nlu.data_preferida || DateTime.fromISO(match.start).setZone(tz).toFormat('yyyy-LL-dd') === nlu.data_preferida)) {
      return match;
    }
  }
  return null;
}
