const DatabaseManager = require('../database/DatabaseManager');
const ProductService = require('./ProductService');
const OrderService = require('./OrderService');
const TrackingDedupeService = require('./TrackingDedupeService');
const TrackingIdentityService = require('./TrackingIdentityService');
const TrackingWorkflowService = require('./TrackingWorkflowService');

class AnalyticsService {
  constructor() {
    this.db = new DatabaseManager();
    this.productService = new ProductService();
    this.orderService = new OrderService();
    this.dedupe = new TrackingDedupeService();
    this.identity = new TrackingIdentityService();
    this.workflows = new TrackingWorkflowService();
  }

  normalizeEventName(eventName) {
    const raw = String(eventName || '').trim().toLowerCase();
    if (!raw) return '';
    if (raw === 'pageview') return 'page_view';
    return raw;
  }

  dedupeWindowMs(eventName) {
    switch (eventName) {
      case 'page_view': return 30 * 60 * 1000;
      case 'email_capture': return 24 * 60 * 60 * 1000;
      case 'quote_submit': return 10 * 60 * 1000;
      case 'checkout_abandon': return 12 * 60 * 60 * 1000;
      case 'begin_checkout': return 30 * 60 * 1000;
      case 'order_create': return 24 * 60 * 60 * 1000;
      case 'payment_success': return 24 * 60 * 60 * 1000;
      case 'payment_failure': return 60 * 60 * 1000;
      case 'purchase': return 24 * 60 * 60 * 1000;
      default: return 0;
    }
  }

  buildDedupeKey(event) {
    const orderId = event?.ecommerce?.orderId || event?.meta?.orderId || null;
    const paymentIntentId = event?.ecommerce?.paymentIntentId || event?.meta?.paymentIntentId || null;
    const cartFingerprint = event?.meta?.cartFingerprint || null;
    const sessionId = event?.sessionId || 'na';
    const path = event?.path || '/';
    const identityKey = event?.emailHash || event?.email || event?.visitorId || event?.userId || 'anonymous';
    switch (event.eventName) {
      case 'page_view':
        return `page_view:${sessionId}:${path}`;
      case 'email_capture':
        return `email_capture:${identityKey}:${event?.lead?.submissionType || event?.meta?.captureType || 'unknown'}`;
      case 'quote_submit':
        return `quote_submit:${identityKey}:${event?.lead?.submissionType || event?.meta?.submissionType || 'unknown'}`;
      case 'begin_checkout':
        return `begin_checkout:${sessionId}:${cartFingerprint || orderId || path}`;
      case 'checkout_abandon':
        return `checkout_abandon:${cartFingerprint || orderId || identityKey}:${event?.meta?.reason || 'unknown'}`;
      case 'order_create':
        return `order_create:${orderId || paymentIntentId || identityKey}`;
      case 'payment_success':
        return `payment_success:${paymentIntentId || orderId || identityKey}`;
      case 'payment_failure':
        return `payment_failure:${paymentIntentId || orderId || identityKey}:${event?.meta?.failureCode || 'unknown'}`;
      case 'purchase':
        return `purchase:${paymentIntentId || orderId || identityKey}`;
      default:
        return `${event.eventName}:${sessionId}:${path}:${event.productId || orderId || ''}`;
    }
  }

  normalizeItems(items = []) {
    return (Array.isArray(items) ? items : []).map(item => ({
      productId: item?.productId || item?.id || null,
      id: item?.id || item?.productId || null,
      quantity: Math.max(1, Number(item?.quantity || item?.qty || 1) || 1),
      qty: Math.max(1, Number(item?.quantity || item?.qty || 1) || 1),
      price: Number(item?.price || item?.unitPrice || 0) || 0,
      productName: item?.productName || item?.name || item?.title || null,
      category: item?.category || null,
      size: item?.size || null,
      color: item?.color || null
    }));
  }

  async trackCanonicalEvent(payload = {}) {
    const eventName = this.normalizeEventName(payload.eventName || payload.type);
    if (!eventName) throw new Error('Event name required');

    const email = this.identity.normalizeEmail(payload.email || payload?.customer?.email || payload?.meta?.email || null);
    const emailHash = payload.emailHash || this.identity.hashEmail(email);
    const event = {
      schemaVersion: Number(payload.schemaVersion || 2),
      eventName,
      type: eventName,
      source: payload.source || 'server',
      eventId: payload.eventId || null,
      occurredAt: payload.occurredAt || payload.timestamp || payload.ts || new Date().toISOString(),
      timestamp: payload.occurredAt || payload.timestamp || payload.ts || new Date().toISOString(),
      path: payload.path || '/',
      url: payload.url || null,
      title: payload.title || null,
      referrer: payload.referrer || null,
      visitorId: payload.visitorId || null,
      sessionId: payload.sessionId || null,
      userId: payload.userId || null,
      email,
      emailHash,
      productId: payload.productId || payload.id || payload?.meta?.productId || payload?.ecommerce?.items?.[0]?.productId || null,
      attribution: payload.attribution || null,
      ecommerce: {
        currency: payload?.ecommerce?.currency || payload.currency || 'USD',
        value: Number(payload?.ecommerce?.value || payload.value || 0) || 0,
        orderId: payload?.ecommerce?.orderId || payload.orderId || payload?.meta?.orderId || null,
        paymentIntentId: payload?.ecommerce?.paymentIntentId || payload.paymentIntentId || payload?.meta?.paymentIntentId || null,
        items: this.normalizeItems(payload?.ecommerce?.items || payload?.items || payload?.products || [])
      },
      lead: {
        submissionType: payload?.lead?.submissionType || payload.submissionType || payload?.meta?.submissionType || null,
        topic: payload?.lead?.topic || payload.topic || payload?.meta?.topic || null,
        quoteType: payload?.lead?.quoteType || payload.quoteType || payload?.meta?.quoteType || null,
        formId: payload?.lead?.formId || payload.formId || payload?.meta?.formId || null,
        estimatedValue: Number(payload?.lead?.estimatedValue || payload.estimatedValue || payload?.meta?.estimatedValue || 0) || 0
      },
      meta: (payload.meta && typeof payload.meta === 'object') ? payload.meta : {}
    };

    event.dedupeKey = payload.dedupeKey || this.buildDedupeKey(event);
    const dedupeWindow = this.dedupeWindowMs(eventName);
    if (dedupeWindow && await this.dedupe.isDuplicate('analytics', event.dedupeKey, dedupeWindow)) {
      return { ok: true, deduped: true, dedupeKey: event.dedupeKey };
    }

    const stitched = await this.identity.stitchIdentity(event);
    event.identityId = stitched.identityId || null;
    event.visitorId = event.visitorId || stitched.visitorId || null;
    event.userId = event.userId || stitched.userId || null;
    event.email = event.email || stitched.email || null;
    event.emailHash = event.emailHash || stitched.emailHash || null;

    const inserted = await this.db.insert('analytics', event);
    await this.workflows.captureEvent(inserted).catch(() => null);
    return inserted;
  }

  async trackPageView({ path, referrer, visitorId, userId, ts }) {
    return await this.trackCanonicalEvent({
      eventName: 'page_view',
      path,
      referrer,
      visitorId,
      userId,
      occurredAt: ts,
      source: 'legacy_pageview'
    });
  }

  async trackEvent({ type, productId, visitorId, userId, ts }) {
    return await this.trackCanonicalEvent({
      eventName: type,
      productId,
      visitorId,
      userId,
      occurredAt: ts,
      source: 'legacy_event'
    });
  }

  // Backwards-compatible richer event tracking
  async trackRichEvent({ type, productId, visitorId, userId, path, label, value, meta, ts }) {
    return await this.trackCanonicalEvent({
      eventName: type,
      productId,
      visitorId,
      userId,
      path,
      value,
      meta: {
        ...(meta && typeof meta === 'object' ? meta : {}),
        label: label || null
      },
      occurredAt: ts,
      source: 'legacy_rich_event'
    });
  }

  _filterByTime(items, timeframe = 'all') {
    if (timeframe === 'all') return items;
    const now = new Date();
    let startDate = new Date(0);
    if (timeframe === 'today') startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    else if (timeframe === 'week') startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    else if (timeframe === 'month') startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    return items.filter(ev => new Date(ev.timestamp) >= startDate);
  }

  async getTrafficSummary(timeframe = 'all') {
    const events = (await this.db.find('analytics')).filter(e => ['pageview', 'page_view'].includes(String(e.eventName || e.type || '').toLowerCase()));
    const filtered = this._filterByTime(events, timeframe);
    const totalPageviews = filtered.length;
    const uniqueVisitors = new Set(filtered.map(e => e.visitorId || e.userId || `${e.path}|${e.timestamp.slice(0,10)}`)).size;
    const byPath = filtered.reduce((acc, e) => { acc[e.path] = (acc[e.path] || 0) + 1; return acc; }, {});
    const topPages = Object.entries(byPath)
      .map(([path, count]) => ({ path, count }))
      .sort((a,b)=> b.count - a.count)
      .slice(0, 10);
    return { timeframe, totalPageviews, uniqueVisitors, topPages };
  }

  async getProductToplists(timeframe = 'all', limit = 10) {
    // Top purchased from orders
    const ordersRes = await this.orderService.getAllOrders(null, { page: 1, pageSize: 100000, sortBy: 'createdAt', sortDir: 'desc' });
    const orders = Array.isArray(ordersRes) ? ordersRes : (ordersRes.items || []);
    const ordersFiltered = this._filterByTime(orders, timeframe);
    const purchasedMap = {};
    for (const o of ordersFiltered) {
      (o.items || []).forEach(it => {
        const pid = it.productId || it.id;
        purchasedMap[pid] = (purchasedMap[pid] || 0) + (it.quantity || it.qty || 1);
      });
    }

    // Favorites and add_to_cart from analytics events
    const events = await this.db.find('analytics');
    const favs = this._filterByTime(events.filter(e => String(e.eventName || e.type || '') === 'favorite' && e.productId), timeframe);
    const adds = this._filterByTime(events.filter(e => String(e.eventName || e.type || '') === 'add_to_cart' && e.productId), timeframe);
    const favMap = favs.reduce((acc, e) => { acc[e.productId] = (acc[e.productId] || 0) + 1; return acc; }, {});
    const addMap = adds.reduce((acc, e) => { acc[e.productId] = (acc[e.productId] || 0) + 1; return acc; }, {});

    function toTopList(map) {
      return Object.entries(map)
        .map(([productId, count]) => ({ productId, count }))
        .sort((a,b)=> b.count - a.count)
        .slice(0, limit);
    }

    const topPurchased = toTopList(purchasedMap);
    const topFavorited = toTopList(favMap);
    const topAddedToCart = toTopList(addMap);

    // Enrich with product names
    async function enrich(list) {
      const out = [];
      for (const item of list) {
        const p = await this.productService.getProductById(item.productId);
        out.push({ ...item, name: p?.name || item.productId });
      }
      return out;
    }

    return {
      timeframe,
      topPurchased: await enrich.call(this, topPurchased),
      topFavorited: await enrich.call(this, topFavorited),
      topAddedToCart: await enrich.call(this, topAddedToCart)
    };
  }
}

module.exports = AnalyticsService;
