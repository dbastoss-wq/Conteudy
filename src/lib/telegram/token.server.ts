// Limpa erros comuns ao colar o token: espaços, aspas, prefixo "bot" ou a URL inteira.
export function botToken(): string | undefined {
  const raw = process.env.TELEGRAM_BOT_TOKEN;
  if (!raw) return undefined;
  const match = raw.match(/\d+:[\w-]{30,}/);
  return match ? match[0] : raw.trim();
}

export function tokenShape() {
  const raw = process.env.TELEGRAM_BOT_TOKEN ?? "";
  const clean = botToken() ?? "";
  return {
    present: Boolean(raw),
    looksValid: /^\d+:[\w-]{30,}$/.test(clean),
    cleaned: raw !== clean,
  };
}
