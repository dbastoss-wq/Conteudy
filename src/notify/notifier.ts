import nodemailer from 'nodemailer';
import { loadConfig } from '../config.js';
import { sendText } from '../whatsapp/client.js';

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

/**
 * Envia alerta ao médico pelos canais configurados (WhatsApp pessoal e/ou
 * e-mail). Falha em um canal não derruba o outro; erros são apenas logados.
 */
export async function notifyDoctor(kind: AlertKind, details: string): Promise<void> {
  const cfg = loadConfig();
  const title = TITLES[kind];
  const text = `${title}\n\n${details}`;

  const tasks: Promise<unknown>[] = [];

  if ((cfg.DOCTOR_NOTIFY_CHANNEL === 'whatsapp' || cfg.DOCTOR_NOTIFY_CHANNEL === 'both') && cfg.DOCTOR_WHATSAPP_NUMBER) {
    tasks.push(
      sendText(cfg.DOCTOR_WHATSAPP_NUMBER, text).catch((err) =>
        console.error('[notify] WhatsApp ao médico falhou:', err),
      ),
    );
  }

  if ((cfg.DOCTOR_NOTIFY_CHANNEL === 'email' || cfg.DOCTOR_NOTIFY_CHANNEL === 'both') && cfg.DOCTOR_EMAIL) {
    const t = getTransporter();
    if (t) {
      tasks.push(
        t
          .sendMail({ from: cfg.SMTP_FROM, to: cfg.DOCTOR_EMAIL, subject: title, text: details })
          .catch((err) => console.error('[notify] e-mail ao médico falhou:', err)),
      );
    } else if (cfg.SIMULATE_WHATSAPP) {
      console.log(`\n[ALERTA SIMULADO → ${cfg.DOCTOR_EMAIL}] ${title}\n${details}\n`);
    }
  }

  await Promise.all(tasks);
}
