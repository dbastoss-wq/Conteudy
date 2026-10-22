'use strict';
// Detecção determinística de sinais de risco (crise, risco a terceiros, urgência médica).
// Roda antes dos filtros e da IA. Prefere falso positivo a falso negativo.
// Termos vêm da configuração (psiquiatria.termos_risco), definidos pela equipe clínica:
//   "texto"                                  → nível alto, categoria crise
//   { termo, nivel: 'alto'|'possivel', categoria: 'crise'|'terceiros'|'urgencia' }
// Um "*" no fim de uma palavra aceita qualquer continuação (ex.: "suicid*").

const LEVELS = ['nenhum', 'possivel', 'alto'];
const CATEGORIES = ['crise', 'terceiros', 'urgencia'];

function normalize(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9*\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function toEntry(t) {
  const e = typeof t === 'string' ? { termo: t } : (t || {});
  return {
    termo: String(e.termo || ''),
    nivel: LEVELS.includes(e.nivel) && e.nivel !== 'nenhum' ? e.nivel : 'alto',
    categoria: CATEGORIES.includes(e.categoria) ? e.categoria : 'crise',
  };
}

function termRegex(termo) {
  const words = normalize(termo).split(' ').filter(Boolean)
    .map(w => { const wild = /\*$/.test(w); const base = w.replace(/[^a-z0-9]/g, ''); return base && wild ? base + '[a-z0-9]*' : base; });
  if (!words.length || words.every(w => !w)) return null;
  return new RegExp(`(^| )${words.join(' ')}( |$)`);
}

function detectRisk(text, termos) {
  const t = normalize(text);
  let best = { risk: 'nenhum', categoria: null, matched: [] };
  if (!t) return best;
  for (const raw of termos || []) {
    const e = toEntry(raw);
    const re = termRegex(e.termo);
    if (!re || !re.test(t)) continue;
    best.matched.push(e.termo);
    if (LEVELS.indexOf(e.nivel) > LEVELS.indexOf(best.risk)) { best.risk = e.nivel; best.categoria = e.categoria; }
  }
  return best;
}

// Combina a detecção determinística com a classificação da IA: vale o nível mais alto.
function maxRisk(a, b) {
  const ra = a || { risk: 'nenhum' }; const rb = b || { risk: 'nenhum' };
  const top = LEVELS.indexOf(rb.risk) > LEVELS.indexOf(ra.risk) ? rb : ra;
  return { risk: top.risk, categoria: top.categoria || null, matched: [...(ra.matched || []), ...(rb.matched || [])] };
}

const isRisk = r => !!r && (r.risk === 'possivel' || r.risk === 'alto');

module.exports = { detectRisk, maxRisk, isRisk, normalize, LEVELS, CATEGORIES };
