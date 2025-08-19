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
      created_at TIMESTAMPTZ DEFAULT now()
    );
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

async function createOrderRecord({ userEmail, items, totalCents }) {
  const { rows } = await sql`
    INSERT INTO orders (user_email, items, total_cents)
    VALUES (${userEmail||null}, ${JSON.stringify(items)}, ${totalCents})
    RETURNING id, created_at;
  `;
  return rows[0];
}

module.exports = {
  ensureSchema,
  findUserByIdentifier,
  createUser,
  updateLastLogin,
  verifyPassword,
  publicUser,
  createOrderRecord
};
