const path = require('path');
const { spawn } = require('child_process');
const waitOn = require('wait-on');

async function startServer() {
  const env = { ...process.env, PORT: process.env.PORT || '5050', NODE_ENV: 'test' };
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: path.join(__dirname, '..', '..'),
    env,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let started = false;
  child.stdout.on('data', (d) => {
    const s = d.toString();
    if (/Server running on port/.test(s)) started = true;
  });
  await waitOn({ resources: [`http://localhost:${env.PORT}/health`], timeout: 15000, interval: 300 });
  return { child, baseUrl: `http://localhost:${env.PORT}` };
}

async function stopServer(child) {
  return new Promise((resolve) => {
    if (!child || child.killed) return resolve();
    child.on('exit', () => resolve());
    child.kill('SIGINT');
  });
}

module.exports = { startServer, stopServer };
