import { getVercelOidcToken } from "@vercel/oidc";
import type { SabiaMessage, SabiaTurn } from "./types.js";

const DEFAULT_URL = "https://api.x.ai/v1/chat/completions";
const DEFAULT_MODEL = "grok-4";
const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/chat/completions";
const GATEWAY_MODEL = "xai/grok-4.5";
const DEFAULT_PROMPT = "Você é a Sabiá, assistente em português do Brasil. Responda de forma direta, útil e curta o bastante para caber no Telegram.";

// Com SABIA_API_KEY fala direto com a API escolhida (padrão xAI).
// Sem ela, usa o AI Gateway da Vercel autenticado pelo OIDC do próprio deploy.
async function target() {
  const key = process.env.SABIA_API_KEY?.trim();
  if (key) {
    return {
      key,
      url: process.env.SABIA_API_URL?.trim() || DEFAULT_URL,
      model: process.env.SABIA_MODEL?.trim() || DEFAULT_MODEL,
    };
  }
  const oidc = process.env.AI_GATEWAY_API_KEY || (await getVercelOidcToken().catch(() => undefined));
  if (!oidc) throw new Error("Sem SABIA_API_KEY e sem token OIDC da Vercel");
  const model = process.env.SABIA_MODEL?.trim();
  return { key: oidc, url: GATEWAY_URL, model: model?.includes("/") ? model : GATEWAY_MODEL };
}

export async function aiMode() {
  return process.env.SABIA_API_KEY?.trim() ? "chave" : "ai-gateway";
}

export async function askSabia(turn: SabiaTurn): Promise<string> {
  const { key, url, model } = await target();
  const messages: SabiaMessage[] = [
    { role: "system", content: process.env.SABIA_SYSTEM_PROMPT || DEFAULT_PROMPT },
    ...(turn.history ?? []).filter((item) => item.role !== "system").slice(-12),
    { role: "user", content: turn.text },
  ];
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: Number(process.env.SABIA_MAX_OUTPUT_TOKENS || 800),
    }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`Sabiá ${res.status}: ${raw.slice(0, 240)}`);
  const data = JSON.parse(raw) as { choices?: { message?: { content?: string } }[]; reply?: string };
  const reply = data.reply || data.choices?.[0]?.message?.content;
  if (!reply?.trim()) throw new Error("Sabiá devolveu resposta vazia");
  return reply.trim();
}
