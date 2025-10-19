const DatabaseManager = require('../database/DatabaseManager');

class SubscriberService {
  constructor(){ this.db = new DatabaseManager(); }

  async addOrUpdate(email, name){
    if (!email) throw new Error('Email required');
    const existing = await this.db.findOne('subscribers', { email });
    if (existing) {
      await this.db.update('subscribers', { id: existing.id }, { name: name || existing.name, subscribed: true });
      return await this.db.findOne('subscribers', { id: existing.id });
    }
    return await this.db.insert('subscribers', { email, name: name||'', subscribed: true });
  }

  async unsubscribe(email){
    const existing = await this.db.findOne('subscribers', { email });
    if (!existing) return false;
    await this.db.update('subscribers', { id: existing.id }, { subscribed: false });
    return true;
  }

  async list(activeOnly = true){
    const all = await this.db.findAll('subscribers');
    return activeOnly ? all.filter(s => s.subscribed !== false) : all;
  }
}

module.exports = SubscriberService;
