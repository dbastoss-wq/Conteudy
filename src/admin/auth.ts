import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { loadConfig } from '../config.js';

const COOKIE = 'sv_session';

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const computed = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (computed.length !== expected.length) return false;
  return timingSafeEqual(computed, expected);
}

export function issueSession(reply: FastifyReply, adminId: string, email: string): void {
  const cfg = loadConfig();
  const token = jwt.sign({ sub: adminId, email }, cfg.JWT_SECRET, { expiresIn: '12h' });
  reply.setCookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: cfg.NODE_ENV === 'production',
    path: '/',
    maxAge: 12 * 60 * 60,
  });
}

export function clearSession(reply: FastifyReply): void {
  reply.clearCookie(COOKIE, { path: '/' });
}

export interface SessionUser {
  id: string;
  email: string;
}

export function getSessionUser(req: FastifyRequest): SessionUser | null {
  const cfg = loadConfig();
  const token = req.cookies?.[COOKIE];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, cfg.JWT_SECRET) as { sub: string; email: string };
    return { id: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}

/** preHandler: exige login; redireciona para /admin/login se não autenticado. */
export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const user = getSessionUser(req);
  if (!user) {
    reply.redirect('/admin/login');
    return reply;
  }
  (req as any).admin = user;
}
