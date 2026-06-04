# Afhverju Abra — Frontend Restyle Spec (v0.4 "pretty")

> Built with the **frontend-design** skill; verified with **react-best-practices** +
> **chrome-devtools** (a11y/LCP). Read this back during implementation — don't trust a
> compacted summary.

## Decisions (LOCKED — 2026-06-04, by user)

| # | Question | Decision |
|---|----------|----------|
| 1 | Design direction | **HYBRID** — sober sokrates-dark base for structure; **Player + Studio lean into verse-tri-color glow + playful motion**; **Editor stays grown-up / tabular**. The verse tri-color (gold/cyan/magenta) lyric theming stays in ALL surfaces — this restyle is about the *chrome around it*. |
| 2 | Tailwind scope | **FULL MIGRATE** — replace the hand-written `styles.css` entirely with Tailwind v4 (`@theme` tokens + component classes/`@apply`). One styling system, all surfaces restyled. |

## Stack

- **Tailwind v4** via `@tailwindcss/vite` (first-party Vite plugin). Config-in-CSS: a single
  entry `src/index.css` with `@import "tailwindcss";` + `@theme { … }`. **Tailwind v4's engine
  IS built on Lightning CSS**, so this HONORS the house "Lightning CSS always" rule, not breaks it.
  Keep `@vitejs/plugin-react-swc`. Biome stays. Remove the old `css.transformer: 'lightningcss'`
  vite option IF it conflicts with the tailwind plugin (test; tailwind owns CSS now).
- **Primitives**: shadcn-style — `class-variance-authority` + `clsx` + `tailwind-merge` (a `cn()`
  helper in `src/lib/cn.ts`). Icons: `lucide-react`. Motion: prefer **CSS keyframes** (in `@theme`/
  base layer); add `motion` (v12, framer-motion successor) ONLY where it clearly earns it
  (take-card entrance, count-in). New deps: `@tailwindcss/vite tailwindcss class-variance-authority
  clsx tailwind-merge lucide-react` (+ maybe `motion`). Fonts via `@fontsource` or a `<link>` —
  Instrument Serif (display) + Inter (body) + a mono (timecode).

## Design tokens — `@theme` (source: sokrates-website MD3 + Abra verse system)

```css
@theme {
  /* surfaces (sokrates-website MD3 dark) */
  --color-surface:        #121416;   /* app ground */
  --color-surface-2:      #1b1e21;   /* cards / raised */
  --color-surface-3:      #24282c;   /* inputs / wells */
  --color-on-surface:     #e2e2e5;   /* primary text */
  --color-on-surface-dim: #c5c7c8;   /* secondary text */
  --color-outline:        #99907c;   /* borders / dividers */
  /* brand */
  --color-primary:        #f2ca50;   /* gold — play btn, highlights (≈ verse-gold #FFD700) */
  --color-tertiary:       #bfcdff;   /* periwinkle accent */
  --color-error:          #ffb4ab;   /* mute / stop / fail */
  /* verse tri-color (the lyric identity — KEEP) : fill + glow */
  --color-verse-gold:     #ffd700;  --color-verse-gold-glow:    #ffb030;  /* lines 1–8  */
  --color-verse-cyan:     #00e0ff;  --color-verse-cyan-glow:    #00c0ff;  /* lines 9–17 */
  --color-verse-magenta:  #ff50ff;  --color-verse-magenta-glow: #e030ff;  /* lines 18–21*/
  /* type */
  --font-display: 'Instrument Serif', Georgia, serif;
  --font-body:    'Inter', system-ui, sans-serif;
  --font-mono:    'JetBrains Mono', ui-monospace, monospace;
  /* radii */
  --radius:    0.25rem; --radius-lg: 0.5rem; --radius-xl: 0.75rem; --radius-2xl: 1rem;
}
@keyframes folio-in   { from { opacity:0; transform:translateY(8px) } to { opacity:1; transform:none } }
@keyframes shimmer    { 100% { background-position:-200% 0 } }
@keyframes vu-pulse   { 0%,100% { opacity:.55 } 50% { opacity:1 } }   /* armed/recording dot */
@keyframes word-pop   { 0% { transform:scale(1) } 40% { transform:scale(1.28) } 100% { transform:scale(1) } }
```

Verse-theme mapping stays driven by the API `Theme` model (gold L0–7 / cyan L8–16 / magenta L17+);
the DOM teleprompter already consumes `line.theme.fill`/`.glow` — keep that, just swap the hard-coded
hexes for the verse `@theme` tokens via inline `style` or CSS vars.

## Primitives to build (`src/components/ui/`)

| File | Pattern | Notes |
|------|---------|-------|
| `lib/cn.ts` | `clsx`+`tailwind-merge` | the `cn()` helper |
| `ui/Button.tsx` | CVA | variants: primary(gold)/ghost/outline/danger; sizes sm/md/lg/icon. Steal shape from deep-search `components/ui/button.tsx` |
| `ui/IconButton.tsx` | CVA | round transport buttons (play/pause/record/stop) — lucide icons |
| `ui/Card.tsx` | compound | surface-2, radius-xl, subtle outline; for take cards / panels |
| `ui/Badge.tsx` | CVA | status: done(green)/mixing(gold-pulse)/failed(error)/uploaded(dim) |
| `ui/Slider.tsx` | range | themed seek + nudge; gold fill, draggable thumb, mono time labels |
| `ui/VuMeter.tsx` | — | gradient bar (green→gold→error) reading `getLevel()`, glow when hot |
| `ui/NavPill.tsx` | — | top-bar nav (Player/Editor/Sing) active=gold underline/fill |

## Surface restyle plan (Hybrid)

- **Layout** — dark topbar (`surface`), brand lockup (`🐱 Afhverju Abra` display font) + `.kicker`
  "the mathematician's melodies" (mono, tracked, dim), NavPills. Content max-width, generous padding.
- **Player (joyful)** — video in a `rounded-2xl` frame with a faint verse-tinted ring/glow; custom
  transport bar (gold play IconButton + `Slider` seek + mono `0:16 / 2:47`); teleprompter in display
  font, current line big with verse-theme glow + `word-pop` on the sung word; SlotRibbon → sleek
  segmented bar, each segment tinted by its verse theme, active segment lifted.
- **Studio (joyful)** — big round **record** IconButton that `vu-pulse`-glows when armed; `VuMeter`;
  count-in number as a large centered overlay; headphone warning as a styled banner; TakeList → `Card`
  grid with `Badge` status, gold download `Button`, inline `Slider` for nudge-and-re-mix.
- **Editor (sober)** — `surface-2` table, monospace numeric cells, `surface-3` inputs with gold focus
  ring, sticky bottom action bar (Save/Reset/Re-render Buttons), drift/total chips.

## Migration steps

1. Deps: `bun add @tailwindcss/vite tailwindcss class-variance-authority clsx tailwind-merge lucide-react` (+ fonts; + `motion` if used).
2. `vite.config.ts`: add `tailwindcss()` plugin; reconcile the existing `css.transformer:'lightningcss'` (let tailwind own CSS).
3. `src/index.css`: `@import "tailwindcss"` + the `@theme` block above + keyframes + a small `@layer base` (bg-surface, text-on-surface, font-body). Import it in `main.tsx`.
4. `lib/cn.ts` + the `ui/` primitives.
5. Restyle surface-by-surface (Layout → Player → Studio → Editor), replacing `styles.css` classes with Tailwind utilities/primitives. Keep all behavior/hooks identical — this is a SKIN, not a logic change.
6. Delete `src/styles.css` once nothing references it.
7. Gates: `bun run typecheck` + `bun run lint` + `bun run build` green. Then **chrome-devtools a11y + LCP audit** and a **react-best-practices** pass over the TSX. Visual check at http://localhost:4321.

## Constraints / traps

- Verse tri-color MUST remain the lyric identity (don't flatten it to a single accent).
- Keep the player's NO-overlay-on-video rule (burned karaoke already in the render; DOM teleprompter
  sits BELOW the video — don't double it).
- Song-agnostic still holds (no hard-coded song title in chrome; nav/labels generic).
- Dev ports: backend **:5678**, frontend **:4321** (already moved).
- This is a SKIN over working, verified behavior (player/editor/studio + the takes pipeline). Do not
  regress the type-safe hook wiring or the recording flow.

## Component source paths (to mine during impl)

- shadcn primitives: `~/projects/.../deep-search/frontend/src/components/ui/{button,card,badge,input,tabs,select,scroll-area}.tsx`
- Oatmeal element primitives + 100+ icons: `~/projects/Oatmeal/hakonfreyr/src/components/{elements,icons}/`
- sokrates `@theme` + keyframes + `.kicker/.folio/.deck`: `~/projects/sokrates-website/src/app/globals.css`
- mist oklch palette (alt): `~/projects/oatmeal-mist-instrument/tailwind.css`
