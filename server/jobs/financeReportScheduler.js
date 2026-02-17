const PayoutReportService = require('../services/PayoutReportService');

function parseHHMM(v) {
  const m = String(v || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hh = Math.max(0, Math.min(23, parseInt(m[1], 10)));
  const mm = Math.max(0, Math.min(59, parseInt(m[2], 10)));
  return { hh, mm };
}

function msUntilNextUTC({ hh, mm }) {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hh, mm, 0, 0));
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - now.getTime();
}

function parseWeekday(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return null;
  const map = {
    sun: 0, sunday: 0,
    mon: 1, monday: 1,
    tue: 2, tues: 2, tuesday: 2,
    wed: 3, wednesday: 3,
    thu: 4, thur: 4, thurs: 4, thursday: 4,
    fri: 5, friday: 5,
    sat: 6, saturday: 6
  };
  if (Object.prototype.hasOwnProperty.call(map, s)) return map[s];
  const n = Number(s);
  if (Number.isInteger(n) && n >= 0 && n <= 6) return n;
  return null;
}

function startFinanceReportScheduler() {
  const enabled = String(process.env.FINANCE_REPORT_ENABLED || '').toLowerCase() === 'true';
  if (!enabled) return { enabled: false };

  const utcTime = parseHHMM(process.env.FINANCE_REPORT_TIME_UTC || '09:15') || { hh: 9, mm: 15 };
  const weeklyDay = parseWeekday(process.env.FINANCE_REPORT_WEEKLY_DAY_UTC || '') ?? 1; // default: Monday
  const svc = new PayoutReportService();

  const run = async () => {
    try {
      await svc.sendDailyPayoutReport({ day: 'yesterday' });
      console.log('[finance-report] daily payout report sent');

      const now = new Date();
      if (now.getUTCDay() === weeklyDay) {
        await svc.sendWeeklyPayoutReport({ end: now });
        console.log('[finance-report] weekly payout report sent');
      }
    } catch (e) {
      console.warn('[finance-report] failed:', e?.message || e);
    } finally {
      setTimeout(run, 24 * 60 * 60 * 1000);
    }
  };

  const delay = msUntilNextUTC(utcTime);
  console.log(`[finance-report] scheduled for ${String(utcTime.hh).padStart(2,'0')}:${String(utcTime.mm).padStart(2,'0')} UTC (in ${Math.round(delay/1000)}s); weekly day UTC=${weeklyDay}`);
  setTimeout(run, delay);

  return { enabled: true, timeUTC: utcTime, weeklyDayUTC: weeklyDay };
}

module.exports = { startFinanceReportScheduler };
