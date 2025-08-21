// Centralized product price list (values in cents)
const PRODUCTS_CENTS = {
  'bat-ghost': 39995,
  'bat-hype': 34995,
  'glove-a2000': 29995,
  'glove-heart': 27995,
  'net-pro': 21900,
  'net-cage': 64900,
  'helmet-pro': 8999,
  'helmet-lite': 5999,
};

function getPriceCents(id) {
  return Number(PRODUCTS_CENTS[id]) || 0;
}

function centsToDollars(cents) {
  return Math.round(Number(cents || 0)) / 100;
}

module.exports = { PRODUCTS_CENTS, getPriceCents, centsToDollars };
