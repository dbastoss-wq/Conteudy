import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifica a assinatura X-Hub-Signature-256 do webhook da Meta.
 * Formato do header: "sha256=<hex>". Comparação em tempo constante.
 * Requer o corpo CRU (raw body), não o JSON já parseado.
 */
export function verifySignature(rawBody: Buffer | string, header: string | undefined, appSecret: string): boolean {
  if (!appSecret) return true; // sem segredo configurado (ex.: dev) => não valida
  if (!header) return false;
  const expected = 'sha256=' + createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
