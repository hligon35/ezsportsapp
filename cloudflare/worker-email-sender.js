// Cloudflare Worker: Email sender using MailChannels
// Deploy this Worker and set its public URL as CF_EMAIL_WEBHOOK_URL on your server.
// Optionally set CF_EMAIL_API_KEY on both sides to secure the endpoint (Bearer token).

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }
    const auth = request.headers.get('authorization') || '';
    const expected = (env.CF_EMAIL_API_KEY || '').trim();
    if (expected && auth !== `Bearer ${expected}`) {
      return new Response('Unauthorized', { status: 401 });
    }
    let body;
    try { body = await request.json(); } catch { return new Response('Bad JSON', { status: 400 }); }
    const to = String(body.to || '').trim();
    const subject = String(body.subject || '').trim();
    const html = String(body.html || '');
    const text = String(body.text || '') || html.replace(/<[^>]+>/g, ' ');
    const from = String(body.from || env.DEFAULT_FROM || 'no-reply@yourdomain.com');
    if (!to || !subject) return new Response('Missing to/subject', { status: 400 });

    const mailChannelsPayload = {
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from, name: body.fromName || 'EZ Sports Netting' },
      subject,
      content: [
        { type: 'text/plain', value: text },
        { type: 'text/html', value: html }
      ]
    };

    const resp = await fetch('https://api.mailchannels.net/tx/v1/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(mailChannelsPayload)
    });
    if (!resp.ok) {
      const b = await resp.text();
      return new Response(`MailChannels error ${resp.status}: ${b}`, { status: 502 });
    }
    return new Response('OK');
  }
};
