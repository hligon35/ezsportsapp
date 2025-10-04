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
    const slugify = (s) => {
      return String(s||'')
        .toLowerCase()
        .replace(/[’']/g, '') // drop apostrophes
        .replace(/[^a-z0-9]+/g, '-') // non-alnum -> dash
        .replace(/^-+|-+$/g,'') // trim dashes
        .replace(/-{2,}/g,'-'); // collapse
    };
    const byCategory = {}; // slug -> array
    Object.entries(categories).forEach(([catName, items]) => {
      if (!Array.isArray(items)) return;
      const catSlug = slugify(catName);
      if (!byCategory[catSlug]) byCategory[catSlug] = [];
      items.forEach((it, idx) => {
        const id = (it.sku || it.name || `${catName}-${idx}`).toString();
        const title = it.name || it.sku || id;
        // Prefer map price, fallback to wholesale or 0
        const price = typeof it.map === 'number' ? it.map : (typeof it.wholesale === 'number' ? it.wholesale : 0);
  // Updated fallback image: remove dependency on legacy assets/prodImgs structure
  // Use a generic on-brand image that exists in assets/img
  const img = it.img || 'assets/img/screen2.avif';
        const rec = {
          id,
            title,
            price: Number(price),
            category: catSlug,
            img,
            sourceSKU: it.sku || null,
            raw: it
        };
        out.push(rec);
        byCategory[catSlug].push(rec);
      });
    });
    window.CATALOG_PRODUCTS = out;
    window.CATALOG_BY_CATEGORY = byCategory;
    window.dispatchEvent(new CustomEvent('catalog:ready', { detail: { count: out.length, categories: Object.keys(byCategory) }}));
  } catch (e) {
    console.error('[product-loader] error', e);
    window.CATALOG_PRODUCTS = [];
    window.dispatchEvent(new CustomEvent('catalog:error', { detail: { message: e.message }}));
  }
})();
