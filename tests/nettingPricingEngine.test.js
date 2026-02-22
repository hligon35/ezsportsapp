const { calculateFromPricingData } = require('../server/services/NettingPricingEngine');

describe('NettingPricingEngine (CSV-backed data shape)', () => {
  const pricingData = {
    netComponents: [
      {
        name: '#18',
        spec_type: 'netting',
        retail_price_per_unit: 0.35,
        wholesale_price_per_unit: 0.1,
        weight_per_unit: 0.01,
      },
    ],
    borderOptions: [
      { border_type: 'Rope', base_cost: 0.25, weight_per_unit: 0.02 },
      { border_type: 'Sewn Rope', base_cost: 0.5, weight_per_unit: 0.02 },
      { border_type: 'No Border', base_cost: 0, weight_per_unit: 0 },
    ],
  };

  test('computes totals using netComponents + borderOptions lookups', () => {
    const res = calculateFromPricingData(
      {
        Net_Height: 10,
        Net_Width: 10,
        Net_Length: 0,
        Net_Gauge: '#18',
        Border_Type: 'Sewn Rope',
        Doors: 2,
        Freight: true,
      },
      pricingData
    );

    // area=100, perimeter=40
    // netting retail=35, wholesale=10, weight=1
    // border cost=40*0.5=20, border weight=40*0.02=0.8
    // doors=100, freight fee=75
    expect(res.totalRetailPrice).toBeCloseTo(35 + 20 + 100 + 75, 8);
    expect(res.totalWholesalePrice).toBeCloseTo(10 + 20, 8);
    expect(res.totalProductWeight).toBeCloseTo(1 + 0.8, 8);
  });

  test('throws validation error when gauge missing', () => {
    expect(() =>
      calculateFromPricingData(
        {
          Net_Height: 10,
          Net_Width: 10,
          Net_Length: 0,
          Net_Gauge: '#99',
          Border_Type: 'Rope',
        },
        pricingData
      )
    ).toThrow(/Net_Gauge not found/i);
  });

  test('throws validation error when border type missing', () => {
    expect(() =>
      calculateFromPricingData(
        {
          Net_Height: 10,
          Net_Width: 10,
          Net_Length: 0,
          Net_Gauge: '#18',
          Border_Type: 'Unknown Border',
        },
        pricingData
      )
    ).toThrow(/Border_Type not found/i);
  });

  test('supports cage-style area when Net_Length > 0', () => {
    const res = calculateFromPricingData(
      {
        Net_Height: 2,
        Net_Width: 3,
        Net_Length: 4,
        Net_Gauge: '#18',
        Border_Type: 'No Border',
      },
      pricingData
    );

    // area=2*3*4=24
    expect(res.totalRetailPrice).toBeCloseTo(24 * 0.35, 8);
    expect(res.totalWholesalePrice).toBeCloseTo(24 * 0.1, 8);
    expect(res.totalProductWeight).toBeCloseTo(24 * 0.01, 8);
  });
});
