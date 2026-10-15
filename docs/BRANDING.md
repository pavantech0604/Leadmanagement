# Capital Grow visual identity

The supplied transparent PNGs are preserved in `public/branding/`. The bull emblem appears in sidebar navigation and the favicon; the full wordmark and tagline appear on the welcome screen. A reusable `components/brand-logo.tsx` component uses Next.js Image for responsive delivery.

Palette interpreted from the supplied logo:

| Color | Theme hex | Application |
|---|---|---|
| Deep navy | #071E36 | Headings, hero, structural identity |
| Golden yellow | #EDB921 | Growth accents, hero action, focus and highlights |
| Growth green | #28723E | Primary controls, navigation, conversions |
| Soft neutral | #F5F7F5 | Light workspace background |

The raster artwork contains gradients and texture; these are representative UI colors rather than a claim of exact flat logo values. Dark mode uses lighter gold and green accents on navy surfaces. Language charts have separate light/dark tokens for readability. The original artwork uses a white backing in dark mode so the navy bull stays visible.

Theme overrides are isolated in `app/branding.css`. Includes responsive emblem sizing, hover feedback, card accents and reduced-motion support. Application title, footer and lead export filenames now use Capital Grow.
