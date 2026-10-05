import { useState } from "react";

export function Composer({ busy, onSend }: { busy: boolean; onSend: (text: string) => void }) {
  const [text, setText] = useState("");

  function submit() {
    const value = text.trim();
    if (!value || busy) return;
    setText("");
    onSend(value);
  }

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <textarea
        value={text}
        placeholder="Escreve para a Sabiá"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <button className="send" type="submit" disabled={busy}>
        {busy ? "..." : "Enviar"}
      </button>
    </form>
  );
}
