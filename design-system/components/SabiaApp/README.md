# SabiaApp

The full Sabiá page: a 280px sidebar with the mark, a note and the webhook card, beside the conversation column.

- **Use** as the root of the web app. It takes no props.
- **Sidebar:** the `.mark` lockup (✦ on a `moss` tile + `wordmark` + lowercase `caption` tagline), one `.note` paragraph in `muted`, and the `.hook` card pinned to the bottom (`margin-top: auto`) showing the webhook URL in `code`.
- **Telegram mini app:** when the URL hash contains `tgWebApp`, it drops the sidebar and renders only `ChatPanel` inside `.app.mini` (full `100dvh`, `space-14` gutters).
- **Responsive:** below 800px the sidebar stacks on top with a bottom `line` border.
- **Do** keep the sidebar copy to one note. **Don't** add navigation; the app has one screen.

Static rendition of `src/components/sabia/app/SabiaApp.tsx`, styled by the repo's stylesheet.
