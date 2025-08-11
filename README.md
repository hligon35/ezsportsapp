# EZ Sports Netting — Ecommerce Template

This is a lightweight, responsive ecommerce front-end template for a baseball gear store. It includes:

- Modern, mobile-first design with a sticky header and hero
- Category tiles and promotional banners
- Product catalog grid with filter chips
- Working mini-cart (add, increment/decrement, remove) with localStorage persistence
- No build step; pure HTML/CSS/JS

## Files
- `index.html` — page structure and components
- `assets/css/styles.css` — styling and responsive rules
- `assets/js/app.js` — mock products, rendering, and cart logic
- `assets/img/` — placeholder assets (logo). Product images load from Unsplash.

## Run locally
Open `index.html` directly in your browser, or start a simple server to avoid CORS issues with modules.

On Windows PowerShell:

```powershell
# Option 1: Use Python if installed
python -m http.server 8080

# Option 2: Node (if you have npx)
npx serve -l 8080
```

Then visit http://localhost:8080 in your browser and navigate to `EZSports/`.

## Customize
- Replace Unsplash image URLs in `assets/js/app.js` with your product images.
- Add real categories or tags to the `PRODUCTS` list.
- Wire up a backend by replacing `checkout()` with your checkout integration (Stripe, Shopify, etc.).

## License
MIT — use freely for your projects.
