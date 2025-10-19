// Minimal isolated forms wiring (subscribe + contact)
// Safe to load while main app.js is in repair. Preserves existing endpoint & Turnstile usage.
(function(){
  const FORM_ENDPOINT = 'https://script.google.com/macros/s/AKfycbw1npuTQiIpGQqlB6LPh4AoihC9bVW8XngIq270ZYaQfZ7msW1zz5cOjmWwATkrqtmr/exec';
  // Prefer calling the Render backend directly so emails queue server-side; fallback to Apps Script if needed.
  function apiBases(){
    const bases = [];
    try { if (window.__API_BASE) bases.push(String(window.__API_BASE).replace(/\/$/, '')); } catch {}
    try { const meta = document.querySelector('meta[name="api-base"]'); if (meta && meta.content) bases.push(String(meta.content).replace(/\/$/, '')); } catch {}
    // Default known backend
    bases.push('https://ezsportsapp.onrender.com');
    // de-dup
    return Array.from(new Set(bases.filter(Boolean)));
  }
  function endpointsFor(kind){
    const path = kind === 'subscribe' ? '/api/marketing/subscribe' : '/api/marketing/contact';
    const list = apiBases().map(b => `${b}${path}`);
    // For subscribe, include Apps Script as an extra logging fallback; for contact, do NOT (CORS + spam/security)
    if (kind === 'subscribe') list.push(FORM_ENDPOINT);
    return list;
  }
  // Prefer a single shared token fetcher from app.js to avoid duplicate execute() calls
  const SITE_KEY = window.TURNSTILE_SITE_KEY || '0x4AAAAAAB5rtUiQ1MiqGIxp';
  async function getToken(){
    try {
      if (typeof window.getTurnstileToken === 'function') {
        return await window.getTurnstileToken();
      }
      // Fallback minimal: no token
      return '';
    } catch { return ''; }
  }

  function ensureHidden(form,name,val){
    if (form.querySelector(`[name="${name}"]`)) return;
    const inp=document.createElement('input');
    inp.type='hidden'; inp.name=name; inp.value=val;
    form.appendChild(inp);
  }

  function wireSubscribeForms(){
    document.querySelectorAll('form.subscribe').forEach(form => {
      if (form.__wired) return; form.__wired = true;
      // honeypot text field
      if (!form.querySelector('input[name="hp"]')) { const hp=document.createElement('input'); hp.type='text'; hp.name='hp'; hp.style.display='none'; form.appendChild(hp); }
      ensureHidden(form,'started', String(Date.now()));
      ensureHidden(form,'finger','ok');
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const emailInput = form.querySelector('input[type="email"]');
        const email = (emailInput?.value||'').trim();
        if (!email) { alert('Please enter your email.'); return; }
        let statusEl=form.querySelector('.subscribe-status');
        if (!statusEl){ statusEl=document.createElement('div'); statusEl.className='subscribe-status muted'; statusEl.style.marginTop='.5rem'; form.appendChild(statusEl); }
        statusEl.textContent='Subscribing…';
        try {
          const token = await getToken();
          const payload = {
            type:'subscribe', email,
            finger:'ok', started:Number(form.querySelector('input[name="started"]').value||Date.now()),
            source:(location.pathname||'').replace(/^\\/,'/'),
            referer: document.referrer||'',
            'cf-turnstile-response': token
          };
          // Try server endpoints first (Render backend), then fallback to Apps Script
          let data = {};
          let ok = false;
          for (const url of endpointsFor('subscribe')) {
            try {
              const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
              data = await res.json().catch(()=>({}));
              if (res.ok && data && data.ok !== false) { ok = true; break; }
            } catch { /* try next */ }
          }
          // Treat success only when not flagged as spam and either
          // - proxy saved a subscriber record, or
          // - Apps Script returned ok (no spam signal from GAS).
          const isSpam = data && (data.spam === true);
          const savedViaProxy = !!(data && data.ok && data.subscriber && data.subscriber.id);
          const okViaAppsScript = !!(data && data.ok && !('subscriber' in data));
          if (!ok || isSpam || !(savedViaProxy || okViaAppsScript)) {
            console.debug('Subscribe: not confirmed:', { data, isSpam, savedViaProxy, okViaAppsScript });
            throw 0;
          }
          statusEl.textContent='Subscribed! Check your inbox for future deals.';
          if (emailInput) emailInput.value='';
        } catch { statusEl.textContent='Could not subscribe right now.'; }
      }, { once:false });
    });
  }

  function wireContactForm(){
    const form = document.getElementById('contact-form');
    if (!form || form.__wired) return; form.__wired=true;
    if (!form.querySelector('input[name="hp"]')) { const hp=document.createElement('input'); hp.type='text'; hp.name='hp'; hp.style.display='none'; form.appendChild(hp); }
    ensureHidden(form,'started', String(Date.now()));
    ensureHidden(form,'finger','ok');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const msgEl = form.querySelector('.form-msg') || (()=>{const d=document.createElement('div'); d.className='form-msg'; form.appendChild(d); return d;})();
      msgEl.textContent='Sending…'; msgEl.style.color='';
      try {
        const fd = new FormData(form);
        const token = await getToken();
        const payload = {
          type:'contact',
          name: fd.get('name')||'',
            email: fd.get('email')||'',
          phone: fd.get('phone')||'',
          message: fd.get('message')||'',
          finger:'ok',
          started:Number(form.querySelector('input[name="started"]').value||Date.now()),
          source:(location.pathname||'').replace(/^\\/,'/'),
          referer: document.referrer||'',
          'cf-turnstile-response': token
        };
        // Try server endpoints first, then fallback to Apps Script
        let data = {};
        let ok = false;
        for (const url of endpointsFor('contact')) {
          try {
            const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
            data = await res.json().catch(()=>({}));
            if (res.ok && data && data.ok !== false) { ok = true; break; }
          } catch { /* try next */ }
        }
        if (!ok || !data.ok) throw 0;
        msgEl.textContent='Message sent!'; msgEl.style.color='green';
        form.reset();
      } catch { msgEl.textContent='Could not send right now.'; msgEl.style.color='red'; }
    });
  }

  function init(){ wireSubscribeForms(); wireContactForm(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
