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

function parseTimeZone(v) {
  const tz = String(v || '').trim();
  if (!tz) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date()); } catch { return null; }
  return tz;
}

function getZonedParts(ts, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
  const parts = dtf.formatToParts(new Date(ts));
  const map = Object.create(null);
  for (const p of parts) map[p.type] = p.value;
  return {
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10),
    day: parseInt(map.day, 10),
    hour: parseInt(map.hour, 10),
    minute: parseInt(map.minute, 10)
  };
}

function pseudoUtcMs({ year, month, day, hour, minute }) {
  return Date.UTC(year, month - 1, day, hour, minute, 0, 0);
}

function findUtcForLocalTime({ timeZone, year, month, day, hh, mm }) {
  let guess = Date.UTC(year, month - 1, day, hh, mm, 0, 0);
  const targetPseudo = pseudoUtcMs({ year, month, day, hour: hh, minute: mm });

  for (let i = 0; i < 6; i++) {
    const got = getZonedParts(guess, timeZone);
    const gotPseudo = pseudoUtcMs({ year: got.year, month: got.month, day: got.day, hour: got.hour, minute: got.minute });
    const delta = gotPseudo - targetPseudo;
    if (delta === 0) return guess;
    guess -= delta;
  }

  for (let off = -180; off <= 180; off++) {
    const cand = guess + off * 60 * 1000;
    const got = getZonedParts(cand, timeZone);
    if (got.year === year && got.month === month && got.day === day && got.hour === hh && got.minute === mm) return cand;
  }
  return guess;
}

function msUntilNextLocal({ hh, mm, timeZone }) {
  const nowMs = Date.now();
  for (let addDays = 0; addDays <= 2; addDays++) {
    const sample = nowMs + addDays * 24 * 60 * 60 * 1000;
    const d = getZonedParts(sample, timeZone);
    const runAtUtc = findUtcForLocalTime({ timeZone, year: d.year, month: d.month, day: d.day, hh, mm });
    if (runAtUtc > nowMs) return runAtUtc - nowMs;
  }
  return 24 * 60 * 60 * 1000;
}

function getZonedWeekday(ts, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' });
  const w = dtf.format(new Date(ts)).toLowerCase();
  const map = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  return map[w] ?? null;
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

  const tz = parseTimeZone(process.env.FINANCE_REPORT_TZ || process.env.TZ || '');
  const localTime = parseHHMM(process.env.FINANCE_REPORT_TIME_LOCAL || '');
  const utcTime = parseHHMM(process.env.FINANCE_REPORT_TIME_UTC || '09:15') || { hh: 9, mm: 15 };
  const time = (tz && localTime) ? localTime : utcTime;

  const weeklyDayUtc = parseWeekday(process.env.FINANCE_REPORT_WEEKLY_DAY_UTC || '') ?? 1; // default: Monday
  const weeklyDayLocal = parseWeekday(process.env.FINANCE_REPORT_WEEKLY_DAY_LOCAL || '') ?? weeklyDayUtc;
  const svc = new PayoutReportService();

  const computeDelay = () => {
    if (tz && localTime) return msUntilNextLocal({ hh: time.hh, mm: time.mm, timeZone: tz });
    return msUntilNextUTC(time);
  };

  const run = async () => {
    try {
      await svc.sendDailyPayoutReport({ day: 'yesterday' });
      console.log('[finance-report] daily payout report sent');

      const now = new Date();
      const shouldSendWeekly = (tz && localTime)
        ? (getZonedWeekday(now.getTime(), tz) === weeklyDayLocal)
        : (now.getUTCDay() === weeklyDayUtc);
      if (shouldSendWeekly) {
        await svc.sendWeeklyPayoutReport({ end: now });
        console.log('[finance-report] weekly payout report sent');
      }
    } catch (e) {
      console.warn('[finance-report] failed:', e?.message || e);
    } finally {
      setTimeout(run, computeDelay());
    }
  };

  const delay = computeDelay();
  if (tz && localTime) {
    console.log(`[finance-report] scheduled for ${String(time.hh).padStart(2,'0')}:${String(time.mm).padStart(2,'0')} ${tz} (in ${Math.round(delay / 1000)}s); weekly day local=${weeklyDayLocal}`);
  } else {
    console.log(`[finance-report] scheduled for ${String(time.hh).padStart(2,'0')}:${String(time.mm).padStart(2,'0')} UTC (in ${Math.round(delay / 1000)}s); weekly day UTC=${weeklyDayUtc}`);
  }
  setTimeout(run, delay);

  return (tz && localTime)
    ? { enabled: true, timeLocal: time, timeZone: tz, weeklyDayLocal }
    : { enabled: true, timeUTC: time, weeklyDayUTC: weeklyDayUtc };
}

module.exports = { startFinanceReportScheduler };
