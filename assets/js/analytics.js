import './tracking.js';

// Frontend analytics: admin dashboard rendering and client-side tracking hooks
const API_BASE_ANALYTICS = (() => {
  // Prefer higher ports first because the backend auto-increments when 4242 is in use.
  const ports = [4243, 4242, 4244, 4245, 4246, 4247];
  const bases = [];
  const isHttp = location.protocol.startsWith('http');
  const onLiveServer = isHttp && location.port === '5500';
  // Prefer explicit overrides first
  try { if (window.__API_BASE) bases.push(String(window.__API_BASE).replace(/\/$/, '')); } catch {}
  try { const meta = document.querySelector('meta[name="api-base"]'); if (meta && meta.content) bases.push(String(meta.content).replace(/\/$/, '')); } catch {}
  // Production default (Render). Safe no-op if unreachable.
  bases.push('https://ezsportsapp.onrender.com');
  // Same-origin next (unless on Live Server where we avoid posting to 5500)
  if (!onLiveServer && isHttp) bases.push(`${location.protocol}//${location.host}`);
  // Localhost fallbacks last
  ['127.0.0.1', 'localhost'].forEach(h => ports.forEach(p => bases.push(`http://${h}:${p}`)));
  return Array.from(new Set(bases));
})();

export async function trackPageview() {
  if (window.EZTrack && typeof window.EZTrack.trackPageView === 'function') {
    return await window.EZTrack.trackPageView();
  }
}

export async function trackEvent(type, payload) {
  if (window.EZTrack && typeof window.EZTrack.track === 'function') {
    return await window.EZTrack.track(type, payload || {});
  }
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
  const aov = document.getElementById('aov');
  if (pv) pv.textContent = String(traffic.totalPageviews || 0);
  if (uv) uv.textContent = String(traffic.uniqueVisitors || 0);
  if (orders) orders.textContent = String(orderStats.totalOrders || 0);
  if (revenue) revenue.textContent = `$${Number(orderStats.totalRevenue||0).toFixed(2)}`;
  if (aov) aov.textContent = `$${Number(orderStats.avgOrderValue||0).toFixed(2)}`;

  // Lists
  const topPages = document.getElementById('top-pages');
  const topProducts = document.getElementById('top-products');
  const favProducts = document.getElementById('fav-products');
  const statusBreakdown = document.getElementById('status-breakdown');
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
  if (statusBreakdown) {
    const sc = orderStats.statusCounts || {};
    const entries = Object.keys(sc).sort().map(k=>`<li><strong>${sc[k]}</strong> — ${k}</li>`).join('');
    statusBreakdown.innerHTML = entries || '<li class="muted">No data</li>';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  if (window.EZTrack && typeof window.EZTrack.boot === 'function') {
    window.EZTrack.boot({ trackPageView: true });
  }

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
if (typeof window.trackEvent !== 'function') window.trackEvent = trackEvent;
