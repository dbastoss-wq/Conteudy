import { query } from './pool.js';
import { loadConfig } from '../config.js';
import { encrypt } from '../crypto/encryption.js';
import type {
  AppointmentStore,
  NewAppointment,
  ReservationStore,
  StoredAppointment,
} from '../scheduling/booking.js';

/**
 * Trava de slot em Postgres. A unicidade da PK de `slot_locks` é o que garante
 * exclusão mútua entre processos/instâncias: INSERT ... ON CONFLICT DO NOTHING
 * é atômico. É o que impede double-booking de verdade em produção.
 */
export class PgReservationStore implements ReservationStore {
  async tryReserve(slotKey: string): Promise<boolean> {
    const res = await query(
      `INSERT INTO slot_locks (slot_key) VALUES ($1)
       ON CONFLICT (slot_key) DO NOTHING RETURNING slot_key`,
      [slotKey],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async release(slotKey: string): Promise<void> {
    await query('DELETE FROM slot_locks WHERE slot_key = $1', [slotKey]);
  }
}

export class PgAppointmentStore implements AppointmentStore {
  async findByIdempotencyKey(key: string): Promise<StoredAppointment | null> {
    const res = await query('SELECT * FROM appointments WHERE idempotency_key = $1', [key]);
    if (!res.rowCount) return null;
    return mapRow(res.rows[0]);
  }

  async create(data: NewAppointment): Promise<StoredAppointment> {
    const cfg = loadConfig();
    const res = await query(
      `INSERT INTO appointments
         (conversation_id, calendar_id, event_id, idempotency_key, patient_name, phone,
          reason_enc, start_at, end_at, timezone, payment_method)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [
        data.conversationId,
        data.calendarId,
        data.eventId,
        data.idempotencyKey,
        data.patientName,
        data.phone,
        encrypt(data.reason, cfg.ENCRYPTION_KEY),
        data.startISO,
        data.endISO,
        data.timezone,
        data.paymentMethod,
      ],
    );
    return mapRow(res.rows[0]);
  }
}

function mapRow(r: any): StoredAppointment {
  return {
    id: r.id,
    idempotencyKey: r.idempotency_key,
    conversationId: r.conversation_id,
    calendarId: r.calendar_id,
    eventId: r.event_id,
    patientName: r.patient_name,
    phone: r.phone,
    reason: '', // não decriptamos aqui; o booking não precisa reler o motivo
    startISO: typeof r.start_at === 'string' ? r.start_at : new Date(r.start_at).toISOString(),
    endISO: typeof r.end_at === 'string' ? r.end_at : new Date(r.end_at).toISOString(),
    timezone: r.timezone,
    paymentMethod: r.payment_method,
    createdAt: typeof r.created_at === 'string' ? r.created_at : new Date(r.created_at).toISOString(),
  };
}
