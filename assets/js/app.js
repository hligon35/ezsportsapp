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

const DEFAULT_PRODUCTS = [
  { id: 'bat-ghost', title: 'Ghost Unlimited Bat -11', price: 399.95, category: 'bats', img: 'assets/img/bat3.avif' },
  { id: 'bat-hype', title: 'HYPE Fire -10', price: 349.95, category: 'bats', img: 'assets/img/bat4.avif' },
  { id: 'glove-a2000', title: 'Wilson A2000 11.5"', price: 299.95, category: 'gloves', img: 'assets/img/glove3.avif' },
  { id: 'glove-heart', title: 'Heart of the Hide 12.25"', price: 279.95, category: 'gloves', img: 'assets/img/glove4.avif' },
  { id: 'net-pro', title: 'Pro Backstop Net 10x30', price: 219.00, category: 'netting', img: 'assets/img/netting.jpg' },
  { id: 'net-cage', title: 'Batting Cage Net 12x55', price: 649.00, category: 'netting', img: 'assets/img/netting3.jpg' },
  { id: 'helmet-pro', title: 'Pro Helmet With Face Guard', price: 89.99, category: 'helmets', img: 'assets/img/helmet3.avif' },
  { id: 'helmet-lite', title: 'Lightweight Helmet Youth', price: 59.99, category: 'helmets', img: 'assets/img/helmet3.avif' },
];

function getProducts() {
  try {
    const adminProducts = JSON.parse(localStorage.getItem('shopProducts') || 'null');
    if (Array.isArray(adminProducts) && adminProducts.length > 0) return adminProducts;
    return DEFAULT_PRODUCTS;
  } catch {
    return DEFAULT_PRODUCTS;
  }
}

let PRODUCTS = getProducts();

const Store = {
  state: {
    filter: 'all',
    cart: JSON.parse(localStorage.getItem('cart') || '[]'),
    user: null,
  },

  // Expose a way to retrieve the current products list (admin-managed or defaults)
  getProducts() {
    return getProducts();
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
  this.ensureExpertCTA();
  this.ensureQuoteButtons();
  this.ensureBrandLogos();
  this.ensureFooterNettingLink();
  this.ensureSkipLink();
  this.ensureSEO();
  this.ensurePerformanceOptimizations();
  this.ensureServiceWorkerRegistered();

    // Runtime responsive enforcement (in case stale CSS served from cache briefly)
    this.enforceResponsiveBehaviors();

    // Refresh products from admin updates
    PRODUCTS = getProducts();

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
    }

    // Render initial views
    if (this.ui.grid) {
      this.renderProducts();
    }
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
      // Insert after search form if present, else at end
      const search = header.querySelector('.search');
      if (search && search.nextSibling) {
        header.insertBefore(actions, search.nextSibling);
      } else {
        header.appendChild(actions);
      }
    }

    // Move cart button out of nav into actions (if present)
    const nav = document.getElementById('primary-nav') || header.querySelector('nav.quick-links');
    const cartBtn = nav ? nav.querySelector('.cart-btn') : null;
    if (cartBtn) actions.appendChild(cartBtn);

    // Standardize search bar (placeholder, button classes/text)
    const search = header.querySelector('.search');
    if (search) {
      const input = search.querySelector('input[type="search"]');
      if (input) input.placeholder = 'Search bats, gloves, helmets…';
      let btn = search.querySelector('button[type="submit"]');
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'submit';
        search.appendChild(btn);
      }
      btn.className = 'btn btn-primary';
      btn.textContent = 'Search';

      // Ensure search submission navigates to Search Results page
      search.removeAttribute('onsubmit');
      search.addEventListener('submit', (e) => {
        e.preventDefault();
        const q = (input?.value || '').trim();
        const url = 'search-results.html' + (q ? `?q=${encodeURIComponent(q)}` : '');
        window.location.href = url;
      }, { once: false });
    }
  },

  ensureCoreNav() {
    const nav = document.getElementById('primary-nav') || document.querySelector('nav.quick-links');
    if (!nav) return;

    // Canonical nav: rebuild to avoid legacy links and ensure correct order
    const required = [
      { href: 'index.html', text: 'Home' },
      { href: 'deals.html', text: 'Deals' },
      { href: 'about.html', text: 'About' },
      { href: 'ez-nets.html', text: 'EZ Nets' },
      { href: 'bats.html', text: 'Bats' },
      { href: 'gloves.html', text: 'Gloves' },
      { href: 'batting-gloves.html', text: 'Batting Gloves' },
      { href: 'drip.html', text: 'Drip' },
      { href: 'gear.html', text: 'Gear' },
      { href: 'apparel.html', text: 'Apparel' },
      { href: 'l-screens.html', text: 'L-Screens' },
      { href: 'facility-field.html', text: 'Facility & Field' },
  { href: 'turf.html', text: 'Turf' },
      { href: 'contactus.html', text: 'Contact Us' }
    ];

    // Preserve cart button if it sits inside nav (will be moved by ensureHeaderLayout)
    const cartBtn = nav.querySelector('.cart-btn');

    // Remove all anchor links
    nav.querySelectorAll('a').forEach(a => a.remove());

    // Append required links in order
    required.forEach(link => {
      const a = document.createElement('a');
      a.href = link.href;
      a.textContent = link.text;
      nav.appendChild(a);
    });

  // Removed EZ Nets mega menu per request


    // Highlight current page
    const path = location.pathname.split('/').pop() || 'index.html';
    const active = Array.from(nav.querySelectorAll('a')).find(a => (a.getAttribute('href') || '').endsWith(path));
    if (active) { active.classList.add('is-active'); active.setAttribute('aria-current', 'page'); }
  },


  updateNavigation() {
    const actions = document.getElementById('header-actions') || document.querySelector('.header-actions');
    if (!actions) return;

    // Remove existing auth elements from actions
    actions.querySelectorAll('.auth-link, .user-menu').forEach(el => el.remove());

    if (this.state.user) {
      // User is logged in — show compact profile avatar with dropdown
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
      actions.appendChild(userMenu);

      // Wire dropdown toggle and outside click
      const btn = userMenu.querySelector('#profile-btn');
      const dd = userMenu.querySelector('#user-dropdown');
      const close = () => { dd.classList.remove('open'); btn.setAttribute('aria-expanded','false'); dd.setAttribute('aria-hidden','true'); };
      const open = () => { dd.classList.add('open'); btn.setAttribute('aria-expanded','true'); dd.setAttribute('aria-hidden','false'); };
      btn.addEventListener('click', (e)=>{ e.stopPropagation(); dd.classList.contains('open')?close():open(); });
      document.addEventListener('click', (e)=>{ if (!userMenu.contains(e.target)) close(); }, { capture:true });
      // Logout wiring
      const logoutBtn = userMenu.querySelector('[data-logout]');
      if (logoutBtn) logoutBtn.addEventListener('click', ()=> this.logout());
    } else {
      // User is not logged in
      const loginLink = document.createElement('a');
      loginLink.href = 'login.html';
      loginLink.className = 'auth-link';
      loginLink.textContent = 'Login';
      actions.appendChild(loginLink);
    }
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
      'support.html': 'Support',
      'careers.html': 'Careers',
      'login.html': 'Login',
      'checkout.html': 'Checkout',
      'admin.html': 'Admin',
      'order-history.html': 'Order History',
      'netting-calculator.html': 'Netting Calculator',
  'hitting-facility.html':'Hitting Facility',
  'batting-cage.html':'Batting Cage',
  'foul-ball.html':'Foul Ball Netting',
  'overhead.html':'Overhead Netting',
  'backstop.html':'Backstop Netting',
  'baseball-l-screen.html':'Baseball L-Screen',
  'pitchers-pocket.html':"Pitcher's Pocket",
  'training-facility.html':'Training Facility',
  'diving-range.html':'Diving Range',
  'golf-course.html':'Golf Course Netting',
  'golf-cube.html':'Golf Cube',
  'residential-golf.html':'Residential Golf Netting',
  'sports-netting.html':'Sports Netting',
  'sports-baseball.html':'Sports: Baseball',
  'basketball.html':'Basketball Netting',
  'cricket-football.html':'Cricket Football',
  'sports-golf.html':'Sports: Golf',
  'hockey.html':'Hockey Netting',
  'sports-lacrosse.html':'Sports: Lacrosse',
  'multi-sport.html':'Multi-Sport',
  'sports-soccer.html':'Sports: Soccer',
  'softball.html':'Softball Netting',
  'tennis.html':'Tennis Netting',
  'volleyball.html':'Volleyball Netting',
  'commercial-netting.html':'Commercial Netting',
  'auto-drone.html':'Auto-Drone',
  'drone-enclosure.html':'Drone Enclosure',
  'warehouse.html':'Warehouse Netting',
  'safety-netting.html':'Safety Netting',
  'debris-netting.html':'Debris Netting',
  'landfill-netting.html':'Landfill Netting',
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
      slides.forEach((title, idx) => {
        const slide = document.createElement('div');
        slide.className = 'carousel-slide';
        slide.setAttribute('data-index', String(idx));
        slide.innerHTML = `
          <div class="slide-media" role="img" aria-label="${title} image placeholder">
            <span>${title}</span>
          </div>
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
    const list = PRODUCTS.filter(p =>
      (this.state.filter === 'all' || p.category === this.state.filter) &&
      p.title.toLowerCase().includes(query.toLowerCase())
    );

    const html = list.map(p => `
      <article class="card ${p.category === 'netting' ? '' : ''}">
        <div class="media">
          <img src="${p.img}" alt="${p.title}" loading="lazy" onerror="this.onerror=null;this.src='https://placehold.co/600x400?text=Image+Unavailable';"/>
        </div>
        <div class="body">
          <h3 class="h3-tight">${p.title}</h3>
          ${p.stock !== undefined ? `<p class=\"text-sm text-muted my-025\">Stock: ${p.stock}</p>` : ''}
          <div class="variant-row">
            <label class="text-sm text-muted">Size
              <select class="sel-size ml-025">
                ${['XS','S','M','L','XL'].map(s=>`<option value=\"${s}\">${s}</option>`).join('')}
              </select>
            </label>
            <label class="text-sm text-muted">Color
              <select class="sel-color ml-025">
                ${['Black','White','Red','Blue','Green'].map(c=>`<option value=\"${c}\">${c}</option>`).join('')}
              </select>
            </label>
          </div>
          <div class="price-row">
            <span class="price">${currency.format(p.price)}</span>
            <button class="btn btn-ghost" data-add="${p.id}" ${p.stock === 0 ? 'disabled' : ''}>
              ${p.stock === 0 ? 'Out of Stock' : 'Add'}
            </button>
          </div>
        </div>
      </article>
    `).join('');

    this.ui.grid.innerHTML = html || `<p>No products found.</p>`;

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
    }));
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
      window.location.href = 'checkout.html';
    } catch (e) {
      alert('Unable to proceed to checkout.');
      console.error(e);
    }
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
