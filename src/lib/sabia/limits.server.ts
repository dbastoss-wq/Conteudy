export class LimitError extends Error {}

type Bucket = { day: string; count: number; stamps: number[] };

const buckets = new Map<string, Bucket>();

function today() {
  return new Date().toISOString().slice(0, 10);
}

function num(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function assertWithinLimit(key: string) {
  const daily = num("SABIA_DAILY_LIMIT", 200);
  const perMinute = num("SABIA_RATE_LIMIT_PER_MINUTE", 12);
  const now = Date.now();
  const current = buckets.get(key) ?? { day: today(), count: 0, stamps: [] };
  if (current.day !== today()) {
    current.day = today();
    current.count = 0;
  }
  current.stamps = current.stamps.filter((stamp) => now - stamp < 60_000);
  if (current.count >= daily) {
    throw new LimitError("Limite diário da Sabiá atingido para este chat.");
  }
  if (current.stamps.length >= perMinute) {
    throw new LimitError("Muitas mensagens seguidas. Espera um minuto.");
  }
  current.count += 1;
  current.stamps.push(now);
  buckets.set(key, current);
}
