const DatabaseManager = require('../database/DatabaseManager');
const ProductService = require('./ProductService');
const OrderService = require('./OrderService');

class AnalyticsService {
  constructor() {
    this.db = new DatabaseManager();
    this.productService = new ProductService();
    this.orderService = new OrderService();
  }

  async trackPageView({ path, referrer, visitorId, userId, ts }) {
    const event = {
      type: 'pageview',
      path: path || '/',
      referrer: referrer || '',
      visitorId: visitorId || null,
      userId: userId || null,
      timestamp: ts || new Date().toISOString(),
    };
    return await this.db.insert('analytics', event);
  }

  async trackEvent({ type, productId, visitorId, userId, ts }) {
    if (!type) throw new Error('Event type required');
    const event = {
      type,
      productId: productId || null,
      visitorId: visitorId || null,
      userId: userId || null,
      timestamp: ts || new Date().toISOString(),
    };
    return await this.db.insert('analytics', event);
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
    const events = await this.db.find('analytics', { type: 'pageview' });
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
    const favs = this._filterByTime(events.filter(e => e.type === 'favorite' && e.productId), timeframe);
    const adds = this._filterByTime(events.filter(e => e.type === 'add_to_cart' && e.productId), timeframe);
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
