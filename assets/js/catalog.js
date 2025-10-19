// Unified product catalog for the Shop page. Mirrors items shown on the individual pages.
// Exposes window.CATALOG_PRODUCTS as an array of { id, title, price, category, img }.

(function(){
  // If dynamic loader already populated products, skip legacy static seed
  if (Array.isArray(window.CATALOG_PRODUCTS) && window.CATALOG_PRODUCTS.length) return;
  const bats = (() => {
    const imgs = [
      'assets/img/bat1.avif','assets/img/bat2.avif','assets/img/bat3.avif','assets/img/bat4.avif','assets/img/bat5.avif','assets/img/bat6.avif','assets/img/bat7.avif','assets/img/bat8.avif','assets/img/bat9.avif','assets/img/bat10.avif','assets/img/bat11.avif','assets/img/bat12.avif','assets/img/bat13.avif','assets/img/bat14.avif','assets/img/bat15.avif'
    ];
    const names = [
      'EZ Pro Maple Bat','EZ Alloy BBCOR Bat','EZ Youth Composite Bat','EZ Power Slugger','EZ Classic Ash Bat','EZ Speedster Bat','EZ Elite Wood Bat','EZ Powerline Bat','EZ Stealth Bat','EZ Thunder Bat','EZ Lightning Bat','EZ Supreme Bat','EZ Ultra Bat','EZ Victory Bat','EZ Champion Bat'
    ];
    const prices = [129.99,179.99,99.99,149.99,119.99,139.99,159.99,169.99,109.99,119.99,129.99,139.99,149.99,159.99,169.99];
    return imgs.map((img,i)=>({ id: `bat-${i+1}`, title: names[i]||`EZ Bat ${i+1}` , price: prices[i]||129.99, category: 'bats', img }));
  })();

  const gloves = (() => {
    const imgs = [
      'assets/img/glove1.avif','assets/img/glove2.avif','assets/img/glove3.avif','assets/img/glove4.avif','assets/img/glove5.avif','assets/img/glove6.avif','assets/img/glove7.avif','assets/img/glove8.avif','assets/img/glove9.avif','assets/img/glove10.avif','assets/img/glove11.avif','assets/img/glove12.avif','assets/img/glove13.avif','assets/img/glove14.avif','assets/img/glove15.avif'
    ];
    const names = [
      'EZ Pro Infield Glove','EZ Outfield Glove','EZ Youth Glove','EZ Catcher\'s Mitt','EZ First Base Mitt','EZ Fastpitch Glove','EZ Elite Series Glove','EZ Stealth Glove','EZ Thunder Glove','EZ Lightning Glove','EZ Supreme Glove','EZ Ultra Glove','EZ Victory Glove','EZ Champion Glove','EZ Dominator Glove'
    ];
    const prices = [159.99,179.99,69.99,189.99,149.99,139.99,159.99,169.99,109.99,119.99,129.99,139.99,149.99,159.99,169.99];
    return imgs.map((img,i)=>({ id: `glove-${i+1}`, title: names[i]||`EZ Glove ${i+1}` , price: prices[i]||159.99, category: 'gloves', img }));
  })();

  const battingGloves = (() => {
    const imgs = [
      'assets/img/batglo1.avif','assets/img/batglo2.avif','assets/img/batglo3.avif','assets/img/batglo4.avif','assets/img/batglo5.avif','assets/img/batglo6.avif','assets/img/batglo7.avif','assets/img/batglo8.avif','assets/img/batglo9.avif','assets/img/batglo10.avif'
    ];
    const names = [
      'EZ Pro Batting Gloves','EZ Youth Batting Gloves','EZ Power Grip Gloves','EZ All-Weather Gloves','EZ Classic Batting Gloves','EZ Elite Batting Gloves','EZ Stealth Batting Gloves','EZ Thunder Batting Gloves','EZ Lightning Batting Gloves','EZ Supreme Batting Gloves'
    ];
    const prices = [39.99,24.99,34.99,29.99,27.99,44.99,32.99,36.99,28.99,31.99];
    return imgs.map((img,i)=>({ id: `batglo-${i+1}`, title: names[i]||`EZ Batting Glove ${i+1}` , price: prices[i]||29.99, category: 'batting-gloves', img }));
  })();

  const drip = [
    { id:'hat-classic-trucker', title:'Classic Trucker Hat', price:24.99, category:'drip', img:'assets/img/hat1.avif' },
    { id:'hat-snapback', title:'Snapback Cap', price:29.99, category:'drip', img:'assets/img/hat2.avif' },
    { id:'hat-performance-visor', title:'Performance Visor', price:34.99, category:'drip', img:'assets/img/hat3.avif' },
    { id:'glass-blackout', title:'Blackout Sunglasses', price:19.99, category:'drip', img:'assets/img/glass1.avif' },
    { id:'glass-mirror', title:'Mirror-Lens Sunglasses', price:24.99, category:'drip', img:'assets/img/glass2.avif' },
    { id:'glass-clear', title:'Clear-Lens Sports Glasses', price:14.99, category:'drip', img:'assets/img/glass3.avif' },
    { id:'shirt-performance-tee', title:'Performance Tee', price:24.99, category:'drip', img:'assets/img/shirt1.avif' },
    { id:'shirt-cotton-tee', title:'Classic Cotton Tee', price:19.99, category:'drip', img:'assets/img/shirt2.avif' },
    { id:'shirt-coach-polo', title:'Coach Polo', price:39.99, category:'drip', img:'assets/img/shirt3.avif' }
  ];

  // Gear page: treat catcher gear and cleats as 'gear' category; helmets as 'helmets'
  const gear = [
    { id:'catch-chest-pro', title:'Pro Catcher\'s Chest Protector', price:149.99, category:'gear', img:'assets/img/catch1.avif' },
    { id:'catch-legs-elite', title:'Elite Catcher\'s Leg Guards', price:129.99, category:'gear', img:'assets/img/catch2.avif' },
    { id:'catch-mitt-premium', title:'Premium Catcher\'s Mitt', price:199.99, category:'gear', img:'assets/img/catch3.avif' },
    { id:'cleat-pro-metal', title:'Pro Metal Cleats', price:99.99, category:'gear', img:'assets/img/cleat1.avif' },
    { id:'cleat-youth-molded', title:'Youth Molded Cleats', price:49.99, category:'gear', img:'assets/img/cleat2.avif' },
    { id:'cleat-speed-turf', title:'Speed Turf Shoes', price:79.99, category:'gear', img:'assets/img/cleat3.avif' },
  ];
  const helmets = [
    { id:'helmet-pro', title:'Pro Helmet With Face Guard', price:89.99, category:'helmets', img:'assets/img/helmet1.avif' },
    { id:'helmet-lite', title:'Lightweight Helmet Youth', price:59.99, category:'helmets', img:'assets/img/helmet2.avif' },
    { id:'helmet-elite-cflap', title:'Elite C-Flap Helmet', price:74.99, category:'helmets', img:'assets/img/helmet3.avif' },
    { id:'helmet-pro-xl', title:'Pro Helmet XL', price:94.99, category:'helmets', img:'assets/img/helmet1.avif' },
  ];

  const lScreens = [
    { id:'ls-pro', title:'Pro L-Screen', price:399.00, category:'l-screens', img:'assets/prodImgs/Bullet_L-Screens/bulletl1.avif' },
    { id:'ls-portable', title:'Portable L-Screen', price:329.00, category:'l-screens', img:'assets/prodImgs/Bullet_L-Screens/bulletl2.avif' },
    { id:'ls-heavy', title:'Heavy-Duty L-Screen', price:499.00, category:'l-screens', img:'assets/prodImgs/Bullet_L-Screens/bulletl3.avif' },
    { id:'ls-junior', title:'Junior L-Screen', price:249.00, category:'l-screens', img:'assets/prodImgs/Bullet_L-Screens/bulletl4.avif' },
    { id:'ls-foldable', title:'Foldable L-Screen', price:289.00, category:'l-screens', img:'assets/prodImgs/Bullet_L-Screens/bulletl6.avif' },
    { id:'ls-net-replacement', title:'Pro Net Replacement', price:149.00, category:'l-screens', img:'assets/prodImgs/Bullet_L-Screens/bulletl7.avif' },
  ];

  const facilityField = [
    { id:'equip-ball-cart', title:'Portable Ball Cart', price:149.00, category:'facility-field', img:'assets/img/equip1.avif' },
    { id:'equip-dugout-organizer', title:'Dugout Organizer', price:89.00, category:'facility-field', img:'assets/img/equip2.avif' },
    { id:'equip-rack', title:'Equipment Rack', price:119.00, category:'facility-field', img:'assets/img/equip3.avif' },
    { id:'coach-clipboard', title:'Coach\'s Clipboard', price:19.99, category:'facility-field', img:'assets/img/coach1.avif' },
    { id:'coach-cones', title:'Practice Cones (Set)', price:14.99, category:'facility-field', img:'assets/img/coach2.avif' },
    { id:'coach-whistle', title:'Whistle & Lanyard', price:9.99, category:'facility-field', img:'assets/img/coach3.avif' },
    { id:'mound-portable', title:'Portable Pitching Mound', price:799.00, category:'facility-field', img:'assets/img/mound1.avif' },
    { id:'mound-rubber', title:'Rubber Throwing Mound', price:349.00, category:'facility-field', img:'assets/img/mound2.avif' },
    { id:'mound-trainer', title:'Youth Mound Trainer', price:229.00, category:'facility-field', img:'assets/img/mound3.avif' },
    { id:'train-agility-ladder', title:'Agility Ladder', price:29.99, category:'facility-field', img:'assets/img/train1.avif' },
    { id:'train-hurdles', title:'Training Hurdles (Set)', price:39.99, category:'facility-field', img:'assets/img/train2.avif' },
    { id:'train-bands', title:'Resistance Bands', price:24.99, category:'facility-field', img:'assets/img/train3.avif' },
  ];

  const apparel = [
    { id:'uni-home', title:'Home Uniform', price:59.99, category:'apparel', img:'assets/img/uni1.avif' },
    { id:'uni-away', title:'Away Uniform', price:64.99, category:'apparel', img:'assets/img/uni2.avif' },
    { id:'uni-alt', title:'Alternate Uniform', price:69.99, category:'apparel', img:'assets/img/uni3.avif' },
    { id:'uni-practice', title:'Practice Uniform', price:49.99, category:'apparel', img:'assets/img/uni4.avif' },
  ];

  const all = [
    ...bats,
    ...gloves,
    ...battingGloves,
    ...drip,
    ...gear,
    ...helmets,
    ...lScreens,
    ...facilityField,
    ...apparel,
  ];

  try { window.CATALOG_PRODUCTS = all; } catch {}
})();
