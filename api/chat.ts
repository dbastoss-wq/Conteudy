import { askSabia } from "../src/lib/sabia/ask.server";
import { assertWithinLimit } from "../src/lib/sabia/limits.server";

export const config = { maxDuration: 60 };

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST" });
    return;
  }
  const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
  const last = [...messages].reverse().find((item) => item?.role === "user" && item?.content);
  if (!last) {
    res.status(400).json({ error: "Mensagem vazia" });
    return;
  }
  try {
    const ip = String(req.headers["x-forwarded-for"] || "web").split(",")[0];
    assertWithinLimit(`web:${ip}`);
    const reply = await askSabia({
      text: String(last.content),
      history: messages.slice(0, -1),
    });
    res.status(200).json({ reply });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "erro";
    res.status(502).json({ error: detail });
  }
}
