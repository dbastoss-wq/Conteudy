import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * Gera o .env a partir do .env.example, criando os segredos que dá para criar
 * sozinho. Idempotente: o que já estiver preenchido no .env existente é mantido;
 * só são gerados os segredos ausentes ou ainda com o valor de exemplo.
 *
 * Uso: npm run setup:env [-- --out caminho/do/.env]
 */
const EXAMPLE = '.env.example';
const LINE = /^([A-Z0-9_]+)=([^#\n]*?)\s*(#.*)?$/;

const GENERATORS: Record<string, () => string> = {
  JWT_SECRET: () => randomBytes(32).toString('hex'),
  ENCRYPTION_KEY: () => randomBytes(32).toString('base64'),
  WHATSAPP_VERIFY_TOKEN: () => randomBytes(16).toString('hex'),
  ADMIN_PASSWORD: () => randomBytes(12).toString('base64url'),
  POSTGRES_PASSWORD: () => randomBytes(18).toString('base64url'),
};

/** O que só você consegue fornecer (contas externas). */
const MANUAL = [
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_APP_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REFRESH_TOKEN',
  'LLM_API_KEY',
];
const EXAMPLE_PLACEHOLDERS = new Set([
  'token-permanente-de-envio',
  'app-secret-do-painel-meta',
  '000000000000000',
]);

function parse(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split('\n')) {
    const m = line.match(LINE);
    if (m) map.set(m[1]!, m[2]!.trim());
  }
  return map;
}

function main(): void {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outPath = outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1]! : '.env';

  const exampleLines = readFileSync(EXAMPLE, 'utf8').split('\n');
  const exampleValues = parse(exampleLines.join('\n'));
  const existing = existsSync(outPath) ? parse(readFileSync(outPath, 'utf8')) : new Map<string, string>();

  const values = new Map<string, string>();
  const generated: string[] = [];
  for (const [key, exampleValue] of exampleValues) {
    const current = existing.get(key);
    let value = current !== undefined && current !== '' ? current : exampleValue;
    const gen = GENERATORS[key];
    if (gen && (current === undefined || current === '' || current === exampleValue)) {
      value = gen();
      generated.push(key);
    }
    values.set(key, value);
  }

  // Conveniências derivadas, só quando o valor ainda é o de exemplo.
  if (generated.includes('POSTGRES_PASSWORD') && values.get('DATABASE_URL') === exampleValues.get('DATABASE_URL')) {
    values.set('DATABASE_URL', `postgres://secretaria:${values.get('POSTGRES_PASSWORD')}@localhost:5432/secretaria`);
  }
  const doctorEmail = values.get('DOCTOR_EMAIL');
  if (values.get('ADMIN_EMAIL') === exampleValues.get('ADMIN_EMAIL') && doctorEmail && doctorEmail !== exampleValues.get('DOCTOR_EMAIL')) {
    values.set('ADMIN_EMAIL', doctorEmail);
  }

  const out = exampleLines.map((line) => {
    const m = line.match(LINE);
    if (!m) return line;
    return `${m[1]}=${values.get(m[1]!)}${m[3] ? `   ${m[3]}` : ''}`;
  });
  const extras = [...existing].filter(([k]) => !exampleValues.has(k));
  if (extras.length) out.push('', '# Variáveis extras (mantidas do .env anterior)', ...extras.map(([k, v]) => `${k}=${v}`));

  writeFileSync(outPath, out.join('\n'), { mode: 0o600 });
  chmodSync(outPath, 0o600); // `mode` acima só vale quando o arquivo é criado

  console.log(`\n✔ ${outPath} escrito (permissão 600).`);
  console.log(generated.length ? `  Segredos gerados: ${generated.join(', ')}` : '  Nenhum segredo novo (já estavam preenchidos).');
  if (generated.includes('ADMIN_PASSWORD')) {
    console.log(`\n  Login do painel: ${values.get('ADMIN_EMAIL')}  /  ${values.get('ADMIN_PASSWORD')}`);
    console.log('  (anote agora; depois do `npm run seed` a senha fica só como hash no banco)');
  }
  if (generated.includes('ENCRYPTION_KEY')) {
    console.log('\n  ⚠ Faça backup do ENCRYPTION_KEY: sem ele os dados de saúde criptografados não podem ser lidos.');
  }
  const pending = MANUAL.filter((k) => {
    const v = values.get(k) ?? '';
    return v === '' || EXAMPLE_PLACEHOLDERS.has(v);
  });
  if (pending.length) {
    console.log(`\n  Ainda precisam de você (contas externas): ${pending.join(', ')}`);
  }
  console.log();
}

main();
