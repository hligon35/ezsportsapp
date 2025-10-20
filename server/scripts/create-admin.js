#!/usr/bin/env node
// Create or promote an admin user (idempotent)
// Usage (env): ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=secret ADMIN_NAME="Your Name" node scripts/create-admin.js
// Usage (flags): node scripts/create-admin.js --email you@example.com --password secret --name "Your Name" --username you --admin

const bcrypt = require('bcrypt');
const UserService = require('../services/UserService');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.replace(/^--/, '');
      const next = args[i + 1];
      if (key === 'admin' || key === 'make-admin') { out.isAdmin = true; continue; }
      if (typeof next === 'undefined' || next.startsWith('--')) { out[key] = true; continue; }
      out[key] = next; i++;
    }
  }
  return out;
}

async function main() {
  const flags = parseArgs();
  const email = process.env.ADMIN_EMAIL || flags.email || flags.user || '';
  const username = process.env.ADMIN_USERNAME || flags.username || '';
  const name = process.env.ADMIN_NAME || flags.name || '';
  const password = process.env.ADMIN_PASSWORD || flags.password || '';
  const forceAdmin = (String(process.env.ADMIN_IS_ADMIN || '').toLowerCase() === 'true') || !!flags.isAdmin || !!flags['make-admin'];

  if (!email) {
    console.error('Missing required email. Provide ADMIN_EMAIL env or --email flag.');
    process.exit(2);
  }
  if (!password) {
    console.error('Missing required password. Provide ADMIN_PASSWORD env or --password flag.');
    process.exit(2);
  }

  const svc = new UserService();
  const all = await svc.getAllUsers();
  const lc = String(email).toLowerCase();
  const existing = all.find(u => String(u.email || '').toLowerCase() === lc);

  if (!existing) {
    console.log(`Creating admin user for ${email} ...`);
    const created = await svc.register({ email, username: username || undefined, password, name: name || email.split('@')[0], isAdmin: true });
    console.log('Created:', { id: created.id || '(auto)', email: created.email, isAdmin: created.isAdmin });
    return;
  }

  // Promote or update existing
  let changed = false;
  if (!existing.isAdmin && forceAdmin !== false) {
    await svc.updateUser(existing.id, { isAdmin: true });
    changed = true;
    console.log('Promoted existing user to admin.');
  }
  if (username && !existing.username) {
    await svc.updateUser(existing.id, { username });
    changed = true;
    console.log('Set username on existing user.');
  }
  if (password) {
    try {
      await svc.changePassword(existing.id, password, password);
      changed = true;
      console.log('Password updated for existing user.');
    } catch {
      // changePassword requires old password; if it fails, update directly
      const hashed = await bcrypt.hash(password, 10);
      await svc.db.update('users', { id: existing.id }, { password: hashed });
      changed = true;
      console.log('Password force-updated for existing user.');
    }
  }
  if (!changed) {
    console.log('No changes needed. User already exists and meets criteria.');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
