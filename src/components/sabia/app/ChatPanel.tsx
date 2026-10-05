import { useState } from "react";
import { Composer } from "./Composer";
import { MessageList, type ChatMessage } from "./MessageList";

const seed: ChatMessage[] = [
  {
    role: "sabia",
    text: "Pode mandar a pergunta. Se o bot do Telegram já estiver com o webhook, a mesma resposta sai por lá.",
  },
];

export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>(seed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send(text: string) {
    const next = [...messages, { role: "user" as const, text }];
    setMessages(next);
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: next.map((item) => ({
            role: item.role === "sabia" ? "assistant" : "user",
            content: item.text,
          })),
        }),
      });
      const data = (await res.json()) as { reply?: string; error?: string };
      if (!res.ok || !data.reply) throw new Error(data.error || "A Sabiá não respondeu.");
      setMessages([...next, { role: "sabia", text: data.reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao falar com a Sabiá.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="main">
      <header className="top">
        <h1>Conversa</h1>
        <button className="ghost" type="button" onClick={() => { setMessages(seed); setError(""); }}>
          Limpar
        </button>
      </header>
      <MessageList messages={messages} />
      {error ? <p className="err">{error}</p> : null}
      <Composer busy={busy} onSend={send} />
    </main>
  );
}
