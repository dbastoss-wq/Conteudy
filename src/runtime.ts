import { loadConfig } from './config.js';
import { GoogleCalendar } from './calendar/google.js';
import { FakeCalendar } from './calendar/fake-calendar.js';
import { PgReservationStore, PgAppointmentStore } from './db/pg-stores.js';
import type { CalendarPort, ReservationStore, AppointmentStore } from './scheduling/booking.js';

export interface Runtime {
  calendar: CalendarPort;
  reservations: ReservationStore;
  appointments: AppointmentStore;
  /** Referência extra para anexar a forma de pagamento à descrição do evento. */
  googleCalendar: GoogleCalendar | null;
}

let cached: Runtime | null = null;

export function getRuntime(): Runtime {
  if (cached) return cached;
  const cfg = loadConfig();
  const google = cfg.SIMULATE_CALENDAR ? null : new GoogleCalendar();
  const calendar: CalendarPort = google ?? new FakeCalendar();
  cached = {
    calendar,
    reservations: new PgReservationStore(),
    appointments: new PgAppointmentStore(),
    googleCalendar: google,
  };
  return cached;
}

export function setRuntimeForTests(rt: Runtime): void {
  cached = rt;
}
