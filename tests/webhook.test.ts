import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifySignature } from '../src/whatsapp/signature';
import { extractMessages } from '../src/server';

describe('assinatura do webhook', () => {
  const secret = 'segredo-de-teste';
  const body = JSON.stringify({ hello: 'world' });

  it('aceita assinatura válida', () => {
    const sig = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
    expect(verifySignature(body, sig, secret)).toBe(true);
  });

  it('rejeita assinatura inválida', () => {
    expect(verifySignature(body, 'sha256=deadbeef', secret)).toBe(false);
  });

  it('rejeita quando falta o header', () => {
    expect(verifySignature(body, undefined, secret)).toBe(false);
  });
});

describe('extração de mensagens do payload do WhatsApp', () => {
  it('extrai texto, id e telefone', () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { from: '5511988887777', id: 'wamid.ABC', type: 'text', text: { body: 'oi' } },
                  { from: '5511988887777', id: 'wamid.DEF', type: 'image', image: { caption: 'comprovante' } },
                ],
              },
            },
          ],
        },
      ],
    };
    const msgs = extractMessages(payload);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]).toMatchObject({ phone: '5511988887777', text: 'oi', waMessageId: 'wamid.ABC', msgType: 'text' });
    expect(msgs[1]).toMatchObject({ msgType: 'image', text: 'comprovante' });
  });

  it('não quebra com payload vazio', () => {
    expect(extractMessages({})).toEqual([]);
  });
});
