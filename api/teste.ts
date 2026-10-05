import { askSabia, aiMode } from "../src/lib/sabia/ask.server.js";

export const config = { maxDuration: 60 };

// Testa a IA sem passar pelo Telegram.
// Uso: GET /api/teste?key=<TELEGRAM_SETUP_SECRET>&q=pergunta
export default async function handler(req: any, res: any) {
  const setupKey = process.env.TELEGRAM_SETUP_SECRET || process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!setupKey || req.query?.key !== setupKey) {
    res.status(401).json({ ok: false });
    return;
  }
  const mode = await aiMode();
  try {
    const reply = await askSabia({ text: String(req.query?.q || "Diga oi em uma frase.") });
    res.status(200).json({ ok: true, mode, reply });
  } catch (error) {
    res.status(200).json({ ok: false, mode, error: error instanceof Error ? error.message : "erro" });
  }
}
