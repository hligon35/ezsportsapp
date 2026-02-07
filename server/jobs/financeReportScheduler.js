const FinanceReportService = require('../services/FinanceReportService');

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

function startFinanceReportScheduler() {
  const enabled = String(process.env.FINANCE_REPORT_ENABLED || '').toLowerCase() === 'true';
  if (!enabled) return { enabled: false };

  const utcTime = parseHHMM(process.env.FINANCE_REPORT_TIME_UTC || '09:15') || { hh: 9, mm: 15 };
  const svc = new FinanceReportService();

  const run = async () => {
    try {
      await svc.sendDailyFinanceReport({ day: 'yesterday' });
      console.log('[finance-report] sent');
    } catch (e) {
      console.warn('[finance-report] failed:', e?.message || e);
    } finally {
      setTimeout(run, 24 * 60 * 60 * 1000);
    }
  };

  const delay = msUntilNextUTC(utcTime);
  console.log(`[finance-report] scheduled for ${String(utcTime.hh).padStart(2,'0')}:${String(utcTime.mm).padStart(2,'0')} UTC (in ${Math.round(delay/1000)}s)`);
  setTimeout(run, delay);

  return { enabled: true, timeUTC: utcTime };
}

module.exports = { startFinanceReportScheduler };
