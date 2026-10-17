import { z } from 'zod';

/**
 * Carrega e valida as variáveis de ambiente.
 *
 * Observação: os parâmetros de ATENDIMENTO (dias, horários, duração, intervalo,
 * antecedência, agenda e textos) NÃO ficam aqui — ficam no banco (tabela
 * `settings`), editáveis pelo painel. O env guarda só credenciais e o seed
 * inicial.
 */
const schema = z.object({
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  TZ: z.string().default('America/Sao_Paulo'),

  WHATSAPP_VERIFY_TOKEN: z.string().min(1).default('dev-verify-token'),
  WHATSAPP_APP_SECRET: z.string().default(''),
  WHATSAPP_ACCESS_TOKEN: z.string().default(''),
  WHATSAPP_PHONE_NUMBER_ID: z.string().default(''),
  WHATSAPP_API_VERSION: z.string().default('v21.0'),

  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().default('http://localhost:3000/oauth/google/callback'),
  GOOGLE_REFRESH_TOKEN: z.string().default(''),
  GOOGLE_CALENDAR_ID: z.string().default('primary'),

  LLM_PROVIDER: z.enum(['anthropic', 'openai']).default('anthropic'),
  LLM_API_KEY: z.string().default(''),
  LLM_MODEL: z.string().default('claude-haiku-5-5'),

  DATABASE_URL: z.string().default('postgres://secretaria:secretaria@localhost:5432/secretaria'),

  JWT_SECRET: z.string().min(1).default('dev-jwt-secret-troque-isto'),
  ENCRYPTION_KEY: z.string().default(''),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().optional(),

  CONSULT_PRICE_CENTS: z.coerce.number().int().positive().default(7000),
  PIX_KEY: z.string().default('dc.bastos@icloud.com'),

  DATA_RETENTION_DAYS: z.coerce.number().int().positive().default(365),

  DOCTOR_NOTIFY_CHANNEL: z.enum(['whatsapp', 'email', 'both']).default('both'),
  DOCTOR_WHATSAPP_NUMBER: z.string().default(''),
  DOCTOR_EMAIL: z.string().default(''),
  // Template de WhatsApp aprovado na Meta (1 variável de corpo, {{1}}) usado
  // quando o texto livre é recusado por estar fora da janela de 24h.
  DOCTOR_ALERT_TEMPLATE: z.string().default(''),
  DOCTOR_ALERT_TEMPLATE_LANG: z.string().default('pt_BR'),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_FROM: z.string().default('Secretaria Virtual <no-reply@localhost>'),

  SIMULATE_WHATSAPP: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // Em modo de teste, usa uma agenda falsa em memória (não cria eventos reais
  // no Google). A trava de slot e as consultas continuam no Postgres.
  SIMULATE_CALENDAR: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type Config = z.infer<typeof schema>;

let cached: Config | null = null;

/**
 * Carrega o .env (se existir) para o processo. Não sobrescreve variáveis já
 * definidas no ambiente (Docker, PaaS), então produção continua mandando.
 */
function loadDotEnv(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // sem .env: usa só o ambiente do processo
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (cached) return cached;
  if (env === process.env) loadDotEnv();
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuração inválida (variáveis de ambiente):\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function resetConfigCache(): void {
  cached = null;
}
