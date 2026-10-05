export type ChatMessage = { role: "user" | "sabia"; text: string };

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  return (
    <section className="thread" aria-live="polite">
      {messages.map((message, index) => (
        <article key={index} className={`bubble ${message.role}`}>
          {message.text}
        </article>
      ))}
    </section>
  );
}
