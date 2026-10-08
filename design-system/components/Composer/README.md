# Composer

The message box: a growing textarea and the gold "Enviar" button.

- **Consumer provides** `busy` (disables the button and swaps its label for "...") and `onSend(text)` (called with the trimmed text; the box clears itself).
- **Keys:** Enter sends, Shift+Enter inserts a line break. Empty or whitespace-only text is ignored.
- **Textarea:** `field` fill, `line` border, `radius-bubble`, `composer-min` (56px) minimum height, 14px padding, no resize handle, placeholder "Escreve para a Sabiá".
- **Button:** `gold` fill, `on-gold` label in `label` (Outfit 640), `radius-pill`. The only gold control on the screen.
- `space-10` between the two; `space-16` above and `space-28` below, with the thread's 8vw side gutter.

Static rendition of `src/components/sabia/app/Composer.tsx`.
