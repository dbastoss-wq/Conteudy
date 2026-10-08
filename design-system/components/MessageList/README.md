# MessageList

The scrolling thread of message bubbles, announced politely to screen readers (`aria-live="polite"`).

- **Consumer provides** `messages: ChatMessage[]`, oldest first; each is `{ role: "user" | "sabia", text }`.
- **Person** (`user`): `bubble-user` fill, no border, pushed right (`margin-left: auto`).
- **Sabiá** (`sabia`): `bubble-sabia` fill with a `line` border, on the left.
- Bubbles: `radius-bubble`, 14px × 16px padding, `body` 16/1.5, max `bubble-max` (680px), `white-space: pre-wrap` so the reply's own line breaks show. Gap between bubbles `space-14`.
- **Don't** add avatars, names or timestamps; side and fill already say who spoke.

Static rendition of `src/components/sabia/app/MessageList.tsx`.
