import { DateTime, Interval } from 'luxon';
import type { SchedulingSettings, TimeInterval } from '../domain/types.js';

export interface Slot {
  /** Instante de início (ISO UTC). */
  start: string;
  /** Instante de fim (ISO UTC). */
  end: string;
}

function toInterval(i: TimeInterval): Interval {
  return Interval.fromDateTimes(DateTime.fromISO(i.start, { zone: 'utc' }), DateTime.fromISO(i.end, { zone: 'utc' }));
}

/** Expande cada intervalo ocupado pelo buffer, nos dois lados. */
function busyWithBuffer(busy: TimeInterval[], bufferMinutes: number): Interval[] {
  return busy.map((b) => {
    const iv = toInterval(b);
    return Interval.fromDateTimes(iv.start!.minus({ minutes: bufferMinutes }), iv.end!.plus({ minutes: bufferMinutes }));
  });
}

function overlapsAny(slot: Interval, busy: Interval[]): boolean {
  return busy.some((b) => b.overlaps(slot) || b.engulfs(slot) || slot.engulfs(b));
}

/**
 * Gera todos os horários livres a partir das configurações menos os eventos
 * ocupados. 100% determinístico. `now` é injetável para testes.
 */
export function generateFreeSlots(
  settings: SchedulingSettings,
  busy: TimeInterval[],
  now: DateTime = DateTime.now().setZone(settings.timezone),
): Slot[] {
  const zone = settings.timezone;
  const nowZ = now.setZone(zone);
  const earliest = nowZ.plus({ minutes: settings.minLeadMinutes });
  const busyBuf = busyWithBuffer(busy, settings.bufferMinutes);
  const duration = settings.slotDurationMinutes;
  const step = duration + settings.bufferMinutes;
  const slots: Slot[] = [];

  for (let d = 0; d < settings.horizonDays; d++) {
    const day = nowZ.startOf('day').plus({ days: d });
    const weekday = day.weekday; // 1..7
    if (!settings.workingDays.includes(weekday)) continue;
    const windows = settings.windows[weekday] ?? [];
    for (const w of windows) {
      const [sh, sm] = w.start.split(':').map(Number);
      const [eh, em] = w.end.split(':').map(Number);
      const windowStart = day.set({ hour: sh, minute: sm, second: 0, millisecond: 0 });
      const windowEnd = day.set({ hour: eh, minute: em, second: 0, millisecond: 0 });

      let cursor = windowStart;
      while (cursor.plus({ minutes: duration }) <= windowEnd) {
        const slotStart = cursor;
        const slotEnd = cursor.plus({ minutes: duration });
        const iv = Interval.fromDateTimes(slotStart, slotEnd);
        if (slotStart >= earliest && !overlapsAny(iv, busyBuf)) {
          slots.push({ start: slotStart.toUTC().toISO()!, end: slotEnd.toUTC().toISO()! });
        }
        cursor = cursor.plus({ minutes: step });
      }
    }
  }
  return slots;
}

export interface RequestedSlotCheck {
  /** O horário pedido cai dentro de uma janela de atendimento válida? */
  withinWorkingHours: boolean;
  /** Respeita a antecedência mínima? */
  respectsLeadTime: boolean;
  /** Está livre (não colide com evento ocupado)? */
  free: boolean;
  /** Resumo: só é agendável se os três acima forem verdadeiros. */
  bookable: boolean;
  slot: Slot;
}

/**
 * Verifica se um horário específico pedido pelo paciente é agendável.
 * `requested` é a hora LOCAL de início (no fuso das settings).
 */
export function checkRequestedSlot(
  settings: SchedulingSettings,
  requestedLocalISO: string,
  busy: TimeInterval[],
  now: DateTime = DateTime.now().setZone(settings.timezone),
): RequestedSlotCheck {
  const zone = settings.timezone;
  const start = DateTime.fromISO(requestedLocalISO, { zone });
  const end = start.plus({ minutes: settings.slotDurationMinutes });
  const slot: Slot = { start: start.toUTC().toISO()!, end: end.toUTC().toISO()! };

  const earliest = now.setZone(zone).plus({ minutes: settings.minLeadMinutes });
  const respectsLeadTime = start >= earliest;

  // Dentro de uma janela de atendimento?
  const weekday = start.weekday;
  let withinWorkingHours = false;
  if (settings.workingDays.includes(weekday)) {
    const windows = settings.windows[weekday] ?? [];
    for (const w of windows) {
      const [sh, sm] = w.start.split(':').map(Number);
      const [eh, em] = w.end.split(':').map(Number);
      const ws = start.set({ hour: sh, minute: sm, second: 0, millisecond: 0 });
      const we = start.set({ hour: eh, minute: em, second: 0, millisecond: 0 });
      if (start >= ws && end <= we) {
        withinWorkingHours = true;
        break;
      }
    }
  }

  const busyBuf = busyWithBuffer(busy, settings.bufferMinutes);
  const free = !overlapsAny(Interval.fromDateTimes(start, end), busyBuf);

  return {
    withinWorkingHours,
    respectsLeadTime,
    free,
    bookable: withinWorkingHours && respectsLeadTime && free,
    slot,
  };
}

/**
 * Dado o horário pedido e a lista de slots livres, retorna até `n` alternativas
 * ordenadas pela proximidade (em tempo) ao pedido.
 */
export function nearestAlternatives(
  requestedLocalISO: string,
  timezone: string,
  freeSlots: Slot[],
  n = 3,
): Slot[] {
  const requested = DateTime.fromISO(requestedLocalISO, { zone: timezone }).toMillis();
  return [...freeSlots]
    .sort((a, b) => {
      const da = Math.abs(DateTime.fromISO(a.start).toMillis() - requested);
      const db = Math.abs(DateTime.fromISO(b.start).toMillis() - requested);
      return da - db;
    })
    .slice(0, n);
}

/** Formata um slot para exibição ao paciente (ex.: "sex, 17/10 às 14:30"). */
export function formatSlotPtBr(slot: Slot, timezone: string): string {
  const dt = DateTime.fromISO(slot.start).setZone(timezone).setLocale('pt-BR');
  return dt.toFormat("ccc, dd/LL 'às' HH:mm");
}
