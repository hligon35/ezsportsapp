# Cross‑Browser and Responsive Audit

Overview

We added a lightweight, runtime‑gated compatibility layer to improve rendering on older browsers without affecting modern ones. The site already used modern CSS thoughtfully; these changes provide safe fallbacks and normalize behavior on legacy engines.

What changed

- Feature detection in assets/js/app.js (ensurePerformanceOptimizations):
  - Detects support for: flex gap, aspect-ratio, color-mix, and backdrop-filter.
  - Applies html classes: no-flex-gap, no-aspect-ratio, no-color-mix, no-backdrop-filter.
  - Conditionally loads assets/css/compat.css only when needed.
- New assets/css/compat.css fallbacks:
  - Flex gap shim via margins for common flex rows (row, price-row, color-dots, thumbs, variant-row, netting-subnav, header-actions).
  - Aspect-ratio fallback using intrinsic padding technique for key media containers (cards, product main image, carousel).
  - color-mix fallback for gradient-heavy hero/CTA backgrounds (simple brand→black gradient).
  - :focus-visible fallback to :focus for older engines.
  - Stronger dialog backdrop when backdrop-filter is unavailable.

Supported browsers (target profile)

- Evergreen: Latest Chrome, Edge, Firefox, Safari — native experience (compat.css not loaded).
- Older Safari iOS 14/early 15: Missing flex-gap/aspect-ratio — compat.css loads to restore spacing and media boxes.
- Android WebView/Chrome 80+: OK; compat used only if needed.
- Internet Explorer: Not supported (Stripe, ES features, and modern CSS).

Responsive checks (key pages verified by styles)

- index.html (hero, tiles, banners)
- ez-nets.html and netting category pages (hero, subnav, carousel)
- l-screens.html + subpages (cards with color dots, actions rows)
- product.html (gallery, thumbs, price/actions)
- netting-calculator.html (form grid, gallery)
- checkout.html (buttons, inputs)

Manual test checklist (suggested)

- Safari iOS 14–15 on iPhone 8/SE: header nav open/close, flex rows spacing (chips, price rows), product thumbs, calculator fields.
- Safari iOS latest: verify gradients and focus outlines, carousel arrows/dots.
- iPadOS split view: ensure no horizontal scrolling on hero/footers.
- Firefox desktop: keyboard focus rings on links/buttons; mini-cart dialog open/close.
- Edge Windows: high‑contrast theme and HDR displays — verify hero gradients are readable and text has contrast.

Notes and limitations

- No global autoprefix step is added (no build). If a bundler is introduced later, add autoprefixer to cover vendor prefixes.
- IE is out of scope. If required, a larger JS/CSS polyfill strategy will be needed.
- The compat layer is intentionally minimal and only activates when feature detection fails, keeping modern engines lean.
