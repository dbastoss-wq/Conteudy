/**
 * Ponta a ponta, sem rede externa: servidores locais fazem o papel da Graph API
 * (WhatsApp), da API do Claude e do formulário da Netlify. Os webhooks chegam
 * assinados como a Meta assina.
 */
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import Anthropic from "@anthropic-ai/sdk";
import { createMemoryState } from "@chat-adapter/state-memory";
import { createWhatsAppAdapter } from "@chat-adapter/whatsapp";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { criarBot, TEXTOS } from "../src/bot.js";
import { lerConfig } from "../src/config.js";
import { FERRAMENTAS, INSTRUCOES } from "../src/ia.js";
import { Memoria } from "../src/memoria.js";

const APP_SECRET = "segredo-de-teste";
const VERIFY_TOKEN = "token-de-verificacao";
const PHONE_ID = "123456789";
const PACIENTE = "5511987654321";
const EQUIPE = "5511912345678";
const AGORA = new Date("2026-10-29T14:00:00-03:00"); // quinta-feira

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
interface Recebido { caminho: string; corpo: string; headers: Record<string, string | string[] | undefined> }

async function servidor(responder: (r: Recebido) => { status?: number; json?: Json; texto?: string }) {
  const recebidos: Recebido[] = [];
  const s = createServer((req, res) => {
    let corpo = "";
    req.on("data", (c) => (corpo += c));
    req.on("end", () => {
      const r = { caminho: req.url ?? "", corpo, headers: req.headers };
      recebidos.push(r);
      const out = responder(r);
      res.writeHead(out.status ?? 200, { "content-type": out.json !== undefined ? "application/json" : "text/plain" });
      res.end(out.json !== undefined ? JSON.stringify(out.json) : out.texto ?? "ok");
    });
  });
  await new Promise<void>((ok) => s.listen(0, "127.0.0.1", ok));
  return { url: `http://127.0.0.1:${(s.address() as AddressInfo).port}`, recebidos, fechar: () => new Promise((ok) => s.close(ok)) };
}

// ---- Claude falso: cada pedido consome um passo do roteiro ----
type Passo = (corpo: Json) => { content: Json[]; stop_reason: string } | { erro: number };
let roteiro: Passo[] = [];
const respostasClaude: Json[] = [];
/** Falhas de expect dentro do roteiro (rodam no servidor, então são guardadas e conferidas no afterEach). */
const falhasRoteiro: unknown[] = [];
let n = 0;
const claude = await servidor((r) => {
  const passo = roteiro.shift();
  if (!passo) { falhasRoteiro.push(new Error("Pedido ao Claude sem passo no roteiro")); return { status: 500, json: { type: "error", error: { type: "api_error", message: "roteiro vazio" } } }; }
  let out: ReturnType<Passo>;
  try { out = passo(JSON.parse(r.corpo)); } catch (e) { falhasRoteiro.push(e); return { status: 500, json: { type: "error", error: { type: "api_error", message: "falha no roteiro" } } }; }
  if ("erro" in out) return { status: out.erro, json: { type: "error", error: { type: "api_error", message: "falha simulada" } } };
  const msg = { id: `msg_${++n}`, type: "message", role: "assistant", model: "claude-opus-5-5", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 }, ...out };
  respostasClaude.push(msg);
  return { json: msg };
});
let wamid = 0;
const graph = await servidor(() => ({ json: { messaging_product: "whatsapp", contacts: [{ wa_id: PACIENTE }], messages: [{ id: `wamid.saida.${++wamid}` }] } }));
let netlifyStatus = 200;
const netlify = await servidor(() => ({ status: netlifyStatus, texto: "ok" }));

const pedidosClaude = () => claude.recebidos.map((r) => JSON.parse(r.corpo));
/** Mensagens enviadas pelo bot (sem os avisos de "digitando"). */
const enviadas = () => graph.recebidos.map((r) => JSON.parse(r.corpo)).filter((b) => b.type);
const para = (numero: string) => enviadas().filter((b) => b.to === numero);
const textoDe = (b: Json): string => b.text?.body ?? b.interactive?.body?.text ?? "";
const pensamento = (t: string) => ({ type: "thinking", thinking: "", signature: `assinatura-${t}` });
const texto = (t: string) => ({ type: "text", text: t });
const ferramenta = (id: string, name: string, input: Json) => ({ type: "tool_use", id, name, input });

function novoBot(env: Record<string, string> = {}) {
  const state = createMemoryState();
  const cfg = lerConfig({ NETLIFY_FORM_URL: `${netlify.url}/`, EQUIPE_WHATSAPP: EQUIPE, BOT_DEBOUNCE_MS: "30", ...env });
  const bot = criarBot({
    cfg,
    state,
    agora: () => AGORA,
    anthropic: new Anthropic({ apiKey: "chave-de-teste", baseURL: claude.url, maxRetries: 0 }),
    whatsapp: createWhatsAppAdapter({ accessToken: "token", appSecret: APP_SECRET, phoneNumberId: PHONE_ID, verifyToken: VERIFY_TOKEN, apiUrl: graph.url }),
  });
  return { bot, memoria: new Memoria(state), threadId: `whatsapp:${PHONE_ID}:${PACIENTE}` };
}

let seq = 0;
function webhook(mensagem: Json, de = PACIENTE): Json {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "WABA",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "5511926915324", phone_number_id: PHONE_ID },
          contacts: [{ profile: { name: "Maria" }, wa_id: de }],
          messages: [{ from: de, id: `wamid.entrada.${++seq}`, timestamp: String(Math.floor(Date.now() / 1000)), ...mensagem }],
        },
      }],
    }],
  };
}
const msgTexto = (body: string) => ({ type: "text", text: { body } });
const toque = (id: string) => ({ type: "interactive", interactive: { type: "button_reply", button_reply: { id, title: "Confirmar" } } });

async function postar(bot: ReturnType<typeof criarBot>, payload: Json, assinatura?: string) {
  const corpo = JSON.stringify(payload);
  const tarefas: Promise<unknown>[] = [];
  const resposta = await bot.webhooks.whatsapp(
    new Request("https://bot.test/api/webhooks/whatsapp", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": assinatura ?? `sha256=${createHmac("sha256", APP_SECRET).update(corpo).digest("hex")}` },
      body: corpo,
    }),
    { waitUntil: (p) => { tarefas.push(p); } },
  );
  await Promise.all(tarefas);
  return resposta;
}

/** O histórico só cresce, e system e tools nunca mudam (cache e "preserved thinking"). */
function conferirSoAcrescenta() {
  const pedidos = pedidosClaude();
  for (const p of pedidos) {
    expect(p.system).toEqual([{ type: "text", text: INSTRUCOES }]);
    expect(p.tools).toEqual(FERRAMENTAS);
    expect(p.cache_control).toEqual({ type: "ephemeral" });
    expect(p.output_config).toEqual({ effort: "low" });
    expect(p.fallbacks).toBe("default");
    expect(p).not.toHaveProperty("tool_choice");
  }
  for (let i = 1; i < pedidos.length; i++) {
    const antes = pedidos[i - 1].messages, depois = pedidos[i].messages;
    expect(depois.slice(0, antes.length)).toEqual(antes);
    const resposta = respostasClaude[i - 1];
    if (resposta.content.length && resposta.stop_reason !== "refusal") {
      expect(depois[antes.length]).toEqual({ role: "assistant", content: resposta.content });
    }
  }
}

beforeAll(() => { delete process.env.ANTHROPIC_BASE_URL; });
afterAll(async () => { await Promise.all([claude.fechar(), graph.fechar(), netlify.fechar()]); });
afterEach(() => {
  const falhas = falhasRoteiro.splice(0);
  if (falhas.length) throw falhas[0];
  expect(roteiro, "passos do roteiro não usados").toHaveLength(0);
});
beforeEach(() => {
  roteiro = [];
  respostasClaude.length = 0;
  for (const s of [claude, graph, netlify]) s.recebidos.length = 0;
  netlifyStatus = 200;
});

describe("webhook", () => {
  it("responde ao desafio de verificação da Meta", async () => {
    const { bot } = novoBot();
    const ok = await bot.webhooks.whatsapp(new Request(`https://bot.test/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=4242`));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("4242");
    const errado = await bot.webhooks.whatsapp(new Request("https://bot.test/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=outro&hub.challenge=1"));
    expect(errado.status).toBe(403);
  });

  it("recusa assinatura inválida sem chamar a IA", async () => {
    const { bot } = novoBot();
    const r = await postar(bot, webhook(msgTexto("oi")), "sha256=00");
    expect(r.status).toBe(401);
    expect(claude.recebidos).toHaveLength(0);
    expect(enviadas()).toHaveLength(0);
  });
});

describe("agendamento", () => {
  it("feriado, pedido, Confirmar, toque duplo e continuação da conversa", async () => {
    const { bot, memoria, threadId } = novoBot();

    // 1) Paciente pede o dia 2 (Finados): a IA consulta a agenda e oferece outro dia.
    roteiro.push(
      (c) => {
        const ultima = c.messages.at(-1);
        expect(ultima.content[0].text).toBe("[contexto] Agora: quinta-feira, 29/10/2026, 14:00 (horário de Brasília).");
        expect(ultima.content[1].text).toBe("Oi! Queria marcar consulta segunda, dia 2");
        return { content: [pensamento("1"), ferramenta("t1", "consultar_horarios", { data: "2026-11-02" })], stop_reason: "tool_use" };
      },
      (c) => {
        const resultado = c.messages.at(-1).content[0];
        expect(resultado).toMatchObject({ type: "tool_result", tool_use_id: "t1" });
        expect(resultado.content).toMatch(/feriado \(Finados\)/);
        return { content: [pensamento("2"), texto("Olá! Sou o assistente virtual do consultório. Dia 2 é feriado (Finados). Na sexta, 6/11, tenho de 09:00 a 17:30. Pode ser?")], stop_reason: "end_turn" };
      },
    );
    await postar(bot, webhook(msgTexto("Oi! Queria marcar consulta segunda, dia 2")));
    expect(para(PACIENTE).map(textoDe)).toEqual([expect.stringMatching(/Dia 2 é feriado/)]);

    // 2) Paciente escolhe sexta às 10h: a IA prepara o pedido e o código manda o resumo com botões.
    roteiro.push(
      () => ({ content: [pensamento("3"), ferramenta("t2", "preparar_pedido", { nome: "Maria  Silva", data: "2026-11-06", horario: "10:00", celular: "" })], stop_reason: "tool_use" }),
      (c) => {
        expect(c.messages.at(-1).content[0].content).toMatch(/Resumo preparado/);
        return { content: [pensamento("4"), texto("Pronto, Maria! Confira o resumo abaixo e toque em *Confirmar* 🙂")], stop_reason: "end_turn" };
      },
    );
    await postar(bot, webhook(msgTexto("Pode ser sexta às 10h. Sou Maria Silva")));
    const [, resposta2, cartao] = para(PACIENTE);
    expect(textoDe(resposta2)).toMatch(/Confira o resumo/);
    expect(cartao.type).toBe("interactive");
    expect(cartao.interactive.type).toBe("button");
    expect(cartao.interactive.body.text).toMatch(/Maria Silva/);
    expect(cartao.interactive.body.text).toMatch(/Sexta-feira, 6 de novembro, às 10:00/);
    expect(cartao.interactive.body.text).toMatch(/LGPD/);
    const [confirmar, corrigir] = cartao.interactive.action.buttons.map((b: Json) => b.reply);
    expect([confirmar.title, corrigir.title]).toEqual(["Confirmar", "Corrigir"]);
    expect(netlify.recebidos).toHaveLength(0); // nada sai sem o toque

    // 3) Toque em Confirmar: o pedido vai para o MESMO formulário da página.
    await postar(bot, webhook(toque(confirmar.id)));
    expect(netlify.recebidos).toHaveLength(1);
    expect(netlify.recebidos[0]!.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    const campos = Object.fromEntries(new URLSearchParams(netlify.recebidos[0]!.corpo));
    expect(campos).toMatchObject({
      "form-name": "agendamento-dr-daniel", data: "06/11/2026 (sexta-feira)", horario: "10:00", "bot-field": "",
      nome: "Maria Silva", whatsapp: "(11) 98765-4321", consentimento_lgpd: "Sim, autorizo",
    });
    expect(campos.responder_paciente_whatsapp).toMatch(/^https:\/\/wa\.me\/5511987654321/);
    expect(textoDe(para(PACIENTE).at(-1))).toMatch(/Pedido enviado/);
    expect(textoDe(para(PACIENTE).at(-1))).toMatch(/cognitoforms\.com/);
    const avisos = para(EQUIPE);
    expect(avisos).toHaveLength(1);
    expect(textoDe(avisos[0])).toMatch(/Novo pedido[\s\S]*Maria Silva[\s\S]*\(11\) 98765-4321[\s\S]*06\/11\/2026 \(sexta-feira\) às 10:00/);

    // 4) Toque duplo: não envia de novo.
    await postar(bot, webhook(toque(confirmar.id)));
    expect(netlify.recebidos).toHaveLength(1);
    expect(textoDe(para(PACIENTE).at(-1))).toBe(TEXTOS.jaEnviado);

    // 5) A conversa continua com o evento do botão no histórico, sem editar nada.
    roteiro.push((c) => {
      const eventos = c.messages.filter((m: Json) => m.role === "user" && m.content.some((b: Json) => /^\[evento\] O paciente tocou em Confirmar/.test(b.text ?? "")));
      expect(eventos).toHaveLength(1);
      return { content: [pensamento("5"), texto("Por nada, Maria! Até sexta.")], stop_reason: "end_turn" };
    });
    await postar(bot, webhook(msgTexto("Obrigada!")));
    expect(textoDe(para(PACIENTE).at(-1))).toBe("Por nada, Maria! Até sexta.");
    expect(roteiro).toHaveLength(0);
    conferirSoAcrescenta();
    expect(await memoria.pendente(threadId)).toBeNull();
  });

  it("Corrigir descarta o resumo e a IA pergunta o que mudar", async () => {
    const { bot, memoria, threadId } = novoBot();
    roteiro.push(
      () => ({ content: [ferramenta("t1", "preparar_pedido", { nome: "João Souza", data: "2026-11-07", horario: "09:30", celular: "" })], stop_reason: "tool_use" }),
      () => ({ content: [texto("Confira e toque em Confirmar.")], stop_reason: "end_turn" }),
    );
    await postar(bot, webhook(msgTexto("João Souza, sábado 9h30")));
    const cartao = para(PACIENTE).find((b) => b.type === "interactive");
    const [confirmar, corrigir] = cartao.interactive.action.buttons.map((b: Json) => b.reply);
    await postar(bot, webhook(toque(corrigir.id)));
    expect(textoDe(para(PACIENTE).at(-1))).toBe(TEXTOS.corrigir);
    expect(await memoria.pendente(threadId)).toBeNull();
    await postar(bot, webhook(toque(confirmar.id)));
    expect(textoDe(para(PACIENTE).at(-1))).toBe(TEXTOS.expirado);
    expect(netlify.recebidos).toHaveLength(0);
  });

  it("dados errados voltam para a IA como erro da ferramenta", async () => {
    const { bot } = novoBot();
    roteiro.push(
      () => ({ content: [ferramenta("t1", "preparar_pedido", { nome: "Ana", data: "2026-11-03", horario: "10:00", celular: "" })], stop_reason: "tool_use" }),
      (c) => {
        const r = c.messages.at(-1).content[0];
        expect(r.is_error).toBe(true);
        return { content: [ferramenta("t2", "preparar_pedido", { nome: "Ana Lima", data: "2026-11-03", horario: "10:00", celular: "" })], stop_reason: "tool_use" };
      },
      (c) => {
        const r = c.messages.at(-1).content[0];
        expect(r.is_error).toBe(true);
        expect(r.content).toMatch(/terça|atendimento/i);
        return { content: [texto("Terça não tem atendimento. Prefere segunda ou quinta?")], stop_reason: "end_turn" };
      },
    );
    await postar(bot, webhook(msgTexto("Ana, terça 10h")));
    expect(para(PACIENTE).some((b) => b.type === "interactive")).toBe(false);
    expect(textoDe(para(PACIENTE).at(-1))).toMatch(/Terça não tem atendimento/);
  });

  it("falha da Netlify: avisa o paciente e deixa tocar de novo", async () => {
    const { bot } = novoBot();
    roteiro.push(
      () => ({ content: [ferramenta("t1", "preparar_pedido", { nome: "Maria Silva", data: "2026-11-06", horario: "11:00", celular: "" })], stop_reason: "tool_use" }),
      () => ({ content: [texto("Confira e toque em Confirmar.")], stop_reason: "end_turn" }),
    );
    await postar(bot, webhook(msgTexto("Maria Silva, sexta 11h")));
    const confirmar = para(PACIENTE).find((b) => b.type === "interactive").interactive.action.buttons[0].reply;
    netlifyStatus = 500;
    await postar(bot, webhook(toque(confirmar.id)));
    expect(textoDe(para(PACIENTE).at(-1))).toBe(TEXTOS.falhaEnvio);
    netlifyStatus = 200;
    await postar(bot, webhook(toque(confirmar.id)));
    expect(netlify.recebidos).toHaveLength(2);
    expect(textoDe(para(PACIENTE).at(-1))).toMatch(/Pedido enviado/);
  });
});

describe("segurança e limites", () => {
  it("emergência: orientação do SAMU sai antes da IA, a equipe é avisada uma vez e o bot pausa", async () => {
    const { bot } = novoBot();
    roteiro.push(
      (c) => {
        // Quando a IA é chamada, o aviso de emergência já foi enviado.
        expect(textoDe(para(PACIENTE)[0])).toMatch(/SAMU 192/);
        expect(c.messages.at(-1).content[1].text).toBe("Estou com dor no peito e falta de ar");
        return { content: [ferramenta("t1", "encaminhar_para_equipe", { motivo: "Relato de dor no peito", urgente: true })], stop_reason: "tool_use" };
      },
      () => ({ content: [texto("Ligue 192 agora. Já avisei a equipe.")], stop_reason: "end_turn" }),
    );
    await postar(bot, webhook(msgTexto("Estou com dor no peito e falta de ar")));
    expect(para(PACIENTE).map(textoDe)).toEqual([expect.stringMatching(/SAMU 192/), "Ligue 192 agora. Já avisei a equipe."]);
    expect(para(EQUIPE)).toHaveLength(1);
    expect(textoDe(para(EQUIPE)[0])).toMatch(/emergência[\s\S]*\(11\) 98765-4321/);

    await postar(bot, webhook(msgTexto("alguém aí?")));
    expect(claude.recebidos).toHaveLength(2);
    expect(para(PACIENTE)).toHaveLength(2);
  });

  it("risco à vida: CVV 188 e SAMU, equipe avisada, sem IA", async () => {
    const { bot } = novoBot();
    await postar(bot, webhook(msgTexto("não aguento mais, quero morrer")));
    expect(claude.recebidos).toHaveLength(0);
    expect(textoDe(para(PACIENTE)[0])).toMatch(/188[\s\S]*192/);
    expect(textoDe(para(EQUIPE)[0])).toMatch(/URGENTE/);
  });

  it("áudio ou imagem sem legenda: pede texto, sem IA", async () => {
    const { bot } = novoBot();
    await postar(bot, webhook({ type: "audio", audio: { id: "m1", mime_type: "audio/ogg", sha256: "x", voice: true } }));
    await postar(bot, webhook({ type: "image", image: { id: "m2", mime_type: "image/jpeg", sha256: "x" } }));
    expect(claude.recebidos).toHaveLength(0);
    expect(para(PACIENTE).map(textoDe)).toEqual([TEXTOS.soTexto, TEXTOS.soTexto]);
  });

  it("recusa do modelo: resposta educada, equipe avisada, histórico intacto", async () => {
    const { bot, memoria, threadId } = novoBot();
    roteiro.push(() => ({ content: [], stop_reason: "refusal" }));
    await postar(bot, webhook(msgTexto("pergunta qualquer")));
    expect(textoDe(para(PACIENTE)[0])).toBe(TEXTOS.recusa);
    expect(para(EQUIPE)).toHaveLength(1);
    expect((await memoria.conversa(threadId, AGORA.getTime())).mensagens).toEqual([]);
  });

  it("erro na API do Claude: mensagem de falha e só a fala do paciente fica no histórico", async () => {
    const { bot, memoria, threadId } = novoBot();
    roteiro.push(() => ({ erro: 500 }));
    await postar(bot, webhook(msgTexto("oi")));
    expect(textoDe(para(PACIENTE)[0])).toBe(TEXTOS.falhaTecnica);
    const { mensagens } = await memoria.conversa(threadId, AGORA.getTime());
    expect(mensagens).toHaveLength(1);
    expect(mensagens[0]!.role).toBe("user");
  });

  it("mensagens em sequência viram uma resposta só", async () => {
    const { bot } = novoBot({ BOT_DEBOUNCE_MS: "300" });
    roteiro.push((c) => {
      expect(c.messages).toHaveLength(1);
      expect(c.messages[0].content[1].text).toBe("oi\nqueria marcar consulta");
      return { content: [texto("Claro! Para qual dia?")], stop_reason: "end_turn" };
    });
    await Promise.all([postar(bot, webhook(msgTexto("oi"))), new Promise((ok) => setTimeout(ok, 50)).then(() => postar(bot, webhook(msgTexto("queria marcar consulta"))))]);
    expect(claude.recebidos).toHaveLength(1);
    expect(para(PACIENTE).map(textoDe)).toEqual(["Claro! Para qual dia?"]);
  });

  it("mensagem da equipe confirma os avisos e não vira conversa", async () => {
    const { bot } = novoBot();
    await postar(bot, webhook(msgTexto("oi"), EQUIPE));
    expect(claude.recebidos).toHaveLength(0);
    expect(para(EQUIPE).map(textoDe)).toEqual([TEXTOS.equipe]);
  });

  it("sem o número no WhatsApp (BSUID), pede o celular e o usa no pedido", async () => {
    const { bot } = novoBot();
    const semNumero = webhook(msgTexto("Maria Silva, sexta 15h"));
    const v = semNumero.entry[0].changes[0].value;
    v.contacts = [{ profile: { name: "Maria" }, user_id: "BR.AbC123xyz" }];
    v.messages[0] = { ...v.messages[0], from: undefined, from_user_id: "BR.AbC123xyz" };
    roteiro.push(
      (c) => {
        expect(c.messages.at(-1).content[0].text).toMatch(/não veio do WhatsApp/);
        return { content: [ferramenta("t1", "preparar_pedido", { nome: "Maria Silva", data: "2026-11-06", horario: "15:00", celular: "(11) 97777-6666" })], stop_reason: "tool_use" };
      },
      () => ({ content: [texto("Confira e toque em Confirmar.")], stop_reason: "end_turn" }),
    );
    await postar(bot, semNumero);
    const cartao = graph.recebidos.map((r) => JSON.parse(r.corpo)).find((b) => b.type === "interactive");
    expect(cartao.recipient).toBe("BR.AbC123xyz");
    const toqueSemNumero = webhook(toque(cartao.interactive.action.buttons[0].reply.id));
    const t = toqueSemNumero.entry[0].changes[0].value;
    t.contacts = v.contacts;
    t.messages[0] = { ...t.messages[0], from: undefined, from_user_id: "BR.AbC123xyz" };
    await postar(bot, toqueSemNumero);
    expect(Object.fromEntries(new URLSearchParams(netlify.recebidos[0]!.corpo)).whatsapp).toBe("(11) 97777-6666");
  });
});
