import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Criptografia simétrica para dados sensíveis em repouso (LGPD).
 * AES-256-GCM. Formato armazenado: base64(iv) . base64(tag) . base64(ciphertext)
 *
 * A chave vem de ENCRYPTION_KEY (32 bytes em base64). Dados de saúde (motivo da
 * consulta) e corpos de mensagem são guardados criptografados.
 */
const PREFIX = 'enc:v1:';

function getKey(keyB64: string): Buffer {
  if (!keyB64) {
    throw new Error('ENCRYPTION_KEY ausente. Gere 32 bytes base64 e defina no ambiente.');
  }
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY deve ter exatamente 32 bytes (base64).');
  }
  return key;
}

export function encrypt(plaintext: string, keyB64: string): string {
  if (plaintext === '' || plaintext == null) return plaintext ?? '';
  const key = getKey(keyB64);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + [iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join('.');
}

export function decrypt(stored: string, keyB64: string): string {
  if (!stored) return stored;
  if (!stored.startsWith(PREFIX)) return stored; // compatibilidade com dados em claro
  const key = getKey(keyB64);
  const [ivB64, tagB64, ctB64] = stored.slice(PREFIX.length).split('.');
  const iv = Buffer.from(ivB64!, 'base64');
  const tag = Buffer.from(tagB64!, 'base64');
  const ct = Buffer.from(ctB64!, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** Hash simples para pseudonimizar identificadores em logs. */
export function isEncrypted(stored: string | null | undefined): boolean {
  return !!stored && stored.startsWith(PREFIX);
}
