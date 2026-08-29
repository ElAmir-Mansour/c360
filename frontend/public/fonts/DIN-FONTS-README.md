# DIN Next brand fonts — drop-in slot

The Clario360 / وثيقتك (Watheeq) UI declares **DIN Next** as its leading
typeface. The runtime family stacks are wired, but the licensed webfont files
and their `@font-face` sources are **NOT committed to this repository** for
licensing reasons.

Until the licensed faces are installed, the interface renders in the bundled
fallback faces (Inter for Latin, IBM Plex Sans Arabic for Arabic) with no build
break or blank text. Merely copying files into this folder is not sufficient:
the licensed integration must also restore the `@font-face` declarations in
`src/app/globals.css` described below.

## Licensing note

**The client must supply the licensed DIN Next web fonts.** DIN Next LT Pro and
DIN Next LT Arabic are commercial typefaces (Monotype / Linotype). You must hold
a valid web-font license before adding these files. Do not commit the `.woff2`
files to version control unless the license permits it.

## Exact filenames expected

The `@font-face` declarations in `frontend/src/app/globals.css` reference these
exact paths (served from `/fonts/` at runtime). Provide **`.woff2`** files with
**exactly** these names:

### DIN Next LT Pro (Latin)

| Weight | CSS `font-weight` | Filename                          |
| ------ | ----------------- | --------------------------------- |
| Regular | 400              | `din-next-lt-pro-regular.woff2`   |
| Medium  | 500              | `din-next-lt-pro-medium.woff2`    |
| Bold    | 700              | `din-next-lt-pro-bold.woff2`      |

### DIN Next LT Arabic

| Weight | CSS `font-weight` | Filename                            |
| ------ | ----------------- | ----------------------------------- |
| Regular | 400              | `din-next-lt-arabic-regular.woff2`  |
| Medium  | 500              | `din-next-lt-arabic-medium.woff2`   |
| Bold    | 700              | `din-next-lt-arabic-bold.woff2`     |

All six files go directly in this folder (`frontend/public/fonts/`).

## How the wiring works

- The **`@font-face`** rules are intentionally absent while the licensed files
  are absent, avoiding six predictable 404s on every cold load. Restore one per
  weight in `src/app/globals.css`, with `font-display: swap`, pointing at the
  filenames above when the licensed files are supplied.
- **`--font-sans`** and **`--font-arabic`** are defined on `body` in
  `globals.css` and **lead with the DIN families**, then fall back to
  `var(--font-inter)` / `var(--font-ibm-arabic)` (the next/font Inter and IBM
  Plex Sans Arabic faces exposed in `src/app/layout.tsx`) and finally the system
  stack — so text never disappears.
- **`tailwind.config.ts`** (`fontFamily.sans` / `.display`) and the token source
  **`src/styles/tokens/index.ts`** (`fontFamily.sans` / `.display` / `.arabic`)
  also lead with the literal DIN family names for explicitness.

Because consumers resolve through those vars/stacks, restoring the licensed
`@font-face` sources activates DIN without component-level typography changes.

## Verifying after drop-in

1. Place the six licensed `.woff2` files in this folder.
2. Restore the six matching `@font-face` declarations in `globals.css`.
3. Restart / rebuild the frontend so `/fonts/*.woff2` are served.
4. Load a page and confirm in DevTools → Network that the DIN files load (200),
   and in the Elements → Computed panel that `body` renders in
   `DIN Next LT Pro` (Latin) / `DIN Next LT Arabic` (`ar` pages).
