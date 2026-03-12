function getFetch() {
  if (typeof globalThis.fetch === 'function') {
    return globalThis.fetch.bind(globalThis);
  }

  throw new Error('Global fetch is unavailable in this Node runtime. Use Node 18+ to run the server.');
}

module.exports = { getFetch };