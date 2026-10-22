-- Área de teleconsulta em psiquiatria: colunas de área e risco, novos tipos de envio.
-- Só acrescenta; pode ser reaplicada. Depois dela, reaplique db/schema.sql para atualizar as funções.
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
