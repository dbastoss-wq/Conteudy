import { loadConfig } from '../config.js';

export interface CompleteParams {
  system: string;
  user: string;
  /** Peça JSON de volta (ativa json mode na OpenAI). */
  json?: boolean;
  maxTokens?: number;
}

/**
 * Chamada única ao LLM. Adapter que troca entre Anthropic e OpenAI por env.
 * Usado SÓ para interpretar mensagens e redigir textos curtos — nunca decide
 * disponibilidade nem agenda.
 */
export async function complete(params: CompleteParams): Promise<string> {
  const cfg = loadConfig();
  if (!cfg.LLM_API_KEY) {
    throw new Error('LLM_API_KEY ausente.');
  }
  if (cfg.LLM_PROVIDER === 'anthropic') {
    return completeAnthropic(params);
  }
  return completeOpenAI(params);
}

async function completeAnthropic(params: CompleteParams): Promise<string> {
  const cfg = loadConfig();
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': cfg.LLM_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: cfg.LLM_MODEL,
      max_tokens: params.maxTokens ?? 512,
      system: params.system,
      messages: [{ role: 'user', content: params.user }],
    }),
  });
  if (!res.ok) throw new Error(`LLM (anthropic) ${res.status}: ${await res.text().catch(() => '')}`);
  const data = (await res.json()) as { content?: Array<{ text?: string }> };
  return data.content?.[0]?.text ?? '';
}

async function completeOpenAI(params: CompleteParams): Promise<string> {
  const cfg = loadConfig();
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.LLM_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: cfg.LLM_MODEL,
      max_tokens: params.maxTokens ?? 512,
      ...(params.json ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        { role: 'system', content: params.system },
        { role: 'user', content: params.user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`LLM (openai) ${res.status}: ${await res.text().catch(() => '')}`);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? '';
}
