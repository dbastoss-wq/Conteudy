import { askSabia } from "../sabia/ask.server";
import { assertWithinLimit, LimitError } from "../sabia/limits.server";
import { sendTelegram } from "./send.server";

type TelegramMessage = {
  message_id: number;
  text?: string;
  chat: { id: number };
  from?: { id?: number; username?: string; first_name?: string };
};
type TelegramUpdate = { message?: TelegramMessage; edited_message?: TelegramMessage };

export async function handleTelegramUpdate(update: TelegramUpdate) {
  const message = update.message ?? update.edited_message;
  if (!message) return { ok: true, ignored: true };
  const text = message.text?.trim();
  const chatId = message.chat?.id;
  if (!text || chatId == null) return { ok: true, ignored: true };
  if (text.startsWith("/start")) {
    await sendTelegram(chatId, "Oi. Sou a Sabiá. Pode mandar a pergunta.", message.message_id);
    return { ok: true };
  }
  try {
    assertWithinLimit(`tg:${chatId}`);
  } catch (error) {
    if (!(error instanceof LimitError)) throw error;
    await sendTelegram(chatId, error.message, message.message_id);
    return { ok: true, limited: true };
  }
  const reply = await askSabia({ text, chatId, userId: message.from?.id });
  await sendTelegram(chatId, reply, message.message_id);
  return { ok: true };
}
