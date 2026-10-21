'use strict';
// Webhooks e recursos da Calendly API v2.
const crypto = require('crypto');

const CALENDLY_API = 'https://api.calendly.com';

// Header "Calendly-Webhook-Signature: t=<unix>,v1=<hex>"; assinatura = HMAC-SHA256(key, `${t}.${rawBody}`).
function verifySignature(header, rawBody, signingKey, toleranceSec = 180, nowSec = Math.floor(Date.now() / 1000)) {
  if (!signingKey) return { valid: false, reason: 'chave_nao_configurada' };
  if (!header) return { valid: false, reason: 'sem_assinatura' };
  const parts = Object.fromEntries(String(header).split(',').map(p => p.trim().split('=')).filter(p => p.length === 2));
  const t = Number(parts.t);
  if (!t || !parts.v1) return { valid: false, reason: 'assinatura_malformada' };
  if (Math.abs(nowSec - t) > toleranceSec) return { valid: false, reason: 'assinatura_expirada' };
  const expected = crypto.createHmac('sha256', signingKey).update(`${t}.${rawBody}`).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(String(parts.v1), 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { valid: false, reason: 'assinatura_invalida' };
  return { valid: true, reason: null };
}

function sign(rawBody, signingKey, t = Math.floor(Date.now() / 1000)) {
  return `t=${t},v1=${crypto.createHmac('sha256', signingKey).update(`${t}.${rawBody}`).digest('hex')}`;
}

// Chave de idempotência do evento: o mesmo invitee pode gerar created e canceled, por isso inclui o tipo.
function dedupeKey(body) {
  const p = body.payload || {};
  return `calendly:${body.event}:${p.uri || ''}:${body.created_at || ''}`;
}

function apiUrl(uri, base) {
  if (!uri) return null;
  return base && base !== CALENDLY_API ? String(uri).replace(CALENDLY_API, base) : String(uri);
}

function uuidFromUri(uri) {
  return String(uri || '').split('/').pop();
}

// Recursos vindos da API (fonte da verdade) -> registro de agendamento.
function bookingFromApi(event, invitee, source) {
  let status = 'ativo';
  if (invitee.status === 'canceled' || event.status === 'canceled') status = invitee.rescheduled ? 'reagendado' : 'cancelado';
  const cal = event.calendar_event || {};
  const tracking = invitee.tracking || {};
  return {
    calendly_event_uri: event.uri,
    calendly_invitee_uri: invitee.uri,
    event_type_uri: event.event_type || null,
    event_name: event.name || null,
    contact_email: String(invitee.email || '').toLowerCase(),
    contact_name: invitee.name || null,
    start_time: event.start_time,
    end_time: event.end_time,
    timezone: invitee.timezone || null,
    status,
    cancel_url: invitee.cancel_url || null,
    reschedule_url: invitee.reschedule_url || null,
    old_invitee_uri: invitee.old_invitee || null,
    new_invitee_uri: invitee.new_invitee || null,
    google_event_id: cal.kind === 'google' ? cal.external_id || null : null,
    calendar_kind: cal.kind || null,
    location: event.location || null,
    canceled_reason: (invitee.cancellation && invitee.cancellation.reason) || null,
    utm_content: tracking.utm_content || null,
    source,
    updated_at_remote: invitee.updated_at || event.updated_at || null,
  };
}

module.exports = { verifySignature, sign, dedupeKey, apiUrl, uuidFromUri, bookingFromApi, CALENDLY_API };
