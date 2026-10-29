/**
 * Assistente de WhatsApp do consultório (Chat SDK + adaptador oficial da WhatsApp Cloud API).
 *
 * Fluxo de agendamento:
 * 1. O paciente conversa; a IA consulta horários com as mesmas regras da agenda online.
 * 2. A IA prepara o pedido; o CÓDIGO envia o resumo com os botões Confirmar e Corrigir.
 * 3. Só o toque em Confirmar envia o pedido ao formulário da Netlify (o mesmo do site).
 *    O celular vem do remetente do WhatsApp, nunca do texto da IA.
 */
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { Actions, Button, Card, CardText, Chat, ConsoleLogger } from "chat";
import type { Message, StateAdapter } from "chat";
import { createMemoryState } from "@chat-adapter/state-memory";
import { createRedisState } from "@chat-adapter/state-redis";
import { createWhatsAppAdapter } from "@chat-adapter/whatsapp";
import type { WhatsAppRawMessage } from "@chat-adapter/whatsapp";
import {
  agoraPorExtenso, agoraSP, celularDoWhatsapp, dataCurta, dataLonga, dataNumerica, diasLivres, dnDe,
  formatarWhats, hhmm, situacaoDoDia, validarCelular, validarHorario, validarNome,
} from "./agenda.js";
import { CLINICA, lerConfig } from "./config.js";
import type { Config } from "./config.js";
import { enviarPedido } from "./formulario.js";
import { conversar } from "./ia.js";
import type { Ferramentas, ResultadoFerramenta } from "./ia.js";
import { Memoria } from "./memoria.js";
import type { PedidoPendente } from "./memoria.js";
import { triagemDeRisco } from "./seguranca.js";

export const TEXTOS = {
  soTexto: "Por enquanto eu só consigo ler mensagens de texto 🙂 Pode escrever o que você precisa?",
  falhaTecnica: `Tive um problema técnico agora e não consegui responder 😕 Tente de novo em alguns minutos. Se preferir, marque pela agenda online: ${CLINICA.agendaUrl}`,
  recusa: "Desculpe, não consigo ajudar com isso por aqui. Vou pedir para a equipe do consultório te responder.",
  naoEntendi: "Não entendi bem. Pode me contar de outro jeito o que você precisa?",
  corrigir: "Sem problema! O que você quer mudar: o nome, o dia ou o horário?",
  jaEnviado: "Esse pedido já foi enviado ✅ A equipe confirma o horário por aqui.",
  expirado: "Esse resumo expirou. Me diga de novo o dia e o horário que você prefere 🙂",
  falhaEnvio: `Não consegui enviar seu pedido agora 😕 Toque em *Confirmar* de novo em alguns minutos, ou marque pela agenda online: ${CLINICA.agendaUrl}`,
  equipe: "✅ Avisos do assistente ativos neste número pelas próximas 24 horas.",
};

export interface OpcoesBot {
  cfg?: Config;
  state?: StateAdapter;
  anthropic?: Anthropic;
  whatsapp?: ReturnType<typeof createWhatsAppAdapter>;
  /** Relógio injetável, para testes. */
  agora?: () => Date;
}

export function cardDoPedido(p: PedidoPendente) {
  const dn = dnDe(p.dataIso);
  return Card({
    title: "Confira seu pedido",
    children: [
      CardText(`*${p.nome}*\n${dataLonga(dn)}, às ${p.horario}\nConsulta de 30 minutos com o ${CLINICA.medico}.\n\nAo tocar em *Confirmar*, você autoriza o uso do seu nome e WhatsApp para este agendamento (LGPD).`),
      Actions([
        Button({ id: "confirmar_pedido", label: "Confirmar", style: "primary", value: p.id }),
        Button({ id: "corrigir_pedido", label: "Corrigir", value: p.id }),
      ]),
    ],
  });
}

/**
 * Celular do remetente (11 dígitos), quando o WhatsApp informa o número.
 * Com os IDs de usuário por empresa (BSUID) da Meta, o número pode não vir: aí devolve null.
 */
export function celularDe(message: Message): string | null {
  const raw = message.raw as Partial<WhatsAppRawMessage> | undefined;
  for (const id of [raw?.message?.from, raw?.contact?.wa_id, message.author.userId]) {
    const celular = id ? celularDoWhatsapp(id) : null;
    if (celular) return celular;
  }
  return null;
}

/** Só o que o paciente escreveu: texto e legendas. Áudio, figurinha, imagem sem legenda etc. viram "semTexto". */
export function textoDe(message: Message): { texto: string; semTexto: boolean } {
  const m = (message.raw as Partial<WhatsAppRawMessage> | undefined)?.message;
  if (!m) return { texto: (message.text ?? "").trim(), semTexto: false };
  const texto = (m.type === "text" ? m.text?.body : m.image?.caption ?? m.video?.caption ?? m.document?.caption)?.trim() ?? "";
  return { texto, semTexto: m.type !== "text" };
}

/** Ajusta o Markdown comum que o modelo às vezes usa (**negrito**, # títulos) ao formato do WhatsApp. */
export function paraWhatsapp(texto: string): string {
  return texto
    .replace(/\*\*([^*\n]+)\*\*/g, "*$1*")
    .replace(/^#{1,6}\s+(.+)$/gm, "*$1*");
}

export function criarBot(op: OpcoesBot = {}) {
  const cfg = op.cfg ?? lerConfig();
  const state = op.state ?? (cfg.redisUrl ? createRedisState({ url: cfg.redisUrl }) : createMemoryState());
  if (!op.state && !cfg.redisUrl && process.env.NODE_ENV === "production") {
    console.warn("[bot] REDIS_URL não definido: a memória das conversas se perde entre execuções. Configure o Redis em produção.");
  }
  // Só avisos e erros no log: nada do conteúdo das mensagens vai para os registros.
  const whatsapp = op.whatsapp ?? createWhatsAppAdapter({ logger: new ConsoleLogger("warn").child("whatsapp") });
  const anthropic = op.anthropic ?? new Anthropic();
  const relogio = op.agora ?? (() => new Date());
  const memoria = new Memoria(state);
  const celularDaEquipe = cfg.equipeWhatsapp ? celularDoWhatsapp(cfg.equipeWhatsapp) : null;

  const bot = new Chat({
    userName: "assistente-dr-daniel",
    adapters: { whatsapp },
    state,
    concurrency: { strategy: "burst", debounceMs: cfg.debounceMs },
    logger: "warn",
  });

  /** Aviso para a equipe no WhatsApp (best effort: um erro aqui não atrapalha o paciente). */
  async function avisarEquipe(texto: string, resumoUmaLinha: string) {
    if (!cfg.equipeWhatsapp) return;
    try {
      const threadId = await whatsapp.openDM(cfg.equipeWhatsapp);
      if (cfg.equipeTemplate) {
        await whatsapp.sendTemplate(threadId, {
          name: cfg.equipeTemplate,
          language: "pt_BR",
          components: [{ type: "body", parameters: [{ type: "text", text: resumoUmaLinha }] }],
        });
      } else {
        await bot.thread(threadId).post(texto);
      }
    } catch (e) {
      console.error("[bot] Falha ao avisar a equipe (fora da janela de 24 h? configure EQUIPE_TEMPLATE):", (e as Error).message);
    }
  }

  async function registrarEvento(threadId: string, texto: string) {
    const agora = relogio().getTime();
    const c = await memoria.conversa(threadId, agora);
    c.mensagens.push({ role: "user", content: [{ type: "text", text: texto }] });
    await memoria.salvarConversa(threadId, c, agora);
  }

  function ferramentasDaConversa(threadId: string, celularDoRemetente: string | null, agora: Date) {
    const estado: { pedido: PedidoPendente | null; encaminhar: { motivo: string; urgente: boolean } | null } = { pedido: null, encaminhar: null };
    const sp = agoraSP(agora);
    const ferramentas: Ferramentas = {
      async consultarHorarios({ data }): Promise<ResultadoFerramenta> {
        if (!data.trim()) {
          const dias = diasLivres(sp);
          if (!dias.length) return { texto: "Não há horários livres nas próximas 4 semanas. Sugira a agenda online ou encaminhar para a equipe." };
          return {
            texto: "Próximos dias com horários livres (consultas de 30 minutos; a equipe confirma o horário):\n" +
              dias.map((d) => `- ${dataCurta(d.dn)} (${d.iso}): ${d.horarios.length} horários, de ${hhmm(d.horarios[0]!)} a ${hhmm(d.horarios.at(-1)!)}`).join("\n"),
          };
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(data.trim())) return { texto: `Data inválida: "${data}". Use AAAA-MM-DD.`, erro: true };
        const dia = situacaoDoDia(dnDe(data.trim()), sp);
        const quando = `${dataLonga(dia.dn)} (${dia.iso})`;
        switch (dia.status) {
          case "livre": return { texto: `${quando}: horários livres ${dia.horarios.map(hhmm).join(", ")}.` };
          case "feriado": return { texto: `${quando}: feriado (${dia.motivo}), sem atendimento.` };
          case "sem-atendimento": return { texto: `${quando}: não há atendimento nesse dia da semana (só segunda, quinta, sexta e sábado).` };
          case "encerrado": return { texto: `${quando}: não há mais horários livres nesse dia.` };
          case "bloqueado": return { texto: `${quando}: dia bloqueado na agenda.` };
          case "fora-do-periodo": return { texto: `${quando}: fora do período da agenda (só até 4 semanas a partir de hoje).` };
        }
      },
      async prepararPedido({ nome, data, horario, celular }): Promise<ResultadoFerramenta> {
        const nomeLimpo = nome.trim().replace(/\s+/g, " ");
        const erroNome = validarNome(nomeLimpo);
        if (erroNome) return { texto: erroNome, erro: true };
        const v = validarHorario(data.trim(), horario.trim(), sp);
        if (!v.ok) return { texto: v.erro, erro: true };
        let digitos = celularDoRemetente;
        if (!digitos) {
          let d = celular.replace(/\D/g, "");
          if (d.length === 13 && d.startsWith("55")) d = d.slice(2);
          const erro = validarCelular(d);
          if (erro) return { texto: `Celular do paciente: ${erro} Peça o celular com DDD.`, erro: true };
          digitos = d;
        }
        const pedido: PedidoPendente = { id: randomUUID().slice(0, 12), nome: nomeLimpo, dataIso: data.trim(), horario: hhmm(v.min), digitos, criadoEm: agora.getTime() };
        await memoria.salvarPendente(threadId, pedido);
        estado.pedido = pedido;
        return { texto: "Resumo preparado. Logo depois da sua resposta, o sistema envia ao paciente o resumo com os botões Confirmar e Corrigir." };
      },
      async encaminhar({ motivo, urgente }): Promise<ResultadoFerramenta> {
        estado.encaminhar = { motivo, urgente };
        return { texto: "Equipe avisada. Diga ao paciente que a equipe do consultório vai responder por aqui assim que possível." };
      },
    };
    return { ferramentas, estado };
  }

  bot.onDirectMessage(async (thread, message, _canal, contexto) => {
    const threadId = thread.id;
    const celularDoRemetente = celularDe(message);
    // A equipe manda mensagem para abrir a janela de 24 h dos avisos; não é conversa de paciente.
    if (celularDaEquipe && celularDoRemetente === celularDaEquipe) { await thread.post(TEXTOS.equipe); return; }

    const recebidas = [...(contexto?.skipped ?? []), message].map(textoDe);
    const texto = recebidas.map((r) => r.texto).filter(Boolean).join("\n");
    if (!texto) { await thread.post(TEXTOS.soTexto); return; }
    const semTexto = recebidas.filter((r) => r.semTexto).length;

    const agora = relogio();
    const contatoPaciente = celularDoRemetente ? `${formatarWhats(celularDoRemetente)} · https://wa.me/55${celularDoRemetente}` : "(número não identificado)";
    const risco = triagemDeRisco(texto);
    if (risco) {
      await thread.post(risco.mensagem);
      await avisarEquipe(
        `🚨 ${risco.tipo === "risco-de-vida" ? "URGENTE: possível risco à vida" : "Possível emergência"} relatada no WhatsApp\nPaciente: ${contatoPaciente}\nMensagem: "${texto.slice(0, 300)}"`,
        `URGENTE: possível ${risco.tipo === "risco-de-vida" ? "risco à vida" : "emergência"}. Paciente ${contatoPaciente}`,
      );
      if (risco.tipo === "risco-de-vida") { await memoria.pausar(threadId, Math.max(cfg.pausaHoras, 1), agora.getTime()); return; }
    }
    if (await memoria.pausado(threadId, agora.getTime())) return;

    await thread.startTyping().catch(() => undefined);
    const conversa = await memoria.conversa(threadId, agora.getTime());
    const conteudo: Anthropic.Beta.BetaContentBlockParam[] = [
      {
        type: "text",
        text: `[contexto] Agora: ${agoraPorExtenso(agoraSP(agora))} (horário de Brasília).` +
          (celularDoRemetente ? "" : " O celular do paciente não veio do WhatsApp: peça o celular com DDD antes de preparar o pedido.") +
          (semTexto ? " O paciente também mandou áudio, imagem ou outro anexo que você não consegue ver nem ouvir: peça que escreva." : ""),
      },
      { type: "text", text: texto },
    ];
    const { ferramentas, estado } = ferramentasDaConversa(threadId, celularDoRemetente, agora);

    let resposta: string;
    try {
      const r = await conversar(anthropic, cfg, conversa.mensagens, conteudo, ferramentas);
      await memoria.salvarConversa(threadId, { mensagens: r.mensagens, atualizadaEm: agora.getTime() }, agora.getTime());
      resposta = r.recusou ? TEXTOS.recusa : paraWhatsapp(r.texto);
      if (r.recusou) {
        estado.pedido = null;
        estado.encaminhar ??= { motivo: "O assistente não conseguiu responder a uma mensagem do paciente.", urgente: false };
      }
    } catch (e) {
      console.error("[bot] Falha ao gerar a resposta:", (e as Error).message);
      await memoria.salvarConversa(threadId, { mensagens: [...conversa.mensagens, { role: "user", content: conteudo }], atualizadaEm: agora.getTime() }, agora.getTime());
      await thread.post(TEXTOS.falhaTecnica);
      return;
    }

    if (resposta) await thread.post(resposta);
    if (estado.pedido) await thread.post(cardDoPedido(estado.pedido));
    if (!resposta && !estado.pedido) await thread.post(TEXTOS.naoEntendi);
    if (estado.encaminhar) {
      const { motivo, urgente } = estado.encaminhar;
      // Na emergência a equipe já foi avisada acima, com a mensagem do paciente.
      if (!risco) await avisarEquipe(
        `${urgente ? "🚨 URGENTE · " : "🔔 "}Paciente pediu atendimento da equipe\nMotivo: ${motivo}\nPaciente: ${contatoPaciente}`,
        `${urgente ? "URGENTE: " : ""}${motivo.replace(/\s+/g, " ").slice(0, 200)}. Paciente ${contatoPaciente}`,
      );
      await memoria.pausar(threadId, cfg.pausaHoras, agora.getTime());
    }
  });

  bot.onAction(["confirmar_pedido", "corrigir_pedido"], async (evento) => {
    const thread = evento.thread;
    if (!thread) return;
    const threadId = evento.threadId;
    const pendente = await memoria.pendente(threadId);

    if (evento.actionId === "corrigir_pedido") {
      if (pendente && pendente.id === evento.value) await memoria.apagarPendente(threadId);
      await registrarEvento(threadId, "[evento] O paciente tocou em Corrigir no resumo do pedido. Pergunte o que ele quer mudar.");
      await thread.post(TEXTOS.corrigir);
      return;
    }

    if (!pendente || pendente.id !== evento.value) {
      await thread.post(evento.value && await memoria.jaEnviado(evento.value) ? TEXTOS.jaEnviado : TEXTOS.expirado);
      return;
    }
    const v = validarHorario(pendente.dataIso, pendente.horario, agoraSP(relogio()));
    if (!v.ok) {
      await memoria.apagarPendente(threadId);
      await registrarEvento(threadId, `[evento] O paciente tocou em Confirmar, mas o horário não está mais disponível: ${v.erro}`);
      await thread.post(`Esse horário não está mais disponível: ${v.erro}\n\nQuer escolher outro?`);
      return;
    }
    if (!(await memoria.reservarEnvio(pendente.id))) { await thread.post(TEXTOS.jaEnviado); return; }
    try {
      await enviarPedido({ nome: pendente.nome, dn: v.dn, min: v.min, digitos: pendente.digitos }, cfg);
    } catch (e) {
      console.error("[bot] Falha ao enviar o pedido ao formulário:", (e as Error).message);
      await memoria.liberarEnvio(pendente.id);
      await thread.post(TEXTOS.falhaEnvio);
      return;
    }
    await memoria.apagarPendente(threadId);
    const quando = `${dataLonga(v.dn)}, às ${pendente.horario}`;
    await registrarEvento(threadId, `[evento] O paciente tocou em Confirmar e o pedido foi enviado à equipe: ${pendente.nome}, ${quando}.`);
    await thread.post(`✅ Pedido enviado!\n\n*${quando}*\n\nA equipe confirma o horário por aqui. Antes da consulta, preencha a triagem pré-consulta (leva poucos minutos):\n${CLINICA.triagemUrl}`);
    await avisarEquipe(
      `📅 Novo pedido de agendamento pelo WhatsApp\nPaciente: ${pendente.nome}\nWhatsApp: ${formatarWhats(pendente.digitos)} · https://wa.me/55${pendente.digitos}\nData: ${dataNumerica(v.dn)} (${dataLonga(v.dn).split(",")[0]!.toLowerCase()}) às ${pendente.horario}`,
      `Novo pedido: ${pendente.nome}, ${dataNumerica(v.dn)} às ${pendente.horario}, WhatsApp ${formatarWhats(pendente.digitos)}`,
    );
  });

  return bot;
}

let instancia: ReturnType<typeof criarBot> | undefined;
/** Bot único por processo (as funções da Vercel reaproveitam o processo entre chamadas). */
export function obterBot() { return (instancia ??= criarBot()); }
