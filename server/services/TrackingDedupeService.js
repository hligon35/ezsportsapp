const DatabaseManager = require('../database/DatabaseManager');

class TrackingDedupeService {
  constructor() {
    this.db = new DatabaseManager();
  }

  async isDuplicate(collection, dedupeKey, withinMs) {
    if (!dedupeKey || !withinMs) return false;
    const rows = await this.db.find(collection);
    const cutoff = Date.now() - Number(withinMs || 0);
    return (Array.isArray(rows) ? rows : []).some(row => {
      if (row?.dedupeKey !== dedupeKey) return false;
      const ts = Date.parse(row?.occurredAt || row?.timestamp || row?.createdAt || 0);
      return Number.isFinite(ts) && ts >= cutoff;
    });
  }
}

module.exports = TrackingDedupeService;