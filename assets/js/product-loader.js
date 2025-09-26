// Dynamic product loader: derives products from assets/prodList.json only.
// Produces window.CATALOG_PRODUCTS = [{ id, title, price, category, img, sourceSKU, raw }]
// Assumptions: prodList.json categories contain arrays of product-like objects with sku or name/map pricing.

(async function(){
  const manifestPath = 'assets/prodList.json';
  try {
    const res = await fetch(manifestPath, { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to load prodList.json: ' + res.status);
    const data = await res.json();
    const out = [];
    const categories = data.categories || {};
    Object.entries(categories).forEach(([catName, items]) => {
      if (!Array.isArray(items)) return;
      items.forEach((it, idx) => {
        const id = (it.sku || it.name || `${catName}-${idx}`).toString();
        const title = it.name || it.sku || id;
        // Prefer map price, fallback to wholesale or 0
        const price = typeof it.map === 'number' ? it.map : (typeof it.wholesale === 'number' ? it.wholesale : 0);
        const img = it.img || 'assets/prodImgs/Bullet_L-Screens/Bullet_L_Screens_Baseball/bulletl1.avif';
        out.push({
          id,
            title,
            price: Number(price),
            category: catName.toLowerCase().replace(/\s+/g,'-'),
            img,
            sourceSKU: it.sku || null,
            raw: it
        });
      });
    });
    window.CATALOG_PRODUCTS = out;
    window.dispatchEvent(new CustomEvent('catalog:ready', { detail: { count: out.length }}));
  } catch (e) {
    console.error('[product-loader] error', e);
    window.CATALOG_PRODUCTS = [];
    window.dispatchEvent(new CustomEvent('catalog:error', { detail: { message: e.message }}));
  }
})();
