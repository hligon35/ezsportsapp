// Frontend analytics: admin dashboard rendering and client-side tracking hooks
// Guard: When running under Live Server (port 5500), disable tracking to avoid DB writes that trigger live-reload loops
const __DEV_DISABLE_TRACKING__ = (location.protocol.startsWith('http') && location.port === '5500');
const API_BASE_ANALYTICS = (() => {
  const ports = [4242];
  const bases = [];
  const isHttp = location.protocol.startsWith('http');
  const onLiveServer = isHttp && location.port === '5500';
  // Try only localhost/127.0.0.1 when on Live Server to avoid POSTing to 5500
  if (onLiveServer) {
    ['127.0.0.1', 'localhost'].forEach(h => ports.forEach(p => bases.push(`http://${h}:${p}`)));
  } else {
    // Same-origin first, then localhost fallbacks
    if (isHttp) bases.push(`${location.protocol}//${location.host}`);
    ['127.0.0.1', 'localhost'].forEach(h => ports.forEach(p => bases.push(`http://${h}:${p}`)));
  }
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
      // Stop retrying after first HTTP response to avoid duplicate 400 logs
      try { window.__API_BASE = base; } catch {}
      return res.ok;
    } catch {}
  }
  return false;
}

// Lightweight pageview tracking on all pages that include this script
export async function trackPageview() {
  if (__DEV_DISABLE_TRACKING__) {
    try { console.warn('[analytics] tracking disabled in Live Server dev'); } catch {}
    return;
  }
  // Prevent duplicate sends within the same tab for the same URL
  try {
    const key = `pv_sent_${location.pathname}${location.search}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch {}
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
  if (__DEV_DISABLE_TRACKING__) return;
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
