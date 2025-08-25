const { sql } = require('@vercel/postgres');
const bcrypt = require('bcryptjs');
const { ensureSchema } = require('../_lib_db');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });
  try {
    await ensureSchema();
    const email = 'demo.admin@ezsportsapp.test';
    const username = 'demoadmin';
    const name = 'Demo Admin';
    const pass = 'demoAdmin123';
    const hash = await bcrypt.hash(pass, 10);
    await sql`
      INSERT INTO users (email, username, name, password_hash, is_admin)
      VALUES (${email}, ${username}, ${name}, ${hash}, true)
      ON CONFLICT (email) DO UPDATE SET username=EXCLUDED.username, name=EXCLUDED.name, is_admin=true
    `;
    return res.json({ ok: true, email, password: pass });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Failed to ensure demo admin' });
  }
}
