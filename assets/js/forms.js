// Minimal isolated forms wiring (subscribe + contact)
// Safe to load while main app.js is in repair. Preserves existing endpoint & Turnstile usage.
(function(){
  const FORM_ENDPOINT = 'https://script.google.com/macros/s/AKfycbw1npuTQiIpGQqlB6LPh4AoihC9bVW8XngIq270ZYaQfZ7msW1zz5cOjmWwATkrqtmr/exec';
  // Decide endpoint strategy:
  // 1. If running on production domain, use relative /api proxies (hide upstream URL & enable easier header control).
  // 2. If running on localhost AND the user created the marketing proxy functions, also use /api.
  // 3. Fallback: direct Apps Script URL.
  const host = location.hostname.toLowerCase();
  const hasProxy = true; // we created /api/marketing/*
  function endpointFor(kind){
    const rel = kind === 'subscribe' ? '/api/marketing/subscribe' : '/api/marketing/contact';
    if ((host.endsWith('ezsportsnetting.com') || /^(localhost|127\.0\.0\.1)$/.test(host)) && hasProxy) return rel;
    return FORM_ENDPOINT;
  }
  const SITE_KEY = window.TURNSTILE_SITE_KEY || '0x4AAAAAAB5rtUiQ1MiqGIxp';

  // Lightweight Turnstile loader (redeclared safely)
  async function loadTurnstile(){
    if (window.turnstile) return true;
    await new Promise(res=>{
      const s=document.createElement('script');
      s.src='https://challenges.cloudflare.com/turnstile/v0/api.js';
      s.async=true; s.defer=true;
      s.onload=()=>res(true); s.onerror=()=>res(false);
      document.head.appendChild(s);
    });
    await new Promise(r=>setTimeout(r,40));
    return !!window.turnstile;
  }
  async function getToken(){
    try {
      const ok = await loadTurnstile();
      if (!ok || !SITE_KEY) return '';
      if (window.__turnstileTokenPromise) return await window.__turnstileTokenPromise;
      window.__turnstileTokenPromise = new Promise(resolve => {
        const host = document.createElement('div');
        host.style.cssText='position:fixed;left:-9999px;top:-9999px;';
        document.body.appendChild(host);
        let wid=null; let cleaned=false;
        const cleanup=(id)=>{ if(cleaned) return; cleaned=true; try{window.turnstile.remove(id);}catch{} try{host.remove();}catch{} };
        try {
          wid = window.turnstile.render(host, {
            sitekey: SITE_KEY,
            size: 'flexible',
            appearance: 'execute',
            callback: t=>{ resolve(t||''); cleanup(wid); },
            'error-callback': ()=>{ resolve(''); cleanup(wid); },
            'timeout-callback': ()=>{ resolve(''); cleanup(wid); }
          });
        } catch { resolve(''); cleanup(wid); return; }
        try { window.turnstile.execute(wid); } catch { try{ if(wid) window.turnstile.reset(wid); }catch{} resolve(''); cleanup(wid); }
        setTimeout(()=>{ resolve(''); cleanup(wid); }, 8000);
      }).finally(()=>{ window.__turnstileTokenPromise=null; });
      return await window.__turnstileTokenPromise;
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
          // Send with fallback: try local /api first, if 404/405/network error, retry direct Apps Script
          let data = {};
          const primaryUrl = endpointFor('subscribe');
          try {
            const res = await fetch(primaryUrl, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
            if (res.ok) {
              data = await res.json().catch(()=>({}));
            } else if (res.status === 404 || res.status === 405) {
              throw new Error('proxy-unavailable');
            } else {
              data = await res.json().catch(()=>({}));
            }
          } catch {
            // Fallback to Apps Script
            const res2 = await fetch(FORM_ENDPOINT, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
            data = await res2.json().catch(()=>({}));
          }
          // Treat success only when not flagged as spam and either
          // - proxy saved a subscriber record, or
          // - Apps Script returned ok (no spam signal from GAS).
          const isSpam = data && (data.spam === true);
          const savedViaProxy = !!(data && data.ok && data.subscriber && data.subscriber.id);
          const okViaAppsScript = !!(data && data.ok && !('subscriber' in data));
          if (!data.ok || isSpam || !(savedViaProxy || okViaAppsScript)) {
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
        // Send with fallback similar to subscribe
        let data = {};
        const primaryUrl = endpointFor('contact');
        try {
          const res = await fetch(primaryUrl, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
          if (res.ok) {
            data = await res.json().catch(()=>({}));
          } else if (res.status === 404 || res.status === 405) {
            throw new Error('proxy-unavailable');
          } else {
            data = await res.json().catch(()=>({}));
          }
        } catch {
          const res2 = await fetch(FORM_ENDPOINT, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
          data = await res2.json().catch(()=>({}));
        }
        if (!data.ok) throw 0;
        msgEl.textContent='Message sent!'; msgEl.style.color='green';
        form.reset();
      } catch { msgEl.textContent='Could not send right now.'; msgEl.style.color='red'; }
    });
  }

  function init(){ wireSubscribeForms(); wireContactForm(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
