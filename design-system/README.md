Sabiá is an assistant that answers in Portuguese, on the web and on Telegram, from the same brain. The interface is a quiet night forest: deep green-black ground, warm off-white text, one gold accent, a serif with character for the name and a soft geometric sans for everything else. It should feel like a conversation, not a dashboard.

## Content fundamentals

- **Language:** Brazilian Portuguese (`lang="pt-BR"`). Never mix in English UI words.
- **Voice:** informal, direct, second person in the colloquial *tu*-imperative common in speech: "Escreve para a Sabiá", "Pode mandar a pergunta." No exclamation marks, no emoji.
- **Sabiá is feminine:** always "a Sabiá" ("A Sabiá não respondeu.", "Falha ao falar com a Sabiá.").
- **Casing:** sentence case for headings and buttons ("Conversa", "Limpar", "Enviar"); the tagline under the wordmark is all lowercase ("português, no site e no Telegram").
- **Length:** headings and buttons are one word. Notes are one or two plain sentences that say what happens, including the technical part ("O Telegram entra por webhook; o site usa a rota de conversa.").
- **Errors** say who failed, in plain words, in `danger`: "A Sabiá não respondeu." Never blame the person.
- **Busy state:** the send button's label becomes "..." while waiting. No spinners.

## Visual foundations

### Color

One dark theme (`color-scheme: dark`); there is no light theme.

- Ground is `ink`. Recessed inputs and cards are `field`; the mark tile is `moss`. `panel` is reserved for a raised surface.
- Text is `text` on every surface; secondary copy is `muted`. Both clear 8:1 everywhere they are used.
- `gold` is the single accent: the primary button (label in `on-gold`), the ✦ glyph, inline `code`. One gold thing per view.
- The person's bubble is `bubble-user`, right-aligned, no border. Sabiá's bubble is `bubble-sabia` with a `line` border, left-aligned. The difference is position and fill, never color alone.
- `danger` is only for error text. `leaf` is declared but unused; keep it for a secondary green signal before adding a new hue.
- `line` draws every divider and control border. It is low contrast (1.5–1.6:1) by design; pair it with a filled or labelled control so a border is never the only cue.
- The body carries one radial glow: `radial-gradient(900px 420px at 10% -10%, moss 0%, transparent 55%)` over `ink`. No other gradients.

### Type

- `wordmark` (Fraunces 680, 28px) is only ever the word Sabiá. `title` (Fraunces 520, 22px) is the one page heading.
- Everything else is Outfit: `body` 16/1.5 in bubbles and the composer, `label` 640 on the primary button, `note` 14/1.45 and `caption` 13px in `muted`.
- `code` (12px, monospace, `gold`) for URLs and keys, breaking anywhere.
- Both families load from Google Fonts: Fraunces `opsz,wght@9..144,520;9..144,680`, Outfit `wght@380;500;640`. Ask for those weights only.

### Space, shape, layout

- Spacing is a set of literal steps, not a grid: `space-8` `space-10` `space-12` `space-14` `space-16` `space-18` `space-22` `space-28`. Use the step the matching element uses (see each token's note).
- Radii grow with the element: `radius-icon` 8 → `radius-tile` 12 → `radius-card` 14 → `radius-bubble` 16; every button is a `radius-pill`.
- No shadows anywhere. Depth comes from fill (`field` is darker, `bubble-user` lighter) and `line` borders.
- Desktop: a `sidebar-width` (280px) sidebar with the mark, a note and the webhook card pinned to the bottom, then the conversation column. Thread and composer use an `8vw` side gutter.
- Below `breakpoint` (800px) the sidebar stacks on top and gutters drop to `space-16`. Inside Telegram (mini app) the sidebar is hidden and gutters are `space-14`.
- Bubbles never exceed `bubble-max` (680px) and keep the text's own line breaks (`white-space: pre-wrap`).

### States and motion

- Disabled send (while busy) shows "..." in place of the label; nothing else changes.
- No transitions or animation in the source. Don't add them.
- The source sets no focus styles and relies on the browser default ring. Keep it, or replace it with a solid 2px `gold` outline (9.4:1 on `ink`), never with nothing.

## Iconography

- No icon set. The only glyph is ✦ (U+2726) in `gold` on a `moss` tile, standing in for the bird in the sidebar mark.
- The app icon is the Sabiá bird silhouette in `gold` on a `mark-ground` tile with `radius-icon` (Logos group, `sabia-mark.svg`). Use the file; don't redraw it.
- Buttons are words, never icons.
