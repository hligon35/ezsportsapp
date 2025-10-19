const DatabaseManager = require('../database/DatabaseManager');

class PayoutService {
  constructor(){ this.db = new DatabaseManager(); }

  async recordPayout(p){
    const rec = {
      type: 'payout',
      id: p.id,
      amount: (p.amount||0)/100,
      currency: p.currency,
      status: p.status,
      arrivalDate: p.arrival_date ? new Date(p.arrival_date*1000).toISOString() : null,
      createdAt: p.created ? new Date(p.created*1000).toISOString() : new Date().toISOString()
    };
    // Upsert-like behavior
    const existing = await this.db.findOne('payouts', { id: rec.id });
    if (existing) {
      await this.db.update('payouts', { id: rec.id }, rec);
      return rec;
    }
    return await this.db.insert('payouts', rec);
  }

  async list(limit=50){
    const all = await this.db.findAll('payouts');
    return all.sort((a,b)=> new Date(b.createdAt) - new Date(a.createdAt)).slice(0, limit);
  }
}

module.exports = PayoutService;
