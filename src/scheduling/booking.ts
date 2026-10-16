import { DateTime, Interval } from 'luxon';
import type { TimeInterval, PaymentMethod } from '../domain/types.js';

/**
 * Porta para a agenda (Google Calendar em produção; fake nos testes).
 * O serviço de reserva nunca conhece a implementação concreta.
 */
export interface CalendarPort {
  /** Intervalos ocupados entre timeMin e timeMax (ISO UTC). */
  freebusy(calendarId: string, timeMinISO: string, timeMaxISO: string): Promise<TimeInterval[]>;
  /** Cria o evento. Lança em caso de falha da API. */
  insertEvent(calendarId: string, event: CalendarEventInput): Promise<CreatedEvent>;
}

export interface CalendarEventInput {
  summary: string;
  description: string;
  startISO: string; // UTC
  endISO: string; // UTC
  timezone: string;
}

export interface CreatedEvent {
  id: string;
  htmlLink?: string;
}

/**
 * Porta de reserva de slot: operação ATÔMICA de "tente travar este slot".
 * - Postgres: INSERT ... ON CONFLICT DO NOTHING numa unique key.
 * - Memória (testes): Map síncrono.
 * É isto que impede dois agendamentos no mesmo horário, inclusive entre
 * conversas diferentes e mensagens simultâneas.
 */
export interface ReservationStore {
  /** Tenta travar o slot. true = conseguiu; false = já estava travado. */
  tryReserve(slotKey: string): Promise<boolean>;
  /** Libera o slot (falha no meio do caminho). */
  release(slotKey: string): Promise<void>;
}

/** Porta de persistência de consultas + idempotência. */
export interface AppointmentStore {
  findByIdempotencyKey(key: string): Promise<StoredAppointment | null>;
  create(data: NewAppointment): Promise<StoredAppointment>;
}

export interface NewAppointment {
  idempotencyKey: string;
  conversationId: string;
  calendarId: string;
  eventId: string;
  patientName: string;
  phone: string;
  reason: string;
  startISO: string;
  endISO: string;
  timezone: string;
  paymentMethod: PaymentMethod | null;
}

export interface StoredAppointment extends NewAppointment {
  id: string;
  createdAt: string;
}

export interface BookInput {
  calendarId: string;
  startISO: string; // UTC
  endISO: string; // UTC
  timezone: string;
  conversationId: string;
  patientName: string;
  phone: string;
  /** Motivo (dado de saúde) — guardado criptografado. */
  reason: string;
  /** Descrição a gravar no evento (telefone + motivo + pagamento). Se ausente, é composta. */
  eventDescription?: string;
  /** Idempotência: mesmo (conversa, slot) nunca agenda duas vezes. */
  idempotencyKey: string;
}

export type BookResult =
  | { status: 'booked'; appointment: StoredAppointment; event: CreatedEvent }
  | { status: 'already_booked'; appointment: StoredAppointment }
  | { status: 'slot_taken' }
  | { status: 'calendar_error'; error: Error };

export function slotKeyOf(calendarId: string, startISO: string): string {
  return `${calendarId}|${DateTime.fromISO(startISO, { zone: 'utc' }).toUTC().toISO()}`;
}

function overlaps(startISO: string, endISO: string, busy: TimeInterval[]): boolean {
  const slot = Interval.fromDateTimes(
    DateTime.fromISO(startISO, { zone: 'utc' }),
    DateTime.fromISO(endISO, { zone: 'utc' }),
  );
  return busy.some((b) => {
    const iv = Interval.fromDateTimes(
      DateTime.fromISO(b.start, { zone: 'utc' }),
      DateTime.fromISO(b.end, { zone: 'utc' }),
    );
    return iv.overlaps(slot) || iv.engulfs(slot) || slot.engulfs(iv);
  });
}

/**
 * Reserva uma consulta de forma segura:
 *  1. idempotência — se já existe agendamento para (conversa, slot), devolve-o;
 *  2. trava o slot (atômico) — se já travado, 'slot_taken';
 *  3. re-checa a disponibilidade no Google DENTRO da trava;
 *  4. cria o evento — só confirma se a API retornar sucesso;
 *  5. em qualquer falha, libera a trava e devolve o erro.
 */
export async function bookAppointment(
  input: BookInput,
  deps: { calendar: CalendarPort; reservations: ReservationStore; appointments: AppointmentStore },
): Promise<BookResult> {
  const { calendar, reservations, appointments } = deps;

  // 1. Idempotência
  const existing = await appointments.findByIdempotencyKey(input.idempotencyKey);
  if (existing) {
    return { status: 'already_booked', appointment: existing };
  }

  // 2. Trava do slot (impede corrida / double-booking)
  const key = slotKeyOf(input.calendarId, input.startISO);
  const acquired = await reservations.tryReserve(key);
  if (!acquired) {
    return { status: 'slot_taken' };
  }

  try {
    // 3. Re-checagem imediatamente antes de gravar
    const busy = await calendar.freebusy(input.calendarId, input.startISO, input.endISO);
    if (overlaps(input.startISO, input.endISO, busy)) {
      await reservations.release(key);
      return { status: 'slot_taken' };
    }

    // 4. Cria o evento — só confirma após sucesso
    const description =
      input.eventDescription ?? `Telefone: ${input.phone}\nMotivo: ${input.reason}`;
    const event = await calendar.insertEvent(input.calendarId, {
      summary: `Teleconsulta – ${input.patientName}`,
      description,
      startISO: input.startISO,
      endISO: input.endISO,
      timezone: input.timezone,
    });

    const appointment = await appointments.create({
      idempotencyKey: input.idempotencyKey,
      conversationId: input.conversationId,
      calendarId: input.calendarId,
      eventId: event.id,
      patientName: input.patientName,
      phone: input.phone,
      reason: input.reason,
      startISO: input.startISO,
      endISO: input.endISO,
      timezone: input.timezone,
      paymentMethod: null,
    });

    return { status: 'booked', appointment, event };
  } catch (err) {
    // 5. Falha (ex.: API do Google fora do ar) — libera o slot para nova tentativa
    await reservations.release(key);
    return { status: 'calendar_error', error: err instanceof Error ? err : new Error(String(err)) };
  }
}
