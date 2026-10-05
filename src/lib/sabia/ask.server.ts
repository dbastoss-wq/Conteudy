import type { SabiaMessage, SabiaTurn } from "./types.js";

const DEFAULT_URL = "https://api.x.ai/v1/chat/completions";
const DEFAULT_MODEL = "grok-4";
const DEFAULT_PROMPT = "Você é a Sabiá, assistente em português do Brasil. Responda de forma direta, útil e curta o bastante para caber no Telegram.";

export async function askSabia(turn: SabiaTurn): Promise<string> {
  const key = process.env.SABIA_API_KEY;
  if (!key) throw new Error("SABIA_API_KEY ausente");
  const url = process.env.SABIA_API_URL || DEFAULT_URL;
  const model = process.env.SABIA_MODEL || DEFAULT_MODEL;
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
