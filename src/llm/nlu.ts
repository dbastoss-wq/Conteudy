import { z } from 'zod';
import { DateTime } from 'luxon';
import { complete } from './index.js';

/**
 * Resultado da interpretação da mensagem do paciente. É SÓ extração — nenhuma
 * decisão de agenda vem daqui.
 */
export const NluSchema = z.object({
  intent: z.enum(['agendar', 'saudacao', 'duvida_clinica', 'fora_do_assunto', 'outro']),
  nome: z.string().nullable(),
  motivo: z.string().nullable(),
  data_preferida: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  hora_preferida: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  confirmou_horario: z.boolean(),
  forma_pagamento: z.enum(['pix', 'credito', 'debito']).nullable(),
  sinais_urgencia: z.boolean(),
  comprovante_mencionado: z.boolean(),
});

export type NluResult = z.infer<typeof NluSchema>;

export const NLU_FALLBACK: NluResult = {
  intent: 'outro',
  nome: null,
  motivo: null,
  data_preferida: null,
  hora_preferida: null,
  confirmou_horario: false,
  forma_pagamento: null,
  sinais_urgencia: false,
  comprovante_mencionado: false,
};

const SYSTEM = `Você é o extrator de dados de uma secretária de consultório médico.
Sua ÚNICA função é ler a mensagem do paciente e devolver um JSON. Você NÃO responde ao paciente,
NÃO dá opinião médica e NÃO decide horários.

Regras:
- "intent": "agendar" se a pessoa quer marcar/remarcar consulta ou fala de motivo/data/hora;
  "saudacao" para um oi/olá sem conteúdo; "duvida_clinica" se faz pergunta sobre sintoma/doença/remédio;
  "fora_do_assunto" se pede algo que não é agendamento nem dúvida clínica (ex.: atestado por fora, parceria, cobrança);
  "outro" se não der para classificar.
- "nome": nome completo do paciente se ele disser, senão null.
- "motivo": motivo da consulta em poucas palavras, se houver, senão null.
- "data_preferida": data desejada no formato YYYY-MM-DD, resolvendo termos relativos ("amanhã",
  "sexta", "semana que vem") a partir da data atual informada. Se não houver, null.
- "hora_preferida": hora desejada em HH:mm (24h). Se não houver, null.
- "confirmou_horario": true SOMENTE se a pessoa está aceitando explicitamente um horário já proposto
  (ex.: "pode ser", "confirmo", "esse mesmo", "fechado").
- "forma_pagamento": "pix", "credito" ou "debito" se a pessoa escolher; senão null.
- "sinais_urgencia": true se houver sinais de emergência (falta de ar, dor no peito, desmaio,
  sangramento forte, ideia de se machucar/suicídio).
- "comprovante_mencionado": true se a pessoa disser que enviou/vai enviar comprovante de pagamento.
Responda APENAS com o JSON, sem texto ao redor.`;

export interface NluContext {
  timezone: string;
  /** Data/hora atual (para resolver termos relativos). */
  now?: DateTime;
  /** O que já sabemos, para o modelo não re-perguntar. */
  jaColetado?: { nome?: string | null; motivo?: string | null };
  /** Horário aguardando confirmação (se houver), em texto legível. */
  slotPendente?: string | null;
}

export async function interpret(message: string, ctx: NluContext): Promise<NluResult> {
  const now = (ctx.now ?? DateTime.now().setZone(ctx.timezone)).setZone(ctx.timezone).setLocale('pt-BR');
  const user = [
    `Data e hora atuais (${ctx.timezone}): ${now.toFormat("cccc, dd/LL/yyyy HH:mm")}.`,
    ctx.jaColetado?.nome ? `Nome já conhecido: ${ctx.jaColetado.nome}.` : '',
    ctx.jaColetado?.motivo ? `Motivo já conhecido: ${ctx.jaColetado.motivo}.` : '',
    ctx.slotPendente ? `Horário aguardando confirmação: ${ctx.slotPendente}.` : '',
    '',
    `Mensagem do paciente: """${message}"""`,
  ]
    .filter(Boolean)
    .join('\n');

  let raw: string;
  try {
    raw = await complete({ system: SYSTEM, user, json: true, maxTokens: 400 });
  } catch (err) {
    console.error('[nlu] falha no LLM:', err);
    return NLU_FALLBACK;
  }

  const parsed = safeParseJson(raw);
  const result = NluSchema.safeParse(parsed);
  if (!result.success) {
    console.error('[nlu] JSON inválido do LLM:', raw);
    return NLU_FALLBACK;
  }
  return result.data;
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // tenta extrair o primeiro bloco { ... }
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}
