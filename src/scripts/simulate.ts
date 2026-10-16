import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config.js';
import { handleInboundMessage } from '../conversation/handler.js';
import { capturedOutbound, clearCapturedOutbound } from '../whatsapp/client.js';
import { closePool } from '../db/pool.js';
import { runMigrations } from '../db/migrate.js';

/**
 * Modo de teste interativo: injeta mensagens no mesmo fluxo do webhook, SEM
 * usar o WhatsApp real. Exige SIMULATE_WHATSAPP=true (e recomenda-se
 * SIMULATE_CALENDAR=true para não criar eventos de verdade).
 *
 * Uso:
 *   SIMULATE_WHATSAPP=true SIMULATE_CALENDAR=true npm run sim
 *   > oi
 *   > quero marcar uma consulta quinta às 14h, é dor de garganta
 *   > meu nome é Maria Silva
 *   > pode confirmar
 *   > pix
 *
 * Comandos: /phone <numero> troca o paciente; /sair encerra.
 */
async function main(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.SIMULATE_WHATSAPP) {
    console.error('Defina SIMULATE_WHATSAPP=true para usar o simulador (evita enviar ao WhatsApp real).');
    process.exit(1);
  }
  await runMigrations();

  let phone = process.env.SIM_PHONE || '5511900000000';
  console.log(`\nModo de teste. Paciente simulado: ${phone}`);
  console.log('Digite mensagens como o paciente. /phone <n> troca o número, /sair encerra.\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
  rl.prompt();

  rl.on('line', async (line) => {
    const text = line.trim();
    if (text === '/sair') {
      rl.close();
      return;
    }
    if (text.startsWith('/phone ')) {
      phone = text.slice(7).trim();
      console.log(`(agora como ${phone})`);
      rl.prompt();
      return;
    }
    if (!text) {
      rl.prompt();
      return;
    }

    clearCapturedOutbound();
    try {
      await handleInboundMessage({ phone, text, waMessageId: randomUUID(), msgType: 'text' });
    } catch (err) {
      console.error('[sim] erro:', err);
    }
    for (const o of capturedOutbound) {
      console.log(`\n🤖 ${o.body}\n`);
    }
    rl.prompt();
  });

  rl.on('close', async () => {
    await closePool();
    console.log('Até logo!');
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
