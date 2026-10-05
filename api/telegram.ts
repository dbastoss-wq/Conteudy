import { handleTelegramUpdate } from "../src/lib/telegram/inbound.server";

export const config = { maxDuration: 60 };

export default async function handler(req: any, res: any) {
  if (req.method === "GET") {
    res.status(200).json({ ok: true, route: "telegram-webhook" });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ ok: false });
    return;
  }
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (expected && req.headers["x-telegram-bot-api-secret-token"] !== expected) {
    res.status(401).json({ ok: false });
    return;
  }
  try {
    const result = await handleTelegramUpdate(req.body ?? {});
    res.status(200).json(result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "erro";
    console.error("telegram", detail);
    const chatId = req.body?.message?.chat?.id ?? req.body?.edited_message?.chat?.id;
    if (chatId) {
      const { sendTelegram } = await import("../src/lib/telegram/send.server");
      await sendTelegram(chatId, "Não consegui responder agora. Tenta de novo.").catch(() => undefined);
    }
    res.status(200).json({ ok: true });
  }
}
