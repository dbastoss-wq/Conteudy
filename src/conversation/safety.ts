/**
 * Detecção de urgência por palavras-chave. Combinada com a flag `sinais_urgencia`
 * do LLM no handler. Em caso de urgência o bot NÃO agenda: orienta SAMU/PS e
 * notifica o médico.
 */
const URGENCY_PATTERNS: RegExp[] = [
  /falta de ar|dificuldade (para|pra|de) respirar|n[aã]o (consigo|estou conseguindo) respirar/i,
  /dor no peito|dor no t[oó]rax|aperto no peito/i,
  /desmai|desacord|perd[ie] a consci[eê]ncia|caiu e n[aã]o/i,
  /sangramento (forte|intenso|muito)|hemorragia|perdendo muito sangue/i,
  /(quero|penso em|ideia de|vou) (me matar|me machucar|morrer|suic)/i,
  /suic[ií]di/i,
  /convuls[aã]o|avc|derrame|infarto/i,
  /overdose|intoxica[cç][aã]o grave/i,
];

export function detectUrgencyKeywords(text: string): boolean {
  return URGENCY_PATTERNS.some((re) => re.test(text));
}

/** Confirmação explícita (reforço determinístico do LLM). */
const CONFIRM_PATTERNS: RegExp[] = [
  /\b(sim|pode ser|confirmo|confirmado|isso mesmo|esse mesmo|fechado|fechou|perfeito|t[aá] bom|ok|beleza)\b/i,
];

export function looksLikeConfirmation(text: string): boolean {
  return CONFIRM_PATTERNS.some((re) => re.test(text));
}
