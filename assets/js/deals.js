// Render deals and featured banners using fixed local images (no shuffling)
const FALLBACK = 'https://placehold.co/600x400?text=Image+Unavailable';
const currency = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });

// Fixed set of 9 deals with explicit images
const DEALS = [
  { title: 'Closeout BBCOR/USSSA Bat', was: 499.95, now: 349.95, add: 'bat-ghost', img: 'assets/img/bat1.avif' },
  { title: 'Portable Practice Net',   was: 249.00, now: 199.00, add: 'net-pro', img: 'assets/img/netting2.jpg' },
  { title: 'Premium Infield Glove',   was: 329.95, now: 259.95, add: 'glove-a2000', img: 'assets/img/glove1.avif' },
  { title: 'Batting Cage Net 12x55',  was: 699.00, now: 599.00, add: 'net-cage', img: 'assets/img/cage.jpg' },
  { title: 'Pro Batting Helmet',      was: 99.99,  now: 69.99,  add: 'helmet-pro', img: 'assets/img/helmet1.avif' },
  { title: 'Closeout BBCOR/USSSA Bat', was: 279.99, now: 199.99, add: 'bat-hype', img: 'assets/img/bat2.avif' },
  { title: 'Lightweight Helmet',      was: 79.99,  now: 54.99,  add: 'helmet-lite', img: 'assets/img/helmet2.avif' },
  { title: 'L-Screen Protector',      was: 399.00, now: 329.00, add: 'l-screen', img: 'assets/img/screen1.avif' },
  { title: 'Premium Outfield Glove',  was: 279.95, now: 219.95, add: 'glove-heart', img: 'assets/img/glove2.avif' }
];

function hydrateFeaturedBanners() {
  const wrap = document.querySelector('#deals');
  if (!wrap) return;
  const banners = wrap.querySelectorAll('.banner');
  // 1: Bats, 2: Gloves (deterministic images)
  if (banners[0]) {
    const img = banners[0].querySelector('img');
    if (img) { img.src = 'assets/img/bats2.jpg'; img.alt = 'Closeout bats'; }
  }
  if (banners[1]) {
    const img = banners[1].querySelector('img');
    if (img) { img.src = 'assets/img/gloves2.jpg'; img.alt = 'Closeout gloves'; }
  }
}

function renderDeals(){
  hydrateFeaturedBanners();

  const data = DEALS;
  const el = document.getElementById('deals-grid');
  if(!el) return;
  el.innerHTML = data.map(d => `
    <article class="card">
      <div class="media">
        <img src="${d.img}" alt="${d.title}" loading="lazy" onerror="this.onerror=null;this.src='${FALLBACK}';"/>
      </div>
      <div class="body">
    <h3 class="h3-tight">${d.title}</h3>
        <div class="price-row">
          <span class="price">
            <span class="was-price">${currency.format(d.was)}</span>
      <strong class="ml-035">${currency.format(d.now)}</strong>
      <span class="badge ml-035">SAVE ${Math.round(100*(1 - d.now/d.was))}%</span>
          </span>
          <button class="btn btn-ghost" data-add="${d.add}">Add</button>
        </div>
      </div>
    </article>
  `).join('');

  // Hook up add buttons using Store if available
  if (window.Store) {
    el.querySelectorAll('[data-add]').forEach(btn => btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-add');
      const prod = (window.PRODUCTS || []).find?.(p => p.id === id);
      if (prod && window.Store?.add) {
        window.Store.add(prod);
      } else if (window.Store) {
        const exists = window.Store.state.cart.find(i => i.id === id);
        if (exists) exists.qty += 1; else window.Store.state.cart.push({ id, qty: 1 });
        window.Store.persist();
        window.Store.renderCart();
        window.Store.openCart();
      }
    }));
  }
}

window.addEventListener('DOMContentLoaded', renderDeals);
