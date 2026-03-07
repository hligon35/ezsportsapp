const crypto = require('crypto');
const DatabaseManager = require('../database/DatabaseManager');

function uniq(values = []) {
  return Array.from(new Set(values.filter(Boolean).map(v => String(v).trim()).filter(Boolean)));
}

class TrackingIdentityService {
  constructor() {
    this.db = new DatabaseManager();
  }

  normalizeEmail(email) {
    const normalized = String(email || '').trim().toLowerCase();
    return normalized || null;
  }

  hashEmail(email) {
    const normalized = this.normalizeEmail(email);
    if (!normalized) return null;
    return crypto.createHash('sha256').update(normalized).digest('hex');
  }

  async stitchIdentity(payload = {}) {
    const visitorId = payload.visitorId ? String(payload.visitorId) : null;
    const sessionId = payload.sessionId ? String(payload.sessionId) : null;
    const userId = payload.userId !== undefined && payload.userId !== null ? String(payload.userId) : null;
    const email = this.normalizeEmail(payload.email || null);
    const emailHash = payload.emailHash || this.hashEmail(email);
    const records = await this.db.find('identity_map');
    const all = Array.isArray(records) ? records : [];

    const matches = all.filter(record => {
      if (!record || record.mergedIntoIdentityId) return false;
      if (visitorId && (record.visitorId === visitorId || (record.aliasVisitorIds || []).includes(visitorId))) return true;
      if (userId && (record.userIds || []).map(String).includes(userId)) return true;
      if (emailHash && (record.emailHashes || []).includes(emailHash)) return true;
      return false;
    });

    let primary = matches[0] || null;
    if (!primary) {
      primary = await this.db.insert('identity_map', {
        visitorId,
        aliasVisitorIds: [],
        sessionIds: uniq([sessionId]),
        userIds: uniq([userId]),
        emails: uniq([email]),
        emailHashes: uniq([emailHash]),
        firstSeenAt: payload.occurredAt || payload.timestamp || new Date().toISOString(),
        lastSeenAt: payload.occurredAt || payload.timestamp || new Date().toISOString(),
        lastSource: payload.source || 'unknown',
        mergedIntoIdentityId: null
      });
      return {
        identityId: primary.id,
        visitorId: primary.visitorId,
        userId,
        email,
        emailHash
      };
    }

    const aliasVisitorIds = uniq([
      ...(primary.aliasVisitorIds || []),
      ...matches.slice(1).map(record => record.visitorId),
      ...matches.slice(1).flatMap(record => record.aliasVisitorIds || []),
      visitorId && visitorId !== primary.visitorId ? visitorId : null
    ]);

    await this.db.update('identity_map', { id: primary.id }, {
      visitorId: primary.visitorId || visitorId,
      aliasVisitorIds,
      sessionIds: uniq([...(primary.sessionIds || []), sessionId]),
      userIds: uniq([...(primary.userIds || []), userId]),
      emails: uniq([...(primary.emails || []), email]),
      emailHashes: uniq([...(primary.emailHashes || []), emailHash]),
      lastSeenAt: payload.occurredAt || payload.timestamp || new Date().toISOString(),
      lastSource: payload.source || primary.lastSource || 'unknown'
    });

    for (const record of matches.slice(1)) {
      await this.db.update('identity_map', { id: record.id }, {
        mergedIntoIdentityId: primary.id,
        lastSeenAt: payload.occurredAt || payload.timestamp || new Date().toISOString()
      });
    }

    return {
      identityId: primary.id,
      visitorId: primary.visitorId || visitorId,
      userId: userId || (primary.userIds || [])[0] || null,
      email: email || (primary.emails || [])[0] || null,
      emailHash: emailHash || (primary.emailHashes || [])[0] || null
    };
  }
}

module.exports = TrackingIdentityService;