import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../config.js';
import {
  getAdminByEmail,
  listConversations,
  getConversationById,
  listMessages,
  updateConversation,
  listAppointments,
  getSettings,
  saveSettings,
  type AppSettings,
} from '../db/repositories.js';
import type { SchedulingSettings, WorkingWindow } from '../domain/types.js';
import {
  requireAdmin,
  getSessionUser,
  issueSession,
  clearSession,
  verifyPassword,
} from './auth.js';
import {
  loginPage,
  conversationsPage,
  conversationDetailPage,
  appointmentsPage,
  settingsPage,
} from './views.js';

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  const cfg = loadConfig();
  const tz = cfg.TZ;

  app.get('/admin/login', async (_req, reply) => {
    reply.type('text/html').send(loginPage());
  });

  app.post('/admin/login', async (req, reply) => {
    const { email, password } = (req.body ?? {}) as { email?: string; password?: string };
    const admin = email ? await getAdminByEmail(email) : null;
    if (!admin || !password || !verifyPassword(password, admin.passwordHash)) {
      reply.type('text/html').code(401).send(loginPage('E-mail ou senha inválidos.'));
      return;
    }
    issueSession(reply, admin.id, admin.email);
    reply.redirect('/admin');
  });

  app.post('/admin/logout', async (_req, reply) => {
    clearSession(reply);
    reply.redirect('/admin/login');
  });

  app.get('/admin', { preHandler: requireAdmin }, async (req, reply) => {
    const user = getSessionUser(req)!;
    const convs = await listConversations();
    reply.type('text/html').send(conversationsPage(convs, tz, user.email));
  });

  app.get('/admin/conversas/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const user = getSessionUser(req)!;
    const { id } = req.params as { id: string };
    const conv = await getConversationById(id);
    if (!conv) {
      reply.code(404).send('Conversa não encontrada');
      return;
    }
    const messages = await listMessages(id);
    reply.type('text/html').send(conversationDetailPage(conv, messages, tz, user.email));
  });

  app.post('/admin/conversas/:id/pausar', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await updateConversation(id, { botPaused: true });
    reply.redirect(`/admin/conversas/${id}`);
  });

  app.post('/admin/conversas/:id/retomar', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await updateConversation(id, { botPaused: false });
    reply.redirect(`/admin/conversas/${id}`);
  });

  app.get('/admin/agendamentos', { preHandler: requireAdmin }, async (req, reply) => {
    const user = getSessionUser(req)!;
    const appts = await listAppointments();
    reply.type('text/html').send(appointmentsPage(appts, tz, user.email));
  });

  app.get('/admin/config', { preHandler: requireAdmin }, async (req, reply) => {
    const user = getSessionUser(req)!;
    const s = await getSettings();
    const saved = (req.query as { saved?: string }).saved === '1';
    reply.type('text/html').send(settingsPage(s, user.email, saved));
  });

  app.post('/admin/config', { preHandler: requireAdmin }, async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, string | string[]>;
    const current = await getSettings();
    const next = buildSettingsFromForm(current, body);
    await saveSettings(next);
    reply.redirect('/admin/config?saved=1');
  });
}

function buildSettingsFromForm(current: AppSettings, body: Record<string, string | string[]>): AppSettings {
  const asArray = (v: string | string[] | undefined): string[] =>
    v === undefined ? [] : Array.isArray(v) ? v : [v];
  const num = (v: unknown, fallback: number): number => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const str = (v: unknown): string => (Array.isArray(v) ? v[0] ?? '' : String(v ?? '')).trim();

  const workingDays = asArray(body.workingDays).map(Number).filter((n) => n >= 1 && n <= 7);
  const winStart = str(body.winStart) || '08:00';
  const winEnd = str(body.winEnd) || '18:00';
  const lunchStart = str(body.lunchStart);
  const lunchEnd = str(body.lunchEnd);

  let dayWindows: WorkingWindow[];
  if (lunchStart && lunchEnd) {
    dayWindows = [
      { start: winStart, end: lunchStart },
      { start: lunchEnd, end: winEnd },
    ];
  } else {
    dayWindows = [{ start: winStart, end: winEnd }];
  }

  const windows: Record<number, WorkingWindow[]> = {};
  for (const d of workingDays.length ? workingDays : current.scheduling.workingDays) {
    windows[d] = dayWindows;
  }

  const scheduling: SchedulingSettings = {
    ...current.scheduling,
    workingDays: workingDays.length ? workingDays : current.scheduling.workingDays,
    windows,
    slotDurationMinutes: num(body.duration, current.scheduling.slotDurationMinutes),
    bufferMinutes: num(body.buffer, current.scheduling.bufferMinutes),
    minLeadMinutes: num(body.minLead, current.scheduling.minLeadMinutes),
  };

  return {
    ...current,
    scheduling,
    googleCalendarId: str(body.googleCalendarId) || current.googleCalendarId,
    messages: {
      intro: str(body.introMsg) || current.messages.intro,
      payment: str(body.paymentMsg) || current.messages.payment,
    },
  };
}
