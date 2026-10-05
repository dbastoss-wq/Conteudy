export type SabiaMessage = { role: "system" | "user" | "assistant"; content: string };

export type SabiaTurn = {
  text: string;
  chatId?: number | string;
  userId?: number | string;
  history?: SabiaMessage[];
};
