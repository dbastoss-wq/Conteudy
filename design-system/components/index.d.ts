// Sabiá — component types, from src/components/sabia/app/*.tsx (dbastoss-wq/Conteudy@26a0882).
// Documentation only: the components are static renditions here, not a runtime bundle.

/** One message in the thread. `sabia` is the assistant; the API maps it to `assistant`. */
export type ChatMessage = { role: "user" | "sabia"; text: string };

/** The whole page: sidebar + ChatPanel. Inside Telegram (hash contains `tgWebApp`) it renders only ChatPanel in `.app.mini`. Takes no props. */
export interface SabiaAppProps {}
export declare function SabiaApp(props: SabiaAppProps): JSX.Element;

/** The conversation column: top bar with "Conversa" and "Limpar", MessageList, error line, Composer. Owns messages, busy and error state and posts to /api/chat. Takes no props. */
export interface ChatPanelProps {}
export declare function ChatPanel(props: ChatPanelProps): JSX.Element;

/** The scrolling thread of bubbles (`aria-live="polite"`). */
export interface MessageListProps {
  /** Messages in order, oldest first. */
  messages: ChatMessage[];
}
export declare function MessageList(props: MessageListProps): JSX.Element;

/** Textarea + "Enviar" button. Enter sends, Shift+Enter breaks a line; empty or whitespace-only text is ignored. */
export interface ComposerProps {
  /** While true the button is disabled and reads "...". */
  busy: boolean;
  /** Called with the trimmed text; the composer clears itself. */
  onSend: (text: string) => void;
}
export declare function Composer(props: ComposerProps): JSX.Element;
