# Design System

How to keep the tablo-web UI visually consistent: where the theme lives, which tokens are customized, and which color values are still scattered in components.

## Three Key Takeaways

- The theme is deliberately minimal: Tailwind CSS with only a custom `surface` color scale, an `accent` color, and the Inter font family. Everything else (spacing, typography scale, breakpoints) is the Tailwind default.
- There is no separate tokens file. `frontend/tailwind.config.js` is the single source for colors, and `frontend/src/index.css` holds the global base styles plus two custom utilities (`.glass`, `.channel-glow`).
- Prefer theme utilities (`bg-surface`, `bg-surface-raised`, `bg-accent`, `text-white/60`) over new hex values. The only hardcoded colors left in components are the brand gradient and the player scrim, listed below.

## Stack

| Layer | Technology |
|---|---|
| UI library | React 19, all custom components (no component library) |
| Styling | Tailwind CSS 3.4 utility classes, minimal custom theme extend |
| Icons | Inline SVG (no icon library) |
| Font | Inter (Google Fonts, weights 300-800) |
| Baseline | Vite 8 + TypeScript, Tailwind preflight |

## Where the theme lives

| Item | Location |
|---|---|
| Theme definition (colors, font) | `frontend/tailwind.config.js` (`theme.extend.colors`, `theme.extend.fontFamily`) |
| Global base styles (background, text, scrollbar) | `frontend/src/index.css`, `@layer base` |
| Custom utilities (`.glass`, `.channel-glow`) | `frontend/src/index.css`, `@layer utilities` |
| Font loading | `frontend/src/index.css`, first line (`@import` Google Fonts Inter) |
| App shell styling | `frontend/src/App.css` (Vite scaffold leftovers, mostly unused) |

## Theme tokens (what's customized)

| Token type | Customized? | Notes |
|---|---|---|
| Accent (primary) | Yes | `accent.DEFAULT` `#5b8af5`, `accent.glow` `rgba(91,138,245,0.25)` |
| Surfaces | Yes | `surface.DEFAULT` `#0d0d14`, `surface.raised` `#13131e`, `surface.overlay` `#1a1a28`, `surface.border` `rgba(255,255,255,0.08)` |
| Typography scale | No | Tailwind default (`text-sm`, `text-lg`, etc.) |
| Font family | Yes | `fontFamily.sans` = Inter, system-ui, sans-serif |
| Spacing | No | Tailwind default scale |
| Breakpoints | No | Tailwind default |
| Semantic colors (success/error) | No | Not defined; use `white` with opacity utilities |

## Where feature colors live

There is no single source of truth for these; they are inline styles in components.

| Use case | Location | Type |
|---|---|---|
| Brand gradient (buttons, logo block) | `frontend/src/components/ChannelGrid.tsx` (line 168), `frontend/src/components/LoginScreen.tsx` (lines 35, 87) | Inline `style={{ background: "linear-gradient(135deg, #5b8af5, #7c5bf5)" }}` |
| Player top/bottom scrim | `frontend/src/components/VideoPlayer.tsx` (line 139) | Inline `linear-gradient(to bottom, rgba(0,0,0,0.7) ...)` |
| Surface/accent utilities | `frontend/tailwind.config.js` | Tailwind tokens |
| Glass panels, focus glow | `frontend/src/index.css` (`.glass`, `.channel-glow`) | Custom CSS utilities |

## Decision guide: styling a new component

| If you are... | Prefer... |
|---|---|
| Coloring a brand element or primary action | `bg-accent` / `text-accent`, or the brand gradient (copy the existing inline gradient, do not invent new hex values) |
| Setting a page or panel background | `bg-surface`, `bg-surface-raised` for raised cards, `bg-surface-overlay` for modals/overlays |
| Drawing a border | `border-surface-border` (or `border-white/10`) |
| Writing secondary or tertiary text | `text-white/60`, `text-white/40` (opacity utilities on white) |
| Building a translucent panel | `.glass` utility from `index.css` |
| Highlighting a selected channel | `.channel-glow` utility or `bg-accent-glow` |
| Choosing spacing | Tailwind default scale (`gap-6`, `p-4`, etc.) |
| Setting type size/weight | Tailwind default scale (`text-sm font-semibold`, etc.); the font is always Inter |

## Quick reference: theme usage in code

```tsx
// surfaces and accent
<div className="bg-surface-raised border border-surface-border rounded-xl">
  <span className="text-white/60">Secondary text</span>
  <button className="bg-accent text-white">Play</button>
</div>

// glass panel + glow
<div className="glass channel-glow rounded-lg"> ... </div>
```

- Spacing: default Tailwind scale only; no custom spacing tokens exist.
- Typography: default Tailwind scale; do not add font sizes to the theme.
- Dynamic layout values (guide block positions, progress bars) use inline `style` props; that is the established pattern.

## FAQ

| Question | Answer |
|---|---|
| Where is the theme defined? | `frontend/tailwind.config.js`, `theme.extend`. |
| Is there a tokens file? | No. The Tailwind config is the only color source; the brand gradient and player scrim are still inline in components. |
| What font does the app use? | Inter, loaded via Google Fonts `@import` in `frontend/src/index.css`, wired through `fontFamily.sans`. |
| Where do the brand gradient colors come from? | `#5b8af5` is `accent.DEFAULT`; `#7c5bf5` appears only in the inline gradients in `ChannelGrid.tsx` and `LoginScreen.tsx`. |
| Where is the player overlay color? | Inline `linear-gradient` in `frontend/src/components/VideoPlayer.tsx` (line 139). |
| Are there success/error colors? | No semantic palette; components use `white` opacity utilities and the accent color. |

## Related

- [CONTRIBUTING.md](../CONTRIBUTING.md) (Styling section)
- [System design: frontend UI](system-design/06-frontend-ui.md)
