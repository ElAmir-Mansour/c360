# Auth hero background assets

The sign-in surface (`/Users/mac/clario360/frontend/src/components/auth/auth-background.tsx`)
renders an animated, brand-tinted SVG network-mesh by default. No image is
required — the SVG is the safe fallback and ships with the app.

To override the SVG with a real photograph, drop the files below into this
folder (`/Users/mac/clario360/frontend/public/auth/`) and ask the layout
integrator to enable the image path by passing `image` to `<AuthBackground />`:

```tsx
<AuthBackground image />
```

## Files to add

| File                    | When it is shown                | Recommended spec                          |
| ----------------------- | ------------------------------- | ----------------------------------------- |
| `hero.jpg`              | Light theme (default)           | 2560×1440, landscape, ≤ 500 KB, sRGB JPEG |
| `hero-dark.jpg`         | Dark theme (`.dark` is present) | Same dimensions; darker, low-key exposure |

Notes:

- File names are **exact** and case-sensitive. The component references
  `/auth/hero.jpg` and `/auth/hero-dark.jpg`.
- The images are served via `next/image` with `fill` + `priority` and
  `object-cover`, so any aspect ratio works but a wide 16:9 source crops best.
- A translucent legibility scrim and the brand gradient wash are layered on top
  automatically, so a fairly busy photo is fine — keep the subject away from the
  right third where the sign-in card sits on desktop.
- If `hero.jpg` (or `hero-dark.jpg`) is missing or fails to load at runtime, the
  component automatically falls back to the SVG mesh — there is no broken-image
  state to worry about.
- Keep total weight modest; these load on the critical sign-in path. Prefer
  optimized/progressive JPEG (or convert to a `.jpg`-named WebP if your pipeline
  supports it) and run them through an optimizer before committing.

## Licensing

Only commit imagery you have the rights to ship (owned, licensed, or
CC0/public-domain). Record the source/license in the commit message.
