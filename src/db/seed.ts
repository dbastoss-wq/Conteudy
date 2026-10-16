import { loadConfig } from '../config.js';
import { createAdmin, getSettings } from './repositories.js';
import { hashPassword } from '../admin/auth.js';
import { closePool } from './pool.js';
import { runMigrations } from './migrate.js';

/** Cria/atualiza o admin inicial e garante a linha de configurações padrão. */
async function seed(): Promise<void> {
  const cfg = loadConfig();
  await runMigrations();

  if (!cfg.ADMIN_EMAIL || !cfg.ADMIN_PASSWORD) {
    throw new Error('Defina ADMIN_EMAIL e ADMIN_PASSWORD no ambiente para criar o admin inicial.');
  }
  await createAdmin(cfg.ADMIN_EMAIL, hashPassword(cfg.ADMIN_PASSWORD));
  await getSettings(); // cria a linha padrão se não existir
  console.log(`Admin criado/atualizado: ${cfg.ADMIN_EMAIL}`);
  console.log('Configurações padrão garantidas.');
}

seed()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Falha no seed:', err);
    process.exit(1);
  });
