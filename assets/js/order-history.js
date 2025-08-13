// Order History: localStorage-based
function currencyFmt(n){ return n.toLocaleString(undefined,{style:'currency',currency:'USD'}); }

function getCurrentUser(){
  try{
    return JSON.parse(localStorage.getItem('currentUser')||'null');
  }catch{ return null; }
}

function getOrders(){
  try{
    const user = getCurrentUser();
    if (!user) return [];
    const allOrders = JSON.parse(localStorage.getItem('orders')||'[]');
    // Filter orders by user email for user-specific history
    return allOrders.filter(order => order.userEmail === user.email);
  }catch{ return []; }
}

function renderOrders(){
  const user = getCurrentUser();
  const list = document.getElementById('orders-list');
  
  if (!user) {
    list.innerHTML = '<p>Please <a href="login.html?redirect=order-history.html">login</a> to view your orders.</p>';
    return;
  }
  
  const orders = getOrders();
  if(!orders.length){
    list.innerHTML = '<p>You have no orders yet. <a href="shop.html">Start shopping!</a></p>';
    return;
  }
  list.innerHTML = orders.map(order => `
    <div class="order-card">
      <div class="order-header">
        <span><strong>Order #${order.id}</strong></span>
        <span>${new Date(order.date).toLocaleString()}</span>
      </div>
      <div class="order-items">
        ${order.items.map(i => `<div class="order-item"><span>${i.qty} × ${i.id}</span><span>${currencyFmt(i.price * i.qty)}</span></div>`).join('')}
      </div>
      <div style="margin-top:.5rem;text-align:right"><strong>Total: ${currencyFmt(order.total)}</strong></div>
    </div>
  `).join('');
}

document.addEventListener('DOMContentLoaded', renderOrders);
