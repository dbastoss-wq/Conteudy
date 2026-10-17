import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { loadConfig } from '../config.js';
import type { CalendarPort, CalendarEventInput, CreatedEvent } from '../scheduling/booking.js';
import type { TimeInterval } from '../domain/types.js';

function oauthClient(): OAuth2Client {
  const cfg = loadConfig();
  const client = new google.auth.OAuth2(
    cfg.GOOGLE_CLIENT_ID,
    cfg.GOOGLE_CLIENT_SECRET,
    cfg.GOOGLE_OAUTH_REDIRECT_URI,
  );
  client.setCredentials({ refresh_token: cfg.GOOGLE_REFRESH_TOKEN });
  return client;
}

/** Status HTTP de um erro do cliente do Google (GaxiosError). */
function statusOf(err: unknown): number | undefined {
  const e = err as { code?: number | string; response?: { status?: number } };
  return e.response?.status ?? (typeof e.code === 'number' ? e.code : Number(e.code) || undefined);
}

/** Cliente de produção do Google Calendar. */
export class GoogleCalendar implements CalendarPort {
  private calendar = google.calendar({ version: 'v3', auth: oauthClient() });

  async freebusy(calendarId: string, timeMinISO: string, timeMaxISO: string): Promise<TimeInterval[]> {
    const res = await this.calendar.freebusy.query({
      requestBody: {
        timeMin: timeMinISO,
        timeMax: timeMaxISO,
        items: [{ id: calendarId }],
      },
    });
    const busy = res.data.calendars?.[calendarId]?.busy ?? [];
    return busy
      .filter((b) => b.start && b.end)
      .map((b) => ({ start: b.start as string, end: b.end as string }));
  }

  /**
   * Insere com id estável (idempotente). Se o id já existe (409), devolve o evento
   * existente; se ele estava cancelado, restaura-o, porque o Google não permite
   * reutilizar o id de um evento apagado.
   */
  async insertEvent(calendarId: string, event: CalendarEventInput): Promise<CreatedEvent> {
    const body = {
      id: event.id,
      summary: event.summary,
      description: event.description,
      start: { dateTime: event.startISO, timeZone: event.timezone },
      end: { dateTime: event.endISO, timeZone: event.timezone },
    };
    try {
      const res = await this.calendar.events.insert({ calendarId, requestBody: body });
      return { id: res.data.id as string, htmlLink: res.data.htmlLink ?? undefined };
    } catch (err) {
      if (statusOf(err) !== 409) throw err;
      const existing = await this.calendar.events.get({ calendarId, eventId: event.id });
      if (existing.data.status === 'cancelled') {
        const restored = await this.calendar.events.update({
          calendarId,
          eventId: event.id,
          requestBody: { ...body, status: 'confirmed' },
        });
        return { id: restored.data.id as string, htmlLink: restored.data.htmlLink ?? undefined };
      }
      return { id: existing.data.id as string, htmlLink: existing.data.htmlLink ?? undefined };
    }
  }

  async getEvent(calendarId: string, eventId: string): Promise<CreatedEvent | null> {
    try {
      const res = await this.calendar.events.get({ calendarId, eventId });
      if (res.data.status === 'cancelled') return null;
      return { id: res.data.id as string, htmlLink: res.data.htmlLink ?? undefined };
    } catch (err) {
      if (statusOf(err) === 404) return null;
      throw err;
    }
  }

  /** Atualiza a descrição do evento (ex.: anexar a forma de pagamento). */
  async appendToDescription(calendarId: string, eventId: string, extra: string): Promise<void> {
    const current = await this.calendar.events.get({ calendarId, eventId });
    const desc = (current.data.description ?? '') + `\n${extra}`;
    await this.calendar.events.patch({ calendarId, eventId, requestBody: { description: desc } });
  }
}

/**
 * Busca intervalos ocupados num horizonte (para gerar a lista de horários
 * livres). Devolve em ISO UTC.
 */
export async function fetchBusyHorizon(
  calendar: CalendarPort,
  calendarId: string,
  fromISO: string,
  days: number,
): Promise<TimeInterval[]> {
  const toISO = new Date(new Date(fromISO).getTime() + days * 24 * 60 * 60 * 1000).toISOString();
  return calendar.freebusy(calendarId, fromISO, toISO);
}
