import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import { loadConfig } from './config.js';
import { verifySignature } from './whatsapp/signature.js';
import { handleInboundMessage, type InboundMessage } from './conversation/handler.js';
import { enqueue } from './worker.js';
import { registerAdminRoutes } from './admin/routes.js';
import { scheduleRetention } from './jobs/retention.js';

export async function buildServer() {
  const cfg = loadConfig();
  const app = Fastify({ logger: true, bodyLimit: 1_048_576 });

  await app.register(cookie);
  await app.register(formbody);

  // Captura o corpo CRU do JSON para validar a assinatura do webhook.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    (req as any).rawBody = body;
    try {
      done(null, body.length ? JSON.parse(body.toString('utf8')) : {});
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.get('/health', async () => ({ ok: true }));

  // Verificação do webhook (handshake GET da Meta).
  app.get('/webhook', async (req, reply) => {
    const q = req.query as Record<string, string>;
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] === cfg.WHATSAPP_VERIFY_TOKEN) {
      reply.code(200).send(q['hub.challenge']);
      return;
    }
    reply.code(403).send('Forbidden');
  });

  // Recebimento de mensagens.
  app.post('/webhook', async (req, reply) => {
    const raw = (req as any).rawBody as Buffer | undefined;
    const sig = req.headers['x-hub-signature-256'] as string | undefined;
    if (!verifySignature(raw ?? Buffer.from(''), sig, cfg.WHATSAPP_APP_SECRET)) {
      reply.code(401).send('Assinatura inválida');
      return;
    }

    // Responde rápido; processa em background, serializado por telefone.
    reply.code(200).send('EVENT_RECEIVED');

    try {
      const messages = extractMessages(req.body);
      for (const m of messages) {
        enqueue(m.phone, () => handleInboundMessage(m));
      }
    } catch (err) {
      app.log.error({ err }, 'falha ao extrair mensagens do webhook');
    }
  });

  await registerAdminRoutes(app);

  return app;
}

/** Extrai mensagens de texto/mídia do payload do WhatsApp Cloud API. */
export function extractMessages(payload: any): InboundMessage[] {
  const out: InboundMessage[] = [];
  const entries = payload?.entry ?? [];
  for (const entry of entries) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      for (const msg of value?.messages ?? []) {
        const phone: string = msg.from;
        const type: string = msg.type;
        let text = '';
        if (type === 'text') text = msg.text?.body ?? '';
        else if (type === 'image') text = msg.image?.caption ?? '';
        else if (type === 'document') text = msg.document?.caption ?? '';
        else if (type === 'button') text = msg.button?.text ?? '';
        else if (type === 'interactive')
          text = msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? '';
        out.push({ phone, text, waMessageId: msg.id, msgType: type });
      }
    }
  }
  return out;
}

// Inicialização direta: node dist/server.js
if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = loadConfig();
  buildServer()
    .then((app) => {
      scheduleRetention();
      return app.listen({ port: cfg.PORT, host: '0.0.0.0' });
    })
    .then((addr) => console.log(`Secretária virtual ouvindo em ${addr}`))
    .catch((err) => {
      console.error('Falha ao iniciar:', err);
      process.exit(1);
    });
}
