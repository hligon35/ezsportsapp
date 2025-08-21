// Order History: server-backed with graceful fallback
function currencyFmt(n){ return Number(n||0).toLocaleString(undefined,{style:'currency',currency:'USD'}); }
const API_BASE = (location.port === '5500') ? 'http://localhost:4242' : '';

function getCurrentUser(){
  try{
    return JSON.parse(localStorage.getItem('currentUser')||'null');
  }catch{ return null; }
}

async function fetchOrdersServer(){
  try{
  const res = await fetch(`${API_BASE}/api/orders/me`, { credentials:'include' });
    if (!res.ok) throw new Error('Not authorized');
    return await res.json();
  }catch(e){ return null; }
}

async function renderOrders(){
  const user = getCurrentUser();
  const list = document.getElementById('orders-list');
  
  if (!user) {
    list.innerHTML = '<p>Please <a href="login.html?redirect=order-history.html">login</a> to view your orders.</p>';
    return;
  }
  
  const serverOrders = await fetchOrdersServer();
  const orders = Array.isArray(serverOrders) ? serverOrders : [];
  if(!orders.length){
    list.innerHTML = '<p>You have no orders yet. <a href="shop.html">Start shopping!</a></p>';
    return;
  }
  list.innerHTML = orders.map(order => `
    <div class="order-card">
      <div class="order-header">
        <span><strong>Order #${order.id}</strong>${order.status ? ` · <em class="muted">${order.status}</em>` : ''}</span>
        <span>${new Date(order.createdAt || order.date).toLocaleString()}</span>
      </div>
      <div class="order-items">
        ${order.items.map(i => {
          const variant = [i.size, i.color].filter(Boolean).join('/');
          return `<div class="order-item"><span>${i.qty} × ${i.id}${variant ? ` (${variant})` : ''}</span><span>${currencyFmt((i.price||0) * i.qty)}</span></div>`
        }).join('')}
      </div>
      <div style="margin-top:.5rem;text-align:right"><strong>Total: ${currencyFmt(order.total)}</strong></div>
    </div>
  `).join('');
}

document.addEventListener('DOMContentLoaded', () => { renderOrders(); });
