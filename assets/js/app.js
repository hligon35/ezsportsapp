// EZ Sports Netting — tiny storefront demo (no backend)
// Lightweight state + rendering so you can drop this in and it just works.

// During local development, ensure any previously-registered Service Worker is disabled to avoid live-reload loops
try {
  if ('serviceWorker' in navigator) {
    const isProd = (location.protocol === 'https:') && !/^(localhost|127\.0\.0\.1)$/i.test(location.hostname);
    if (!isProd) {
      navigator.serviceWorker.getRegistrations()
        .then(regs => regs.forEach(r => r.unregister()))
        .catch(() => {});
      if (window.caches && caches.keys) {
        caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).catch(() => {});
      }
    }
  }
} catch {}

const currency = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });

// Featured products cache (homepage only): random until enough analytics, then popularity-based
let FEATURED = [];

// Dynamic products loaded from API (fallback to empty). Each product object expected shape:
// { id, name, description, category, price, image, stripe? }
let PRODUCTS = [];

// Basic description sanitizer to remove scripting, styles, boilerplate clutter and collapse whitespace.
function sanitizeDescription(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let txt = raw;
  // Remove script/style tags and their content
  txt = txt.replace(/<script[\s\S]*?<\/script>/gi, ' ') // scripts
           .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  // Strip HTML tags
  txt = txt.replace(/<[^>]+>/g, ' ');
  // Decode very common entities manually (avoid DOMParser dependency for robustness if blocked by CSP)
  const entities = { '&nbsp;':' ', '&amp;':'&', '&lt;':'<', '&gt;':'>', '&quot;':'"', '&#39;':'\'' };
  txt = txt.replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (m)=> entities[m] || ' ');
  // Split into lines, prune obvious boilerplate / navigation / marketing footer junk
  const boilerplatePatterns = [
    /©/i,
    /all rights reserved/i,
    /privacy policy/i,
    /terms of (service|use)/i,
    /subscribe/i,
    /follow us/i,
    /track your order/i,
    /customer service/i,
    /returns &? exchanges/i,
    /shipping/i,
    /warranty/i,
    /newsletter/i,
    /javascript required/i,
    /var\s+\w+\s*=|function\s*\(/i,
    /add to cart/i
  ];
  let lines = txt.split(/\r?\n|\u2028|\u2029/).map(l=>l.trim()).filter(l=>l);
  lines = lines.filter(l => {
    if (l.length < 2) return false;
    if (l.length > 600) return false; // extremely long (likely concatenated junk)
    return !boilerplatePatterns.some(re => re.test(l));
  });
  // Remove duplicate consecutive lines
  const deduped = [];
  for (const l of lines) {
    if (deduped[deduped.length-1] === l) continue;
    deduped.push(l);
  }
  lines = deduped;
  // Attempt to extract feature-like bullet lines (retain for features array if not already present elsewhere)
  const featureLike = [];
  lines = lines.filter(l => {
    if (/^[-*•]\s+/.test(l) || /^\d+\./.test(l)) { featureLike.push(l.replace(/^[-*•]\s+/, '').replace(/^\d+\.\s*/, '')); return false; }
    return true;
  });
  // Merge back cleaned description
  txt = lines.join(' ');
  // Collapse multiple spaces
  txt = txt.replace(/\s{2,}/g, ' ').trim();
  // Truncate to reasonable length for dialog readability
  const MAX_LEN = 800;
  if (txt.length > MAX_LEN) txt = txt.slice(0, MAX_LEN) + '…';
  return txt;
}
async function fetchProducts() {
  try {
    // Attempt multiple API bases so that when developing with Live Server (port 5500)
    // and the backend on 4242 we still succeed. First try relative (same origin),
    // then localhost variants. Stop at first success with >0 products.
    const bases = [ '', 'http://127.0.0.1:4242', 'http://localhost:4242' ];
    let data = [];
    let lastErr = null;
    for (const base of bases) {
      try {
        const url = base + '/api/products?limit=100';
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
        const json = await res.json();
        if (Array.isArray(json) && json.length) {
          data = json;
          window.__API_BASE = base; // expose for other calls (logout, etc.)
          break;
        } else {
          // keep iterating; remember empty as soft failure
          lastErr = new Error('Empty dataset from ' + (base || 'current origin'));
        }
      } catch (e) { lastErr = e; }
    }
    if (!Array.isArray(data)) data = [];
    if (!data.length && lastErr) throw lastErr;
    // Normalize to UI shape
    const mapCategory = (raw) => {
      const c = String(raw || '').toLowerCase();
      // Direct matches first
      if (['bats','gloves','netting','helmets'].includes(c)) return c;
      // Heuristic mapping
      if (/bat/.test(c)) return 'bats';
      if (/glove|mitt/.test(c)) return 'gloves';
      if (/screen|net|cage|field|facility/.test(c)) return 'netting';
      if (/helm|protect/.test(c)) return 'helmets';
      return 'bats'; // fallback bucket for now
    };
    PRODUCTS = data.map(p => {
      const normCat = mapCategory(p.category || p.department || p.type || '');
      // Salvage bad name cases like literal 'div' by deriving from id slug
      let rawName = p.name || p.title || p.id || '';
      if (/^div$/i.test(rawName) && p.id) {
        rawName = p.id
          .replace(/[-_]+/g, ' ')
          .replace(/\b([a-z])/g, m => m.toUpperCase())
          .slice(0, 120);
      }
      const cleanedDesc = sanitizeDescription(p.description || '');
      return {
        id: p.id,
        title: rawName,
        price: typeof p.price === 'number' ? p.price : Number(p.price) || 0,
        category: normCat,
        img: p.image || 'assets/EZSportslogo.png',
        images: Array.isArray(p.images) ? p.images.filter(x=>typeof x==='string' && x.trim()).slice(0,8) : (p.image ? [p.image] : []),
        stripe: p.stripe || null,
        stock: p.stock,
        createdAt: p.createdAt || null,
        description: cleanedDesc,
        features: Array.isArray(p.features) ? p.features.slice(0, 25) : []
      };
    });
    // Only filter zero-priced items now; salvaged names retained
    const before = PRODUCTS.length;
    PRODUCTS = PRODUCTS.filter(p => p.price > 0);
    const removed = before - PRODUCTS.length;
    // Expose quick debug counts in development
    if (removed > 0 && !window.__catalogDebugShown) {
      window.__catalogDebugShown = true;
      const badge = document.createElement('div');
      badge.style.cssText = 'position:fixed;bottom:8px;right:8px;background:#112;padding:6px 10px;font:12px/1.2 monospace;color:#8f8;border-radius:4px;z-index:9999;opacity:0.9';
      badge.textContent = `Products loaded: ${PRODUCTS.length} (filtered out ${removed} zero-price)`;
      document.body.appendChild(badge);
      setTimeout(()=>badge.remove(), 8000);
    }
    // Optional: sort newest first if timestamps present; fallback to title
    PRODUCTS.sort((a, b) => {
      if (a.createdAt && b.createdAt) return (new Date(b.createdAt)) - (new Date(a.createdAt));
      return a.title.localeCompare(b.title);
    });
    // Notify listeners that products are loaded
    try { window.dispatchEvent(new CustomEvent('products:loaded', { detail: { count: PRODUCTS.length } })); } catch {}
  } catch (e) {
    console.warn('Product fetch failed, leaving PRODUCTS empty:', e.message);
    PRODUCTS = [];
  }
}
// Augment PRODUCTS with locally built L-Screens catalog (screens-catalog.json) if present.
(async function mergeLocalScreens(){
  try {
    // Wait a tick for initial fetch to complete
    await new Promise(r=>setTimeout(r,300));
    const res = await fetch('assets/info/prodInfo/screens-catalog.json', { cache: 'no-cache' });
    if (!res.ok) return;
    const local = await res.json();
    if (!Array.isArray(local) || !local.length) return;
    const existingIds = new Set(PRODUCTS.map(p=>p.id));
    let added = 0;
    local.forEach(p => {
      if (!existingIds.has(p.id)) { PRODUCTS.push({
        id: p.id,
        title: p.title || p.name,
        price: p.price || 0,
        category: 'l-screens',
        img: p.image || p.img || 'assets/EZSportslogo.png',
        images: Array.isArray(p.images) ? p.images : (p.image ? [p.image] : []),
        description: sanitizeDescription(p.description || ''),
        features: Array.isArray(p.features) ? p.features.slice(0,25) : []
      }); added++; }
    });
    if (added) {
      PRODUCTS.sort((a,b)=> a.title.localeCompare(b.title));
      try { window.dispatchEvent(new CustomEvent('products:loaded', { detail: { count: PRODUCTS.length, addedScreens: added } })); } catch {}
    }
  } catch(e) { /* silent */ }
})();

// Augment PRODUCTS with locally built Gloves catalog (gloves-catalog.json) if present.
(async function mergeLocalGloves(){
  try {
    await new Promise(r=>setTimeout(r,400)); // slight delay after screens merge
    const res = await fetch('assets/info/prodInfo/gloves-catalog.json', { cache: 'no-cache' });
    if (!res.ok) return;
    const local = await res.json();
    if (!Array.isArray(local) || !local.length) return;
    const existingIds = new Set(PRODUCTS.map(p=>p.id));
    let added = 0;
    local.forEach(p => {
      if (!existingIds.has(p.id)) {
        PRODUCTS.push({
          id: p.id,
          title: p.title || p.name,
          price: p.price || 0,
          category: 'gloves',
          img: p.image || p.img || 'assets/EZSportslogo.png',
          images: Array.isArray(p.images) ? p.images : (p.image ? [p.image] : []),
          description: sanitizeDescription(p.description || ''),
          features: Array.isArray(p.features) ? p.features.slice(0,25) : []
        });
        added++;
      }
    });
    if (added) {
      PRODUCTS.sort((a,b)=> a.title.localeCompare(b.title));
      try { window.dispatchEvent(new CustomEvent('products:loaded', { detail: { count: PRODUCTS.length, addedGloves: added } })); } catch {}
    }
  } catch(e) { /* silent */ }
})();

// Lightweight analytics dispatcher (fallback logs) – can later POST to /api/analytics/event
window.trackEvent = function(eventName, payload) {
  try {
    const body = { event: eventName, payload, ts: Date.now() };
    console.debug('[analytics]', eventName, payload);
    // Local popularity counters (will inform FEATURED selection later)
    const raw = localStorage.getItem('analyticsCounters');
    const counters = raw ? JSON.parse(raw) : { view_item: {}, add_to_cart: {} };
    if (eventName === 'view_item' && payload?.id) {
      counters.view_item[payload.id] = (counters.view_item[payload.id] || 0) + 1;
    } else if (eventName === 'add_to_cart' && (payload?.id || typeof payload === 'string')) {
      const id = payload.id || payload; counters.add_to_cart[id] = (counters.add_to_cart[id] || 0) + 1;
    }
    localStorage.setItem('analyticsCounters', JSON.stringify(counters));
  } catch {}
};

function computeFeatured(products) {
  if (!Array.isArray(products) || products.length === 0) return [];
  // Pull counters
  let counters = { view_item: {}, add_to_cart: {} };
  try { counters = JSON.parse(localStorage.getItem('analyticsCounters')) || counters; } catch {}
  const totalEvents = Object.values(counters.view_item).reduce((a,b)=>a+b,0) + Object.values(counters.add_to_cart).reduce((a,b)=>a+b,0);
  const TARGET = 12;
  if (totalEvents < 30) { // Not enough signal yet → random unique selection
    const shuffled = products.slice().sort(()=>Math.random()-0.5);
    return shuffled.slice(0, Math.min(TARGET, shuffled.length));
  }
  // Popularity score: add_to_cart * 3 + view_item
  const score = (id) => (counters.add_to_cart[id]||0)*3 + (counters.view_item[id]||0);
  return products.slice().sort((a,b)=> score(b.id) - score(a.id)).slice(0, Math.min(TARGET, products.length));
}

const Store = {
  state: {
    filter: 'all',
    cart: JSON.parse(localStorage.getItem('cart') || '[]'),
    user: null,
  },

  // Expose a way to retrieve the current products list (admin-managed or defaults)
  getProducts() {
    // Previously this called a removed helper `getProducts()` which caused a ReferenceError
    // and stopped script execution before products could render. Now we simply return the
    // in‑memory PRODUCTS array populated by fetchProducts().
    return PRODUCTS;
  },

  keyFor(item) {
    const size = (item.size || '').trim() || '-';
    const color = (item.color || '').trim() || '-';
    return `${item.id}__${size}__${color}`;
  },

  init() {
    // Load current user
    try {
      this.state.user = JSON.parse(localStorage.getItem('currentUser') || 'null');
    } catch {
      this.state.user = null;
    }

    this.ui = {
      grid: document.getElementById('product-grid'),
      count: document.getElementById('cart-count'),
      items: document.getElementById('cart-items'),
      subtotal: document.getElementById('cart-subtotal'),
      dialog: document.getElementById('mini-cart'),
    };

    // Ensure layout and nav
  this.ensureHeaderLayout();
  this.ensureCoreNav();
    this.ensureBreadcrumbs();
    this.updateNavigation();
  this.ensureNettingSubnav();
  this.ensureNettingCarousel();
  this.ensureUniformFooter();
  this.ensureExpertCTA();
  this.ensureQuoteButtons();
  this.ensureBrandLogos();
  this.ensureFooterNettingLink();
  this.ensureSkipLink();
  this.ensureSEO();
  this.ensurePerformanceOptimizations();
  this.ensureServiceWorkerRegistered();
  // Render page-specific product grids from external prodList.json if present
  this.ensurePageProductGrid();

    // Runtime responsive enforcement (in case stale CSS served from cache briefly)
    this.enforceResponsiveBehaviors();

    // Load products from API then render
    fetchProducts().then(() => {
      // Homepage: build FEATURED set and hide category chips if present
      const page = (location.pathname.split('/').pop()||'').toLowerCase();
      if (page === 'index.html' || page === '' ) {
        FEATURED = computeFeatured(PRODUCTS);
        const chipBar = document.querySelector('.catalog .filters');
        if (chipBar) chipBar.style.display = 'none';
      }
      if (this.ui.grid) this.renderProducts();
      if (this.ui.grid && PRODUCTS.length === 0) {
        const msg = document.createElement('div');
        msg.className = 'alert alert-warn';
        msg.style.cssText = 'background:#331;padding:12px 16px;border:1px solid #663;color:#ffc;border-radius:6px;margin:12px 0;font:14px/1.4 system-ui, sans-serif;';
        msg.innerHTML = `
          <strong>No live products loaded.</strong><br/>
          The backend API did not return any products. This usually means the Node server is not running or the dataset has not been synced.<br/>
          <em>Next steps:</em>
          <ol style="margin:6px 0 0 18px;padding:0;">
            <li>Start the server (e.g. <code>npm run start</code> or <code>node server/index.js</code>).</li>
            <li>Run the product sync script if needed (e.g. <code>node server/scripts/sync-products.js</code>).</li>
            <li>Click Retry below once the server is up.</li>
          </ol>
          <button type="button" style="margin-top:8px" class="btn btn-primary" id="retry-products">Retry Load</button>
        `;
        this.ui.grid.parentNode.insertBefore(msg, this.ui.grid);
        const retry = msg.querySelector('#retry-products');
        retry?.addEventListener('click', async () => {
          retry.disabled = true; retry.textContent = 'Retrying…';
          await fetchProducts();
          this.renderProducts();
          if (PRODUCTS.length) msg.remove(); else { retry.disabled = false; retry.textContent = 'Retry Load'; }
        });
      }
    });

    // Mobile nav toggle
    const toggle = document.querySelector('.menu-toggle');
    const nav = document.getElementById('primary-nav') || document.querySelector('nav.quick-links');
    if (toggle && nav) {
      toggle.addEventListener('click', () => {
        const open = nav.classList.toggle('is-open');
        document.body.classList.toggle('nav-open', open);
        toggle.setAttribute('aria-expanded', String(open));
      });
      // Close nav when a link is chosen
      nav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
        if (nav.classList.contains('is-open')) {
          nav.classList.remove('is-open');
          document.body.classList.remove('nav-open');
          toggle.setAttribute('aria-expanded', 'false');
        }
      }));
      // Close when clicking outside (mobile overlay)
      document.addEventListener('click', (e) => {
        if (!nav.classList.contains('is-open')) return;
        if (e.target === nav || nav.contains(e.target) || e.target === toggle || toggle.contains(e.target)) return;
        nav.classList.remove('is-open');
        document.body.classList.remove('nav-open');
        toggle.setAttribute('aria-expanded','false');
      });
    }

    // Render initial views
    // initial render will happen after fetch; if fetch stalls, show spinner
    if (this.ui.grid) this.ui.grid.innerHTML = '<p class="text-muted">Loading products…</p>';
    this.renderCart();

    // Chips
    document.querySelectorAll('.chip').forEach(ch => ch.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach(x => x.classList.remove('is-active'));
      ch.classList.add('is-active');
      this.state.filter = ch.dataset.chip;
      this.renderProducts();
    }));

    // Category tiles
    document.querySelectorAll('.tile').forEach(tile => tile.addEventListener('click', () => {
      const c = tile.dataset.filter; if (!c) return;
      this.filter(c);
    }));

    // Footer year
    const y = document.getElementById('year');
    if (y) y.textContent = new Date().getFullYear();

    // Reveal header/nav only after everything is standardized
    document.body.classList.add('nav-ready');
  },

  // Build or normalize a canonical footer structure across all pages
  ensureUniformFooter() {
    try {
      let footer = document.querySelector('footer.site-footer');
      if (!footer) {
        footer = document.createElement('footer');
        footer.className = 'site-footer';
        document.body.appendChild(footer);
      }
      // Canonical footer markup
      const html = `
        <div class="container footer-grid">
          <div class="footer-brand-block">
            <img src="assets/EZSportslogo.png" height="36" alt="EZ Sports Netting logo"/>
            <strong>EZ Sports Netting</strong>
            <p>Better baseball through better gear.</p>
            <div class="socials" aria-label="social links">
              <a href="https://www.facebook.com/Ezsportsnetting/" aria-label="Facebook" target="_blank" rel="noopener"><img src="assets/img/facebook.png" alt="Facebook"/></a>
              <a href="#" aria-label="Instagram" target="_blank" rel="noopener"><img src="assets/img/instagram.png" alt="Instagram"/></a>
            </div>
          </div>
          <div>
            <h4>Shop</h4>
            <a href="ez-nets.html">EZ Nets</a><br/>
            <a href="l-screens.html">L-Screens</a><br/>
            <a href="accessories.html">Accessories</a>
          </div>
          <div>
            <h4>Company</h4>
            <a href="about.html">About</a><br/>
            <a href="contactus.html">Contact Us</a>
          </div>
          <div class="subscribe">
            <h4>Get deals in your inbox</h4>
            <div class="row">
              <input type="email" placeholder="you@email.com" aria-label="Email address"/>
              <button class="btn btn-primary" type="button">Subscribe</button>
            </div>
          </div>
        </div>
        <div class="subfooter container">&copy; <span id="year"></span> EZ Sports Netting. All rights reserved.</div>`;
      // Replace footer content only if different to avoid layout thrash
      if (footer.innerHTML.trim() !== html.trim()) {
        footer.innerHTML = html;
      }
      // Ensure current year
      const y = footer.querySelector('#year');
      if (y) y.textContent = new Date().getFullYear();
    } catch {}
  },

  // Accessibility: ensure a skip link exists for keyboard users
  ensureSkipLink() {
    try {
      if (document.querySelector('a.skip')) return;
      const a = document.createElement('a');
      a.className = 'skip';
      a.href = '#main';
      a.textContent = 'Skip to content';
      // Insert as the first child of body
      document.body.insertAdjacentElement('afterbegin', a);
    } catch {}
  },

  // SEO: canonical/robots/OG/Twitter and JSON-LD (Organization + Breadcrumbs)
  ensureSEO() {
    try {
      const head = document.head;
      // Canonical
      if (!head.querySelector('link[rel="canonical"]')) {
        const link = document.createElement('link');
        link.rel = 'canonical';
        const base = location.origin || (location.protocol + '//' + location.host);
        link.href = base + location.pathname;
        head.appendChild(link);
      }
      // Robots
      if (!head.querySelector('meta[name="robots"]')) {
        const m = document.createElement('meta');
        m.name = 'robots';
        m.content = 'index,follow';
        head.appendChild(m);
      }
      // OG/Twitter fallback
      const title = document.title || 'EZ Sports Netting';
      const descEl = head.querySelector('meta[name="description"]');
      const desc = (descEl && descEl.getAttribute('content')) || 'Shop premium baseball nets, bats, gloves, helmets & training gear.';
      const url = (head.querySelector('link[rel="canonical"]')?.getAttribute('href')) || location.href;
  const defaultImage = (location.origin || '') + '/assets/EZSportslogo.png';
      const og = {
        'og:site_name': 'EZ Sports Netting',
        'og:type': 'website',
        'og:title': title,
        'og:description': desc,
        'og:url': url,
        'og:image': defaultImage
      };
      Object.entries(og).forEach(([p, v]) => {
        if (!head.querySelector(`meta[property="${p}"]`)) {
          const m = document.createElement('meta');
          m.setAttribute('property', p);
          m.setAttribute('content', v);
          head.appendChild(m);
        }
      });
      const tw = {
        'twitter:card': 'summary_large_image',
        'twitter:title': title,
        'twitter:description': desc,
        'twitter:image': defaultImage
      };
      Object.entries(tw).forEach(([n, v]) => {
        if (!head.querySelector(`meta[name="${n}"]`)) {
          const m = document.createElement('meta');
          m.setAttribute('name', n);
          m.setAttribute('content', v);
          head.appendChild(m);
        }
      });
      // JSON-LD Organization (if not already present)
      const hasOrg = Array.from(head.querySelectorAll('script[type="application/ld+json"]')).some(s => /"@type"\s*:\s*"Organization"/i.test(s.textContent || ''));
      if (!hasOrg) {
        const s = document.createElement('script');
        s.type = 'application/ld+json';
        s.text = JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: 'EZ Sports Netting',
          url: (location.origin || '') + '/',
          logo: (location.origin || '') + '/assets/EZSportslogo.png',
          sameAs: []
        });
        head.appendChild(s);
      }
      // JSON-LD Breadcrumbs when breadcrumbs nav exists
      const crumbsNav = document.querySelector('nav.breadcrumbs .crumbs');
      if (crumbsNav) {
        const items = Array.from(crumbsNav.querySelectorAll('li'));
        const list = items.map((li, idx) => {
          const a = li.querySelector('a');
          return {
            '@type': 'ListItem',
            position: idx + 1,
            name: (a ? a.textContent : li.textContent || '').trim(),
            item: a ? (new URL(a.getAttribute('href'), location.href)).href : (location.href)
          };
        });
        const hasBreadcrumb = Array.from(head.querySelectorAll('script[type="application/ld+json"]')).some(s => /"@type"\s*:\s*"BreadcrumbList"/i.test(s.textContent || ''));
        if (!hasBreadcrumb) {
          const s = document.createElement('script');
          s.type = 'application/ld+json';
          s.text = JSON.stringify({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: list });
          head.appendChild(s);
        }
      }

      // Manifest and theme-color for PWA hints
      if (!head.querySelector('link[rel="manifest"]')) {
        const link = document.createElement('link');
        link.rel = 'manifest';
        link.href = 'manifest.webmanifest';
        head.appendChild(link);
      }
      if (!head.querySelector('meta[name="theme-color"]')) {
        const m = document.createElement('meta');
        m.name = 'theme-color';
        m.content = '#0f2f50';
        head.appendChild(m);
      }
    } catch {}
  },

  // Performance: fonts/stripe preconnect, stylesheet preload, image lazy loading with LCP protection
  ensurePerformanceOptimizations() {
    try {
      const head = document.head;
      const ensureLink = (attrs) => {
        const selector = Object.entries(attrs).map(([k, v]) => `[${k}="${v}"]`).join('');
        if (!head.querySelector(`link${selector}`)) {
          const l = document.createElement('link');
          Object.entries(attrs).forEach(([k, v]) => l.setAttribute(k, v));
          head.appendChild(l);
        }
      };
      // Preconnects
      ensureLink({ rel: 'preconnect', href: 'https://fonts.googleapis.com' });
      ensureLink({ rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' });
      // Stripe only where likely used; add generically as it’s cheap
      ensureLink({ rel: 'preconnect', href: 'https://js.stripe.com' });

      // Ensure Google Fonts CSS present (Outfit) to reduce FOUT inconsistencies
      const hasOutfit = Array.from(head.querySelectorAll('link[href*="fonts.googleapis.com"]')).some(l => /Outfit/i.test(l.href));
      if (!hasOutfit) {
        const l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = 'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700;800;900&display=swap';
        head.appendChild(l);
      }

      // Preload main stylesheet
      const cssLink = head.querySelector('link[rel="stylesheet"][href*="assets/css/styles.css"]');
      if (cssLink && !head.querySelector('link[rel="preload"][as="style"][href="' + cssLink.getAttribute('href') + '"]')) {
        ensureLink({ rel: 'preload', as: 'style', href: cssLink.getAttribute('href') });
      }

      // Image loading tweaks
      const isHero = (img) => img.closest('.hero, .hero-art, .net-hero, .netting-hero, .turf-hero');
      // Promote first hero/primary image
      const lcpCandidate = document.querySelector('.hero-art img, .net-hero img, .netting-hero img, main img');
      if (lcpCandidate) {
        lcpCandidate.setAttribute('fetchpriority', 'high');
        lcpCandidate.setAttribute('loading', 'eager');
        lcpCandidate.setAttribute('decoding', 'async');
      }
      // Lazy load all other images
      document.querySelectorAll('img').forEach(img => {
        if (img === lcpCandidate) return;
        if (!isHero(img)) {
          if (!img.hasAttribute('loading')) img.setAttribute('loading', 'lazy');
          img.setAttribute('decoding', 'async');
        }
      });
    } catch {}
  },

  // PWA: register Service Worker for production only
  ensureServiceWorkerRegistered() {
    try {
      const isProd = (location.protocol === 'https:') && !/^(localhost|127\.0\.0\.1)$/i.test(location.hostname);
      if (!('serviceWorker' in navigator) || !isProd) return;
      navigator.serviceWorker.getRegistration().then(reg => {
        if (!reg) navigator.serviceWorker.register('/service-worker.js').catch(()=>{});
      }).catch(()=>{});
    } catch {}
  },

  ensureHeaderLayout() {
    const header = document.querySelector('.site-header .header-bar');
    if (!header) return;

    // Ensure actions container exists
    let actions = document.getElementById('header-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.id = 'header-actions';
      actions.className = 'header-actions';
      const search = header.querySelector('.search');
      if (search && search.nextSibling) {
        header.insertBefore(actions, search.nextSibling);
      } else {
        header.appendChild(actions);
      }
    }

    // Ensure cart button lives in the header-actions (right side), not inside the nav
    try {
      const nav = document.getElementById('primary-nav') || header.querySelector('nav.quick-links');
      const cartBtnInNav = nav ? nav.querySelector('.cart-btn') : null;
      const cartBtnLoose = header.querySelector('.cart-btn');
      const cartBtn = cartBtnInNav || cartBtnLoose;
      if (cartBtn && actions && cartBtn.parentElement !== actions) {
        actions.appendChild(cartBtn);
      }
    } catch {}

    // Standardize search bar (placeholder, button classes/text)
    const search = header.querySelector('.search');
    if (search) {
      const input = search.querySelector('input[type="search"]');
      if (input) input.placeholder = 'Search bats, gloves, helmets…';
      let btn = search.querySelector('button[type="submit"]');
      if (!btn) {
        btn = document.createElement('button');
        // Decorative search icon sits inside input; submission still via Enter key
        btn.type = 'button';
        search.appendChild(btn);
      }
  btn.className = 'btn btn-primary search-icon-btn';
  btn.textContent = '';
  btn.setAttribute('aria-hidden','true');
  btn.tabIndex = -1;

      // Ensure search submission navigates to Search Results page
      search.removeAttribute('onsubmit');
      search.addEventListener('submit', (e) => {
        e.preventDefault();
        const q = (input?.value || '').trim();
        const url = 'search-results.html' + (q ? `?q=${encodeURIComponent(q)}` : '');
        window.location.href = url;
      }, { once: false });
    }

    // Ensure menu toggle has aria-label when icon-only on very small screens
    const menuToggle = header.querySelector('.menu-toggle');
    if (menuToggle && !menuToggle.getAttribute('aria-label')) {
      menuToggle.setAttribute('aria-label','Toggle navigation');
    }
  },

  ensureCoreNav() {
  const nav = document.getElementById('primary-nav') || document.querySelector('nav.quick-links');
    if (!nav) return;

    // Deactivate legacy nav (kept for later reference):
    // const legacy = [ 'Deals','Bats','Gloves','Batting Gloves','Drip','Gear','Apparel','Facility & Field','Turf' ];

    // Build new primary nav
    const links = [
      { href: 'about.html', text: 'About' },
      { href: 'ez-nets.html', text: 'EZ Nets' },
      { href: 'l-screens.html', text: 'L-Screens', submenu: [
        { href: 'baseball-l-screens.html', text: 'Baseball L-Screens' },
        { href: 'protective-screens.html', text: 'Protective Screens' },
        { href: 'pitchers-pocket.html', text: "Pitcher's Pocket" },
        { href: 'replacement-screens.html', text: 'Replacement Screens' },
      ]},
      { href: 'accessories.html', text: 'Accessories' },
      { href: 'contactus.html', text: 'Contact Us' },
    ];

    // Clear existing links
    nav.innerHTML = '';

    // Create links
    links.forEach(item => {
      if (item.submenu) {
        const wrapper = document.createElement('div');
        wrapper.className = 'has-submenu';
        const a = document.createElement('a');
        a.href = item.href || '#'; a.textContent = item.text; a.setAttribute('aria-haspopup','true'); a.setAttribute('aria-expanded','false');
        const ul = document.createElement('div');
        ul.className = 'nav-submenu';
        item.submenu.forEach(sub => {
          const subA = document.createElement('a'); subA.href = sub.href; subA.textContent = sub.text; ul.appendChild(subA);
        });
        // For the L-Screens dropdown, align the submenu to the right so it opens to the left
        if ((item.text || '').toLowerCase() === 'l-screens') {
          wrapper.classList.add('submenu-left');
        }
        wrapper.appendChild(a);
        wrapper.appendChild(ul);
        nav.appendChild(wrapper);

        // Desktop: open on hover; Mobile: toggle on tap
        const isFinePointer = typeof window.matchMedia === 'function' && window.matchMedia('(hover:hover) and (pointer:fine)').matches;
        if (isFinePointer) {
          // Desktop hover: add a small hide-delay so users can move into the submenu
          // even if there's a visual gap; cancel the timer on re-enter.
          let hideTimer = null;
          const openMenu = () => {
            if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
            wrapper.classList.add('open');
            a.setAttribute('aria-expanded','true');
          };
          const scheduleClose = () => {
            if (hideTimer) clearTimeout(hideTimer);
            hideTimer = setTimeout(() => {
              wrapper.classList.remove('open');
              a.setAttribute('aria-expanded','false');
              hideTimer = null;
            }, 200); // 200ms grace period
          };
          wrapper.addEventListener('mouseenter', openMenu);
          wrapper.addEventListener('mouseleave', scheduleClose);
          // Also listen on submenu to keep it open while hovering over it
          ul.addEventListener('mouseenter', openMenu);
          ul.addEventListener('mouseleave', scheduleClose);
          // Allow click to navigate to l-screens.html
        } else {
          a.addEventListener('click', (e) => {
            e.preventDefault();
            const open = wrapper.classList.toggle('open');
            a.setAttribute('aria-expanded', String(open));
          });
        }
      } else {
        const a = document.createElement('a');
        a.href = item.href; a.textContent = item.text; nav.appendChild(a);
      }
    });

  // Cart button is handled by ensureHeaderLayout (moved into header-actions)

    // Active link highlighting
    const path = location.pathname.split('/').pop() || 'index.html';
    const candidates = Array.from(nav.querySelectorAll('a')).filter(a => a.getAttribute('href') && !a.closest('.nav-submenu'));
    const active = candidates.find(a => (a.getAttribute('href') || '').endsWith(path));
    if (active) { active.classList.add('is-active'); active.setAttribute('aria-current','page'); }
  },


  updateNavigation() {
    const actions = document.getElementById('header-actions') || document.querySelector('.header-actions');
    const nav = document.getElementById('primary-nav') || document.querySelector('nav.quick-links');
    if (!nav) return;

    // Clear any existing auth/user elements inside nav to avoid duplicates
    nav.querySelectorAll('.auth-link, .user-menu').forEach(el => el.remove());
    // Also clear prior ones in actions (legacy)
    if (actions) actions.querySelectorAll('.auth-link, .user-menu').forEach(el => el.remove());

    if (this.state.user) {
      const userMenu = document.createElement('div');
      userMenu.className = 'user-menu';
      const initials = (this.state.user.name || this.state.user.email || 'U').split(/\s+/).map(s=>s[0]).slice(0,2).join('').toUpperCase();
      userMenu.innerHTML = `
        <button class="profile-btn" id="profile-btn" aria-haspopup="menu" aria-expanded="false" title="Account">
          <span class="avatar">${initials}</span>
        </button>
        <div class="user-dropdown" id="user-dropdown" role="menu" aria-hidden="true">
          <div class="user-summary">
            <strong>${this.state.user.name || this.state.user.email}</strong><br/>
            <small>${this.state.user.email || ''}</small>
          </div>
          <a href="account.html" role="menuitem">Account</a>
          <a href="order-history.html" role="menuitem">Orders</a>
          ${this.state.user.isAdmin ? '<a href="admin.html" role="menuitem">Admin</a>' : ''}
          <button type="button" data-logout role="menuitem">Logout</button>
        </div>`;
  // Prefer right-side header actions for the user menu; fallback to nav if needed
  if (actions) actions.appendChild(userMenu); else nav.appendChild(userMenu);

      const btn = userMenu.querySelector('#profile-btn');
      const dd = userMenu.querySelector('#user-dropdown');
      const close = () => { dd.classList.remove('open'); btn.setAttribute('aria-expanded','false'); dd.setAttribute('aria-hidden','true'); };
      const open = () => { dd.classList.add('open'); btn.setAttribute('aria-expanded','true'); dd.setAttribute('aria-hidden','false'); };
      btn.addEventListener('click', (e)=>{ e.stopPropagation(); dd.classList.contains('open')?close():open(); });
      document.addEventListener('click', (e)=>{ if (!userMenu.contains(e.target)) close(); }, { capture:true });
      const logoutBtn = userMenu.querySelector('[data-logout]');
      if (logoutBtn) logoutBtn.addEventListener('click', ()=> this.logout());
    } else {
      const loginLink = document.createElement('a');
      loginLink.href = 'login.html';
      loginLink.className = 'auth-link';
      loginLink.textContent = 'Login';
      if (actions) actions.appendChild(loginLink); else nav.appendChild(loginLink);
    }

  // Hide header-actions if empty
  if (actions && actions.children.length === 0) actions.style.display = 'none';

    // Ensure header break element still exists for layout but not needed for actions now
    (function(){
      try {
        const header = document.querySelector('.site-header .header-bar');
        if (!header) return;
        if (!header.querySelector('.header-break')) {
          const br = document.createElement('span');
          br.className = 'header-break';
          br.setAttribute('aria-hidden','true');
          const menu = header.querySelector('.menu-toggle');
          if (menu) header.insertBefore(br, menu);
          else header.appendChild(br);
        }
      } catch {}
    })();
  },
  ensureBreadcrumbs() {
    // Avoid duplicates
    if (document.querySelector('nav.breadcrumbs')) return;
    const main = document.querySelector('main#main') || document.querySelector('main');
    if (!main) return;

    // Resolve current page
    const base = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
  const TITLES = {
      'index.html': 'Home',
      'deals.html': 'Deals',
      'about.html': 'About',
  'careers.html': 'Careers',
      'careers.html': 'Careers',
      'login.html': 'Login',
      'checkout.html': 'Checkout',
      'admin.html': 'Admin',
      'order-history.html': 'Order History',
      'netting-calculator.html': 'Netting Calculator',
    'hitting-facility.html':'Hitting Facility',
    'batting-cage.html':'Batting Cage',
    'foul-ball.html':'Foul Ball Netting',
    'backstop.html':'Backstop Netting',
    // L-Screens subpages
    'baseball-l-screens.html':'Baseball L-Screens',
    'protective-screens.html':'Protective Screens',
    'pitchers-pocket.html':"Pitcher's Pocket",
    'replacement-screens.html':'Replacement Screens',
    // Netting categories
    'training-facility.html':'Training Facility',
    'residential-golf.html':'Residential Golf Netting',
    'sports-netting.html':'Sports Netting',
    'basketball.html':'Basketball Netting',
    'hockey.html':'Hockey Netting',
    'softball.html':'Softball Netting',
    'tennis.html':'Tennis Netting',
    'volleyball.html':'Volleyball Netting',
    'commercial-netting.html':'Commercial Netting',
      'ez-nets.html': 'EZ Nets',
      'baseball-netting.html': 'Baseball Netting',
      'golf-netting.html': 'Golf Netting',
      'lacrosse-netting.html': 'Lacrosse Netting',
      'soccer-netting.html': 'Soccer Netting',
      'contactus.html': 'Contact Us',
      'bats.html': 'Bats',
      'gloves.html': 'Gloves',
      'batting-gloves.html': 'Batting Gloves',
      'drip.html': 'Drip',
      'gear.html': 'Gear',
      'apparel.html': 'Apparel',
      'l-screens.html': 'L-Screens',
      'accessories.html': 'Accessories',
      'facility-field.html': 'Facility & Field'
    };

    const crumbs = [];
    crumbs.push({ label: 'Home', href: 'index.html' });
    if (base !== 'index.html') {
      crumbs.push({ label: TITLES[base] || (document.title?.split('—')[0].trim() || 'Current'), href: null });
    }

    // Build DOM
    const nav = document.createElement('nav');
    nav.className = 'breadcrumbs container wrap';
    nav.setAttribute('aria-label', 'Breadcrumb');
    const ol = document.createElement('ol');
    ol.className = 'crumbs';
    crumbs.forEach((c, idx) => {
      const li = document.createElement('li');
      if (c.href && idx < crumbs.length - 1) {
        const a = document.createElement('a'); a.href = c.href; a.textContent = c.label; li.appendChild(a);
      } else {
        const span = document.createElement('span'); span.textContent = c.label; span.setAttribute('aria-current', 'page'); li.appendChild(span);
      }
      ol.appendChild(li);
    });
    nav.appendChild(ol);
    // Insert before main
    main.parentNode.insertBefore(nav, main);
  },

  // Standardize the EZ Nets sub-navigation across all netting-related pages and append Expert CTA action
  ensureNettingSubnav() {
    try {
  const container = document.getElementById('netting-subnav');
      if (!container) return;
      // Canonical order for EZ Nets category navigation
      const TOP = [
        { label: 'Overview', href: 'ez-nets.html' },
        { label: 'Baseball', href: 'baseball-netting.html' },
        { label: 'Training Facility', href: 'training-facility.html' },
        { label: 'Golf', href: 'golf-netting.html' },
        { label: 'Sports', href: 'sports-netting.html' },
        { label: 'Commercial', href: 'commercial-netting.html' },
        { label: 'Calculator', href: 'netting-calculator.html' }
      ];
      // Rebuild only if markup differs from expected list
  const base = (location.pathname.split('/').pop() || '').toLowerCase();
  const html = TOP.map(i => `<a href="${i.href}">${i.label}</a>`).join('');
  container.innerHTML = html;
  container.classList.add('is-ready');
      [...container.querySelectorAll('a')].forEach(a => {
        if ((a.getAttribute('href') || '').toLowerCase() === base) a.classList.add('is-active');
      });
  // No extra button per uniform sub-nav requirement
    } catch {}
  },

  // Build a simple carousel on netting category pages using former sub‑sub page labels as slide titles
  ensureNettingCarousel() {
    try {
      const base = (location.pathname.split('/').pop() || '').toLowerCase();
      const DATA = {
  'baseball-netting.html': [ 'Hitting Facility','Batting Cage','Foul Ball','Overhead','Backstop','L-Screen','Pitcher Pocket' ],
  'golf-netting.html': [ 'Driving Range','Golf Course','Golf Cube','Residential' ],
  'commercial-netting.html': [ 'Auto-Drone','Drone Enclosure','Warehouse','Safety','Debris','Landfill' ],
  'sports-netting.html': [ 'Baseball','Basketball','Cricket Football','Golf','Hockey','Lacrosse','Multi-Sport','Soccer','Softball','Tennis','Volleyball' ],
        'training-facility.html': [
          'Lane Divider Systems','Ceiling Track','Retractable Shell','Impact Panels'
        ]
      };
      if (!DATA[base] || DATA[base].length === 0) return;
      // Avoid duplicate build
      if (document.querySelector('.net-carousel')) return;
      // Find hero section to insert after
      const hero = document.querySelector('.net-hero, .netting-hero');
      if (!hero) return;
      const section = document.createElement('section');
      section.className = 'carousel-section';
      section.innerHTML = `
        <div class="net-carousel" data-autoplay="5500" aria-roledescription="carousel">
          <div class="carousel-track" role="group"></div>
          <button class="carousel-arrow prev" aria-label="Previous slide" type="button">‹</button>
          <button class="carousel-arrow next" aria-label="Next slide" type="button">›</button>
          <div class="carousel-dots" role="tablist"></div>
        </div>`;
      hero.insertAdjacentElement('afterend', section);
      const track = section.querySelector('.carousel-track');
      const dotsWrap = section.querySelector('.carousel-dots');
      const slides = DATA[base];
      // Title->image heuristic mapping (best available match from assets/img/netting)
      const IMG_BASE = 'assets/img/netting/';
      const AVAILABLE = [
        'backstopnetting.jpg','cage.jpg','cage2.jpg','netting.jpg','netting2.jpg','netting3.jpg','overheadnetting.webp','screen6.avif','equip6.avif'
      ];
      const IMG_MAP = {
        'Hitting Facility':'cage2.jpg',
        'Batting Cage':'cage.jpg',
        'Foul Ball':'backstopnetting.jpg',
        'Overhead':'overheadnetting.webp',
        'Backstop':'backstopnetting.jpg',
        'L-Screen':'screen6.avif',
        'Pitcher Pocket':'screen6.avif',
        'Golf Cube':'netting2.jpg',
        'Residential':'netting3.jpg',
        'Ceiling Track':'overheadnetting.webp',
        'Retractable Shell':'overheadnetting.webp',
        'Impact Panels':'netting3.jpg'
      };
      function pickImage(title){
        const direct = IMG_MAP[title];
        if (direct && AVAILABLE.includes(direct)) return direct;
        // Random fallback for any unmapped title
        return AVAILABLE[Math.floor(Math.random()*AVAILABLE.length)];
      }
      slides.forEach((title, idx) => {
        const imgFile = pickImage(title);
        const slide = document.createElement('div');
        slide.className = 'carousel-slide';
        slide.setAttribute('data-index', String(idx));
        // First image eager, others lazy
        const loading = idx === 0 ? 'eager' : 'lazy';
        slide.innerHTML = `
          <figure class="slide-media">
            <img src="${IMG_BASE + imgFile}" alt="${title} netting solution" loading="${loading}" width="480" height="320" />
            <figcaption class="visually-hidden">${title}</figcaption>
          </figure>
          <h3 class="slide-title">${title}</h3>`;
        track.appendChild(slide);
        const dot = document.createElement('button');
        dot.type = 'button';
        dot.className = 'carousel-dot';
        dot.setAttribute('role','tab');
        dot.setAttribute('aria-label', `Slide ${idx+1}: ${title}`);
        dot.dataset.index = String(idx);
        dotsWrap.appendChild(dot);
      });

      const carousel = section.querySelector('.net-carousel');
      const prevBtn = section.querySelector('.carousel-arrow.prev');
      const nextBtn = section.querySelector('.carousel-arrow.next');
      let index = 0;
      const total = slides.length;
      const update = () => {
        track.style.transform = `translateX(-${index*100}%)`;
        dotsWrap.querySelectorAll('button').forEach(b => {
          const active = Number(b.dataset.index) === index;
            b.setAttribute('aria-selected', active ? 'true':'false');
            b.classList.toggle('is-active', active);
        });
      };
      const go = (i) => { index = (i+total)%total; update(); };
      prevBtn?.addEventListener('click', ()=> go(index-1));
      nextBtn?.addEventListener('click', ()=> go(index+1));
      dotsWrap.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn) return;
        go(Number(btn.dataset.index));
      });
      // Autoplay
      const delay = Number(carousel?.dataset.autoplay) || 0;
      let timer = null;
      if (delay && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        timer = setInterval(()=> go(index+1), delay);
        carousel.addEventListener('mouseenter', ()=> timer && clearInterval(timer));
        carousel.addEventListener('mouseleave', ()=> { if (delay) timer = setInterval(()=> go(index+1), delay); });
        document.addEventListener('visibilitychange', ()=>{
          if (document.hidden) { timer && clearInterval(timer); timer=null; }
          else if (!timer) { timer = setInterval(()=> go(index+1), delay); }
        });
      }
      // Initialize
      update();
    } catch(e) { /* silent */ }
  },

  // Dynamically render products for the current page from prodList.json
  async ensurePageProductGrid() {
    try {
      const grid = document.getElementById('page-product-grid');
      if (!grid) return; // Only run on pages that declare a page-level grid

      // If prodList.json isn't present yet, fail gracefully
      const data = await this.fetchProdList();
      if (!data || typeof data !== 'object') {
        this.renderEmptyState(grid);
        return;
      }

      const pageKey = (location.pathname.split('/').pop() || '').toLowerCase().replace(/\.html$/, '');
      let items = [];
      // Support two schemas:
      // 1) Legacy: { "accessories": [...], "baseball-l-screens": [...] }
      if (Array.isArray(data[pageKey])) {
        items = data[pageKey];
      }
      // 2) New: { schemaVersion, categories: { "Accessories": [...], "Better Baseball Screens": [...] } }
      if (!items.length && data && data.categories && typeof data.categories === 'object') {
        // Map page -> category arrays
        const pageToCategories = {
          'accessories': ['Accessories'],
          'baseball-l-screens': ['Better Baseball Screens'],
          'protective-screens': ['Better Baseball Screens'],
          'pitchers-pocket': ["Better Baseball Pitcher's Pocket"],
          'replacement-screens': ['Replacement Nets']
        };
        const cats = pageToCategories[pageKey] || [];
        for (const c of cats) {
          if (Array.isArray(data.categories[c])) items = items.concat(data.categories[c]);
        }
        // For protective-screens page, filter out only square/protective entries when using Better Baseball Screens bucket
        if (pageKey === 'protective-screens' && items.length) {
          items = items.filter(x => {
            const n = (x.name || x.title || '').toLowerCase();
            return /protective|square/.test(n) || /sock\s*net/.test(n) || /fast\s*pitch/.test(n) || /10x10|8x8|7x7/.test(n);
          });
        }
        // For baseball-l-screens page, filter items that look like L-screens
        if (pageKey === 'baseball-l-screens' && items.length) {
          items = items.filter(x => /\bl[ -]?screen\b/i.test(x.name || x.title || ''));
        }
      }
      if (!items.length) {
        this.renderEmptyState(grid);
        return;
      }

      grid.innerHTML = '';
      items.forEach(p => {
        const card = this.buildProductCard(this.normalizeProdListItem(p));
        if (card) grid.appendChild(card);
      });

      // Bind add buttons
      grid.querySelectorAll('.js-add').forEach(btn => {
        if (btn._bound) return; btn._bound = true;
        btn.addEventListener('click', () => {
          const d = btn.dataset;
          const product = { id: d.id, title: d.title, price: Number(d.price)||0, category: d.category || (pageKey || 'misc'), img: d.img };
          try { window.Store && window.Store.add(product); } catch (e) { console.error(e); }
        });
      });
    } catch (e) {
      console.warn('Page product grid failed:', e);
    }
  },

  async fetchProdList() {
    // Cache result during session to avoid repeated fetches
    if (this._prodList) return this._prodList;
    const urls = ['assets/prodList.json', 'prodList.json'];
    for (const u of urls) {
      try {
        const res = await fetch(u, { credentials: 'same-origin', cache: 'no-cache' });
        if (!res.ok) throw new Error('not found');
        const json = await res.json();
        if (json && (typeof json === 'object' || Array.isArray(json))) {
          this._prodList = json;
          return json;
        }
      } catch (e) { /* try next */ }
    }
    // Not present yet or invalid; caller will handle empty state
    return null;
  },

  // Normalize raw entries from prodList.json categories into the minimal shape our UI expects
  normalizeProdListItem(p) {
    if (!p || typeof p !== 'object') return p;
    const id = String(p.sku || p.id || p.name || p.title || Math.random().toString(36).slice(2));
    const title = String(p.name || p.title || id);
    // Prefer explicit price fields; fall back to map, then wholesale, else 0
    const price = Number(p.price ?? p.map ?? p.wholesale ?? 0) || 0;
    // Robust image selection: prefer web URLs and known fields; avoid local file paths (e.g. C:\...)
    const isUsableSrc = (s) => typeof s === 'string' && /^(https?:|\/|assets\/)/i.test(s);
    let img = null;
    // 1) Explicit fields
    if (isUsableSrc(p.img)) img = p.img;
    // 2) images object or array
    if (!img && p.images) {
      if (isUsableSrc(p.images.primary)) img = p.images.primary;
      else if (Array.isArray(p.images.all)) {
        const cand = p.images.all.find(isUsableSrc);
        if (cand) img = cand;
      } else if (Array.isArray(p.images)) {
        const cand = p.images.find(isUsableSrc);
        if (cand) img = cand;
      }
    }
    // 3) details.images
    if (!img && p.details && p.details.images) {
      const di = p.details.images;
      if (isUsableSrc(di.primary)) img = di.primary;
      else if (Array.isArray(di.all)) {
        const cand = di.all.find(isUsableSrc);
        if (cand) img = cand;
      }
    }
    // 4) other single fields
    if (!img && isUsableSrc(p.image)) img = p.image;
    if (!img && p.details && isUsableSrc(p.details.image_url)) img = p.details.image_url;
    // 5) downloaded_images (prefer web/relative entries only)
    const dl = (p.downloaded_images && Array.isArray(p.downloaded_images) ? p.downloaded_images : (p.details && Array.isArray(p.details.downloaded_images) ? p.details.downloaded_images : []));
    if (!img && dl && dl.length) {
      const cand = dl.find(isUsableSrc);
      if (cand) img = cand;
    }
    if (!img) img = 'assets/EZSportslogo.png';
    return { id, title, price, img, category: (p.category || '').toString().toLowerCase() };
  },

  buildProductCard(prod) {
    try {
      if (!prod || !prod.id) return null;
      const id = String(prod.id);
      const title = String(prod.title || 'Untitled');
      const price = Number(prod.price || 0);
      const img = String(prod.img || 'assets/img/netting.jpg');
      const displayPrice = isFinite(price) && price > 0 ? currency.format(price) : '';
      const href = `product.html?pid=${encodeURIComponent(id)}`;

      const article = document.createElement('article');
      article.className = 'card';
      article.innerHTML = `
        <a class="media" href="${href}"><img src="${img}" alt="${title}" loading="lazy" /></a>
        <div class="body">
          <h3 class="h3-tight"><a href="${href}">${title}</a></h3>
          <div class="price-row">
            ${displayPrice ? `<span class="price">${displayPrice}</span>` : ''}
            <button class="btn btn-ghost js-add" data-id="${id}" data-title="${title.replace(/"/g,'&quot;')}" data-price="${price}" data-category="${prod.category || ''}" data-img="${img}">Add</button>
          </div>
        </div>`;
      return article;
    } catch {
      return null;
    }
  },

  renderEmptyState(grid) {
    if (!grid) return;
    grid.innerHTML = '<div class="muted">No products available yet for this page.</div>';
  },

  // Inject a bottom "Talk with a Netting Expert" CTA on all pages except contact page
  ensureExpertCTA() {
    try {
      const base = (location.pathname.split('/').pop() || '').toLowerCase();
      const EXCLUDE = new Set(['contactus.html']);
      if (EXCLUDE.has(base)) return; // skip contact page
      // If already present, normalize its paragraph text for uniformity
      const existing = document.querySelector('.expert-cta');
      if (existing) {
        const p = existing.querySelector('p');
        if (p) p.textContent = 'Planning a facility or multi-field build? Talk with a netting expert for layout optimization, span design, hardware selection, and realistic lead times.';
        return;
      }
      const footer = document.querySelector('footer.site-footer');
      if (!footer) return;
      const section = document.createElement('section');
      section.className = 'expert-cta container';
      section.innerHTML = `
        <h2>Talk with a Netting Expert</h2>
        <p>Planning a facility or multi-field build? Talk with a netting expert for layout optimization, span design, hardware selection, and realistic lead times.</p>
        <button type="button" class="cta-btn" data-open-expert>Connect Now <span aria-hidden="true">›</span></button>
      `;
      footer.parentNode.insertBefore(section, footer);
      section.querySelector('[data-open-expert]')?.addEventListener('click', () => {
        // Focus any existing expert/help form if present on the page
        const nameField = document.querySelector('#contact-name, #expert-name');
        if (nameField) { nameField.scrollIntoView({ behavior:'smooth', block:'center' }); nameField.focus(); }
        // Fallback: navigate to contact page
        else { window.location.href = 'contactus.html'; }
      });
    } catch {}
  },

  // Standardize all "Request Quote" / "Get Quote" buttons on netting pages to a black style
  ensureQuoteButtons() {
    try {
      // Only run on netting related pages (presence of netting hero or subnav)
      const isNettingPage = !!document.querySelector('.netting-hero, .net-hero, #netting-subnav');
      if (!isNettingPage) return;
      const buttons = Array.from(document.querySelectorAll('button'));
      buttons.forEach(btn => {
        const label = (btn.textContent || '').trim().toLowerCase();
        if (label === 'request quote' || label === 'get quote') {
          btn.textContent = 'Request Quote';
          // Ensure navigation to contact page if no explicit handler
          if (!btn.getAttribute('onclick')) {
            btn.addEventListener('click', () => { window.location.href = 'contactus.html'; });
          }
          // Normalize classes
          const classes = new Set((btn.className || '').split(/\s+/).filter(Boolean));
          classes.delete('btn-primary');
          classes.add('btn');
            classes.add('btn-quote');
          btn.className = Array.from(classes).join(' ');
        }
      });
    } catch {}
  },

  // Replace placeholder logo.svg with brand ezsportslogo.jpg in header & footer
  ensureBrandLogos() {
    try {
  const BRAND_SRC = 'assets/EZSportslogo.png';
      const targets = [
        ...document.querySelectorAll('.site-header .brand img, .footer-brand-block img')
      ];
      targets.forEach(img => {
        const src = img.getAttribute('src') || '';
        if (/logo\.svg$/i.test(src) || /\/logo\.svg$/i.test(src)) {
          img.setAttribute('src', BRAND_SRC);
        }
        img.setAttribute('alt', 'EZ Sports Netting logo');
        // Standardize size if missing explicit height
        if (!img.getAttribute('height')) img.setAttribute('height', '40');
      });
    } catch {}
  },

  // Ensure footer "Netting" link (generic category) points to EZ Nets overview, not calculator
  ensureFooterNettingLink() {
    try {
      const footer = document.querySelector('footer');
      if (!footer) return;
      // Find links inside any footer Shop section whose text is exactly "Netting"
      const links = Array.from(footer.querySelectorAll('a'));
      links.forEach(a => {
        const label = (a.textContent || '').trim().toLowerCase();
        if (label === 'netting' && /netting-calculator\.html$/i.test(a.getAttribute('href')||'')) {
          a.setAttribute('href', 'ez-nets.html');
        }
      });
    } catch {}
  },

  logout() {
    try {
      const bases = [];
      if (location.port === '5500') { bases.push('http://localhost:4242','http://127.0.0.1:4242'); }
      bases.unshift(window.__API_BASE || '');
      const tried = new Set();
      bases.forEach(base => {
        if (tried.has(base)) return; tried.add(base);
        fetch(`${base}/api/users/logout`, { method:'POST', credentials:'include' }).catch(()=>{});
      });
    } catch {}
    localStorage.removeItem('currentUser');
    localStorage.removeItem('authToken');
    this.state.user = null;
    this.updateNavigation();
    window.location.href = 'index.html';
  },

  filter(category) {
    this.state.filter = category || 'all';
    document.querySelectorAll('.chip').forEach(x => x.classList.toggle('is-active', x.dataset.chip === this.state.filter));
    this.renderProducts();
    // Jump to catalog
    const cat = document.getElementById('catalog');
    if (cat) cat.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  search(q) {
    this.state.filter = 'all';
    this.renderProducts(q);
    const cat = document.getElementById('catalog');
    if (cat) cat.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  renderProducts(query = '') {
    if (!this.ui.grid) return;
    // Determine source list: homepage uses FEATURED (if non-empty), other pages full PRODUCTS
    const baseList = (function(){
      const page = (location.pathname.split('/').pop()||'').toLowerCase();
      if ((page === 'index.html' || page==='') && FEATURED.length) return FEATURED;
      return PRODUCTS;
    })();
    const list = baseList.filter(p =>
      (this.state.filter === 'all' || p.category === this.state.filter) &&
      p.title.toLowerCase().includes(query.toLowerCase())
    );

    const html = list.map(p => {
      const desc = p.description ? p.description.slice(0, 140) + (p.description.length > 140 ? '…' : '') : '';
      const featPreview = (p.features && p.features.length) ? p.features.slice(0,3).map(f=>`<li>${f}</li>`).join('') : '';
      return `
      <article class="card ${p.category === 'netting' ? '' : ''}" data-product-id="${p.id}" ${p.stripe?.defaultPriceId ? `data-stripe-price="${p.stripe.defaultPriceId}"` : ''}>
        <div class="media no-link">
          <img src="${p.img}" alt="${p.title}" loading="lazy" draggable="false" style="pointer-events:none;" onerror="this.onerror=null;this.src='https://placehold.co/600x400?text=Image+Unavailable';"/>
        </div>
        <div class="body">
          <h3 class="h3-tight">${p.title}</h3>
          ${desc ? `<p class=\"desc text-sm\">${desc}</p>` : ''}
          ${featPreview ? `<ul class=\"text-xs features-preview\">${featPreview}</ul>` : ''}
          ${p.stock !== undefined ? `<p class=\"text-xs text-muted my-025\">Stock: ${p.stock}</p>` : ''}
          <div class="variant-row">
            <label class="text-sm text-muted">Size
              <select class="sel-size ml-025">
                ${['XS','S','M','L','XL'].map(s => `<option value="${s}">${s}</option>`).join('')}
              </select>
            </label>
            <label class="text-sm text-muted ml-05">Color
              <select class="sel-color ml-025">
                ${['Black','White','Red','Blue','Green'].map(c => `<option value="${c}">${c}</option>`).join('')}
              </select>
            </label>
          </div>
          <div class="price-row">
            <span class="price">${currency.format(p.price)}</span>
            <div class="actions">
              <button class="btn btn-ghost" data-add="${p.id}" ${p.stock === 0 ? 'disabled' : ''}>${p.stock === 0 ? 'Out of Stock' : 'Add'}</button>
              <button class="btn btn-ghost" data-detail="${p.id}" aria-label="View details for ${p.title}">Details</button>
            </div>
          </div>
        </div>
      </article>`;
    }).join('');

    this.ui.grid.innerHTML = html || `<p>No products found.</p>`;

    // Analytics: product impression (batched)
    try {
      if (window.trackEvent && list.length) {
        window.trackEvent('view_item_list', list.map(p => ({ id: p.id, price: p.price, stripePrice: p.stripe?.defaultPriceId })));
      }
    } catch {}

    // Inject/update JSON-LD ItemList for SEO based on currently rendered products
    try {
      const head = document.head;
      const existing = document.getElementById('jsonld-itemlist');
      if (existing) existing.remove();
      if (list.length > 0) {
        const script = document.createElement('script');
        script.type = 'application/ld+json';
        script.id = 'jsonld-itemlist';
        const itemListElement = list.map((p, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          item: {
            '@type': 'Product',
            name: p.title,
            sku: p.id,
            category: p.category,
            image: (p.img ? new URL(p.img, location.href).href : undefined),
            offers: {
              '@type': 'Offer',
              priceCurrency: 'USD',
              price: String(p.price ?? ''),
              availability: 'https://schema.org/InStock'
            }
          }
        }));
        script.text = JSON.stringify({ '@context': 'https://schema.org', '@type': 'ItemList', itemListElement });
        head.appendChild(script);
      }
    } catch {}

    // Bind add buttons
    this.ui.grid.querySelectorAll('[data-add]:not([disabled])').forEach(btn => btn.addEventListener('click', (ev) => {
      const id = btn.dataset.add;
      const product = PRODUCTS.find(p => p.id === id);
      const card = ev.target.closest('article');
      const sizeSel = card.querySelector('.sel-size');
      const colorSel = card.querySelector('.sel-color');
      const opts = { size: sizeSel ? sizeSel.value : undefined, color: colorSel ? colorSel.value : undefined };
      this.add(product, opts);
      try { window.trackEvent && window.trackEvent('add_to_cart', { id: product.id, price: product.price, stripePrice: product.stripe?.defaultPriceId }); } catch {}
    }));

    // Bind detail buttons
    this.ui.grid.querySelectorAll('[data-detail]').forEach(btn => btn.addEventListener('click', () => {
      const id = btn.dataset.detail;
      const product = PRODUCTS.find(p => p.id === id);
      if (!product) return;
      this.openProductDetail(product);
    }));

    // Record lightweight view_item events (on initial render for visible items only)
    try {
      const observer = new IntersectionObserver((entries, obs) => {
        entries.forEach(en => {
          if (en.isIntersecting) {
            const id = en.target.getAttribute('data-product-id');
            if (id) window.trackEvent && window.trackEvent('view_item', { id });
            obs.unobserve(en.target);
          }
        });
      }, { rootMargin: '0px 0px 200px 0px', threshold: 0.25 });
      this.ui.grid.querySelectorAll('article[data-product-id]').forEach(card => observer.observe(card));
    } catch {}
  },

  openProductDetail(product) {
    let dlg = document.getElementById('product-detail');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'product-detail';
      dlg.className = 'product-detail-dialog';
      document.body.appendChild(dlg);
    }
    const images = Array.isArray(product.images) && product.images.length ? product.images : [product.img];
    const thumbs = images.map((src,i)=>`<button class="thumb" data-thumb-index="${i}" aria-label="View image ${i+1}"><img src="${src}" alt="${product.title} thumbnail ${i+1}"/></button>`).join('');
    // Feature key:value formatting
    let featureList = '';
    if (product.features && product.features.length) {
      const items = product.features.map(f => {
        const parts = f.split(':');
        if (parts.length > 1 && parts[0].length < 60) {
          const key = parts.shift().trim();
          const val = parts.join(':').trim();
          return `<li><strong>${key}:</strong> ${val}</li>`;
        }
        return `<li>${f}</li>`;
      }).join('');
      featureList = `<h4>Features</h4><ul class="feature-list">${items}</ul>`;
    }
    const descHtml = `<h4>Description</h4>` + (product.description ? `<p class="full-desc">${product.description}</p>` : `<p class="full-desc muted">Description coming soon.</p>`);
    dlg.innerHTML = `
      <form method="dialog" class="dlg-backdrop" onclick="this.closest('dialog').close()"></form>
      <section class="panel" role="document">
        <header class="panel-head">
          <h3>${product.title}</h3>
          <button class="icon-btn" value="close" aria-label="Close">✕</button>
        </header>
        <div class="panel-body product-detail-layout">
          <div class="gallery">
            <div class="main-image"><img id="pd-main-img" src="${images[0]}" alt="${product.title}" onerror="this.onerror=null;this.src='https://placehold.co/800x600?text=Image+Unavailable';"/></div>
            ${images.length > 1 ? `<div class="thumbs" role="list">${thumbs}</div>` : ''}
          </div>
          <div class="info">
            <p class="price-lg">${currency.format(product.price)}</p>
            ${featureList}
            ${descHtml}
          </div>
        </div>
        <footer class="panel-foot">
          <button class="btn btn-primary" data-add-detail="${product.id}">Add to Cart</button>
          <button class="btn btn-ghost" value="close">Close</button>
        </footer>
      </section>`;
    dlg.showModal();
    // Thumbnail click swapping
    dlg.querySelectorAll('.thumb').forEach(btn => btn.addEventListener('click', (e)=>{
      e.preventDefault();
      const idx = Number(btn.getAttribute('data-thumb-index')) || 0;
      const main = dlg.querySelector('#pd-main-img');
      if (main && images[idx]) main.src = images[idx];
      dlg.querySelectorAll('.thumb').forEach(t=>t.classList.remove('active'));
      btn.classList.add('active');
    }));
    // Add-to-cart inside dialog
    dlg.querySelector('[data-add-detail]')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.add(product, {});
      try { window.trackEvent && window.trackEvent('add_to_cart', { id: product.id, price: product.price }); } catch {}
    }, { once: true });
    // Explicit close wiring (buttons with value="close" do not auto-close because they are outside the form element containing method="dialog")
    dlg.querySelectorAll('button[value="close"], [data-close-detail]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        try { dlg.close(); } catch {}
      });
    });
    // Keyboard fallback (some browsers polyfill dialog)
    dlg.addEventListener('keydown', (e) => { if (e.key === 'Escape') { try { dlg.close(); } catch {} } });
  },

  add(product, opts = {}) {
    const candidate = { id: product.id, size: opts.size, color: opts.color };
    const key = this.keyFor(candidate);
    const exists = this.state.cart.find(i => this.keyFor(i) === key);
    if (exists) {
      exists.qty += 1;
    } else {
      // Store a snapshot for items that may not exist in PRODUCTS (e.g., dynamic pages like gloves)
      this.state.cart.push({
        id: product.id,
        qty: 1,
        size: opts.size,
        color: opts.color,
        title: product.title || product.name,
        price: typeof product.price === 'number' ? product.price : Number(product.price) || 0,
        img: product.img,
        category: product.category
      });
    }
    this.persist();
    this.renderCart();
    this.openCart();
  // Track add_to_cart event if analytics is present
  try { window.trackEvent && window.trackEvent('add_to_cart', product.id); } catch {}
  },

  removeByKey(key) {
    this.state.cart = this.state.cart.filter(i => this.keyFor(i) !== key);
    this.persist();
    this.renderCart();
  },

  persist() {
    localStorage.setItem('cart', JSON.stringify(this.state.cart));
  },

  get cartDetailed() {
    return this.state.cart.map(i => {
      const found = PRODUCTS.find(p => p.id === i.id);
      const product = found || {
        id: i.id,
        title: i.title || 'Item',
        price: typeof i.price === 'number' ? i.price : Number(i.price) || 0,
        img: i.img || 'assets/img/logo.svg',
        category: i.category || 'misc'
      };
      return { ...i, product };
    });
  },

  get subtotal() {
    return this.cartDetailed.reduce((sum, i) => sum + ((i.product?.price || 0) * i.qty), 0);
  },

  renderCart() {
    const rows = this.cartDetailed.map(i => {
      const key = this.keyFor(i);
      const variant = `${(i.size || '').trim() ? `Size: ${i.size} ` : ''}${(i.color || '').trim() ? `Color: ${i.color}` : ''}`.trim();
      const img = i.product?.img || 'assets/img/logo.svg';
      const title = i.product?.title || 'Item';
      const price = typeof i.product?.price === 'number' ? i.product.price : 0;
      return `
      <div class="cart-row">
        <img src="${img}" alt="${title}" width="64" height="64" class="rounded-xs object-cover"/>
        <div>
          <strong>${title}</strong>
          ${variant ? `<div class=\"text-sm text-muted\">${variant}</div>` : ''}
          <div class="opacity-80">Qty: <button class="icon-btn" data-dec="${key}">−</button> ${i.qty} <button class="icon-btn" data-inc="${key}">+</button></div>
        </div>
        <div class="text-right">
          <div>${currency.format(price * i.qty)}</div>
          <button class="btn btn-ghost" data-remove="${key}">Remove</button>
        </div>
      </div>
    `;
    }).join('');

    if (this.ui.items) this.ui.items.innerHTML = rows || '<p>Your cart is empty.</p>';
    if (this.ui.count) this.ui.count.textContent = String(this.state.cart.reduce((s, i) => s + i.qty, 0));
    if (this.ui.subtotal) this.ui.subtotal.textContent = currency.format(this.subtotal);
    if (this.state.cart.length) {
      try { window.trackEvent && window.trackEvent('view_cart', { items: this.state.cart.map(i => ({ id: i.id, price: i.price, qty: i.qty })) }); } catch {}
    }

    // Bind buttons
    if (this.ui.items) {
      this.ui.items.querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', () => this.removeByKey(b.dataset.remove)));
      this.ui.items.querySelectorAll('[data-inc]').forEach(b => b.addEventListener('click', () => { const it = this.state.cart.find(x => this.keyFor(x) === b.dataset.inc); if (!it) return; it.qty++; this.persist(); this.renderCart(); }));
      this.ui.items.querySelectorAll('[data-dec]').forEach(b => b.addEventListener('click', () => { const it = this.state.cart.find(x => this.keyFor(x) === b.dataset.dec); if (!it) return; it.qty = Math.max(0, it.qty - 1); if (it.qty === 0) this.removeByKey(this.keyFor(it)); else { this.persist(); this.renderCart(); } }));
    }
  },

  toggleCart() {
    if (!this.ui.dialog) return;
    this.ui.dialog.open ? this.ui.dialog.close() : this.ui.dialog.showModal();
  },

  openCart() {
    if (!this.ui.dialog) return;
    if (!this.ui.dialog.open) this.ui.dialog.showModal();
  },

  checkout() {
    try {
      const cents = Math.round(this.subtotal * 100);
      localStorage.setItem('checkoutTotalCents', String(cents));
      // persist cart for the checkout page
      this.persist();
      try { window.trackEvent && window.trackEvent('begin_checkout', { items: this.state.cart.map(i => ({ id: i.id, price: i.price, qty: i.qty })) }); } catch {}
      window.location.href = 'checkout.html';
    } catch (e) {
      alert('Unable to proceed to checkout.');
      console.error(e);
    }
  },

  // Call this after successful order placement (Stripe + server order saved)
  completePurchase(order) {
    try {
      window.trackEvent && window.trackEvent('purchase', {
        orderId: order?.id,
        items: (order?.items || []).map(i => ({ id: i.id, price: i.price, qty: i.qty })),
        value: (order?.items || []).reduce((s,i)=> s + (i.price * i.qty), 0)
      });
    } catch {}
  }
};

// Fallback responsive enforcement if cached old CSS briefly loads
Store.enforceResponsiveBehaviors = function(){
  try {
    const apply = () => {
      const w = window.innerWidth;
      const nav = document.getElementById('primary-nav') || document.querySelector('nav.quick-links');
      const toggle = document.querySelector('.menu-toggle');
      if (w <= 1200) {
        if (toggle) toggle.style.display = 'inline-flex';
        if (nav && !nav.classList.contains('is-open')) {
          // Keep it collapsed until explicitly opened
          nav.classList.remove('forced-wide');
        }
      } else {
        if (toggle) toggle.style.display = '';
        if (nav) nav.classList.add('forced-wide');
      }
      // Calculator adaptive safeguard
      // Calculator now mobile-first (single column by default); JS stack enforcement no longer required.
    };
    window.addEventListener('resize', apply);
    apply();
  } catch {}
};

window.Store = Store;
window.addEventListener('DOMContentLoaded', () => Store.init());
