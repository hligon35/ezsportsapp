// Admin panel functionality
let currentEditingProduct = null;
const API_BASES = (() => {
  const isHttp = location.protocol.startsWith('http');
  // For Replit, use same-origin (empty string) first, then fallback to localhost for development
  const bases = [''];
  if (location.port === '5500') {
    // Live Server development
    bases.push('http://localhost:4242', 'http://127.0.0.1:4242');
  }
  return bases;
})();

function authHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  try {
    const token = localStorage.getItem('authToken');
    if (token) headers['Authorization'] = `Bearer ${token}`;
  } catch {}
  return headers;
}

async function fetchAdmin(path, options = {}) {
  let lastErr;
  for (const base of API_BASES) {
    try {
  const res = await fetch(`${base}${path}`, { credentials:'include', ...options, headers: { ...(options.headers||{}), ...authHeaders() } });
  if (res.ok) { window.__API_BASE = base; return res; }
      lastErr = res;
    } catch (e) { lastErr = e; }
  }
  if (lastErr instanceof Response) return lastErr;
  throw lastErr || new Error('Network error');
}

function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem('currentUser') || 'null');
  } catch {
    return null;
  }
}

// Products list (Admin) must come exclusively from assets/prodList.json
let __prodListProducts = [];
function __slug(str) {
  return (str||'').toString().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');
}
function __pickPrice(obj) {
  // Prefer MAP, then explicit price, then details.price, then wholesale
  const from = (v) => (typeof v === 'number' ? v : (v && !isNaN(Number(v)) ? Number(v) : undefined));
  return (
    from(obj?.map) ??
    from(obj?.price) ??
    from(obj?.details?.price) ??
    from(obj?.wholesale)
  ) || 0;
}
async function loadProductsFromProdList(force=false) {
  if (!force && __prodListProducts.length) return __prodListProducts;
  try {
    const res = await fetch('assets/prodList.json', { credentials:'same-origin' });
    if (!res.ok) throw new Error('Failed to load prodList.json');
    const data = await res.json();
    const out = [];
    const categories = data && data.categories ? data.categories : {};
    for (const [catName, items] of Object.entries(categories)) {
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        const base = {
          sku: item.sku || '',
          name: item.name || item.sku || 'Product',
          image: item.img || (Array.isArray(item.images) ? item.images[0] : '') || '',
          category: catName,
          description: (item.details && item.details.description) || '',
          isActive: true,
          source: 'prodList'
        };
        if (Array.isArray(item.variations) && item.variations.length) {
          for (const v of item.variations) {
            const id = (item.sku ? `${item.sku}-${__slug(v.option||'opt')}` : `${__slug(base.name)}-${__slug(v.option||'opt')}`);
            out.push({
              id,
              ...base,
              name: `${base.name} (${v.option})`,
              price: __pickPrice(v)
            });
          }
        } else {
          const id = item.sku || __slug(base.name) || ('prod-' + Date.now());
          out.push({
            id,
            ...base,
            price: __pickPrice(item)
          });
        }
      }
    }
    __prodListProducts = out;
  } catch (e) {
    console.error('Failed to load prodList.json', e);
    __prodListProducts = [];
  }
  return __prodListProducts;
}

// Legacy helpers retained for other admin features, but products list will not use them
let __adminProductsCache = [];
async function loadProductsFromServer() { return []; }
function getProducts() { return __prodListProducts.slice(); }
function saveProducts(_) { /* no-op for prod list enforcement */ }
function updateShopProducts(_) { /* no-op for prod list enforcement */ }

function getOrders() {
  try {
    return JSON.parse(localStorage.getItem('orders') || '[]');
  } catch {
    return [];
  }
}

// Users will be loaded from the server for admins

function generateId() {
  return 'prod-' + Date.now();
}

function showSection(section, btn) {
  // Hide all sections (use class since .hidden has !important and overrides inline styles)
  const sections = document.querySelectorAll('.admin-section');
  sections.forEach(s => s.classList.add('hidden'));
  // Update tab active state
  document.querySelectorAll('.admin-nav button').forEach(b => b.classList.remove('active'));

  // Show selected section and mark active tab
  const el = document.getElementById(section + '-section');
  if (el) el.classList.remove('hidden');
  if (btn) btn.classList.add('active');

  // Load data for section
  if (section === 'products') renderProducts();
  if (section === 'orders') renderOrders();
  if (section === 'users') renderUsers();
  if (section === 'marketing') renderMarketing();
  if (section === 'invoices') renderInvoices();
}

async function renderProducts() {
  if (!__prodListProducts.length) { await loadProductsFromProdList(); }
  const products = getProducts();
  const list = document.getElementById('products-list');

  if (!products.length) {
    list.innerHTML = '<p>No products yet. Add your first product above.</p>';
    return;
  }

  list.innerHTML = products.map(p => `
    <div class="product-item">
      <div>
        <strong>${p.name}</strong> - $${Number(p.price||0).toFixed(2)}
        <br><small>${p.category}${p.sku?` | SKU: ${p.sku}`:''}</small>
      </div>
      <div>
        <!-- Admin Products list is read-only and reflects assets/prodList.json -->
      </div>
    </div>
  `).join('');
}

function renderOrders() {
  const list = document.getElementById('orders-list');
  const status = document.getElementById('orders-status-filter')?.value || '';
  list.innerHTML = '<p>Loading orders…</p>';

  const params = new URLSearchParams();
  if (status) params.set('status', status);
  params.set('page', window.__ordersPage||1);
  params.set('pageSize', 10);
  params.set('sortBy', 'createdAt');
  params.set('sortDir', 'desc');
  fetchAdmin(`/api/orders/admin/all?${params.toString()}`)
    .then(async res=>{
      if (!res.ok) {
        const txt = await res.text().catch(()=> '');
        throw new Error(txt || 'Unauthorized or failed');
      }
      return res.json();
    })
    .then(result => {
      console.log('Loaded orders:', result); // Debug logging
      const { items:orders, total, page, pageSize } = Array.isArray(result) ? { items:result, total:result.length, page:1, pageSize:result.length } : result;
      if (!orders || !orders.length) {
        list.innerHTML = '<p>No orders found.</p>';
        return;
      }
      const html = orders.map(order => `
        <div class="product-item">
          <div>
            <strong>Order #${order.id}</strong> — <small>${order.status||'pending'}</small>
            <br><small>${new Date(order.createdAt||order.date).toLocaleString()}</small>
            <br>Items: ${order.items.map(i => `${(i.quantity||i.qty)}x ${i.productId||i.id}`).join(', ')}
          </div>
          <div class="flex-row gap-05 items-center">
            <strong>$${(order.total||0).toFixed(2)}</strong>
            <a class="btn btn-ghost" href="${(window.__API_BASE||'')}/api/invoices/INV-${order.id}/print" target="_blank" rel="noopener">View Invoice</a>
            ${order.customerInfo?.email ? `<button class="btn btn-ghost" data-portal="${order.customerInfo.email}">Billing Portal</button>` : ''}
            <select data-order-id="${order.id}" class="order-status-select">
              ${['pending','paid','fulfilled','cancelled'].map(s=>`<option value="${s}" ${s===(order.status||'pending')?'selected':''}>${s}</option>`).join('')}
            </select>
            <button class="btn btn-ghost" data-update-status="${order.id}">Update</button>
          </div>
        </div>
      `).join('');

      const pager = `
        <div class="flex-row gap-1 items-center mt-1">
          <button class="btn btn-ghost" id="orders-prev" ${page<=1?'disabled':''}>Prev</button>
          <span>Page ${page} of ${Math.max(1, Math.ceil(total/(pageSize||1)))} (${total} total)</span>
          <button class="btn btn-ghost" id="orders-next" ${(page*pageSize)>=total?'disabled':''}>Next</button>
        </div>`;

      list.innerHTML = html + pager;

      // Wire billing portal buttons
      list.querySelectorAll('[data-portal]').forEach(btn => {
        btn.addEventListener('click', () => {
          const email = btn.getAttribute('data-portal');
          if (email) openBillingPortal(email);
        });
      });
      // Wire updates
      list.querySelectorAll('[data-update-status]')
        .forEach(btn => btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-update-status');
          const sel = list.querySelector(`select[data-order-id="${id}"]`);
          const newStatus = sel.value;
          fetchAdmin(`/api/orders/${id}/status`, { method:'PATCH', body: JSON.stringify({ status:newStatus }) })
            .then(r=>{ if(!r.ok) throw new Error('Failed'); return r.json(); })
            .then(()=>{ renderOrders(); })
            .catch(()=> alert('Failed to update status. Ensure you are logged in as admin.'));
        }));

      const prev = document.getElementById('orders-prev');
      const next = document.getElementById('orders-next');
      if (prev) prev.addEventListener('click', ()=>{ window.__ordersPage = Math.max(1,(page-1)); renderOrders(); });
      if (next) next.addEventListener('click', ()=>{ window.__ordersPage = (page+1); renderOrders(); });
    })
    .catch((e)=>{
      list.innerHTML = `<p>Failed to load orders. ${e.message||''}</p>`;
    });
}

function renderUsers() {
  const list = document.getElementById('users-list');
  list.innerHTML = '<p>Loading users…</p>';
  fetchAdmin(`/api/users/admin/all`)
    .then(async res=>{ if(!res.ok){ const txt=await res.text().catch(()=> ''); throw new Error(txt||'Unauthorized or failed'); } return res.json(); })
    .then(users => {
      console.log('Loaded users:', users); // Debug logging
      if (!users || !users.length) { list.innerHTML = '<p>No users found.</p>'; return; }
      list.innerHTML = users.map(user => `
        <div class="product-item">
          <div>
            <strong>${user.name || user.username || user.email}</strong> (${user.email})
            <br><small>${user.isAdmin ? 'Admin' : 'Customer'}</small>
          </div>
          <div>
            <small>ID: ${user.id}</small>
            <button class="btn btn-ghost" data-user-portal="${user.email}">Billing Portal</button>
          </div>
        </div>
      `).join('');
      list.querySelectorAll('[data-user-portal]').forEach(btn => {
        btn.addEventListener('click', () => {
          const email = btn.getAttribute('data-user-portal');
          if (email) openBillingPortal(email);
        });
      });
    })
  .catch((e)=>{ list.innerHTML = `<p>Failed to load users. ${e.message||''}</p>`; });
}

function addProduct(productData) {
  // Try backend first
  (async () => {
    try {
      const res = await fetchAdmin('/api/products', { method: 'POST', body: JSON.stringify(productData) });
      if (!res.ok) throw new Error('Failed');
      const created = await res.json();
      __adminProductsCache = [created, ...getProducts().filter(p => p.id !== created.id)];
      saveProducts(__adminProductsCache);
      renderProducts();
      return;
    } catch (_) {
      // Fallback to local-only when offline
      const products = getProducts();
      const newProduct = { id: generateId(), ...productData, createdAt: new Date().toISOString() };
      products.push(newProduct);
      saveProducts(products);
      renderProducts();
    }
  })();
}

function editProduct(id) {
  const products = getProducts();
  const product = products.find(p => p.id === id);
  if (!product) return;

  currentEditingProduct = id;
  document.getElementById('product-name').value = product.name;
  document.getElementById('product-price').value = product.price;
  document.getElementById('product-image').value = product.image || '';
  document.getElementById('product-category').value = product.category;
  document.getElementById('product-description').value = product.description || '';
  document.getElementById('product-stock').value = product.stock || 0;

  document.querySelector('#product-form button[type="submit"]').textContent = 'Update Product';
  document.getElementById('cancel-edit').style.display = 'block';
}

function updateProduct(id, productData) {
  (async () => {
    try {
      const res = await fetchAdmin(`/api/products/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(productData) });
      if (!res.ok) throw new Error('Failed');
      const updated = await res.json();
      __adminProductsCache = getProducts().map(p => p.id === id ? { ...p, ...updated } : p);
      saveProducts(__adminProductsCache);
      renderProducts();
      return;
    } catch (_) {
      // Local fallback
      const products = getProducts();
      const index = products.findIndex(p => p.id === id);
      if (index !== -1) {
        products[index] = { ...products[index], ...productData };
        saveProducts(products);
        renderProducts();
      }
    }
  })();
}

function deleteProduct(id) {
  if (!confirm('Are you sure you want to delete this product?')) return;
  (async () => {
    try {
      const res = await fetchAdmin(`/api/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed');
      __adminProductsCache = getProducts().filter(p => p.id !== id);
      saveProducts(__adminProductsCache);
      renderProducts();
      return;
    } catch (_) {
      const products = getProducts().filter(p => p.id !== id);
      saveProducts(products);
      renderProducts();
    }
  })();
}

function cancelEdit() {
  currentEditingProduct = null;
  document.getElementById('product-form').reset();
  document.querySelector('#product-form button[type="submit"]').textContent = 'Add Product';
  document.getElementById('cancel-edit').style.display = 'none';
}

// Initialize admin panel
document.addEventListener('DOMContentLoaded', () => {
  const user = getCurrentUser();

  // Check if user is admin
  if (!user || !user.isAdmin) {
    alert('Access denied. Admin privileges required.');
    window.location.href = 'login.html?redirect=admin.html';
    return;
  }
  // If served via Live Server (port 5500) and no Bearer token, redirect to login to acquire one
  try {
    const hasToken = !!localStorage.getItem('authToken');
    if (!hasToken && location.port === '5500') {
      // Cookies won't be sent cross-origin; ensure token exists for Authorization header
      window.location.href = 'login.html?redirect=admin.html';
      return;
    }
  } catch {}

  // Product form submission
  document.getElementById('product-form').addEventListener('submit', (e) => {
    e.preventDefault();

    const productData = {
      name: document.getElementById('product-name').value,
      price: parseFloat(document.getElementById('product-price').value),
      image: document.getElementById('product-image').value,
      category: document.getElementById('product-category').value,
      description: document.getElementById('product-description').value,
      stock: parseInt(document.getElementById('product-stock').value) || 0
    };

    if (currentEditingProduct) {
      updateProduct(currentEditingProduct, productData);
      cancelEdit();
    } else {
      addProduct(productData);
      document.getElementById('product-form').reset();
    }
  });

  // Logout functionality
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
  const base = window.__API_BASE || API_BASES[0] || '';
  fetch(`${base}/api/users/logout`, { method:'POST', credentials:'include', headers: authHeaders() }).finally(()=>{
        localStorage.removeItem('currentUser');
        window.location.href = 'index.html';
      });
    });
  }

  // Load initial data
  // Ensure the default tab (Products) is visible on load
  showSection('products', document.querySelector('.admin-nav button'));
  // Load products exclusively from prodList.json for Admin > Products
  loadProductsFromProdList().then(() => { try { renderProducts(); } catch {} });
  // Orders filters
  const statusFilter = document.getElementById('orders-status-filter');
  const refreshBtn = document.getElementById('orders-refresh-btn');
  if (statusFilter) statusFilter.addEventListener('change', renderOrders);
  if (refreshBtn) refreshBtn.addEventListener('click', renderOrders);

  // Invoices filters
  const invStatusFilter = document.getElementById('invoices-status-filter');
  const invRefreshBtn = document.getElementById('invoices-refresh-btn');
  if (invStatusFilter) invStatusFilter.addEventListener('change', renderInvoices);
  if (invRefreshBtn) invRefreshBtn.addEventListener('click', renderInvoices);
});

// Make functions global for onclick handlers
window.showSection = showSection;
window.editProduct = editProduct;
window.deleteProduct = deleteProduct;
window.cancelEdit = cancelEdit;
window.openBillingPortal = async function(email){
  try {
    if (!email) { alert('Enter a customer email first.'); return; }
    const base = window.__API_BASE || API_BASES[0] || '';
    const res = await fetch(`${base}/api/admin/billing-portal`, {
      method: 'POST',
      credentials: 'include',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, return_url: location.origin + '/admin.html' })
    });
    const data = await res.json().catch(()=>({}));
    if (!res.ok || !data.url) throw new Error(data.message||'Failed to create portal session');
    window.location.href = data.url;
  } catch (e) {
    alert(e.message || 'Unable to open billing portal');
  }
}
// Marketing helpers
async function renderMarketing(){
  // Initial loads
  await loadSubscribers();
  await loadCoupons();
  await populateMarketingWidgets();

  // Wire newsletter form
  const nlForm = document.getElementById('newsletter-form');
  const nlStatus = document.getElementById('nl-status');
  if (nlForm && !nlForm.__wired) {
    nlForm.__wired = true;
    nlForm.addEventListener('submit', async (e)=>{
      e.preventDefault();
      nlStatus.textContent = 'Queuing…';
      try {
        const body = {
          subject: document.getElementById('nl-subject').value,
          text: document.getElementById('nl-text').value,
          html: document.getElementById('nl-html').value
        };
        const res = await fetchAdmin('/api/marketing/admin/newsletter', { method:'POST', body: JSON.stringify(body) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message||'Failed');
        nlStatus.textContent = `Queued ${data.queued||0} emails.`;
        nlForm.reset();
      } catch (e) { nlStatus.textContent = e.message || 'Failed'; }
    });
  }

  // Wire coupon form
  const cpForm = document.getElementById('coupon-form');
  const cpStatus = document.getElementById('coupon-status');
  if (cpForm && !cpForm.__wired) {
    cpForm.__wired = true;
    cpForm.addEventListener('submit', async (e)=>{
      e.preventDefault();
      cpStatus.textContent = 'Creating…';
      try {
        const emails = (document.getElementById('cp-emails').value||'').split(',').map(e=>e.trim()).filter(Boolean);
        const body = {
          code: document.getElementById('cp-code').value,
          type: document.getElementById('cp-type').value,
          value: Number(document.getElementById('cp-value').value||0),
          expiresAt: document.getElementById('cp-expires').value || null,
          maxUses: Number(document.getElementById('cp-maxuses').value||0),
          userEmails: emails
        };
        const res = await fetchAdmin('/api/marketing/admin/coupons', { method:'POST', body: JSON.stringify(body) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message||'Failed');
        cpStatus.textContent = 'Created.';
        cpForm.reset();
        await loadCoupons();
      } catch (e) { cpStatus.textContent = e.message || 'Failed'; }
    });
  }

  // Refresh buttons
  const couRefresh = document.getElementById('coupons-refresh');
  if (couRefresh && !couRefresh.__wired) { couRefresh.__wired = true; couRefresh.addEventListener('click', async () => { await loadCoupons(); await populateMarketingWidgets(); }); }
  const subsRefresh = document.getElementById('subs-refresh');
  if (subsRefresh && !subsRefresh.__wired) { subsRefresh.__wired = true; subsRefresh.addEventListener('click', async () => { await loadSubscribers(); await populateMarketingWidgets(); }); }
}

async function loadCoupons(){
  try {
    const el = document.getElementById('coupons-list');
    const err = document.getElementById('coupons-error');
    if (el) el.innerHTML = '<p class="muted">Loading coupons…</p>';
    if (err) err.style.display = 'none';
    const res = await fetchAdmin('/api/marketing/admin/coupons');
    const list = res.ok ? await res.json() : [];
    if (!el) return;
    if (!list.length) { el.innerHTML = '<p>No coupons created.</p>'; return; }
    el.innerHTML = list.map(c => `
      <div class="product-item">
        <div>
          <strong>${c.code}</strong> — ${c.type==='percent'?c.value+'%':'$'+Number(c.value||0).toFixed(2)}
          <br><small>Used ${c.used||0}${c.maxUses?` / ${c.maxUses}`:''} ${c.active===false?'(inactive)':''}</small>
          ${c.expiresAt?`<br><small>Expires: ${new Date(c.expiresAt).toLocaleDateString()}</small>`:''}
        </div>
        <div>
          ${c.active!==false?`<button class="btn btn-ghost" data-deact="${c.code}">Deactivate</button>`:''}
        </div>
      </div>
    `).join('');
    el.querySelectorAll('[data-deact]').forEach(btn => {
      btn.addEventListener('click', async ()=>{
        const code = btn.getAttribute('data-deact');
        try {
          const r = await fetchAdmin(`/api/marketing/admin/coupons/${encodeURIComponent(code)}/deactivate`, { method:'POST' });
          if (!r.ok) throw new Error('Failed');
          loadCoupons();
        } catch (e) {
          if (err) { err.style.display = ''; err.textContent = e.message || 'Failed to deactivate.'; }
        }
      });
    });
  } catch (e) {
    const el = document.getElementById('coupons-list');
    const err = document.getElementById('coupons-error');
    if (el) el.innerHTML = '';
    if (err) { err.style.display = ''; err.textContent = e.message || 'Failed to load coupons.'; }
  }
}

async function loadSubscribers(){
  const subsList = document.getElementById('subs-list');
  const err = document.getElementById('subs-error');
  if (subsList) subsList.innerHTML = '<p class="muted">Loading subscribers…</p>';
  if (err) err.style.display = 'none';
  try {
    const subsRes = await fetchAdmin(`/api/marketing/admin/subscribers?activeOnly=true`);
    const subs = subsRes.ok ? await subsRes.json() : [];
    if (subsList) subsList.innerHTML = subs.length ? (`<ul>` + subs.map(s=>`<li>${s.email}${s.name?` — ${s.name}`:''}</li>`).join('') + `</ul>`) : '<p>No subscribers yet.</p>';
  } catch (e) {
    if (subsList) subsList.innerHTML = '';
    if (err) { err.style.display=''; err.textContent = e.message || 'Failed to load subscribers.'; }
  }
}

async function populateMarketingWidgets(){
  // Subscribers active count
  try {
    const res = await fetchAdmin(`/api/marketing/admin/subscribers?activeOnly=true`);
    const list = res.ok ? await res.json() : [];
    const el = document.getElementById('w-subs-active');
    if (el) el.textContent = Array.isArray(list) ? list.length : '0';
  } catch { const el = document.getElementById('w-subs-active'); if (el) el.textContent = '—'; }

  // Coupons aggregates & top codes
  try {
    const res = await fetchAdmin('/api/marketing/admin/coupons');
    const list = res.ok ? await res.json() : [];
    const total = list.length;
    const active = list.filter(c=>c.active!==false).length;
    const usedSum = list.reduce((s,c)=> s + (Number(c.used||0)), 0);
    const top = list.slice().sort((a,b)=>(b.used||0)-(a.used||0)).slice(0,5);
    const fmt = (n)=> (typeof n==='number' ? n.toLocaleString() : n);
    const elTotal = document.getElementById('w-coupons-total'); if (elTotal) elTotal.textContent = fmt(total);
    const elActive = document.getElementById('w-coupons-active'); if (elActive) elActive.textContent = fmt(active);
    const elUsed = document.getElementById('w-coupons-used'); if (elUsed) elUsed.textContent = fmt(usedSum);
    const listEl = document.getElementById('w-top-codes');
    if (listEl) {
      if (!top.length) listEl.innerHTML = '<li>No redemptions yet.</li>';
      else listEl.innerHTML = top.map(c => `<li><strong>${c.code}</strong> — used ${Number(c.used||0)}${c.expiresAt?`, exp ${new Date(c.expiresAt).toLocaleDateString()}`:''}</li>`).join('');
    }
  } catch {
    const elTotal = document.getElementById('w-coupons-total'); if (elTotal) elTotal.textContent = '—';
    const elActive = document.getElementById('w-coupons-active'); if (elActive) elActive.textContent = '—';
    const elUsed = document.getElementById('w-coupons-used'); if (elUsed) elUsed.textContent = '—';
    const listEl = document.getElementById('w-top-codes'); if (listEl) listEl.innerHTML = '<li class="muted">Unavailable</li>';
  }
}

// Invoices
function renderInvoices() {
  const list = document.getElementById('invoices-list');
  const status = document.getElementById('invoices-status-filter')?.value || '';
  list.innerHTML = '<p>Loading invoices…</p>';

  const params = new URLSearchParams();
  if (status) params.set('status', status);
  params.set('page', window.__invoicesPage||1);
  params.set('pageSize', 10);
  params.set('sortBy', 'createdAt');
  params.set('sortDir', 'desc');
  fetchAdmin(`/api/invoices/admin/all?${params.toString()}`)
    .then(async res=>{ if(!res.ok){ const txt=await res.text().catch(()=> ''); throw new Error(txt||'Unauthorized or failed'); } return res.json(); })
    .then(result => {
      const { items:invoices, total, page, pageSize } = Array.isArray(result) ? { items:result, total:result.length, page:1, pageSize:result.length } : result;
      if (!invoices || !invoices.length) { list.innerHTML = '<p>No invoices found.</p>'; return; }
      const html = invoices.map(inv => `
        <div class="product-item">
          <div>
            <strong>${inv.id}</strong> — <small>${inv.status}</small>
            <br><small>${new Date(inv.createdAt).toLocaleString()}</small>
            <br>${inv.customer?.name || 'Customer'} (${inv.customer?.email || ''})
          </div>
          <div class="flex-row gap-05 items-center">
            <strong>$${Number(inv.total||0).toFixed(2)}</strong>
                <a class="btn btn-ghost" href="${(window.__API_BASE||API_BASES[0]||'')}/api/invoices/${inv.id}/print" target="_blank" rel="noopener">View</a>
            <button class="btn btn-ghost" data-print="${inv.id}">Print</button>
          </div>
        </div>
      `).join('');

      const pager = `
        <div class="flex-row gap-1 items-center mt-1">
          <button class="btn btn-ghost" id="invoices-prev" ${page<=1?'disabled':''}>Prev</button>
          <span>Page ${page} of ${Math.max(1, Math.ceil(total/(pageSize||1)))} (${total} total)</span>
          <button class="btn btn-ghost" id="invoices-next" ${(page*pageSize)>=total?'disabled':''}>Next</button>
        </div>`;

      list.innerHTML = html + pager;

      // Wire print
      list.querySelectorAll('[data-print]').forEach(btn => {
        btn.addEventListener('click', () => printInvoice(btn.getAttribute('data-print')));
      });

      const prev = document.getElementById('invoices-prev');
      const next = document.getElementById('invoices-next');
      if (prev) prev.addEventListener('click', ()=>{ window.__invoicesPage = Math.max(1,(page-1)); renderInvoices(); });
      if (next) next.addEventListener('click', ()=>{ window.__invoicesPage = (page+1); renderInvoices(); });
    })
  .catch((e)=>{ list.innerHTML = `<p>Failed to load invoices. ${e.message||''}</p>`; });
}

function printInvoice(invoiceId) {
  fetchAdmin(`/api/invoices/${invoiceId}`)
    .then(r=>{ if(!r.ok) throw new Error('Failed'); return r.json(); })
    .then(inv => {
      const w = window.open('', '_blank');
      if (!w) return alert('Popup blocked. Allow popups to print invoice.');
  const rows = (inv.items||[]).map(it => `<tr><td>${it.productName||it.productId}</td><td class="num">${it.quantity||it.qty}</td><td class="num">$${Number(it.price||0).toFixed(2)}</td><td class="num">$${Number(it.subtotal||((it.price||0)*(it.quantity||1))).toFixed(2)}</td></tr>`).join('');
      w.document.write(`
        <html><head><title>${inv.id}</title>
  <style>body{font-family: Arial, sans-serif; padding:20px;} table{width:100%; border-collapse: collapse;} th,td{padding:8px; border-bottom:1px solid #eee;} th.num,td.num{text-align:right;} h1{margin:0 0 10px;} .totals{margin-top:10px; text-align:right;} </style>
        </head><body>
          <h1>Invoice ${inv.id}</h1>
          <p>Date: ${new Date(inv.createdAt).toLocaleString()}</p>
          <p>Customer: ${inv.customer?.name || ''} (${inv.customer?.email || ''})</p>
          <table>
            <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Subtotal</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
          <div class="totals">
            <div>Subtotal: $${Number(inv.subtotal||0).toFixed(2)}</div>
            <div>Tax: $${Number(inv.tax||0).toFixed(2)}</div>
            <div>Shipping: $${Number(inv.shipping||0).toFixed(2)}</div>
            <div><strong>Total: $${Number(inv.total||0).toFixed(2)}</strong></div>
          </div>
          <script>window.print();</script>
        </body></html>
      `);
      w.document.close();
    })
    .catch(()=> alert('Failed to load invoice'));
}