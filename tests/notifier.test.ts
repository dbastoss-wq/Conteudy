import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetConfigCache } from '../src/config';

const { sendText, sendTemplate, sendMail } = vi.hoisted(() => ({
  sendText: vi.fn(),
  sendTemplate: vi.fn(),
  sendMail: vi.fn(),
}));

vi.mock('../src/whatsapp/client', () => ({ sendText, sendTemplate }));
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }));

import { notifyDoctor } from '../src/notify/notifier';

function setEnv(overrides: Record<string, string> = {}) {
  Object.assign(process.env, {
    DOCTOR_NOTIFY_CHANNEL: 'whatsapp',
    DOCTOR_WHATSAPP_NUMBER: '5511999990000',
    DOCTOR_EMAIL: 'medico@exemplo.com',
    DOCTOR_ALERT_TEMPLATE: '',
    SMTP_HOST: 'smtp.exemplo.com',
    SIMULATE_WHATSAPP: 'false',
    ...overrides,
  });
  resetConfigCache();
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {}); // falhas aqui são simuladas de propósito
  sendText.mockReset().mockResolvedValue(undefined);
  sendTemplate.mockReset().mockResolvedValue(undefined);
  sendMail.mockReset().mockResolvedValue(undefined);
});

describe('alertas ao médico', () => {
  it('canal whatsapp: entrega pelo WhatsApp e não envia e-mail', async () => {
    setEnv();
    await notifyDoctor('urgencia', 'paciente com dor no peito');
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('WhatsApp recusado (fora da janela de 24h) cai para e-mail mesmo com canal whatsapp', async () => {
    setEnv();
    sendText.mockRejectedValue(new Error('131047 re-engagement message'));
    await notifyDoctor('urgencia', 'paciente com dor no peito');
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0]![0]).toMatchObject({ to: 'medico@exemplo.com' });
  });

  it('WhatsApp recusado com template configurado: usa o template e não envia e-mail', async () => {
    setEnv({ DOCTOR_ALERT_TEMPLATE: 'alerta_medico' });
    sendText.mockRejectedValue(new Error('131047'));
    await notifyDoctor('falha_agendamento', 'linha 1\nlinha 2');
    expect(sendTemplate).toHaveBeenCalledTimes(1);
    const [to, name, lang, params] = sendTemplate.mock.calls[0]!;
    expect(to).toBe('5511999990000');
    expect(name).toBe('alerta_medico');
    expect(lang).toBe('pt_BR');
    expect(params[0]).not.toContain('\n');
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('template também recusado: cai para e-mail', async () => {
    setEnv({ DOCTOR_ALERT_TEMPLATE: 'alerta_medico' });
    sendText.mockRejectedValue(new Error('131047'));
    sendTemplate.mockRejectedValue(new Error('template pausado'));
    await notifyDoctor('urgencia', 'x');
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('canal both: envia pelos dois', async () => {
    setEnv({ DOCTOR_NOTIFY_CHANNEL: 'both' });
    await notifyDoctor('escolha_cartao', 'x');
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('tudo falhando não lança exceção', async () => {
    setEnv();
    sendText.mockRejectedValue(new Error('falhou'));
    sendMail.mockRejectedValue(new Error('smtp fora'));
    await expect(notifyDoctor('urgencia', 'x')).resolves.toBeUndefined();
  });
});
