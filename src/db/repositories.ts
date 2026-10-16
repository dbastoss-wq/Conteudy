import { query } from './pool.js';
import { loadConfig } from '../config.js';
import { encrypt, decrypt } from '../crypto/encryption.js';
import {
  DEFAULT_SETTINGS,
  type SchedulingSettings,
  type ConversationState,
  type PaymentMethod,
  type PaymentStatus,
} from '../domain/types.js';
import type { Slot } from '../scheduling/slots.js';

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface MessageTemplates {
  intro: string;
  payment: string;
}

export interface AppSettings {
  scheduling: SchedulingSettings;
  messages: MessageTemplates;
  googleCalendarId: string;
  consultPriceCents: number;
  pixKey: string;
}

export function defaultMessages(priceCents: number, pixKey: string): MessageTemplates {
  const price = (priceCents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
  return {
    intro:
      'Oi, tudo bem? Aqui é o Dr. Daniel, obrigado pelo contato 😊\n' +
      'Sou clínico geral e atendo por teleconsulta adolescentes, adultos e idosos. Na consulta dá pra ver queixas do dia a dia, acompanhar doenças crônicas, renovar receitas e fazer encaminhamentos quando for preciso.\n' +
      `O valor da consulta é R$ ${price}, definido pela própria PsyMeet.\n` +
      'Se quiser agendar, me conta rapidinho o motivo da consulta e qual dia e horário ficam melhor pra você, que eu vejo a agenda e te confirmo.',
    payment:
      `Consulta agendada! 😊 O valor é R$ ${price} e você pode pagar no crédito, débito ou Pix. ` +
      `Se preferir Pix, a chave é o e-mail ${pixKey}. Qual forma fica melhor pra você?`,
  };
}

export function defaultAppSettings(): AppSettings {
  const cfg = loadConfig();
  return {
    scheduling: DEFAULT_SETTINGS,
    messages: defaultMessages(cfg.CONSULT_PRICE_CENTS, cfg.PIX_KEY),
    googleCalendarId: cfg.GOOGLE_CALENDAR_ID,
    consultPriceCents: cfg.CONSULT_PRICE_CENTS,
    pixKey: cfg.PIX_KEY,
  };
}

export async function getSettings(): Promise<AppSettings> {
  const res = await query<{ config: AppSettings }>('SELECT config FROM settings WHERE id = 1');
  if (!res.rowCount) {
    const def = defaultAppSettings();
    await saveSettings(def);
    return def;
  }
  // merge defensivo com defaults (caso novos campos surjam)
  return { ...defaultAppSettings(), ...res.rows[0]!.config };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await query(
    `INSERT INTO settings (id, config, updated_at) VALUES (1, $1, now())
     ON CONFLICT (id) DO UPDATE SET config = EXCLUDED.config, updated_at = now()`,
    [JSON.stringify(settings)],
  );
}

// ---------------------------------------------------------------------------
// Admin users
// ---------------------------------------------------------------------------

export interface AdminUser {
  id: string;
  email: string;
  passwordHash: string;
}

export async function getAdminByEmail(email: string): Promise<AdminUser | null> {
  const res = await query<{ id: string; email: string; password_hash: string }>(
    'SELECT id, email, password_hash FROM admin_users WHERE email = $1',
    [email.toLowerCase()],
  );
  if (!res.rowCount) return null;
  const r = res.rows[0]!;
  return { id: r.id, email: r.email, passwordHash: r.password_hash };
}

export async function createAdmin(email: string, passwordHash: string): Promise<void> {
  await query(
    `INSERT INTO admin_users (email, password_hash) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [email.toLowerCase(), passwordHash],
  );
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export interface CollectedInfo {
  nome?: string | null;
  motivo?: string | null; // decriptado em memória
  dataPreferida?: string | null; // YYYY-MM-DD
  horaPreferida?: string | null; // HH:mm
}

export interface Conversation {
  id: string;
  phone: string;
  patientName: string | null;
  state: ConversationState;
  botPaused: boolean;
  sentIntro: boolean;
  collected: CollectedInfo;
  pendingSlot: Slot | null;
  proposedSlots: Slot[];
  lastMessageAt: string | null;
  updatedAt: string;
}

function rowToConversation(r: any): Conversation {
  const cfg = loadConfig();
  const collected: CollectedInfo = r.collected ?? {};
  if (collected.motivo) {
    collected.motivo = decrypt(collected.motivo, cfg.ENCRYPTION_KEY);
  }
  return {
    id: r.id,
    phone: r.phone,
    patientName: r.patient_name,
    state: r.state,
    botPaused: r.bot_paused,
    sentIntro: r.sent_intro,
    collected,
    pendingSlot: r.pending_slot ?? null,
    proposedSlots: r.proposed_slots ?? [],
    lastMessageAt: r.last_message_at,
    updatedAt: r.updated_at,
  };
}

export async function getOrCreateConversation(phone: string): Promise<Conversation> {
  const existing = await query('SELECT * FROM conversations WHERE phone = $1', [phone]);
  if (existing.rowCount) return rowToConversation(existing.rows[0]);
  const created = await query(
    'INSERT INTO conversations (phone) VALUES ($1) RETURNING *',
    [phone],
  );
  return rowToConversation(created.rows[0]);
}

export async function getConversationById(id: string): Promise<Conversation | null> {
  const res = await query('SELECT * FROM conversations WHERE id = $1', [id]);
  return res.rowCount ? rowToConversation(res.rows[0]) : null;
}

export async function listConversations(): Promise<Conversation[]> {
  const res = await query('SELECT * FROM conversations ORDER BY last_message_at DESC NULLS LAST, created_at DESC');
  return res.rows.map(rowToConversation);
}

export async function updateConversation(id: string, patch: Partial<Conversation>): Promise<void> {
  const cfg = loadConfig();
  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  const push = (col: string, val: unknown) => {
    fields.push(`${col} = $${i++}`);
    values.push(val);
  };

  if (patch.patientName !== undefined) push('patient_name', patch.patientName);
  if (patch.state !== undefined) push('state', patch.state);
  if (patch.botPaused !== undefined) push('bot_paused', patch.botPaused);
  if (patch.sentIntro !== undefined) push('sent_intro', patch.sentIntro);
  if (patch.collected !== undefined) {
    const toStore: CollectedInfo = { ...patch.collected };
    if (toStore.motivo) toStore.motivo = encrypt(toStore.motivo, cfg.ENCRYPTION_KEY);
    push('collected', JSON.stringify(toStore));
  }
  if (patch.pendingSlot !== undefined) push('pending_slot', patch.pendingSlot ? JSON.stringify(patch.pendingSlot) : null);
  if (patch.proposedSlots !== undefined) push('proposed_slots', JSON.stringify(patch.proposedSlots));
  if (patch.lastMessageAt !== undefined) push('last_message_at', patch.lastMessageAt);

  fields.push('updated_at = now()');
  if (fields.length === 1) return; // só updated_at => nada a fazer

  values.push(id);
  await query(`UPDATE conversations SET ${fields.join(', ')} WHERE id = $${i}`, values);
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export interface StoredMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  body: string;
  msgType: string;
  createdAt: string;
}

/** Retorna false se a mensagem já existia (dedup por wa_message_id). */
export async function recordMessage(params: {
  conversationId: string;
  direction: 'inbound' | 'outbound';
  waMessageId?: string | null;
  body: string;
  msgType?: string;
}): Promise<boolean> {
  const cfg = loadConfig();
  const bodyEnc = encrypt(params.body, cfg.ENCRYPTION_KEY);
  // O índice único é PARCIAL (WHERE wa_message_id IS NOT NULL); o ON CONFLICT
  // precisa repetir o predicado para casar com ele.
  const res = await query(
    `INSERT INTO messages (conversation_id, direction, wa_message_id, body_enc, msg_type)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (wa_message_id) WHERE wa_message_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [params.conversationId, params.direction, params.waMessageId ?? null, bodyEnc, params.msgType ?? 'text'],
  );
  const inserted = (res.rowCount ?? 0) > 0;
  if (inserted) {
    await query('UPDATE conversations SET last_message_at = now() WHERE id = $1', [params.conversationId]);
  }
  return inserted;
}

export async function listMessages(conversationId: string): Promise<StoredMessage[]> {
  const cfg = loadConfig();
  const res = await query(
    'SELECT id, direction, body_enc, msg_type, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
    [conversationId],
  );
  return res.rows.map((r: any) => ({
    id: r.id,
    direction: r.direction,
    body: decrypt(r.body_enc, cfg.ENCRYPTION_KEY),
    msgType: r.msg_type,
    createdAt: r.created_at,
  }));
}

// ---------------------------------------------------------------------------
// Appointments (consulta de leitura; a escrita passa pelo booking service)
// ---------------------------------------------------------------------------

export interface AppointmentView {
  id: string;
  patientName: string;
  phone: string;
  reason: string;
  startAt: string;
  endAt: string;
  timezone: string;
  paymentMethod: PaymentMethod | null;
  paymentStatus: PaymentStatus;
  comprovanteRecebido: boolean;
}

export async function listAppointments(): Promise<AppointmentView[]> {
  const cfg = loadConfig();
  const res = await query('SELECT * FROM appointments ORDER BY start_at DESC');
  return res.rows.map((r: any) => ({
    id: r.id,
    patientName: r.patient_name,
    phone: r.phone,
    reason: decrypt(r.reason_enc, cfg.ENCRYPTION_KEY),
    startAt: r.start_at,
    endAt: r.end_at,
    timezone: r.timezone,
    paymentMethod: r.payment_method,
    paymentStatus: r.payment_status,
    comprovanteRecebido: r.comprovante_recebido,
  }));
}

export async function findAppointmentByConversation(conversationId: string): Promise<AppointmentView | null> {
  const cfg = loadConfig();
  const res = await query(
    'SELECT * FROM appointments WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 1',
    [conversationId],
  );
  if (!res.rowCount) return null;
  const r: any = res.rows[0];
  return {
    id: r.id,
    patientName: r.patient_name,
    phone: r.phone,
    reason: decrypt(r.reason_enc, cfg.ENCRYPTION_KEY),
    startAt: r.start_at,
    endAt: r.end_at,
    timezone: r.timezone,
    paymentMethod: r.payment_method,
    paymentStatus: r.payment_status,
    comprovanteRecebido: r.comprovante_recebido,
  };
}

export async function updateAppointmentPayment(
  id: string,
  patch: { paymentMethod?: PaymentMethod | null; paymentStatus?: PaymentStatus; comprovanteRecebido?: boolean },
): Promise<void> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (patch.paymentMethod !== undefined) { fields.push(`payment_method = $${i++}`); values.push(patch.paymentMethod); }
  if (patch.paymentStatus !== undefined) { fields.push(`payment_status = $${i++}`); values.push(patch.paymentStatus); }
  if (patch.comprovanteRecebido !== undefined) { fields.push(`comprovante_recebido = $${i++}`); values.push(patch.comprovanteRecebido); }
  if (!fields.length) return;
  values.push(id);
  await query(`UPDATE appointments SET ${fields.join(', ')} WHERE id = $${i}`, values);
}

export async function audit(action: string, entity: string, entityId: string, meta?: unknown): Promise<void> {
  await query('INSERT INTO audit_log (action, entity, entity_id, meta) VALUES ($1,$2,$3,$4)', [
    action,
    entity,
    entityId,
    meta ? JSON.stringify(meta) : null,
  ]);
}
