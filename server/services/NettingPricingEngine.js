const { getPricingData } = require('./NettingPricingDataLoader');

function toNumberOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normKey(s) {
  return String(s || '').trim().toLowerCase();
}

function findNetComponent(pricingData, name) {
  const k = normKey(name);
  return (pricingData?.netComponents || []).find((c) => normKey(c?.name) === k) || null;
}

function findBorderOption(pricingData, borderType) {
  const k = normKey(borderType);
  return (pricingData?.borderOptions || []).find((b) => normKey(b?.border_type) === k) || null;
}

function validateRequestBody(body, pricingData) {
  const Net_Height = toNumberOrNull(body?.Net_Height);
  const Net_Width = toNumberOrNull(body?.Net_Width);
  const Net_Length = toNumberOrNull(body?.Net_Length);

  const Net_Gauge = String(body?.Net_Gauge || '').trim();
  const Border_Type = String(body?.Border_Type || '').trim();

  const DoorsRaw = body?.Doors;
  const FreightRaw = body?.Freight;

  const Doors = DoorsRaw == null ? 0 : Math.max(0, Math.floor(Number(DoorsRaw) || 0));
  const Freight = FreightRaw == null ? false : Boolean(FreightRaw);

  if (!Number.isFinite(Net_Height) || Net_Height <= 0) {
    return { ok: false, message: 'Net_Height must be a valid number > 0' };
  }
  if (!Number.isFinite(Net_Width) || Net_Width <= 0) {
    return { ok: false, message: 'Net_Width must be a valid number > 0' };
  }
  if (Net_Length != null && (!Number.isFinite(Net_Length) || Net_Length < 0)) {
    return { ok: false, message: 'Net_Length must be a valid number >= 0' };
  }

  const netComponent = findNetComponent(pricingData, Net_Gauge);
  if (!netComponent) {
    return { ok: false, message: `Net_Gauge not found: ${Net_Gauge || '(empty)'}` };
  }

  const borderOption = findBorderOption(pricingData, Border_Type);
  if (!borderOption) {
    return { ok: false, message: `Border_Type not found: ${Border_Type || '(empty)'}` };
  }

  return {
    ok: true,
    value: {
      Net_Height,
      Net_Width,
      Net_Length: Net_Length == null ? 0 : Net_Length,
      Net_Gauge,
      Border_Type,
      Doors,
      Freight,
      netComponent,
      borderOption,
    },
  };
}

function calculateFromPricingData(input, pricingData) {
  const validation = validateRequestBody(input, pricingData);
  if (!validation.ok) {
    const err = new Error(validation.message);
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

  const {
    Net_Height,
    Net_Width,
    Net_Length,
    Doors,
    Freight,
    netComponent,
    borderOption,
  } = validation.value;

  // A. Base Netting
  const isCage = Number(Net_Length) > 0;
  const area = isCage ? (Net_Height * Net_Width * Net_Length) : (Net_Height * Net_Width);

  const retailUnit = Number(netComponent.retail_price_per_unit) || 0;
  const wholesaleUnit = Number(netComponent.wholesale_price_per_unit) || 0;
  const weightUnit = Number(netComponent.weight_per_unit) || 0;

  const nettingRetailCost = area * retailUnit;
  const nettingWholesaleCost = area * wholesaleUnit;
  const nettingWeight = area * weightUnit;

  // B. Border
  const perimeter = (Net_Height * 2) + (Net_Width * 2);
  const borderBaseCost = Number(borderOption.base_cost) || 0;
  const borderWeightUnit = Number(borderOption.weight_per_unit) || 0;

  const borderCost = perimeter * borderBaseCost;
  const borderWeight = perimeter * borderWeightUnit;

  // C. Final Totals
  const doorFee = Doors * 50;
  const freightFee = Freight ? 75 : 0;

  const totalRetailPrice = nettingRetailCost + borderCost + doorFee + freightFee;
  const totalWholesalePrice = nettingWholesaleCost + borderCost;
  const totalProductWeight = nettingWeight + borderWeight;

  return {
    totalRetailPrice,
    totalWholesalePrice,
    totalProductWeight,
  };
}

async function calculatePrice(input) {
  const data = await getPricingData();
  return calculateFromPricingData(input, data?.pricingData);
}

module.exports = {
  calculatePrice,
  calculateFromPricingData,
  validateRequestBody,
};
