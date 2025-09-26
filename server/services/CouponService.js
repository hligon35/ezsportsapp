const DatabaseManager = require('../database/DatabaseManager');

class CouponService {
  constructor(){ this.db = new DatabaseManager(); }

  async create({ code, type='percent', value=0, expiresAt=null, maxUses=0, userEmails=[] }){
    if (!code) throw new Error('Code required');
    code = code.toUpperCase();
    const existing = await this.db.findOne('coupons', { code });
    if (existing) throw new Error('Coupon code already exists');
    return await this.db.insert('coupons', { code, type, value, expiresAt, maxUses, used:0, userEmails, active:true });
  }

  async list(){ return await this.db.findAll('coupons'); }

  async deactivate(code){
    code = code.toUpperCase();
    const c = await this.db.findOne('coupons', { code });
    if (!c) throw new Error('Not found');
    await this.db.update('coupons', { id: c.id }, { active:false });
    return await this.db.findOne('coupons', { id: c.id });
  }

  async validate(code, email, now = new Date()){
    if (!code) throw new Error('Code required');
    code = code.toUpperCase();
    const c = await this.db.findOne('coupons', { code });
    if (!c || c.active === false) return { valid:false, reason:'invalid' };
    if (c.expiresAt && new Date(c.expiresAt) < now) return { valid:false, reason:'expired' };
    if (c.maxUses && c.used >= c.maxUses) return { valid:false, reason:'maxed' };
    if (c.userEmails && c.userEmails.length && !c.userEmails.includes(email)) return { valid:false, reason:'restricted' };
    return { valid:true, coupon:c };
  }

  async consume(code){
    code = code.toUpperCase();
    const c = await this.db.findOne('coupons', { code });
    if (!c) throw new Error('Not found');
    await this.db.update('coupons', { id: c.id }, { used: (c.used||0) + 1 });
    return await this.db.findOne('coupons', { id: c.id });
  }

  applyDiscount(amountCents, coupon){
    if (!coupon) return amountCents;
    if (coupon.type === 'percent') {
      return Math.max(0, Math.round(amountCents * (1 - (Number(coupon.value)||0)/100)));
    }
    if (coupon.type === 'fixed') {
      return Math.max(0, Math.round(amountCents - Math.round(Number(coupon.value||0)*100)));
    }
    return amountCents;
  }
}

module.exports = CouponService;
