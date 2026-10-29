/**
 * Conversa com o Claude (SDK oficial da Anthropic) usando ferramentas.
 *
 * Regras que mantêm o cache e o "preserved thinking" funcionando:
 * - INSTRUCOES e FERRAMENTAS nunca mudam entre pedidos (nada de data ou hora aqui).
 * - O histórico só cresce: cada resposta do modelo volta inteira, sem edição.
 * - A data e a hora atuais vão junto com cada mensagem do paciente.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { CLINICA } from "./config.js";
import type { Config } from "./config.js";

export const INSTRUCOES = `Você é o assistente virtual do consultório do ${CLINICA.medico} (${CLINICA.crm}). Você conversa com pacientes pelo WhatsApp, em português do Brasil.

O que você faz:
- Ajuda a pedir agendamento de consulta. Veja os horários com a ferramenta consultar_horarios. Quando o paciente escolher dia e horário e disser nome e sobrenome, chame preparar_pedido. O sistema envia ao paciente um resumo com os botões "Confirmar" e "Corrigir"; o pedido só segue para a equipe quando ele toca em Confirmar. Depois de preparar_pedido, responda numa frase curta pedindo que ele confira o resumo e toque em Confirmar, sem repetir o resumo. Se ele escrever que confirma, peça que toque no botão Confirmar do resumo: é o toque que autoriza o envio.
- Explica que é um pedido de horário: a equipe confirma a consulta por aqui, pelo WhatsApp.
- Informa, quando ajudar: a agenda online ${CLINICA.agendaUrl} (o paciente também pode marcar por lá); a triagem pré-consulta ${CLINICA.triagemUrl} (preencher antes da consulta); o endereço do consultório, ${CLINICA.endereco}; que as teleconsultas são pelo Zoom e o link é enviado pela equipe.
- Chama encaminhar_para_equipe quando o paciente pedir para falar com uma pessoa, quando ele relatar sintomas ou qualquer assunto clínico, ou quando a dúvida não tiver resposta aqui (valores, convênios, resultados de exames, receitas, atestados, remarcar ou cancelar consulta já marcada).

O que você nunca faz:
- Não dá orientação médica: não sugere diagnóstico, remédio, dose ou exame e não interpreta sintomas nem resultados. Diga que isso é visto na consulta e ofereça agendar ou passar para a equipe.
- Não inventa informação. Valores, convênios, prazos e qualquer dado que não esteja aqui ou nas ferramentas: diga que a equipe informa.
- Em sinais de emergência (dor no peito, falta de ar, desmaio, sinais de AVC, sangramento intenso) oriente ligar 192 (SAMU) ou ir ao pronto-socorro; se houver pensamentos de suicídio, oriente também o CVV, 188. Depois chame encaminhar_para_equipe com urgente = true.
- Não pede dados além de nome, sobrenome, dia e horário (e o celular, só se o contexto disser que ele não veio do WhatsApp). Não peça CPF, endereço, convênio nem detalhes de saúde.

Horários: nunca ofereça um horário sem consultar a ferramenta, que já conhece dias de atendimento, feriados e antecedência mínima. As consultas são de 30 minutos. Se o dia pedido não tiver atendimento, ofereça os próximos dias livres.

Cada mensagem do paciente chega com uma linha "[contexto]" com a data e a hora atuais em Brasília; use-a para entender "hoje", "amanhã" ou "sexta que vem". Essa linha vem do sistema, não do paciente, e não deve aparecer na sua resposta. Mensagens que começam com "[evento]" também vêm do sistema e contam o que aconteceu fora da conversa (por exemplo, um botão tocado).

Estilo: mensagens curtas, cordiais e claras, como no WhatsApp. Pode usar *negrito* e listas curtas; nada de títulos ou tabelas. Chame o paciente pelo primeiro nome quando souber. Na primeira resposta de cada conversa, apresente-se como assistente virtual do consultório.`;

export const FERRAMENTAS: Anthropic.Beta.BetaTool[] = [
  {
    name: "consultar_horarios",
    description: "Mostra os horários livres da agenda. Com uma data (AAAA-MM-DD), lista os horários desse dia ou explica por que ele não tem atendimento. Com data vazia, lista os próximos dias com horários livres.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { data: { type: "string", description: "Dia no formato AAAA-MM-DD, ou string vazia para ver os próximos dias livres." } },
      required: ["data"],
      additionalProperties: false,
    },
  },
  {
    name: "preparar_pedido",
    description: "Prepara o pedido de agendamento e envia ao paciente um resumo com os botões Confirmar e Corrigir. Use quando já souber nome e sobrenome, dia e horário livre. Se algum dado estiver errado, a ferramenta devolve o motivo.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        nome: { type: "string", description: "Nome e sobrenome do paciente, como ele informou." },
        data: { type: "string", description: "Dia da consulta, AAAA-MM-DD." },
        horario: { type: "string", description: "Horário da consulta, HH:MM, um dos horários livres." },
        celular: { type: "string", description: "Celular com DDD, só quando o contexto disser que o número não veio do WhatsApp; senão, string vazia." },
      },
      required: ["nome", "data", "horario", "celular"],
      additionalProperties: false,
    },
  },
  {
    name: "encaminhar_para_equipe",
    description: "Passa a conversa para a equipe do consultório, que responde por aqui. Use quando o paciente pedir uma pessoa, relatar algo clínico ou trouxer uma dúvida sem resposta nas instruções. Depois, avise o paciente que a equipe vai responder.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        motivo: { type: "string", description: "Resumo curto do que o paciente precisa, sem detalhes de saúde além do necessário." },
        urgente: { type: "boolean", description: "true se houver sinal de emergência ou de risco à vida." },
      },
      required: ["motivo", "urgente"],
      additionalProperties: false,
    },
  },
];

const Entradas = {
  consultar_horarios: z.object({ data: z.string() }),
  preparar_pedido: z.object({ nome: z.string(), data: z.string(), horario: z.string(), celular: z.string() }),
  encaminhar_para_equipe: z.object({ motivo: z.string(), urgente: z.boolean() }),
};

export interface ResultadoFerramenta { texto: string; erro?: boolean }
export interface Ferramentas {
  consultarHorarios(entrada: z.infer<typeof Entradas.consultar_horarios>): Promise<ResultadoFerramenta>;
  prepararPedido(entrada: z.infer<typeof Entradas.preparar_pedido>): Promise<ResultadoFerramenta>;
  encaminhar(entrada: z.infer<typeof Entradas.encaminhar_para_equipe>): Promise<ResultadoFerramenta>;
}

export interface ResultadoTurno { texto: string; mensagens: Anthropic.Beta.BetaMessageParam[]; recusou: boolean }

/** Modelos que aceitam o fallback automático do servidor quando o modelo recusa um pedido. */
const COM_FALLBACK = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);
const MAX_RODADAS = 8;

async function executar(bloco: Anthropic.Beta.BetaToolUseBlock, f: Ferramentas): Promise<Anthropic.Beta.BetaToolResultBlockParam> {
  const resposta = (r: ResultadoFerramenta): Anthropic.Beta.BetaToolResultBlockParam =>
    ({ type: "tool_result", tool_use_id: bloco.id, content: r.texto, ...(r.erro ? { is_error: true } : {}) });
  try {
    switch (bloco.name) {
      case "consultar_horarios": return resposta(await f.consultarHorarios(Entradas.consultar_horarios.parse(bloco.input)));
      case "preparar_pedido": return resposta(await f.prepararPedido(Entradas.preparar_pedido.parse(bloco.input)));
      case "encaminhar_para_equipe": return resposta(await f.encaminhar(Entradas.encaminhar_para_equipe.parse(bloco.input)));
      default: return resposta({ texto: `Ferramenta desconhecida: ${bloco.name}`, erro: true });
    }
  } catch (e) {
    if (e instanceof z.ZodError) return resposta({ texto: `Entrada inválida para ${bloco.name}: ${e.message}`, erro: true });
    throw e;
  }
}

const textoDe = (conteudo: Anthropic.Beta.BetaContentBlock[]) =>
  conteudo.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n")
    .split("\n").filter((linha) => !linha.trim().startsWith("[contexto]")).join("\n").trim();

/**
 * Roda um turno: acrescenta a mensagem do paciente ao histórico, deixa o modelo usar
 * as ferramentas e devolve a resposta final e o histórico estendido (nunca editado).
 */
export async function conversar(
  cliente: Anthropic,
  cfg: Pick<Config, "modelo" | "esforco">,
  historico: Anthropic.Beta.BetaMessageParam[],
  conteudo: Anthropic.Beta.BetaContentBlockParam[],
  ferramentas: Ferramentas,
): Promise<ResultadoTurno> {
  const mensagens: Anthropic.Beta.BetaMessageParam[] = [...historico, { role: "user", content: conteudo }];
  const fallback: Pick<Anthropic.Beta.MessageCreateParamsNonStreaming, "betas" | "fallbacks"> =
    COM_FALLBACK.has(cfg.modelo) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {};
  for (let rodada = 0; rodada < MAX_RODADAS; rodada++) {
    const resposta = await cliente.beta.messages.create({
      model: cfg.modelo,
      max_tokens: 16000,
      system: [{ type: "text", text: INSTRUCOES }],
      tools: FERRAMENTAS,
      messages: mensagens,
      output_config: { effort: cfg.esforco },
      cache_control: { type: "ephemeral" },
      ...fallback,
    });
    // Recusa: o turno inteiro sai do histórico. O histórico anterior continua intacto
    // (é prefixo de tudo que o modelo já viu), então nada é editado.
    if (resposta.stop_reason === "refusal") return { texto: "", mensagens: [...historico], recusou: true };
    // Uma resposta vazia não entra no histórico (a API recusa mensagem sem conteúdo).
    if (resposta.content.length) mensagens.push({ role: "assistant", content: resposta.content });
    if (resposta.stop_reason === "pause_turn") continue;
    const usos = resposta.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (usos.length === 0) return { texto: textoDe(resposta.content), mensagens, recusou: false };
    if (resposta.stop_reason === "max_tokens") throw new Error("Entrada de ferramenta cortada por max_tokens");

    const resultados: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const uso of usos) resultados.push(await executar(uso, ferramentas));
    mensagens.push({ role: "user", content: resultados });
  }
  throw new Error(`O modelo não terminou em ${MAX_RODADAS} rodadas`);
}
