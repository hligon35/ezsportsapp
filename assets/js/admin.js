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

function getProducts() {
  try {
    return JSON.parse(localStorage.getItem('adminProducts') || '[]');
  } catch {
    return [];
  }
}

function saveProducts(products) {
  localStorage.setItem('adminProducts', JSON.stringify(products));
  // Also update the main PRODUCTS array for the shop
  updateShopProducts(products);
}

function updateShopProducts(products) {
  // Convert admin products to shop format
  const shopProducts = products.map(p => ({
    id: p.id,
    title: p.name,
    price: p.price,
    category: p.category,
    img: p.image || 'https://source.unsplash.com/600x400/?product',
    description: p.description,
    stock: p.stock
  }));
  localStorage.setItem('shopProducts', JSON.stringify(shopProducts));
}

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
  if (section === 'invoices') renderInvoices();
}

function renderProducts() {
  const products = getProducts();
  const list = document.getElementById('products-list');

  if (!products.length) {
    list.innerHTML = '<p>No products yet. Add your first product above.</p>';
    return;
  }

  list.innerHTML = products.map(p => `
    <div class="product-item">
      <div>
        <strong>${p.name}</strong> - $${p.price}
        <br><small>${p.category} | Stock: ${p.stock || 0}</small>
      </div>
      <div>
        <button class="btn btn-ghost" onclick="editProduct('${p.id}')">Edit</button>
        <button class="btn btn-ghost text-red" onclick="deleteProduct('${p.id}')">Delete</button>
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
          </div>
        </div>
      `).join('');
    })
  .catch((e)=>{ list.innerHTML = `<p>Failed to load users. ${e.message||''}</p>`; });
}

function addProduct(productData) {
  const products = getProducts();
  const newProduct = {
    id: generateId(),
    ...productData,
    createdAt: new Date().toISOString()
  };
  products.push(newProduct);
  saveProducts(products);
  renderProducts();
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
  const products = getProducts();
  const index = products.findIndex(p => p.id === id);
  if (index !== -1) {
    products[index] = { ...products[index], ...productData };
    saveProducts(products);
    renderProducts();
  }
}

function deleteProduct(id) {
  if (!confirm('Are you sure you want to delete this product?')) return;

  const products = getProducts().filter(p => p.id !== id);
  saveProducts(products);
  renderProducts();
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