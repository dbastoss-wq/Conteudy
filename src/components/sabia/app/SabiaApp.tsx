import { useMemo } from "react";
import { ChatPanel } from "./ChatPanel";

export function SabiaApp() {
  const webhook = useMemo(() => {
    if (typeof window === "undefined") return "/api/telegram";
    return `${window.location.origin}/api/telegram`;
  }, []);

  return (
    <div className="app">
      <aside className="side">
        <div className="mark">
          <div className="bird" aria-hidden>✦</div>
          <div>
            <b>Sabiá</b>
            <div><span>português, no site e no Telegram</span></div>
          </div>
        </div>
        <p className="note">
          O mesmo cérebro responde aqui e no @SabiaNewAibot. O Telegram entra por webhook; o site usa a rota de conversa.
        </p>
        <div className="hook">
          <div>Webhook</div>
          <code>{webhook}</code>
        </div>
      </aside>
      <ChatPanel />
    </div>
  );
}
