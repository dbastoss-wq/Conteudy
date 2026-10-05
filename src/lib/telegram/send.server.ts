function token() {
  const value = process.env.TELEGRAM_BOT_TOKEN;
  if (!value) throw new Error("TELEGRAM_BOT_TOKEN ausente");
  return value;
}

export async function sendTelegram(chatId: number, text: string, replyTo?: number) {
  let rest = text.trim() || "Não consegui formular uma resposta agora.";
  let first = true;
  while (rest) {
    const chunk = rest.slice(0, 4000);
    rest = rest.slice(4000);
    const res = await fetch(`https://api.telegram.org/bot${token()}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: chunk,
        reply_to_message_id: first ? replyTo : undefined,
        allow_sending_without_reply: true,
      }),
    });
    first = false;
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Telegram ${res.status}: ${body.slice(0, 240)}`);
    }
  }
}
