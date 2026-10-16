import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { bookAppointment, slotKeyOf, type BookInput } from '../src/scheduling/booking';
import { FakeCalendar } from '../src/calendar/fake-calendar';
import { InMemoryAppointmentStore, InMemoryReservationStore } from '../src/scheduling/memory-stores';

const TZ = 'America/Sao_Paulo';

function bookInput(overrides: Partial<BookInput> = {}): BookInput {
  const start = DateTime.fromISO('2026-10-20T14:00:00', { zone: TZ }).toUTC().toISO()!;
  const end = DateTime.fromISO('2026-10-20T14:15:00', { zone: TZ }).toUTC().toISO()!;
  return {
    calendarId: 'primary',
    startISO: start,
    endISO: end,
    timezone: TZ,
    conversationId: 'conv-1',
    patientName: 'Maria Teste',
    phone: '5511988887777',
    reason: 'dor de garganta',
    idempotencyKey: 'conv-1|2026-10-20T17:00:00.000Z',
    ...overrides,
  };
}

describe('duas mensagens simultâneas pedindo o mesmo horário', () => {
  it('agenda apenas uma vez; a segunda recebe slot_taken e o Google é chamado uma única vez', async () => {
    const calendar = new FakeCalendar({ insertDelayMs: 25 }); // latência para exercitar a corrida
    const reservations = new InMemoryReservationStore();
    const appointments = new InMemoryAppointmentStore();
    const deps = { calendar, reservations, appointments };

    // Mesmo slot, conversas/idempotency keys diferentes => só a trava de slot
    // pode impedir o double-booking.
    const a = bookInput({ conversationId: 'conv-A', idempotencyKey: 'A|slot' });
    const b = bookInput({ conversationId: 'conv-B', idempotencyKey: 'B|slot' });

    const [r1, r2] = await Promise.all([
      bookAppointment(a, deps),
      bookAppointment(b, deps),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual(['booked', 'slot_taken']);
    expect(calendar.insertCalls).toBe(1);
    expect(appointments.all).toHaveLength(1);
  });

  it('mensagens repetidas da MESMA conversa (mesma idempotency key) não duplicam', async () => {
    const calendar = new FakeCalendar();
    const reservations = new InMemoryReservationStore();
    const appointments = new InMemoryAppointmentStore();
    const deps = { calendar, reservations, appointments };

    const input = bookInput();
    const first = await bookAppointment(input, deps);
    const second = await bookAppointment(input, deps);

    expect(first.status).toBe('booked');
    expect(second.status).toBe('already_booked');
    expect(calendar.insertCalls).toBe(1);
    expect(appointments.all).toHaveLength(1);
  });
});

describe('falha da API do Google', () => {
  it('não confirma, não persiste e libera o slot para nova tentativa', async () => {
    const calendar = new FakeCalendar();
    calendar.failNextInsert();
    const reservations = new InMemoryReservationStore();
    const appointments = new InMemoryAppointmentStore();
    const deps = { calendar, reservations, appointments };

    const input = bookInput();
    const result = await bookAppointment(input, deps);

    expect(result.status).toBe('calendar_error');
    expect(appointments.all).toHaveLength(0);
    // Slot liberado => uma nova tentativa é possível.
    expect(reservations.has(slotKeyOf(input.calendarId, input.startISO))).toBe(false);

    // Segunda tentativa (Google de volta) agenda normalmente.
    const retry = await bookAppointment(input, deps);
    expect(retry.status).toBe('booked');
    expect(appointments.all).toHaveLength(1);
  });
});
