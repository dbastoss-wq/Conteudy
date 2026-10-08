# ChatPanel

The conversation column: a top bar titled "Conversa" with a "Limpar" ghost button, the message thread, an error line and the composer.

- **Use** inside `SabiaApp`, or alone in the Telegram mini app. Takes no props; it owns `messages`, `busy` and `error` and posts the history to `/api/chat`.
- **Starts** with one seed message from Sabiá: "Pode mandar a pergunta. Se o bot do Telegram já estiver com o webhook, a mesma resposta sai por lá."
- **Limpar** resets to the seed message and clears the error.
- **Errors** appear as one `.err` line in `danger` between the thread and the composer: the server's message, else "A Sabiá não respondeu." / "Falha ao falar com a Sabiá."
- **Top bar:** `title` in Fraunces 520, `space-18`/`space-22` padding, bottom `line` border. The ghost button is a `radius-pill` with a `line` border and transparent fill.

Static rendition of `src/components/sabia/app/ChatPanel.tsx`.
