// Frontend analytics: admin dashboard rendering and client-side tracking hooks
const API_BASE_ANALYTICS = (() => {
  const bases = [''];
  const hosts = ['localhost', '127.0.0.1'];
  const ports = [4242, 4343];
  if (location.protocol.startsWith('http')) {
    // Prefer same host with common ports
    ports.forEach(p => bases.push(`${location.protocol}//${location.hostname}:${p}`));
    // Explicit localhost/127.0.0.1 for safety
    hosts.forEach(h => ports.forEach(p => bases.push(`http://${h}:${p}`)));
  } else {
    // file:// fallback
    hosts.forEach(h => ports.forEach(p => bases.push(`http://${h}:${p}`)));
  }
  // De-duplicate
  return Array.from(new Set(bases));
})();

function getVisitorId() {
  try {
    let id = localStorage.getItem('visitorId');
    if (!id) {
      id = 'v_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem('visitorId', id);
    }
    return id;
  } catch {
    return undefined;
  }
}

async function postWithFallback(path, data) {
  for (const base of API_BASE_ANALYTICS) {
    try {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data)
      });
      if (res.ok) { try { window.__API_BASE = base; } catch {} return true; }
    } catch {}
  }
  return false;
}

// Lightweight pageview tracking on all pages that include this script
export async function trackPageview() {
  const user = (function(){ try { return JSON.parse(localStorage.getItem('currentUser')||'null'); } catch { return null; } })();
  const payload = {
    path: location.pathname.replace(/^\\\\/,'/') + location.search,
    referrer: document.referrer || '',
    visitorId: getVisitorId(),
    userId: user?.id
  };
  await postWithFallback(`/api/analytics/track`, payload);
}

export async function trackEvent(type, productId) {
  const user = (function(){ try { return JSON.parse(localStorage.getItem('currentUser')||'null'); } catch { return null; } })();
  const payload = { type, productId, visitorId: getVisitorId(), userId: user?.id };
  await postWithFallback(`/api/analytics/event`, payload);
}

// Admin dashboard wiring (only runs on analytics.html)
async function loadAnalytics() {
  const tfSel = document.getElementById('timeframe');
  const timeframe = tfSel ? tfSel.value : 'week';

  // parallel fetches
  const token = (()=>{ try { return localStorage.getItem('authToken'); } catch { return null; } })();
  const hdrs = token ? { 'Authorization': `Bearer ${token}` } : {};
  async function tryFetch(path) {
    let last;
    for (const base of API_BASE_ANALYTICS) {
      try {
        const res = await fetch(`${base}${path}`, { credentials:'include', headers: hdrs });
        if (res.ok) { try { window.__API_BASE = base; } catch {} return res; }
        last = res;
      } catch (e) { last = e; }
    }
    if (last instanceof Response) return last;
    throw last || new Error('Network error');
  }
  const [trafficRes, toplistsRes, orderStatsRes] = await Promise.all([
    tryFetch(`/api/analytics/admin/traffic?timeframe=${encodeURIComponent(timeframe)}`),
    tryFetch(`/api/analytics/admin/products?timeframe=${encodeURIComponent(timeframe)}&limit=10`),
    tryFetch(`/api/orders/admin/stats?timeframe=${encodeURIComponent(timeframe)}`)
  ]);

  if (!trafficRes.ok || !toplistsRes.ok || !orderStatsRes.ok) {
    document.getElementById('kpis').innerHTML = '<div class="card-sm">Failed to load analytics. Are you logged in as admin?</div>';
    return;
  }

  const traffic = await trafficRes.json();
  const toplists = await toplistsRes.json();
  const orderStats = await orderStatsRes.json();

  // KPIs
  const pv = document.getElementById('pv');
  const uv = document.getElementById('uv');
  const orders = document.getElementById('orders');
  const revenue = document.getElementById('revenue');
  if (pv) pv.textContent = String(traffic.totalPageviews || 0);
  if (uv) uv.textContent = String(traffic.uniqueVisitors || 0);
  if (orders) orders.textContent = String(orderStats.totalOrders || 0);
  if (revenue) revenue.textContent = `$${Number(orderStats.totalRevenue||0).toFixed(2)}`;

  // Lists
  const topPages = document.getElementById('top-pages');
  const topProducts = document.getElementById('top-products');
  const favProducts = document.getElementById('fav-products');
  if (topPages) {
    topPages.innerHTML = (traffic.topPages||[]).map(p=>`<li><strong>${p.count}</strong> — <code>${p.path}</code></li>`).join('') || '<li class="muted">No data</li>';
  }
  if (topProducts) {
    topProducts.innerHTML = (toplists.topPurchased||[]).map(p=>`<li><strong>${p.count}</strong> — ${p.name||p.productId}</li>`).join('') || '<li class="muted">No data</li>';
  }
  if (favProducts) {
    const fav = (toplists.topFavorited||[]).map(p=>`<li><strong>${p.count}</strong> — ${p.name||p.productId} <span class="muted">(favorited)</span></li>`).join('');
    const add = (toplists.topAddedToCart||[]).map(p=>`<li><strong>${p.count}</strong> — ${p.name||p.productId} <span class="muted">(added)</span></li>`).join('');
    favProducts.innerHTML = (fav + add) || '<li class="muted">No data</li>';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Track pageview on any page that includes this script
  trackPageview();

  // If we're on analytics dashboard, wire controls
  const isDashboard = /analytics\.html$/i.test(location.pathname);
  if (isDashboard) {
    const refresh = document.getElementById('refresh');
    const tf = document.getElementById('timeframe');
    if (refresh) refresh.addEventListener('click', loadAnalytics);
    if (tf) tf.addEventListener('change', loadAnalytics);
    loadAnalytics();
  }
});

// Expose for other modules
window.trackEvent = trackEvent;
