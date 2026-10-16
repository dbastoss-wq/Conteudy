import { randomUUID } from 'node:crypto';
import { DateTime, Interval } from 'luxon';
import type { CalendarPort, CalendarEventInput, CreatedEvent } from '../scheduling/booking.js';
import type { TimeInterval } from '../domain/types.js';

/**
 * Agenda falsa, em memória, para o modo de teste e os testes automatizados.
 * Permite:
 *  - semear intervalos ocupados;
 *  - simular falha da API do Google (failNextInsert / alwaysFail);
 *  - introduzir latência para exercitar concorrência.
 */
export class FakeCalendar implements CalendarPort {
  busy: TimeInterval[] = [];
  insertCalls = 0;
  freebusyCalls = 0;
  private failNext = false;
  private alwaysFail = false;
  private insertDelayMs = 0;

  constructor(opts?: { busy?: TimeInterval[]; insertDelayMs?: number }) {
    if (opts?.busy) this.busy = opts.busy;
    if (opts?.insertDelayMs) this.insertDelayMs = opts.insertDelayMs;
  }

  seedBusyLocal(timezone: string, startLocalISO: string, durationMinutes: number): void {
    const start = DateTime.fromISO(startLocalISO, { zone: timezone });
    const end = start.plus({ minutes: durationMinutes });
    this.busy.push({ start: start.toUTC().toISO()!, end: end.toUTC().toISO()! });
  }

  failNextInsert(): void {
    this.failNext = true;
  }

  setAlwaysFail(v: boolean): void {
    this.alwaysFail = v;
  }

  async freebusy(_calendarId: string, timeMinISO: string, timeMaxISO: string): Promise<TimeInterval[]> {
    this.freebusyCalls++;
    const window = Interval.fromDateTimes(
      DateTime.fromISO(timeMinISO, { zone: 'utc' }),
      DateTime.fromISO(timeMaxISO, { zone: 'utc' }),
    );
    return this.busy.filter((b) => {
      const iv = Interval.fromDateTimes(
        DateTime.fromISO(b.start, { zone: 'utc' }),
        DateTime.fromISO(b.end, { zone: 'utc' }),
      );
      return iv.overlaps(window) || iv.engulfs(window) || window.engulfs(iv);
    });
  }

  async insertEvent(_calendarId: string, event: CalendarEventInput): Promise<CreatedEvent> {
    if (this.insertDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this.insertDelayMs));
    }
    if (this.alwaysFail || this.failNext) {
      this.failNext = false;
      throw new Error('Google Calendar API indisponível (simulado)');
    }
    this.insertCalls++;
    // Passa a contar como ocupado para chamadas futuras de freebusy.
    this.busy.push({ start: event.startISO, end: event.endISO });
    return { id: randomUUID(), htmlLink: 'https://calendar.google.com/evento-fake' };
  }
}
