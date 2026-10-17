import nodemailer from 'nodemailer';
import { loadConfig, type Config } from '../config.js';
import { sendText, sendTemplate } from '../whatsapp/client.js';

export type AlertKind =
  | 'urgencia'
  | 'falha_agendamento'
  | 'escolha_cartao'
  | 'comprovante_recebido'
  | 'fora_do_roteiro';

const TITLES: Record<AlertKind, string> = {
  urgencia: '🚨 URGÊNCIA de paciente',
  falha_agendamento: '⚠️ Falha ao agendar consulta',
  escolha_cartao: '💳 Paciente escolheu pagamento no cartão',
  comprovante_recebido: '✅ Comprovante de Pix recebido',
  fora_do_roteiro: '💬 Mensagem fora do roteiro',
};

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  const cfg = loadConfig();
  if (!cfg.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: cfg.SMTP_HOST,
      port: cfg.SMTP_PORT,
      secure: cfg.SMTP_PORT === 465,
      auth: cfg.SMTP_USER ? { user: cfg.SMTP_USER, pass: cfg.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

/** Variáveis de template da Meta não aceitam quebras de linha. */
function flattenForTemplate(text: string): string {
  return text.replace(/\s*\n+\s*/g, ' | ').slice(0, 900);
}

/**
 * Tenta o WhatsApp: texto livre primeiro (só entrega dentro da janela de 24h) e,
 * se recusado e houver template configurado, o template aprovado.
 * Retorna true se algum dos dois foi aceito pela API.
 */
async function sendWhatsAppAlert(cfg: Config, text: string): Promise<boolean> {
  const to = cfg.DOCTOR_WHATSAPP_NUMBER;
  if (!to) return false;
  try {
    await sendText(to, text);
    return true;
  } catch (err) {
    console.error('[notify] WhatsApp (texto) ao médico falhou:', err);
  }
  if (!cfg.DOCTOR_ALERT_TEMPLATE) return false;
  try {
    await sendTemplate(to, cfg.DOCTOR_ALERT_TEMPLATE, cfg.DOCTOR_ALERT_TEMPLATE_LANG, [flattenForTemplate(text)]);
    return true;
  } catch (err) {
    console.error('[notify] WhatsApp (template) ao médico falhou:', err);
    return false;
  }
}

async function sendEmailAlert(cfg: Config, title: string, details: string): Promise<void> {
  if (!cfg.DOCTOR_EMAIL) return;
  const t = getTransporter();
  if (!t) {
    if (cfg.SIMULATE_WHATSAPP) {
      console.log(`\n[ALERTA SIMULADO → ${cfg.DOCTOR_EMAIL}] ${title}\n${details}\n`);
    } else {
      console.error('[notify] SMTP não configurado; alerta por e-mail não enviado.');
    }
    return;
  }
  try {
    await t.sendMail({ from: cfg.SMTP_FROM, to: cfg.DOCTOR_EMAIL, subject: title, text: details });
  } catch (err) {
    console.error('[notify] e-mail ao médico falhou:', err);
  }
}

/**
 * Envia alerta ao médico pelos canais configurados (WhatsApp pessoal e/ou
 * e-mail). Se o WhatsApp for pedido e falhar (ex.: fora da janela de 24h, sem
 * template), o e-mail entra como fallback mesmo com DOCTOR_NOTIFY_CHANNEL=whatsapp,
 * para que um alerta de urgência nunca se perca em silêncio. Nunca lança.
 */
export async function notifyDoctor(kind: AlertKind, details: string): Promise<void> {
  const cfg = loadConfig();
  const title = TITLES[kind];
  const channel = cfg.DOCTOR_NOTIFY_CHANNEL;
  const wantsWhatsApp = channel === 'whatsapp' || channel === 'both';
  const wantsEmail = channel === 'email' || channel === 'both';

  const whatsappOk = wantsWhatsApp ? await sendWhatsAppAlert(cfg, `${title}\n\n${details}`) : true;

  if (wantsEmail || !whatsappOk) {
    await sendEmailAlert(cfg, title, details);
  }
}
