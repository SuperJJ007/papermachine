# @deepseek-ai/dsh-client-ui-layout

English | [中文](README.zh.md)

Shell plugin: three-column AppFrame (drag handles and concession chain) plus the `ctx.layout` panel-geometry service; it registers into the runtime-owned `root` slot and declares `sidebar`, `conversation`, `details`, and `conversation.empty`. The sidebar resize boundary is an invisible hit strip, while the details boundary retains its floating pill; only details shrinks during concession and then auto-closes. A closed sidebar retains a 56px control rail while details closes to zero width. The package also seats the theme presenter: it consumes resolved `ctx.theme` snapshots and projects them onto the document (`html { color-scheme }` for native UA chrome, `body[data-ds-dark-theme]` from the active color scheme, the theme's alias tokens as inline variables on body, and one owned `<meta name="theme-color">` whose content follows the computed body background). Measuring after palette and token application keeps the rendered background as the single color authority; disposing the presenter removes its metadata node with its other global writes.

AppFrame always mounts the conversation and details columns; a connected Session renders through `SessionProvider`, while the details column renders the session-scoped `details` slot for any current Session (blank included) and falls back to `details.files` only on the true welcome page — no current Session at all. The layout store persists the details width/open-closed preference to `localStorage` (`dsh.layout.panels.v1`) across reloads; the sidebar width and the narrow-viewport breakpoint fields (`narrow`, `narrowExpanded`) are declared `transient` and always restart at their `init()` value — the sidebar is navigation chrome, not saved work state, and the narrow fields are live viewport derivations. Opening details defaults the conversation and details columns to equal shares of the width remaining after the sidebar. AppFrame retains the last non-blank Session id across unselected states: returning to the same Session preserves its width, while selecting a different Session closes details before paint. The conversation owner share is empty, while the sidebar owner share contains only `collapsed` and `width`; registrants obtain business data from standard hooks and actions from their own inject faces.

The `/client` exports are the plugin body (`apply`/`inject`), `LayoutController`, and the four owner-share interfaces. AppFrame, the panel store, and the concession solver remain package-internal.

Science follows the application theme preference across the sidebar, conversation, process view and artifact library. AppFrame does not override the document's palette or color scheme for any Session.

## Model Experience

None, as the layout shell manages browser viewing state; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Sidebar geometry is transient; details geometry persists** — reload restores the sidebar default width, while the details open/closed state and dragged width survive it (`dsh.layout.panels.v1`); switching between distinct Session ids still closes details and forgets its dragged width, while unselected surfaces render details at zero width without modifying geometry.
- **Concession-chain auto-close derives a zero width without touching the preferred width** — the panel restores itself when the window widens; consumers must not read the stored details width as the rendered truth.
- **No scroll anchoring during squeeze reflow** — layout changes may move the reader's viewport.
