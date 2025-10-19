/**
 * EZ Sports Netting — Google Apps Script backend for Subscribe + Contact forms
 *
 * What it does
 * - Accepts POSTs from your website (JSON or form-urlencoded)
 * - Detects form type (subscribe vs contact)
 * - Sends an email to the configured inbox
 * - Logs each submission to a Google Sheet (two tabs: Subscriptions, Contacts)
 *
 * How to use
 * 1) Create a Google Sheet and copy its Spreadsheet ID (from the URL).
 * 2) Paste the ID below in CONFIG.SHEET_ID and set CONFIG.EMAIL_TO.
 * 3) In Apps Script editor, paste this file, then Deploy > New deployment > Web app:
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4) Use the Web app URL as your form action (POST) or fetch() endpoint.
 *
 * NOTE: The email address here uses the spelling provided: info@ezsportsnettting.com (with three 't').
 *       If that's a typo, change CONFIG.EMAIL_TO to the correct address.
 */

const CONFIG = {
  SHEET_ID: '1AtqZc5XzZzuP3jDdXXz3P2cRHnIbeQgvn6lyGwaF3Ks',
  EMAIL_TO: 'info@ezsportsnetting.com', // main inbox
  ENABLE_EMAIL: true,
  ENABLE_SHEETS: true,
  EMAIL_CC: [], // optional list of additional recipients
  TEST_EMAIL: 'hligon@getsparqd.com', // testing address (temporary)
  FORCE_TEST_CC: true, // temporarily CC test email on all sends during testing
  BOT_MIN_MS: 1200, // minimum elapsed ms required before submit (timing heuristic)
  // Optional: add an API key and include it in requests via header 'X-API-Key' or query 'key'
  API_KEY: '',
  // Optional: reCAPTCHA secret. If provided, requests must include recaptchaToken (v3/v2) to be verified.
  RECAPTCHA_SECRET: '',
  // Optional: Cloudflare Turnstile secret. If provided, requests must include cf-turnstile-response to be verified.
  TURNSTILE_SECRET: '',
  // Optional: restrict accepted Referer/Origin domains
  ALLOWED_ORIGINS: ['https://ezsportsnetting.com', 'https://www.ezsportsnetting.com', 'http://localhost:5500', 'http://127.0.0.1:5500'],
  // Optional end‑user autoresponder controls
  AUTOREPLY: {
    ENABLE_SUBSCRIBE: true,
    ENABLE_CONTACT: true,
    FROM: 'EZ Sports Netting <no-reply@ezsportsnetting.com>',
    SUBJECT_SUBSCRIBE: 'Thanks for subscribing to EZ Sports Netting',
    SUBJECT_CONTACT: 'We received your message',
    // If you want a BCC of every autoresponse for audit, set value below; else leave blank
    BCC: ''
  }
};

const SHEETS = {
  SUBS: 'Subscribers',
  CONTACTS: 'ContactForm'
};

function doGet(e) {
  return _json({ ok: true, message: 'EZ Sports form endpoint. Use POST.' });
}

function doPost(e) {
  try {
    if (CONFIG.API_KEY) {
      const k = (e?.parameter?.key || _header(e, 'x-api-key') || '').trim();
      if (k !== CONFIG.API_KEY) return _json({ ok: false, error: 'Unauthorized' }, 401);
    }

  const payload = _parseRequest(e) || {};
    // Optional origin check
    if (Array.isArray(CONFIG.ALLOWED_ORIGINS) && CONFIG.ALLOWED_ORIGINS.length) {
      var ref = _header(e, 'referer') || e?.parameter?.referer || '';
      var okOrigin = CONFIG.ALLOWED_ORIGINS.some(function(o){ return ref && (ref.indexOf(o) === 0); });
      if (!okOrigin && ref) {
        // If Referer is present but not allowed, silently accept but drop
        return _json({ ok: true });
      }
    }

    // Optional Cloudflare Turnstile verification (preferred)
    // Prefer Script Properties value over in-source secret so secret isn't kept in version control.
    var scriptProps = null; try { scriptProps = PropertiesService.getScriptProperties(); } catch (e2) {}
    var TURNSTILE_SECRET = (scriptProps && scriptProps.getProperty('TURNSTILE_SECRET')) || CONFIG.TURNSTILE_SECRET;
    if (TURNSTILE_SECRET) {
      var tsToken = (payload['cf-turnstile-response'] || payload.turnstileToken || '').toString().trim();
      var ipTs = (_header(e, 'x-forwarded-for') || '').split(',')[0].trim();
      if (!tsToken || !_verifyTurnstile(TURNSTILE_SECRET, tsToken, ipTs)) {
        return _json({ ok: true }); // pretend success
      }
    }

    // Optional reCAPTCHA verification
    if (CONFIG.RECAPTCHA_SECRET) {
      var token = (payload.recaptchaToken || payload['g-recaptcha-response'] || '').toString().trim();
      var ip = (_header(e, 'x-forwarded-for') || '').split(',')[0].trim();
      if (!token || !_verifyRecaptcha(CONFIG.RECAPTCHA_SECRET, token, ip)) {
        return _json({ ok: true }); // pretend success
      }
    }
    // Bot guard: honeypot/timing/rate limit. If flagged, return ok without processing.
    const botCheck = _isBot(e, payload);
    if (botCheck.flag) {
      const dbg = (payload && (payload.test === '1' || payload.debug === '1')) || (e && e.parameter && (e.parameter.test === '1' || e.parameter.debug === '1'));
      return _json({ ok: true, debug: dbg ? botCheck : undefined }); // Pretend OK
    }
  const kind = _detectFormType(payload);

    if (kind === 'subscribe') {
      return _handleSubscribe(payload, e);
    } else if (kind === 'contact') {
      return _handleContact(payload, e);
    } else {
      return _json({ ok: false, error: 'Unknown form type' }, 400);
    }
  } catch (err) {
    return _json({ ok: false, error: String(err && err.message || err) }, 500);
  }
}

// --- Handlers ---
function _handleSubscribe(data, e) {
  data = data || {};
  const email = String(data.email || data.e || '').trim();
  if (!email || !_isValidEmail(email)) return _json({ ok: false, error: 'Email required' }, 400);
  const when = new Date();
  const meta = _metaFromRequest(e);

  if (CONFIG.ENABLE_EMAIL) {
    const subject = `New subscriber: ${email}`;
    const body = _kv({ Email: email, Source: data.source || '', Time: when, ...meta });
    const cc = _computeCc(e, data);
    MailApp.sendEmail({ to: CONFIG.EMAIL_TO, subject, htmlBody: _html(body), replyTo: email, cc: cc.join(',') });
  }

  if (CONFIG.ENABLE_SHEETS && CONFIG.SHEET_ID) {
    const sheet = _getOrCreateSheet(SHEETS.SUBS, ['Time', 'Email', 'Source', 'Referer', 'IP', 'UA']);
    sheet.appendRow([
      when,
      email,
      data.source || '',
      meta.referer || '',
      meta.ip || '',
      meta.ua || ''
    ]);
  }

  const resp1 = { ok: true, type: 'subscribe' };
  // Optional autoresponder
  try {
    if (CONFIG.AUTOREPLY && CONFIG.AUTOREPLY.ENABLE_SUBSCRIBE && email && _isValidEmail(email)) {
      _sendAutoReply('subscribe', { email: email });
      resp1.autoreply = true;
    }
  } catch (er) { resp1.autoreplyError = String(er); }
  resp1.message = 'Subscription received';
  if (e && e.parameter && (e.parameter.test === '1' || e.parameter.debug === '1')) resp1.debug = { kind: 'subscribe' };
  return _json(resp1);
}

function _handleContact(data, e) {
  data = data || {};
  const name = String(data.name || data.fullName || '').trim();
  const email = String(data.email || '').trim();
  const subjectIn = String(data.subject || data.topic || 'Contact form').trim();
  const phone = String(data.phone || data.tel || '').trim();
  const message = String(data.message || data.msg || '').trim();
  const when = new Date();
  const meta = _metaFromRequest(e);

  if (!message && !email) return _json({ ok: false, error: 'Missing message or email' }, 400);

  if (CONFIG.ENABLE_EMAIL) {
    const subject = `Contact form — ${name || '(no name)'}${email ? ` <${email}>` : ''}`;
    const body = _kv({
      Name: name,
      Email: email,
      Phone: phone,
      Subject: subjectIn,
      Message: message,
      Time: when,
      ...meta
    });
    const cc = _computeCc(e, data);
    MailApp.sendEmail({ to: CONFIG.EMAIL_TO, subject, htmlBody: _html(body), replyTo: email || CONFIG.EMAIL_TO, cc: cc.join(',') });
  }

  if (CONFIG.ENABLE_SHEETS && CONFIG.SHEET_ID) {
    const sheet = _getOrCreateSheet(SHEETS.CONTACTS, ['Time', 'Name', 'Email', 'Phone', 'Subject', 'Message', 'Referer', 'IP', 'UA']);
    sheet.appendRow([
      when,
      name,
      email,
      phone,
      subjectIn,
      message,
      meta.referer || '',
      meta.ip || '',
      meta.ua || ''
    ]);
  }

  const resp2 = { ok: true, type: 'contact' };
  // Optional autoresponder
  try {
    if (CONFIG.AUTOREPLY && CONFIG.AUTOREPLY.ENABLE_CONTACT && email && _isValidEmail(email)) {
      _sendAutoReply('contact', { email: email, name: name, message: message, subject: subjectIn });
      resp2.autoreply = true;
    }
  } catch (er2) { resp2.autoreplyError = String(er2); }
  resp2.message = 'Message received';
  if (e && e.parameter && (e.parameter.test === '1' || e.parameter.debug === '1')) resp2.debug = { kind: 'contact' };
  return _json(resp2);
}

// === Weekly subscriber report ===
// Sends a report of new subscribers since the last run (tracked in Script Properties)
function weeklySubscriberReport() {
  try {
    if (!CONFIG.ENABLE_SHEETS || !CONFIG.SHEET_ID) return;
    var ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
    var sheet = ss.getSheetByName(SHEETS.SUBS);
    if (!sheet) return;
    var props = PropertiesService.getScriptProperties();
    var lastIso = props.getProperty('SUBS_LAST_REPORT_AT');
    var last = lastIso ? new Date(lastIso) : new Date(0);

    // Assumes header row exists; data starts at row 2
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) {
      _sendReportEmail([], last);
      props.setProperty('SUBS_LAST_REPORT_AT', new Date().toISOString());
      return;
    }
    var range = sheet.getRange(2, 1, lastRow - 1, 6); // Time, Email, Source, Referer, IP, UA
    var values = range.getValues();
    var rows = values.map(function(r){ return { time: r[0], email: r[1], source: r[2], referer: r[3] }; });
    var recent = rows.filter(function(x){ return x.time && x.time > last; });
    _sendReportEmail(recent, last);
    props.setProperty('SUBS_LAST_REPORT_AT', new Date().toISOString());
  } catch (err) {
    // swallow errors to avoid alert loops
  }
}

function _sendReportEmail(recent, sinceDate) {
  try {
    var to = CONFIG.EMAIL_TO;
    var ccList = _computeCc(null, { test: CONFIG.FORCE_TEST_CC ? '1' : '0' });
    var subject = 'Weekly Subscriber Report — ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
    var since = sinceDate ? Utilities.formatDate(sinceDate, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm') : 'beginning';
    var html;
    if (!recent || recent.length === 0) {
      html = _html('<p>No new subscribers since ' + _esc(since) + '.</p>');
    } else {
      var rows = recent.map(function(x){
        var t = Utilities.formatDate(new Date(x.time), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
        return '<tr><td>' + _esc(t) + '</td><td>' + _esc(x.email) + '</td><td>' + _esc(x.source||'') + '</td><td>' + _esc(x.referer||'') + '</td></tr>';
      }).join('');
      var table = '<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">' +
                  '<tr><th>Time</th><th>Email</th><th>Source</th><th>Referer</th></tr>' + rows + '</table>';
      html = _html('<p>New subscribers since ' + _esc(since) + ':</p>' + table + '<p>Total: ' + recent.length + '</p>');
    }
    MailApp.sendEmail({ to: to, subject: subject, htmlBody: html, cc: ccList.join(',') });
  } catch (err) {}
}

// To enable: In Apps Script UI, Triggers > Add Trigger > choose weeklySubscriberReport, time-based, weekly, Sunday

// --- Helpers ---
function _parseRequest(e) {
  try {
    const ct = String(e?.postData?.type || '').toLowerCase();
    const raw = e?.postData?.contents || '';
    if (ct.includes('json')) {
      return JSON.parse(raw || '{}');
    }
    // Heuristic: handle JSON sent as text/plain or missing content-type
    const firstChar = (raw || '').trim().charAt(0);
    if (firstChar === '{' || firstChar === '[') {
      try { return JSON.parse(raw); } catch (err) {}
    }
  } catch (err) {}

  // Fallback to form fields (application/x-www-form-urlencoded or multipart)
  const params = e?.parameter || {};
  const obj = {};
  for (var k in params) { obj[k] = params[k]; }
  return obj;
}

function _detectFormType(data) {
  data = data || {};
  const t = String(data.type || data.formType || '').toLowerCase();
  if (['subscribe','subscription','sub','newsletter'].includes(t)) return 'subscribe';
  if (['contact','support','message'].includes(t)) return 'contact';
  // Heuristics
  if (data.message || data.name || data.fullName || data.phone || data.subject) return 'contact';
  if (data.email && !(data.message || data.name)) return 'subscribe';
  return 'subscribe';
}

function _metaFromRequest(e) {
  const referer = _header(e, 'referer') || e?.parameter?.referer || '';
  const ua = _header(e, 'user-agent') || '';
  const ip = _header(e, 'x-forwarded-for') || '';
  return { referer, ua, ip };
}

function _header(e, name) {
  try {
    const all = e?.headers || {};
    const keys = Object.keys(all);
    const k = keys.find(x => x.toLowerCase() === String(name).toLowerCase());
    return k ? all[k] : '';
  } catch { return ''; }
}

function _getOrCreateSheet(name, headers) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEET_ID);
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (!headers || !headers.length) {
      headers = (name === SHEETS.SUBS)
        ? ['Time', 'Email', 'Source', 'Referer', 'IP', 'UA']
        : ['Time', 'Name', 'Email', 'Phone', 'Subject', 'Message', 'Referer', 'IP', 'UA'];
    }
    sheet.appendRow(headers);
  } else {
    // Ensure headers exist in first row if empty
    if (sheet.getLastRow() === 0) {
      if (!headers || !headers.length) {
        headers = (name === SHEETS.SUBS)
          ? ['Time', 'Email', 'Source', 'Referer', 'IP', 'UA']
          : ['Time', 'Name', 'Email', 'Phone', 'Subject', 'Message', 'Referer', 'IP', 'UA'];
      }
      sheet.appendRow(headers);
    }
  }
  return sheet;
}

function _isValidEmail(s) {
  return /.+@.+\..+/.test(String(s || '').trim());
}

function _kv(obj) {
  obj = obj || {};
  return Object.entries(obj).map(([k, v]) => `<div><strong>${_esc(k)}:</strong> ${_esc(String(v))}</div>`).join('');
}

function _html(inner) {
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Inter,Arial,sans-serif;font-size:14px;line-height:1.5;color:#111">
  ${inner}
</div>`;
}

function _esc(s) {
  return String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
}

function _json(obj, status) {
  const out = ContentService.createTextOutput(JSON.stringify(obj));
  out.setMimeType(ContentService.MimeType.JSON);
  // Apps Script ContentService cannot set custom status codes; include status in body
  return out;
}

// --- Bot protection ---
function _isBot(e, data) {
  try {
    const testFlag = (data && (data.test === true || data.test === '1' || data.debug === '1')) || (e && e.parameter && (e.parameter.test === '1' || e.parameter.debug === '1'));
    if (testFlag) return { flag: false, reason: 'test' };
    // 1) Honeypot fields that real users leave empty
    const hpFields = ['hp', 'honeypot', 'company', 'website', 'url'];
    for (var i = 0; i < hpFields.length; i++) {
      if ((data[hpFields[i]] || '').toString().trim().length > 0) return { flag: true, reason: 'honeypot', field: hpFields[i] };
    }

    // 2) JS fingerprint and timing combined check
    const finger = (data.finger || data.fingerprint || '').toString().trim();
    const started = Number(data.started || data.ts || 0);
    const now = Date.now();
    const minMs = Number(CONFIG.BOT_MIN_MS || 1200);
    const elapsed = (started && !isNaN(started)) ? (now - started) : 0;
    // allow pass if either finger is ok OR elapsed >= minMs
    if (!(finger === 'ok' || elapsed >= minMs)) {
      return { flag: true, reason: 'finger_or_timing', finger, elapsed };
    }
    if (elapsed && elapsed > 2 * 60 * 60 * 1000) return { flag: true, reason: 'too_old', elapsed };

    // 3) Simple IP rate limit
    const ip = (_header(e, 'x-forwarded-for') || '').split(',')[0].trim();
    if (ip) {
      const cache = CacheService.getScriptCache();
      const key = 'rl:' + ip;
      const raw = cache.get(key);
      const count = raw ? Number(raw) : 0;
      if (count >= 30) return { flag: true, reason: 'rate_limit', count };
      cache.put(key, String(count + 1), 3600); // 1 hour window
    }

    // 4) User-Agent heuristics (missing or obvious non-browser clients)
    var ua = _header(e, 'user-agent') || '';
    if (!ua) return { flag: true, reason: 'ua_missing' };
    var uaBad = /(curl|wget|python-requests|httpclient|libwww|postman|insomnia|java|okhttp|apache-httpclient|bot|crawler)/i.test(ua);
    if (uaBad) return { flag: true, reason: 'ua_blacklist', ua: ua };

    // 5) Message phishing heuristics: excessive links or HTML markup
    var msg = (data.message || data.msg || '').toString();
    if (msg) {
      var urlMatches = msg.match(/\bhttps?:\/\/|\bwww\./gi);
      var linkCount = urlMatches ? urlMatches.length : 0;
      if (linkCount >= 3) return { flag: true, reason: 'too_many_links', links: linkCount };
      if (/<\s*a\s+href|<script|<iframe/i.test(msg)) return { flag: true, reason: 'html_in_message' };
      if (msg.length > 5000) return { flag: true, reason: 'message_too_long' };
    }
    return { flag: false };
  } catch (err) {
    // Fail-closed for safety
    return { flag: true, reason: 'exception', error: String(err && err.message || err) };
  }
}

function _computeCc(e, data) {
  const list = [];
  // Configured CCs
  if (Array.isArray(CONFIG.EMAIL_CC)) list.push.apply(list, CONFIG.EMAIL_CC.filter(Boolean));
  // Optional test CC
  const testFlag = (data && (data.test === true || data.test === '1')) || (e && e.parameter && e.parameter.test === '1');
  if (CONFIG.TEST_EMAIL && (CONFIG.FORCE_TEST_CC || testFlag)) list.push(CONFIG.TEST_EMAIL);
  // Dedupe and clean
  return Array.from(new Set(list.map(String).filter(Boolean)));
}

// --- Autoresponder ---
function _sendAutoReply(kind, ctx) {
  try {
    if (!CONFIG.AUTOREPLY) return;
    var email = (ctx && ctx.email) || '';
    if (!email || !_isValidEmail(email)) return;
    var from = CONFIG.AUTOREPLY.FROM || CONFIG.EMAIL_TO;
    var bcc = CONFIG.AUTOREPLY.BCC || '';
    if (kind === 'subscribe' && CONFIG.AUTOREPLY.ENABLE_SUBSCRIBE) {
      var subjS = CONFIG.AUTOREPLY.SUBJECT_SUBSCRIBE || 'Thanks for subscribing';
      var bodyS = _html('<p>Thanks for subscribing to EZ Sports Netting! You\'re now on the list for product updates, facility build tips, and launch announcements.</p><p>- The EZ Sports Team</p>');
      MailApp.sendEmail({ to: email, subject: subjS, htmlBody: bodyS, name: from, bcc: bcc });
    } else if (kind === 'contact' && CONFIG.AUTOREPLY.ENABLE_CONTACT) {
      var subjC = CONFIG.AUTOREPLY.SUBJECT_CONTACT || 'We received your message';
      var preview = (ctx && ctx.message) ? (String(ctx.message).slice(0,160)) : '';
      var bodyC = _html('<p>We\'ve received your message' + (ctx && ctx.name ? (', ' + _esc(ctx.name)) : '') + '.</p>' + (preview ? ('<blockquote style="border-left:3px solid #ddd;margin:1em 0;padding:.5em 1em;font-style:italic">' + _esc(preview) + (ctx.message.length>160?'…':'') + '</blockquote>') : '') + '<p>A member of the team will get back to you shortly. If this is urgent, you can reply directly to this email.</p><p>- The EZ Sports Team</p>');
      MailApp.sendEmail({ to: email, subject: subjC, htmlBody: bodyC, name: from, bcc: bcc });
    }
  } catch(err) {
    // Silent fail; autoresponder should not block core flow
  }
}

// --- Optional reCAPTCHA verify ---
function _verifyRecaptcha(secret, token, remoteip) {
  try {
    var url = 'https://www.google.com/recaptcha/api/siteverify';
    var payload = {
      method: 'post',
      payload: { secret: secret, response: token, remoteip: remoteip || '' },
      muteHttpExceptions: true
    };
    var res = UrlFetchApp.fetch(url, payload);
    var text = res && res.getContentText ? res.getContentText() : '';
    var json = (text && text.charAt(0) === '{') ? JSON.parse(text) : {};
    return !!json.success;
  } catch (err) {
    return false;
  }
}

function _verifyTurnstile(secret, token, remoteip) {
  try {
    var url = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
    var payload = {
      method: 'post',
      payload: { secret: secret, response: token, remoteip: remoteip || '' },
      muteHttpExceptions: true
    };
    var res = UrlFetchApp.fetch(url, payload);
    var text = res && res.getContentText ? res.getContentText() : '';
    var json = (text && text.charAt(0) === '{') ? JSON.parse(text) : {};
    return !!json.success;
  } catch (err) {
    return false;
  }
}
