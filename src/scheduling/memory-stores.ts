import { randomUUID } from 'node:crypto';
import type {
  AppointmentStore,
  NewAppointment,
  ReservationStore,
  StoredAppointment,
} from './booking.js';

/**
 * Trava de slot em memória. Como o Node é single-thread, `tryReserve` é um
 * check-and-set síncrono — atômico dentro do processo. Usada no modo de teste
 * e nos testes automatizados. Em produção use PgReservationStore.
 */
export class InMemoryReservationStore implements ReservationStore {
  private readonly held = new Set<string>();

  async tryReserve(slotKey: string): Promise<boolean> {
    if (this.held.has(slotKey)) return false;
    this.held.add(slotKey);
    return true;
  }

  async release(slotKey: string): Promise<void> {
    this.held.delete(slotKey);
  }

  has(slotKey: string): boolean {
    return this.held.has(slotKey);
  }
}

export class InMemoryAppointmentStore implements AppointmentStore {
  private readonly byKey = new Map<string, StoredAppointment>();
  readonly all: StoredAppointment[] = [];

  async findByIdempotencyKey(key: string): Promise<StoredAppointment | null> {
    return this.byKey.get(key) ?? null;
  }

  async create(data: NewAppointment): Promise<StoredAppointment> {
    const appointment: StoredAppointment = {
      ...data,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    };
    this.byKey.set(data.idempotencyKey, appointment);
    this.all.push(appointment);
    return appointment;
  }
}
