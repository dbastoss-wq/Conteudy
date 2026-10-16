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

  async insertEvent(calendarId: string, event: CalendarEventInput): Promise<CreatedEvent> {
    const res = await this.calendar.events.insert({
      calendarId,
      requestBody: {
        summary: event.summary,
        description: event.description,
        start: { dateTime: event.startISO, timeZone: event.timezone },
        end: { dateTime: event.endISO, timeZone: event.timezone },
      },
    });
    return { id: res.data.id as string, htmlLink: res.data.htmlLink ?? undefined };
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
