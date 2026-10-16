import { query } from '../db/pool.js';
import { loadConfig } from '../config.js';
import { audit } from '../db/repositories.js';

/**
 * Purga dados além do prazo de retenção configurável (LGPD).
 * Remove conversas e consultas antigas; as mensagens caem por CASCADE.
 */
export async function runRetention(): Promise<void> {
  const cfg = loadConfig();
  const days = cfg.DATA_RETENTION_DAYS;
  const cutoff = `now() - interval '${days} days'`;

  const conv = await query(
    `DELETE FROM conversations
     WHERE COALESCE(last_message_at, created_at) < ${cutoff}
       AND id NOT IN (SELECT conversation_id FROM appointments WHERE start_at >= ${cutoff} AND conversation_id IS NOT NULL)`,
  );
  const appt = await query(`DELETE FROM appointments WHERE start_at < ${cutoff}`);
  const locks = await query(`DELETE FROM slot_locks WHERE created_at < ${cutoff}`);

  await audit('retention', 'system', 'retention', {
    conversationsRemovidas: conv.rowCount,
    consultasRemovidas: appt.rowCount,
    locksRemovidos: locks.rowCount,
    retentionDays: days,
  });
  console.log(`[retention] conversas=${conv.rowCount} consultas=${appt.rowCount} locks=${locks.rowCount}`);
}

/** Agenda a purga diária. Retorna o timer para permitir cancelamento. */
export function scheduleRetention(): NodeJS.Timeout {
  const DAY = 24 * 60 * 60 * 1000;
  void runRetention().catch((e) => console.error('[retention] falha:', e));
  return setInterval(() => {
    void runRetention().catch((e) => console.error('[retention] falha:', e));
  }, DAY);
}
