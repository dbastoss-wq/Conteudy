import { botToken } from "../src/lib/telegram/token.server.js";

export const config = { maxDuration: 30 };

// Registra o webhook do bot apontando para este deploy.
// Uso: GET /api/setup?key=<TELEGRAM_SETUP_SECRET ou TELEGRAM_WEBHOOK_SECRET>
export default async function handler(req: any, res: any) {
  const token = botToken();
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!token || !secret) {
    res.status(500).json({ ok: false, error: "Defina TELEGRAM_BOT_TOKEN e TELEGRAM_WEBHOOK_SECRET na Vercel" });
    return;
  }
  const setupKey = process.env.TELEGRAM_SETUP_SECRET || secret;
  if (req.query?.key !== setupKey) {
    res.status(401).json({ ok: false });
    return;
  }
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const url = `https://${host}/api/telegram`;
  const body = new URLSearchParams({
    url,
    secret_token: secret,
    allowed_updates: JSON.stringify(["message"]),
    drop_pending_updates: "true",
  });
  const tg = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, { method: "POST", body });
  const me = await fetch(`https://api.telegram.org/bot${token}/getMe`).then((r) => r.json()).catch(() => null);
  const result = await tg.json();
  res.status(200).json({
    ok: Boolean(result?.ok),
    webhook: url,
    setWebhook: result,
    bot: me?.result?.username,
    hint: result?.error_code === 404 ? "Token inválido: copie de novo do @BotFather (/mybots → API Token)" : undefined,
  });
}
