// Simple Postgres adapter for Vercel using @vercel/postgres
const { sql } = require('@vercel/postgres');
const bcrypt = require('bcryptjs');

// Ensure tables exist
async function ensureSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE,
      name TEXT,
      password_hash TEXT NOT NULL,
      is_admin BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT now(),
      last_login TIMESTAMPTZ
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_email TEXT,
      items JSONB NOT NULL,
      total_cents INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    stripe_pi_id TEXT,
    customer_name TEXT,
    shipping JSONB,
    summary TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
    );
  `;
  // Add missing columns if upgrading
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';`;
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS stripe_pi_id TEXT;`;
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name TEXT;`;
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping JSONB;`;
  await sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS summary TEXT;`;
}

// Ensure the owner admin exists in production DB without overwriting password on updates
// idempotent: sets is_admin to true if the user exists; only sets password on initial insert
async function ensureOwnerAdmin() {
  const email = 'amercedes@ezsportsnetting.com';
  const username = 'amercedes';
  const name = 'EZ Sports Owner';
  const pass = process.env.OWNER_ADMIN_PASSWORD || '#EZSports2025';
  const existing = await sql`SELECT id FROM users WHERE lower(email)=lower(${email}) LIMIT 1;`;
  if (existing.rows && existing.rows.length) {
    if (String(process.env.OWNER_ADMIN_RESET || '').toLowerCase() === 'true') {
      const password_hash = await bcrypt.hash(pass, 10);
      await sql`UPDATE users SET is_admin=true, password_hash=${password_hash} WHERE email=${email};`;
    } else {
      await sql`UPDATE users SET is_admin=true WHERE email=${email};`;
    }
    return;
  }
  const password_hash = await bcrypt.hash(pass, 10);
  await sql`
    INSERT INTO users (email, username, name, password_hash, is_admin)
    VALUES (${email}, ${username}, ${name}, ${password_hash}, true)
  `;
}

async function findUserByIdentifier(identifier) {
  const ident = (identifier || '').trim();
  if (!ident) return null;
  const { rows } = await sql`
    SELECT * FROM users WHERE lower(email)=lower(${ident}) OR lower(username)=lower(${ident}) LIMIT 1;
  `;
  return rows[0] || null;
}

async function createUser({ email, username, name, password, isAdmin=false }) {
  const password_hash = await bcrypt.hash(password, 10);
  const { rows } = await sql`
    INSERT INTO users (email, username, name, password_hash, is_admin)
    VALUES (${email}, ${username||null}, ${name||null}, ${password_hash}, ${isAdmin})
    ON CONFLICT (email) DO UPDATE SET name=EXCLUDED.name
    RETURNING id, email, username, name, is_admin, created_at;
  `;
  return rows[0];
}

async function updateLastLogin(id) {
  await sql`UPDATE users SET last_login = now() WHERE id = ${id};`;
}

async function verifyPassword(user, password) {
  if (!user) return false;
  return bcrypt.compare(password, user.password_hash);
}

function publicUser(u){
  if (!u) return null;
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    name: u.name,
    isAdmin: !!u.is_admin
  };
}

async function createOrderRecord({ userEmail, items, totalCents, customerName, shipping, stripePiId, status='pending', summary }) {
  const { rows } = await sql`
    INSERT INTO orders (user_email, items, total_cents, customer_name, shipping, stripe_pi_id, status, summary)
    VALUES (${userEmail||null}, ${JSON.stringify(items)}, ${totalCents}, ${customerName||null}, ${shipping?JSON.stringify(shipping):null}, ${stripePiId||null}, ${status}, ${summary||null})
    RETURNING id, created_at, status;
  `;
  return rows[0];
}

async function updateOrderStripePi(id, stripePiId) {
  await sql`UPDATE orders SET stripe_pi_id=${stripePiId} WHERE id=${id};`;
}

async function updateOrderStatus(id, status) {
  await sql`UPDATE orders SET status=${status} WHERE id=${id};`;
}

async function markOrderPaidByPi(piId) {
  await sql`UPDATE orders SET status='paid' WHERE stripe_pi_id=${piId};`;
}

module.exports = {
  ensureSchema,
  ensureOwnerAdmin,
  findUserByIdentifier,
  createUser,
  updateLastLogin,
  verifyPassword,
  publicUser,
  createOrderRecord,
  updateOrderStripePi,
  updateOrderStatus,
  markOrderPaidByPi
};
