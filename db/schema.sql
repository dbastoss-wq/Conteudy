-- Armazenamento persistente do agente de atendimento (PostgreSQL 14+).
-- Toda a lógica de idempotência fica em funções SQL chamadas pelo n8n com um único parâmetro jsonb.
-- Idempotente: pode ser reaplicado (CREATE ... IF NOT EXISTS / CREATE OR REPLACE).

CREATE SCHEMA IF NOT EXISTS agente;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS agente.settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agente.contacts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text NOT NULL UNIQUE,
  name       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agente.conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gmail_thread_id text NOT NULL UNIQUE,
  contact_id      uuid REFERENCES agente.contacts(id),
  subject         text,
  status          text NOT NULL DEFAULT 'aberta' CHECK (status IN ('aberta','aguardando_contato','escalada','encerrada')),
  last_intent     text,
  summary         text,
  next_action     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agente.messages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gmail_message_id  text UNIQUE,
  rfc822_message_id text,
  conversation_id   uuid REFERENCES agente.conversations(id),
  direction         text NOT NULL CHECK (direction IN ('in','out')),
  from_email        text,
  to_emails         text[],
  subject           text,
  body_text         text,
  received_at       timestamptz,
  status            text NOT NULL DEFAULT 'pendente'
                    CHECK (status IN ('pendente','processando','concluida','ignorada','escalada','falhou','descartada','registrada')),
  skip_reason       text,
  intent            text,
  attempts          int NOT NULL DEFAULT 0,
  last_error        text,
  locked_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conv_idx ON agente.messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS messages_status_idx ON agente.messages (status, locked_at);

-- Cada envio tem uma chave de idempotência; o Message-ID é gerado antes do envio para permitir verificação.
CREATE TABLE IF NOT EXISTS agente.outbound_emails (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key   text NOT NULL UNIQUE,
  kind              text NOT NULL CHECK (kind IN ('resposta','confirmacao_encaminhamento','encaminhamento','alerta')),
  conversation_id   uuid REFERENCES agente.conversations(id),
  source_message_id uuid REFERENCES agente.messages(id),
  to_emails         text[] NOT NULL,
  subject           text,
  body_text         text,
  rfc822_message_id text NOT NULL,
  gmail_message_id  text,
  gmail_thread_id   text,
  status            text NOT NULL DEFAULT 'preparado' CHECK (status IN ('preparado','enviando','enviado','falhou','desconhecido','descartado')),
  attempts          int NOT NULL DEFAULT 0,
  last_error        text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  sent_at           timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agente.bookings (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendly_invitee_uri text NOT NULL UNIQUE,
  calendly_event_uri   text NOT NULL,
  event_type_uri       text,
  event_name           text,
  contact_id           uuid REFERENCES agente.contacts(id),
  conversation_id      uuid REFERENCES agente.conversations(id),
  start_time           timestamptz,
  end_time             timestamptz,
  timezone             text,
  status               text NOT NULL CHECK (status IN ('ativo','cancelado','reagendado')),
  cancel_url           text,
  reschedule_url       text,
  rescheduled_from_uri text,
  rescheduled_to_uri   text,
  google_event_id      text,
  calendar_kind        text,
  location             jsonb,
  canceled_reason      text,
  verified_at          timestamptz,
  last_source          text,
  remote_updated_at    timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bookings_contact_idx ON agente.bookings (contact_id, start_time);

CREATE TABLE IF NOT EXISTS agente.webhook_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key   text NOT NULL UNIQUE,
  source       text NOT NULL,
  event        text,
  payload      jsonb,
  status       text NOT NULL DEFAULT 'recebido' CHECK (status IN ('recebido','processado','falhou')),
  attempts     int NOT NULL DEFAULT 0,
  last_error   text,
  received_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE TABLE IF NOT EXISTS agente.action_log (
  id           bigserial PRIMARY KEY,
  at           timestamptz NOT NULL DEFAULT now(),
  workflow     text,
  execution_id text,
  entity_type  text,
  entity_id    text,
  action       text NOT NULL,
  status       text NOT NULL,
  detail       jsonb
);
CREATE INDEX IF NOT EXISTS action_log_entity_idx ON agente.action_log (entity_type, entity_id, at);

-- Área de psiquiatria e risco (mesmo conteúdo de db/migracoes/001_psiquiatria.sql).
ALTER TABLE agente.conversations ADD COLUMN IF NOT EXISTS area text NOT NULL DEFAULT 'geral';
ALTER TABLE agente.conversations ADD COLUMN IF NOT EXISTS risk_level text NOT NULL DEFAULT 'nenhum';
ALTER TABLE agente.conversations ADD COLUMN IF NOT EXISTS risk_flagged_at timestamptz;
ALTER TABLE agente.conversations DROP CONSTRAINT IF EXISTS conversations_area_check;
ALTER TABLE agente.conversations ADD CONSTRAINT conversations_area_check CHECK (area IN ('geral','psiquiatria'));
ALTER TABLE agente.conversations DROP CONSTRAINT IF EXISTS conversations_risk_level_check;
ALTER TABLE agente.conversations ADD CONSTRAINT conversations_risk_level_check CHECK (risk_level IN ('nenhum','possivel','alto'));
ALTER TABLE agente.outbound_emails DROP CONSTRAINT IF EXISTS outbound_emails_kind_check;
ALTER TABLE agente.outbound_emails ADD CONSTRAINT outbound_emails_kind_check
  CHECK (kind IN ('resposta','confirmacao_encaminhamento','encaminhamento','alerta','alerta_risco','resposta_risco'));
ALTER TABLE agente.messages ADD COLUMN IF NOT EXISTS anonymized_at timestamptz;

-- ---------------------------------------------------------------- funções

CREATE OR REPLACE FUNCTION agente.log(p jsonb) RETURNS void LANGUAGE sql AS $$
  INSERT INTO agente.action_log (workflow, execution_id, entity_type, entity_id, action, status, detail)
  VALUES (p->>'workflow', p->>'execution_id', p->>'entity_type', p->>'entity_id', coalesce(p->>'action','?'), coalesce(p->>'status','info'), p->'detail');
$$;

CREATE OR REPLACE FUNCTION agente.settings_get() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb) FROM agente.settings;
$$;

CREATE OR REPLACE FUNCTION agente.settings_set(p_key text, p_value jsonb) RETURNS void LANGUAGE sql AS $$
  INSERT INTO agente.settings (key, value) VALUES (p_key, p_value)
  ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now();
$$;

CREATE OR REPLACE FUNCTION agente.upsert_contact(p_email text, p_name text) RETURNS uuid LANGUAGE sql AS $$
  INSERT INTO agente.contacts (email, name) VALUES (lower(p_email), nullif(p_name,''))
  ON CONFLICT (email) DO UPDATE SET name = coalesce(nullif(excluded.name,''), agente.contacts.name), updated_at = now()
  RETURNING id;
$$;

-- Reivindica uma mensagem recebida para processamento exclusivo.
-- claimed=false quando já concluída, em processamento por outra execução ou sem tentativas restantes.
CREATE OR REPLACE FUNCTION agente.claim_message(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  v_contact uuid; v_conv uuid; v_msg agente.messages%ROWTYPE;
  v_max int := coalesce((p->>'max_attempts')::int, 3);
  v_lock interval := make_interval(mins => coalesce((p->>'lock_minutes')::int, 15));
BEGIN
  v_contact := agente.upsert_contact(p->>'from_email', p->>'from_name');
  INSERT INTO agente.conversations (gmail_thread_id, contact_id, subject)
  VALUES (p->>'gmail_thread_id', v_contact, p->>'subject')
  ON CONFLICT (gmail_thread_id) DO UPDATE SET updated_at = now()
  RETURNING id INTO v_conv;

  INSERT INTO agente.messages (gmail_message_id, rfc822_message_id, conversation_id, direction, from_email, to_emails, subject, body_text, received_at)
  VALUES (p->>'gmail_message_id', p->>'rfc822_message_id', v_conv, 'in', lower(p->>'from_email'),
          ARRAY(SELECT jsonb_array_elements_text(coalesce(p->'to','[]'::jsonb))), p->>'subject', p->>'body_text',
          coalesce((p->>'internal_date')::timestamptz, now()))
  ON CONFLICT (gmail_message_id) DO NOTHING;

  -- Bloqueio atômico: só uma execução passa por aqui por mensagem.
  UPDATE agente.messages m SET status = 'processando', locked_at = now(), attempts = m.attempts + 1, updated_at = now()
  WHERE m.gmail_message_id = p->>'gmail_message_id'
    AND (m.status = 'pendente' OR (m.status IN ('falhou','processando') AND (m.locked_at IS NULL OR m.locked_at < now() - v_lock)))
    AND m.attempts < v_max
  RETURNING * INTO v_msg;

  IF NOT FOUND THEN
    SELECT * INTO v_msg FROM agente.messages WHERE gmail_message_id = p->>'gmail_message_id';
    RETURN jsonb_build_object('claimed', false, 'message_id', v_msg.id, 'status', v_msg.status, 'attempts', v_msg.attempts,
      'exhausted', v_msg.attempts >= v_max AND v_msg.status IN ('falhou','processando'), 'conversation_id', v_conv, 'contact_id', v_contact);
  END IF;
  RETURN jsonb_build_object('claimed', true, 'message_id', v_msg.id, 'status', v_msg.status, 'attempts', v_msg.attempts,
    'conversation_id', v_conv, 'contact_id', v_contact);
END $$;

-- Contexto para a decisão: conversa, histórico, agendamentos verificados e contadores anti-ciclo.
CREATE OR REPLACE FUNCTION agente.get_context(p jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE v_conv agente.conversations%ROWTYPE; v_contact uuid; v_tz text := coalesce(p->>'timezone','America/Sao_Paulo');
BEGIN
  SELECT * INTO v_conv FROM agente.conversations WHERE id = (p->>'conversation_id')::uuid;
  v_contact := v_conv.contact_id;
  RETURN jsonb_build_object(
    'conversation', jsonb_build_object('id', v_conv.id, 'status', v_conv.status, 'summary', v_conv.summary,
                                       'next_action', v_conv.next_action, 'last_intent', v_conv.last_intent,
                                       'area', v_conv.area, 'risk_level', v_conv.risk_level),
    'history', coalesce((SELECT jsonb_agg(h ORDER BY h.at) FROM (
        SELECT to_char(coalesce(m.received_at, m.created_at) AT TIME ZONE v_tz, 'YYYY-MM-DD HH24:MI') AS at,
               m.direction, m.from_email, left(m.body_text, 2000) AS body
        FROM agente.messages m
        WHERE m.conversation_id = v_conv.id AND m.id <> (p->>'message_id')::uuid
          AND (m.direction = 'out' OR m.status <> 'ignorada')
        ORDER BY coalesce(m.received_at, m.created_at) DESC LIMIT 10) h), '[]'::jsonb),
    'bookings', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id', b.id, 'event_name', b.event_name, 'event_type_uri', b.event_type_uri, 'status', b.status, 'start_time', b.start_time, 'end_time', b.end_time,
        'start_local', to_char(b.start_time AT TIME ZONE coalesce(b.timezone, v_tz), 'DD/MM/YYYY HH24:MI'),
        'end_local', to_char(b.end_time AT TIME ZONE coalesce(b.timezone, v_tz), 'DD/MM/YYYY HH24:MI'),
        'timezone', coalesce(b.timezone, v_tz), 'verified', b.verified_at IS NOT NULL,
        'cancel_url', b.cancel_url, 'reschedule_url', b.reschedule_url) ORDER BY b.start_time DESC)
      FROM agente.bookings b WHERE b.contact_id = v_contact AND b.start_time > now() - interval '30 days'), '[]'::jsonb),
    'auto_replies_thread_24h', (SELECT count(*) FROM agente.outbound_emails o
        WHERE o.conversation_id = v_conv.id AND o.kind IN ('resposta','confirmacao_encaminhamento')
          AND o.status = 'enviado' AND o.sent_at > now() - interval '24 hours'),
    'risk_replies_thread_24h', (SELECT count(*) FROM agente.outbound_emails o
        WHERE o.conversation_id = v_conv.id AND o.kind = 'resposta_risco'
          AND o.status = 'enviado' AND o.sent_at > now() - interval '24 hours'),
    'auto_replies_sender_24h', (SELECT count(*) FROM agente.outbound_emails o
        JOIN agente.conversations c ON c.id = o.conversation_id
        WHERE c.contact_id = v_contact AND o.kind IN ('resposta','confirmacao_encaminhamento')
          AND o.status = 'enviado' AND o.sent_at > now() - interval '24 hours'));
END $$;

-- Conclui o processamento de uma mensagem recebida (sucesso, ignorada, escalada ou falha).
CREATE OR REPLACE FUNCTION agente.finish_message(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_msg agente.messages%ROWTYPE;
BEGIN
  UPDATE agente.messages SET status = p->>'status', skip_reason = coalesce(p->>'skip_reason', skip_reason),
         intent = coalesce(p->>'intent', intent), last_error = p->>'error', locked_at = NULL, updated_at = now()
  WHERE id = (p->>'message_id')::uuid RETURNING * INTO v_msg;
  IF p ? 'conversation' THEN
    UPDATE agente.conversations SET
      status = coalesce(p->'conversation'->>'status', status),
      summary = coalesce(nullif(p->'conversation'->>'summary',''), summary),
      next_action = coalesce(nullif(p->'conversation'->>'next_action',''), next_action),
      last_intent = coalesce(p->'conversation'->>'last_intent', last_intent),
      -- Uma vez psiquiatria, sempre psiquiatria; o nível de risco só sobe.
      area = CASE WHEN area = 'psiquiatria' THEN area ELSE coalesce(p->'conversation'->>'area', area) END,
      risk_level = CASE
        WHEN coalesce(p->'conversation'->>'risk_level', 'nenhum') = 'alto' THEN 'alto'
        WHEN coalesce(p->'conversation'->>'risk_level', 'nenhum') = 'possivel' AND risk_level = 'nenhum' THEN 'possivel'
        ELSE risk_level END,
      risk_flagged_at = CASE WHEN coalesce(p->'conversation'->>'risk_level', 'nenhum') <> 'nenhum' THEN now() ELSE risk_flagged_at END,
      updated_at = now()
    WHERE id = v_msg.conversation_id;
  END IF;
  PERFORM agente.log(jsonb_build_object('workflow', p->>'workflow', 'execution_id', p->>'execution_id', 'entity_type', 'message',
    'entity_id', v_msg.id::text, 'action', 'finalizar_mensagem', 'status', v_msg.status,
    'detail', jsonb_build_object('skip_reason', v_msg.skip_reason, 'intent', v_msg.intent, 'error', v_msg.last_error, 'extra', p->'detail')));
  RETURN jsonb_build_object('message_id', v_msg.id, 'status', v_msg.status, 'attempts', v_msg.attempts);
END $$;

-- Prepara (ou recupera) um envio idempotente. should_send só é true quando é seguro tentar enviar;
-- needs_verification indica tentativa anterior com resultado desconhecido (verificar na caixa antes).
CREATE OR REPLACE FUNCTION agente.prepare_outbound(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v agente.outbound_emails%ROWTYPE; v_max int := coalesce((p->>'max_attempts')::int, 3);
BEGIN
  INSERT INTO agente.outbound_emails (idempotency_key, kind, conversation_id, source_message_id, to_emails, subject, body_text, rfc822_message_id)
  VALUES (p->>'idempotency_key', p->>'kind', nullif(p->>'conversation_id','')::uuid, nullif(p->>'source_message_id','')::uuid,
          ARRAY(SELECT jsonb_array_elements_text(p->'to')), p->>'subject', p->>'body_text', p->>'rfc822_message_id')
  ON CONFLICT (idempotency_key) DO NOTHING;
  SELECT * INTO v FROM agente.outbound_emails WHERE idempotency_key = p->>'idempotency_key' FOR UPDATE;

  IF v.status = 'enviado' OR v.status = 'descartado' THEN
    RETURN jsonb_build_object('outbound_id', v.id, 'status', v.status, 'should_send', false, 'needs_verification', false,
      'rfc822_message_id', v.rfc822_message_id, 'gmail_message_id', v.gmail_message_id);
  END IF;
  IF v.attempts >= v_max THEN
    UPDATE agente.outbound_emails SET status = 'falhou', updated_at = now() WHERE id = v.id;
    RETURN jsonb_build_object('outbound_id', v.id, 'status', 'falhou', 'should_send', false, 'needs_verification', false,
      'exhausted', true, 'rfc822_message_id', v.rfc822_message_id);
  END IF;
  UPDATE agente.outbound_emails SET status = 'enviando', attempts = attempts + 1, updated_at = now() WHERE id = v.id;
  RETURN jsonb_build_object('outbound_id', v.id, 'status', 'enviando', 'should_send', true,
    'needs_verification', v.status IN ('enviando','desconhecido','falhou') AND v.attempts > 0,
    'attempt', v.attempts + 1, 'rfc822_message_id', v.rfc822_message_id,
    'subject', v.subject, 'body_text', v.body_text, 'to', to_jsonb(v.to_emails));
END $$;

-- Registra o resultado real do envio, conforme a resposta da Gmail API.
CREATE OR REPLACE FUNCTION agente.record_send_result(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v agente.outbound_emails%ROWTYPE;
BEGIN
  UPDATE agente.outbound_emails SET
    status = p->>'status', gmail_message_id = coalesce(p->>'gmail_message_id', gmail_message_id),
    gmail_thread_id = coalesce(p->>'gmail_thread_id', gmail_thread_id), last_error = p->>'error',
    sent_at = CASE WHEN p->>'status' = 'enviado' THEN coalesce(sent_at, now()) ELSE sent_at END, updated_at = now()
  WHERE id = (p->>'outbound_id')::uuid RETURNING * INTO v;

  IF v.status = 'enviado' AND v.gmail_message_id IS NOT NULL THEN
    INSERT INTO agente.messages (gmail_message_id, rfc822_message_id, conversation_id, direction, from_email, to_emails, subject, body_text, received_at, status)
    VALUES (v.gmail_message_id, v.rfc822_message_id, CASE WHEN v.kind IN ('resposta','confirmacao_encaminhamento') THEN v.conversation_id END,
            'out', p->>'from_email', v.to_emails, v.subject, v.body_text, v.sent_at, 'registrada')
    ON CONFLICT (gmail_message_id) DO NOTHING;
  END IF;
  PERFORM agente.log(jsonb_build_object('workflow', p->>'workflow', 'execution_id', p->>'execution_id', 'entity_type', 'outbound',
    'entity_id', v.id::text, 'action', 'envio_' || v.kind, 'status', v.status,
    'detail', jsonb_build_object('attempts', v.attempts, 'gmail_message_id', v.gmail_message_id, 'error', v.last_error, 'verified_by', p->>'verified_by')));
  RETURN jsonb_build_object('outbound_id', v.id, 'status', v.status, 'gmail_message_id', v.gmail_message_id, 'attempts', v.attempts);
END $$;

CREATE OR REPLACE FUNCTION agente.register_webhook_event(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v agente.webhook_events%ROWTYPE; v_new boolean := false;
BEGIN
  INSERT INTO agente.webhook_events (dedupe_key, source, event, payload)
  VALUES (p->>'dedupe_key', p->>'source', p->>'event', p->'payload')
  ON CONFLICT (dedupe_key) DO NOTHING RETURNING * INTO v;
  IF FOUND THEN v_new := true; ELSE SELECT * INTO v FROM agente.webhook_events WHERE dedupe_key = p->>'dedupe_key'; END IF;
  -- Reprocessa duplicatas apenas se a tentativa anterior falhou.
  UPDATE agente.webhook_events SET attempts = attempts + 1 WHERE id = v.id AND (v_new OR v.status = 'falhou');
  RETURN jsonb_build_object('webhook_event_id', v.id, 'is_new', v_new, 'process', v_new OR v.status = 'falhou', 'status', v.status);
END $$;

CREATE OR REPLACE FUNCTION agente.finish_webhook_event(p jsonb) RETURNS void LANGUAGE sql AS $$
  UPDATE agente.webhook_events SET status = p->>'status', last_error = p->>'error', processed_at = now()
  WHERE id = (p->>'webhook_event_id')::uuid;
$$;

-- Upsert de agendamento a partir de dados verificados na Calendly API.
-- Relaciona ao contato (e-mail) e à conversa (utm_content = id da conversa; senão, conversa mais recente do contato).
CREATE OR REPLACE FUNCTION agente.upsert_booking(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_contact uuid; v_conv uuid; v_prev agente.bookings%ROWTYPE; v agente.bookings%ROWTYPE; v_change text;
BEGIN
  v_contact := agente.upsert_contact(p->>'contact_email', p->>'contact_name');
  IF p->>'utm_content' ~ '^[0-9a-f-]{36}$' THEN
    SELECT id INTO v_conv FROM agente.conversations WHERE id = (p->>'utm_content')::uuid;
  END IF;
  IF v_conv IS NULL THEN
    SELECT conversation_id INTO v_conv FROM agente.bookings WHERE calendly_invitee_uri = p->>'old_invitee_uri';
  END IF;
  IF v_conv IS NULL THEN
    SELECT id INTO v_conv FROM agente.conversations WHERE contact_id = v_contact ORDER BY updated_at DESC LIMIT 1;
  END IF;

  SELECT * INTO v_prev FROM agente.bookings WHERE calendly_invitee_uri = p->>'calendly_invitee_uri' FOR UPDATE;

  INSERT INTO agente.bookings (calendly_invitee_uri, calendly_event_uri, event_type_uri, event_name, contact_id, conversation_id,
    start_time, end_time, timezone, status, cancel_url, reschedule_url, rescheduled_from_uri, rescheduled_to_uri,
    google_event_id, calendar_kind, location, canceled_reason, verified_at, last_source, remote_updated_at)
  VALUES (p->>'calendly_invitee_uri', p->>'calendly_event_uri', p->>'event_type_uri', p->>'event_name', v_contact, v_conv,
    (p->>'start_time')::timestamptz, (p->>'end_time')::timestamptz, p->>'timezone', p->>'status', p->>'cancel_url', p->>'reschedule_url',
    p->>'old_invitee_uri', p->>'new_invitee_uri', p->>'google_event_id', p->>'calendar_kind', p->'location', p->>'canceled_reason',
    now(), p->>'source', (p->>'updated_at_remote')::timestamptz)
  ON CONFLICT (calendly_invitee_uri) DO UPDATE SET
    status = excluded.status, start_time = excluded.start_time, end_time = excluded.end_time, timezone = excluded.timezone,
    event_name = excluded.event_name, cancel_url = coalesce(excluded.cancel_url, agente.bookings.cancel_url),
    reschedule_url = coalesce(excluded.reschedule_url, agente.bookings.reschedule_url),
    rescheduled_from_uri = coalesce(excluded.rescheduled_from_uri, agente.bookings.rescheduled_from_uri),
    rescheduled_to_uri = coalesce(excluded.rescheduled_to_uri, agente.bookings.rescheduled_to_uri),
    google_event_id = coalesce(excluded.google_event_id, agente.bookings.google_event_id),
    calendar_kind = coalesce(excluded.calendar_kind, agente.bookings.calendar_kind),
    location = coalesce(excluded.location, agente.bookings.location),
    canceled_reason = coalesce(excluded.canceled_reason, agente.bookings.canceled_reason),
    conversation_id = coalesce(agente.bookings.conversation_id, excluded.conversation_id),
    verified_at = now(), last_source = excluded.last_source, remote_updated_at = excluded.remote_updated_at, updated_at = now()
  RETURNING * INTO v;

  -- Reagendamento: a reserva antiga aponta para a nova.
  IF p->>'old_invitee_uri' IS NOT NULL THEN
    UPDATE agente.bookings SET status = 'reagendado', rescheduled_to_uri = v.calendly_invitee_uri, updated_at = now()
    WHERE calendly_invitee_uri = p->>'old_invitee_uri';
  END IF;

  v_change := CASE WHEN v_prev.id IS NULL THEN 'novo'
                   WHEN v_prev.status IS DISTINCT FROM v.status THEN 'status:' || v_prev.status || '->' || v.status
                   WHEN v_prev.start_time IS DISTINCT FROM v.start_time THEN 'horario_alterado'
                   ELSE 'sem_alteracao' END;
  IF v_change <> 'sem_alteracao' THEN
    PERFORM agente.log(jsonb_build_object('workflow', p->>'workflow', 'execution_id', p->>'execution_id', 'entity_type', 'booking',
      'entity_id', v.id::text, 'action', 'agendamento_' || v_change, 'status', v.status,
      'detail', jsonb_build_object('source', p->>'source', 'conversation_id', v.conversation_id, 'invitee', v.calendly_invitee_uri)));
  END IF;
  RETURN jsonb_build_object('booking_id', v.id, 'status', v.status, 'change', v_change, 'conversation_id', v.conversation_id, 'contact_id', v_contact);
END $$;

-- Manutenção pós-interrupção: libera travas antigas e marca envios sem resultado como "desconhecido".
CREATE OR REPLACE FUNCTION agente.reset_stale(p jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE n_msg int; n_out int; n_dead int; v_max int := coalesce((p->>'max_attempts')::int, 3);
BEGIN
  UPDATE agente.messages SET status = 'falhou', last_error = coalesce(last_error, 'interrompida'), locked_at = NULL, updated_at = now()
  WHERE status = 'processando' AND locked_at < now() - make_interval(mins => coalesce((p->>'lock_minutes')::int, 15));
  GET DIAGNOSTICS n_msg = ROW_COUNT;
  UPDATE agente.outbound_emails SET status = 'desconhecido', updated_at = now()
  WHERE status = 'enviando' AND updated_at < now() - interval '10 minutes';
  GET DIAGNOSTICS n_out = ROW_COUNT;
  SELECT count(*) INTO n_dead FROM agente.messages WHERE status = 'falhou' AND attempts >= v_max;
  IF n_msg + n_out > 0 THEN
    PERFORM agente.log(jsonb_build_object('workflow', 'reconciliacao', 'action', 'reset_stale', 'status', 'ok',
      'detail', jsonb_build_object('mensagens_liberadas', n_msg, 'envios_desconhecidos', n_out)));
  END IF;
  RETURN jsonb_build_object('released_messages', n_msg, 'unknown_outbound', n_out, 'exhausted_messages', n_dead);
END $$;

-- Envios com resultado desconhecido ou falhos que ainda podem ser verificados/reenviados.
CREATE OR REPLACE FUNCTION agente.list_pending_outbound(p jsonb DEFAULT '{}'::jsonb) RETURNS SETOF jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('outbound_id', id, 'idempotency_key', idempotency_key, 'kind', kind, 'status', status,
    'rfc822_message_id', rfc822_message_id, 'attempts', attempts)
  FROM agente.outbound_emails WHERE status = 'desconhecido' ORDER BY created_at LIMIT 50;
$$;

-- Retenção (LGPD): anonimiza o corpo das mensagens antigas da área de psiquiatria. Desligada quando dias é nulo.
CREATE OR REPLACE FUNCTION agente.anonymize_old(p jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_days int := nullif(p->>'dias', '')::int; v_n int := 0; v_o int := 0;
BEGIN
  IF v_days IS NULL OR v_days < 1 THEN RETURN jsonb_build_object('ativo', false); END IF;
  UPDATE agente.messages m SET body_text = '[removido]', anonymized_at = now(), updated_at = now()
  FROM agente.conversations c
  WHERE c.id = m.conversation_id AND c.area = 'psiquiatria' AND m.anonymized_at IS NULL
    AND m.status NOT IN ('pendente','processando','falhou') AND m.created_at < now() - make_interval(days => v_days);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE agente.outbound_emails o SET body_text = '[removido]', updated_at = now()
  FROM agente.conversations c
  WHERE c.id = o.conversation_id AND c.area = 'psiquiatria' AND o.body_text <> '[removido]'
    AND o.status IN ('enviado','falhou','descartado') AND o.created_at < now() - make_interval(days => v_days);
  GET DIAGNOSTICS v_o = ROW_COUNT;
  PERFORM agente.log(jsonb_build_object('workflow', 'reconciliacao', 'entity_type', 'retencao', 'action', 'anonimizar', 'status', 'ok',
    'detail', jsonb_build_object('dias', v_days, 'mensagens', v_n, 'envios', v_o)));
  RETURN jsonb_build_object('ativo', true, 'mensagens', v_n, 'envios', v_o);
END $$;
