#!/usr/bin/env node
'use strict';
// Gera o SQL que grava a configuração (sem segredos) e a base de conhecimento em agente.settings.
// Uso: node scripts/seed-settings.js config/agent.config.json config/knowledge-base.md | psql "$DATABASE_URL"
const fs = require('fs');

const [configPath, kbPath] = process.argv.slice(2);
if (!configPath || !kbPath) {
  console.error('uso: seed-settings.js <agent.config.json> <knowledge-base.md>');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
config.knowledge_base = fs.readFileSync(kbPath, 'utf8');

const q = s => `'${String(s).replace(/'/g, "''")}'`;
const lines = ['BEGIN;'];
for (const [key, value] of Object.entries(config)) {
  lines.push(`SELECT agente.settings_set(${q(key)}, ${q(JSON.stringify(value))}::jsonb);`);
}
lines.push('COMMIT;');
process.stdout.write(lines.join('\n') + '\n');
