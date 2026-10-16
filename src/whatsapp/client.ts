import { loadConfig } from '../config.js';

export interface OutboundRecord {
  to: string;
  body: string;
  at: string;
}

/**
 * Buffer de envios capturados quando SIMULATE_WHATSAPP=true. O simulador e os
 * testes leem daqui em vez de chamar o WhatsApp real.
 */
export const capturedOutbound: OutboundRecord[] = [];

export function clearCapturedOutbound(): void {
  capturedOutbound.length = 0;
}

/**
 * Envia uma mensagem de texto pelo WhatsApp Business Cloud API (oficial).
 * Em modo de simulação, não chama a rede: registra no buffer e no console.
 */
export async function sendText(to: string, body: string): Promise<void> {
  const cfg = loadConfig();

  if (cfg.SIMULATE_WHATSAPP) {
    capturedOutbound.push({ to, body, at: new Date().toISOString() });
    console.log(`\n[SIMULADO → ${to}]\n${body}\n`);
    return;
  }

  const url = `https://graph.facebook.com/${cfg.WHATSAPP_API_VERSION}/${cfg.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body },
    }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Falha ao enviar WhatsApp (${res.status}): ${txt}`);
  }
}
