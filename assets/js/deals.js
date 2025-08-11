// Render placeholder deals dynamically
const FALLBACK = 'https://placehold.co/600x400?text=Image+Unavailable';
const currency = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });

const DEALS = [
  { title: 'BBCOR Alloy Bat', was: 279.99, now: 199.99, add: 'bat-hype', img: 'https://source.unsplash.com/800x600/?baseball,bat&sig=101' },
  { title: 'Premium Infield Glove', was: 329.95, now: 259.95, add: 'glove-a2000', img: 'https://source.unsplash.com/800x600/?baseball,glove&sig=102' },
  { title: 'Portable Practice Net', was: 249.00, now: 199.00, add: 'net-pro', img: 'https://source.unsplash.com/800x600/?baseball,net&sig=103' },
  { title: 'Pro Batting Helmet', was: 99.99, now: 69.99, add: 'helmet-pro', img: 'https://source.unsplash.com/800x600/?baseball,helmet&sig=104' },
];

function renderDeals(){
  const el = document.getElementById('deals-grid');
  if(!el) return;
  el.innerHTML = DEALS.map(d => `
    <article class="card">
      <div class="media">
        <img src="${d.img}" alt="${d.title}" loading="lazy" onerror="this.onerror=null;this.src='${FALLBACK}';"/>
      </div>
      <div class="body">
        <h3 style="margin:0 0 .25rem;font-size:1rem">${d.title}</h3>
        <div class="price-row">
          <span class="price">
            <span class="was-price">${currency.format(d.was)}</span>
            <strong style="margin-left:.35rem">${currency.format(d.now)}</strong>
            <span class="badge" style="margin-left:.35rem">SAVE ${Math.round(100*(1 - d.now/d.was))}%</span>
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
      // Try to use Store.add with real product if exists; otherwise push a generic line item
      const prod = (window.PRODUCTS || []).find?.(p => p.id === id);
      if (prod && window.Store?.add) {
        window.Store.add(prod);
      } else if (window.Store) {
        // Fallback: minimal item add
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
