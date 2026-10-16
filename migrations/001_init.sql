-- Secretária virtual — esquema inicial
-- Fuso: tudo armazenado em UTC (timestamptz); conversão para America/Sao_Paulo é feita na aplicação.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Configurações (linha única id=1). Parâmetros de atendimento + textos das mensagens.
CREATE TABLE IF NOT EXISTS settings (
  id            INTEGER PRIMARY KEY DEFAULT 1,
  config        JSONB NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT settings_singleton CHECK (id = 1)
);

-- Administradores do painel.
CREATE TABLE IF NOT EXISTS admin_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Conversas (uma por paciente/telefone).
CREATE TABLE IF NOT EXISTS conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone           TEXT NOT NULL UNIQUE,
  patient_name    TEXT,
  state           TEXT NOT NULL DEFAULT 'NOVO',
  bot_paused      BOOLEAN NOT NULL DEFAULT false,
  sent_intro      BOOLEAN NOT NULL DEFAULT false,
  -- dados coletados; campos sensíveis (motivo) ficam CRIPTOGRAFADOS dentro do jsonb
  collected       JSONB NOT NULL DEFAULT '{}'::jsonb,
  pending_slot    JSONB,          -- slot aguardando confirmação explícita
  proposed_slots  JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_conversations_state ON conversations (state);

-- Mensagens (histórico). body_enc é criptografado em repouso.
CREATE TABLE IF NOT EXISTS messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction        TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  wa_message_id    TEXT,           -- id da Meta; usado para deduplicação
  body_enc         TEXT NOT NULL,
  msg_type         TEXT NOT NULL DEFAULT 'text',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Deduplicação de webhooks reentregues pela Meta.
CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_wa_id ON messages (wa_message_id) WHERE wa_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages (conversation_id, created_at);

-- Consultas agendadas. reason_enc criptografado. idempotency_key impede duplicidade.
CREATE TABLE IF NOT EXISTS appointments (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id      UUID REFERENCES conversations(id) ON DELETE SET NULL,
  calendar_id          TEXT NOT NULL,
  event_id             TEXT NOT NULL,
  idempotency_key      TEXT NOT NULL UNIQUE,
  patient_name         TEXT NOT NULL,
  phone                TEXT NOT NULL,
  reason_enc           TEXT NOT NULL,
  start_at             TIMESTAMPTZ NOT NULL,
  end_at               TIMESTAMPTZ NOT NULL,
  timezone             TEXT NOT NULL,
  payment_method       TEXT,       -- pix | credito | debito | null
  payment_status       TEXT NOT NULL DEFAULT 'pendente',
  comprovante_recebido BOOLEAN NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appointments_start ON appointments (start_at);

-- Trava de slot: garante que o mesmo horário não seja agendado duas vezes,
-- inclusive entre processos/instâncias. A unicidade da PK é a trava.
CREATE TABLE IF NOT EXISTS slot_locks (
  slot_key    TEXT PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trilha de auditoria (LGPD / rastreabilidade).
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  action      TEXT NOT NULL,
  entity      TEXT,
  entity_id   TEXT,
  meta        JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
