const DailyReportService = require('../services/DailyReportService');

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
  // Validate timeZone string (throws RangeError if invalid)
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
  // Iterative correction: adjust a UTC guess until its formatted local parts match target.
  let guess = Date.UTC(year, month - 1, day, hh, mm, 0, 0);
  const targetPseudo = pseudoUtcMs({ year, month, day, hour: hh, minute: mm });

  for (let i = 0; i < 6; i++) {
    const got = getZonedParts(guess, timeZone);
    const gotPseudo = pseudoUtcMs({ year: got.year, month: got.month, day: got.day, hour: got.hour, minute: got.minute });
    const delta = gotPseudo - targetPseudo;
    if (delta === 0) return guess;
    guess -= delta;
  }

  // Fallback: scan nearby minutes (safe + small). 7am always exists, but keep this defensive.
  for (let off = -180; off <= 180; off++) {
    const cand = guess + off * 60 * 1000;
    const got = getZonedParts(cand, timeZone);
    if (got.year === year && got.month === month && got.day === day && got.hour === hh && got.minute === mm) return cand;
  }
  return guess;
}

function msUntilNextLocal({ hh, mm, timeZone }) {
  const nowMs = Date.now();
  const nowLocal = getZonedParts(nowMs, timeZone);

  // Try today in that timezone, else tomorrow.
  for (let addDays = 0; addDays <= 2; addDays++) {
    // Get local Y-M-D for (now + addDays) by sampling midday UTC (avoids edge issues)
    const sample = nowMs + addDays * 24 * 60 * 60 * 1000;
    const d = getZonedParts(sample, timeZone);
    const runAtUtc = findUtcForLocalTime({ timeZone, year: d.year, month: d.month, day: d.day, hh, mm });
    if (runAtUtc > nowMs) return runAtUtc - nowMs;
  }
  // Fallback to 24h
  return 24 * 60 * 60 * 1000;
}

function startDailyReportScheduler() {
  const enabled = String(process.env.DAILY_REPORT_ENABLED || '').toLowerCase() === 'true';
  if (!enabled) return { enabled: false };

  const tz = parseTimeZone(process.env.DAILY_REPORT_TZ || process.env.TZ || '');
  const localTime = parseHHMM(process.env.DAILY_REPORT_TIME_LOCAL || '');
  const utcTime = parseHHMM(process.env.DAILY_REPORT_TIME_UTC || '09:00') || { hh: 9, mm: 0 };
  const time = (tz && localTime) ? localTime : utcTime;
  const svc = new DailyReportService();

  const computeDelay = () => {
    return (tz && localTime)
      ? msUntilNextLocal({ hh: time.hh, mm: time.mm, timeZone: tz })
      : msUntilNextUTC(time);
  };

  const run = async () => {
    try {
      await svc.sendDailyActivityReport({ day: 'yesterday' });
      console.log('[daily-report] sent');
    } catch (e) {
      console.warn('[daily-report] failed:', e?.message || e);
    } finally {
      setTimeout(run, computeDelay());
    }
  };

  const delay = computeDelay();
  if (tz && localTime) {
    console.log(`[daily-report] scheduled for ${String(time.hh).padStart(2,'0')}:${String(time.mm).padStart(2,'0')} ${tz} (in ${Math.round(delay/1000)}s)`);
  } else {
    console.log(`[daily-report] scheduled for ${String(time.hh).padStart(2,'0')}:${String(time.mm).padStart(2,'0')} UTC (in ${Math.round(delay/1000)}s)`);
  }
  setTimeout(run, delay);

  return tz && localTime
    ? { enabled: true, timeLocal: time, timeZone: tz }
    : { enabled: true, timeUTC: time };
}

module.exports = { startDailyReportScheduler };
