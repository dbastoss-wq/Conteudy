import { DateTime, Interval } from 'luxon';
import type { CalendarPort, CalendarEventInput, CreatedEvent } from '../scheduling/booking.js';
import type { TimeInterval } from '../domain/types.js';

/**
 * Agenda falsa, em memória, para o modo de teste e os testes automatizados.
 * Permite:
 *  - semear intervalos ocupados;
 *  - simular falha da API do Google (failNextInsert / alwaysFail);
 *  - simular resposta perdida DEPOIS de criar o evento (timeoutAfterNextInsert);
 *  - introduzir latência para exercitar concorrência.
 * Como o Google, o insert é idempotente por id.
 */
export class FakeCalendar implements CalendarPort {
  busy: TimeInterval[] = [];
  insertCalls = 0;
  freebusyCalls = 0;
  readonly events = new Map<string, CalendarEventInput>();
  private failNext = false;
  private alwaysFail = false;
  private timeoutAfterInsert = false;
  private getEventFails = false;
  private breakLookupOnTimeout = false;
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

  /**
   * O próximo insert CRIA o evento, mas a resposta se perde (timeout).
   * Com `breakLookup`, a conferência (getEvent) também passa a falhar a partir daí.
   */
  timeoutAfterNextInsert(opts?: { breakLookup?: boolean }): void {
    this.timeoutAfterInsert = true;
    this.breakLookupOnTimeout = opts?.breakLookup ?? false;
  }

  /** getEvent passa a falhar (API indisponível), como o resto do Google. */
  setGetEventFails(v: boolean): void {
    this.getEventFails = v;
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
    const created: CreatedEvent = { id: event.id, htmlLink: 'https://calendar.google.com/evento-fake' };
    if (!this.events.has(event.id)) {
      this.insertCalls++;
      this.events.set(event.id, event);
      // Passa a contar como ocupado para chamadas futuras de freebusy.
      this.busy.push({ start: event.startISO, end: event.endISO });
    }
    if (this.timeoutAfterInsert) {
      this.timeoutAfterInsert = false;
      if (this.breakLookupOnTimeout) this.getEventFails = true;
      throw new Error('timeout: resposta do Google perdida (simulado)');
    }
    return created;
  }

  async getEvent(_calendarId: string, eventId: string): Promise<CreatedEvent | null> {
    if (this.alwaysFail || this.getEventFails) throw new Error('Google Calendar API indisponível (simulado)');
    return this.events.has(eventId) ? { id: eventId } : null;
  }
}
