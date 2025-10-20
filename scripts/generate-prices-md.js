#!/usr/bin/env node
/**
 * Generate a client-facing Prices.md that lists products, prices, and per-item shipping
 * using the same rules as checkout:
 *  - Shipping per item: use dsr when present and > 0; otherwise default to $100 per item
 *  - Free shipping overrides: Batting Mat and Armor Basket
 *  - Variations: list each option with its price and shipping (using variation.dsr when present)
 *  - Per-foot price items (e.g., "2.5/ft"): display as $X/ft
 *  - Notes like "Free Shipping" or "LTL Freight Only" are included when available
 *
 * Output: Prices.md at repository root by default.
 */
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

function currency(n){
	if (typeof n === 'string') return n; // pass-through for per-foot strings
	const v = Number(n || 0);
	return `$${v.toFixed(2)}`;
}

function parseMapPrice(val){
	// Returns { type: 'number'|'per-foot'|'unknown', value: number|string }
	if (val == null) return { type: 'unknown', value: null };
	if (typeof val === 'number' && isFinite(val)) return { type: 'number', value: val };
	const s = String(val).trim();
		if (/\/\s*ft$/i.test(s) || /per\s*ft/i.test(s)) {
			const num = parseFloat(s);
			if (isFinite(num)) return { type: 'per-foot', value: `${num.toFixed(2)}/ft` };
		return { type: 'per-foot', value: s.replace(/^\$?/, '') };
	}
	const num = parseFloat(s.replace(/[^0-9.]/g, ''));
	if (isFinite(num)) return { type: 'number', value: num };
	return { type: 'unknown', value: s };
}

function priceDisplay(parsed){
	if (!parsed) return '';
	if (parsed.type === 'number') return currency(parsed.value);
	if (parsed.type === 'per-foot') return `$${String(parsed.value).replace(/^\$?/, '')}`;
	if (parsed.value != null) return String(parsed.value);
	return '';
}

function profitDisplay(mapParsed, wholesaleParsed){
	// Only compute when types align and both present
	if (!mapParsed || !wholesaleParsed) return null;
	if (mapParsed.type === 'number' && wholesaleParsed.type === 'number') {
		const profit = Number(mapParsed.value) - Number(wholesaleParsed.value);
		return currency(profit);
	}
	if (mapParsed.type === 'per-foot' && wholesaleParsed.type === 'per-foot') {
		// Extract numeric part if string like "1.50/ft"
		const num = (v) => typeof v === 'string' ? parseFloat(String(v).split('/')[0]) : Number(v);
		const m = num(mapParsed.value);
		const w = num(wholesaleParsed.value);
		if (isFinite(m) && isFinite(w)) {
			return `$${(m - w).toFixed(2)}/ft`;
		}
	}
	return null;
}

function profitPercent(mapParsed, wholesaleParsed){
	// Returns a number (0-100+) or null when not computable
	if (!mapParsed || !wholesaleParsed) return null;
	if (mapParsed.type === 'number' && wholesaleParsed.type === 'number') {
		const m = Number(mapParsed.value); const w = Number(wholesaleParsed.value);
		if (!isFinite(m) || m <= 0 || !isFinite(w)) return null;
		return ((m - w) / m) * 100;
	}
	if (mapParsed.type === 'per-foot' && wholesaleParsed.type === 'per-foot') {
		const num = (v) => typeof v === 'string' ? parseFloat(String(v).split('/')[0]) : Number(v);
		const m = num(mapParsed.value); const w = num(wholesaleParsed.value);
		if (!isFinite(m) || m <= 0 || !isFinite(w)) return null;
		return ((m - w) / m) * 100;
	}
	return null;
}

function normId(v){ return String(v||'').trim().toLowerCase(); }

function isFreeShipOverride(p){
	const id = normId(p.sku || p.id || '');
	const title = normId(p.name || p.title || '');
	if (id === 'battingmat' || id === 'armorbasket') return true;
	if (/\bbatting\s*mat\b/.test(title)) return true;
	if (/armor\s*(baseball)?\s*cart|armor\s*basket/.test(title)) return true;
	return false;
}

function effectiveShippingDollars(p, v){
	// Mirror server behavior:
	// - If free-ship override, return 0
	// - Else prefer variation.dsr when > 0; else product-level dsr when > 0; else default 100
	if (isFreeShipOverride(p)) return 0;
	const raw = (v && typeof v.dsr !== 'undefined') ? v.dsr : (typeof p.dsr !== 'undefined' ? p.dsr : (p.details && typeof p.details.dsr !== 'undefined' ? p.details.dsr : undefined));
	const n = Number(raw);
	if (Number.isFinite(n) && n > 0) return n;
	// Note: dsr === 0 is NOT treated as free shipping unless in the explicit override above
	return 100;
}

function productTitle(p){
	const parts = [];
	if (p.name) return p.name;
	if (p.material) parts.push(p.material);
	if (p.gauge) parts.push(`#${p.gauge}`);
	if (p.size) parts.push(p.size);
	if (!parts.length && p.title) return p.title;
	return parts.join(' ').trim() || (p.sku || p.id || '');
}

async function loadCatalog(){
	const file = path.join(__dirname, '..', 'assets', 'prodList.json');
	const raw = await fsp.readFile(file, 'utf8');
	return JSON.parse(raw);
}

function line(str=''){ return str + (str.endsWith('\n') ? '' : '\n'); }

async function generate(){
	const catalog = await loadCatalog();
	const byCategory = catalog && catalog.categories || {};

	// First pass: collect profit stats across catalog
		const numericEntries = []; // entries with numeric MAP and Wholesale
		const perFootEntries = []; // entries with per-foot MAP and Wholesale
		const totalEntries = []; // all entries for later detailed output if needed
		const missingProfit = []; // entries where profit not computable

	const toNum = (parsed) => (parsed && parsed.type === 'number') ? Number(parsed.value) : null;
	const toPerFootNum = (parsed) => {
		if (!parsed || parsed.type !== 'per-foot') return null;
		const s = String(parsed.value);
		const n = parseFloat(s.split('/')[0]);
		return isFinite(n) ? n : null;
	};
	for (const [cat, items] of Object.entries(byCategory)){
		if (!Array.isArray(items)) continue;
		for (const p of items){
			if (Array.isArray(p.variations) && p.variations.length){
				for (const v of p.variations){
					const mapParsed = (typeof v.map !== 'undefined') ? parseMapPrice(v.map) : ((typeof v.price !== 'undefined') ? parseMapPrice(v.price) : null);
					const wholesaleParsed = (typeof v.wholesale !== 'undefined') ? parseMapPrice(v.wholesale) : null;
					const profitNum = (toNum(mapParsed) != null && toNum(wholesaleParsed) != null) ? (toNum(mapParsed) - toNum(wholesaleParsed)) : null;
					const profitPerFt = (toPerFootNum(mapParsed) != null && toPerFootNum(wholesaleParsed) != null) ? (toPerFootNum(mapParsed) - toPerFootNum(wholesaleParsed)) : null;
					const profitPct = profitPercent(mapParsed, wholesaleParsed);
								const entry = {
						category: cat,
						sku: p.sku || p.id || '',
						title: productTitle(p),
						option: v.option || v.name || '',
						mapParsed,
						wholesaleParsed,
						profitNum,
						profitPerFt,
						profitPct,
						ship: effectiveShippingDollars(p, v)
					};
					totalEntries.push(entry);
					if (profitNum != null) numericEntries.push(entry);
					if (profitPerFt != null) perFootEntries.push(entry);
								if (profitNum == null && profitPerFt == null) missingProfit.push({ ...entry });
				}
			} else {
				const mapParsed = (typeof p.map !== 'undefined') ? parseMapPrice(p.map) : ((typeof p.price !== 'undefined') ? parseMapPrice(p.price) : null);
				const wholesaleParsed = (typeof p.wholesale !== 'undefined') ? parseMapPrice(p.wholesale) : null;
				const profitNum = (toNum(mapParsed) != null && toNum(wholesaleParsed) != null) ? (toNum(mapParsed) - toNum(wholesaleParsed)) : null;
				const profitPerFt = (toPerFootNum(mapParsed) != null && toPerFootNum(wholesaleParsed) != null) ? (toPerFootNum(mapParsed) - toPerFootNum(wholesaleParsed)) : null;
				const profitPct = profitPercent(mapParsed, wholesaleParsed);
						const entry = {
					category: cat,
					sku: p.sku || p.id || '',
					title: productTitle(p),
					option: '',
					mapParsed,
					wholesaleParsed,
					profitNum,
					profitPerFt,
					profitPct,
					ship: effectiveShippingDollars(p, null)
				};
				totalEntries.push(entry);
				if (profitNum != null) numericEntries.push(entry);
				if (profitPerFt != null) perFootEntries.push(entry);
						if (profitNum == null && profitPerFt == null) missingProfit.push({ ...entry });
			}
		}
	}

	const out = [];
	// Heading
	out.push(line('# EZ Sports Netting — Prices and Shipping'));
	out.push(line(`_Updated: ${new Date().toISOString().slice(0,10)}_`));
	out.push('\n');

	// Profit Summary (before shipping policy)
	const N = numericEntries.length; // dollar-priced items with computable profit
	const PF = perFootEntries.length; // per-foot items with computable profit
	const totalSku = totalEntries.length;
	const sum = numericEntries.reduce((s,e)=> s + Number(e.profitNum||0), 0);
	const avg = N ? (sum / N) : 0;
	// Average profit percent across items where computable
	const pctVals = totalEntries.map(e => e.profitPct).filter(v => typeof v === 'number' && isFinite(v));
	const avgPct = pctVals.length ? (pctVals.reduce((a,b)=>a+b,0) / pctVals.length) : 0;
	const sorted = [...numericEntries].sort((a,b)=> Number(b.profitNum||0) - Number(a.profitNum||0));
	const minProfit = N ? Number(sorted[sorted.length-1].profitNum) : 0;
	const maxProfit = N ? Number(sorted[0].profitNum) : 0;
	const top = sorted.slice(0, 5);
	const perCat = new Map();
	for (const e of numericEntries){
		const k = e.category || 'Uncategorized';
		if (!perCat.has(k)) perCat.set(k, { count: 0, total: 0 });
		const row = perCat.get(k);
		row.count++; row.total += Number(e.profitNum||0);
	}
	out.push(line('## Profit summary'));
	out.push(line(`- Items with profit available: ${N + PF} of ${totalSku} (includes per-foot items)`));
	out.push(line(`- Average profit (dollar-priced items): ${currency(avg)}`));
	out.push(line(`- Average profit % (all computable): ${avgPct.toFixed(1)}%`));
	out.push(line(`- Range: ${currency(minProfit)} – ${currency(maxProfit)}`));
	out.push(line(`- Total profit (one unit each): ${currency(sum)}`));
	out.push('\n');
	if (top.length){
		out.push(line('### Top items by profit'));
		let idx = 1;
		for (const t of top){
			const name = t.option ? `${t.sku} — ${t.title} (${t.option})` : `${t.sku} — ${t.title}`;
			const mapStr = priceDisplay(t.mapParsed) || '—';
			const whStr = priceDisplay(t.wholesaleParsed) || '—';
			out.push(line(`${idx}. ${name} — Profit: ${currency(Number(t.profitNum||0))} (MAP: ${mapStr}, Wholesale: ${whStr})`));
			idx++;
		}
		out.push('\n');
	}
	if (perCat.size){
		out.push(line('### Profit by category'));
		for (const [k, v] of [...perCat.entries()].sort((a,b)=> b[1].total - a[1].total)){
			const avgCat = v.count ? (v.total / v.count) : 0;
			out.push(line(`- ${k}: avg ${currency(avgCat)} • items ${v.count} • total ${currency(v.total)}`));
		}
		out.push('\n');
	}
	if (perFootEntries.length){
		const pf = [...perFootEntries].map(e => ({
			name: e.option ? `${e.sku} — ${e.title} (${e.option})` : `${e.sku} — ${e.title}`,
			val: Number(e.profitPerFt||0)
		}));
		const pfSorted = pf.sort((a,b)=> b.val - a.val);
		const pfMin = pfSorted.length ? pfSorted[pfSorted.length-1].val : 0;
		const pfMax = pfSorted.length ? pfSorted[0].val : 0;
		out.push(line('### Per-foot items summary'));
		out.push(line(`- Items with per-foot profit: ${pfSorted.length}`));
		out.push(line(`- Range: $${pfMin.toFixed(2)}/ft – $${pfMax.toFixed(2)}/ft`));
		const topPf = pfSorted.slice(0,3);
		if (topPf.length){
			out.push(line('- Top per-foot profits:'));
			for (const e of topPf){ out.push(line(`  - ${e.name}: $${e.val.toFixed(2)}/ft`)); }
		}
		out.push('\n');
	}

	// Shipping policy summary
	out.push(line('## Shipping policy summary'));
	out.push(line('- Per-item shipping. When an item has a DSR value (shipping dollars) defined, we use that per unit.'));
	out.push(line('- When DSR is not defined, a baseline $100 per item applies.'));
	out.push(line('- Free shipping overrides: Batting Mat and Armor Basket.'));
	out.push(line('- Some large items may be LTL Freight. Notes are shown when applicable.'));
	out.push('\n');

		// Items missing profit (help client decide what to adjust)
		if (missingProfit.length){
			out.push(line('## Items missing profit'));
			out.push(line(`(${missingProfit.length} items)`));
			out.push('\n');
			for (const m of missingProfit){
				const name = m.option ? `${m.sku} — ${m.title} (${m.option})` : `${m.sku} — ${m.title}`;
				out.push(line(`### ${name}`));
				out.push(line(`- MAP: ${m.mapParsed ? (priceDisplay(m.mapParsed) || '—') : '—'}`));
				out.push(line(`- Wholesale: ${m.wholesaleParsed ? (priceDisplay(m.wholesaleParsed) || '—') : '—'}`));
				out.push(line(`- Shipping: ${m.ship === 0 ? 'Free' : currency(m.ship || 0)}`));
				// Explicitly call out missing fields to guide adjustments
				const missingBits = [];
				if (!m.mapParsed) missingBits.push('MAP');
				if (!m.wholesaleParsed) missingBits.push('Wholesale');
				out.push(line(`- Profit: —${missingBits.length ? ` (missing ${missingBits.join(' & ')})` : ''}`));
				out.push('\n');
			}
		}

	// Prices by Category
	for (const [cat, items] of Object.entries(byCategory)){
		if (!Array.isArray(items) || !items.length) continue;
			out.push(line(`## ${cat}`));
		out.push('\n');
		for (const p of items){
			const sku = p.sku || p.id || '';
			const title = productTitle(p);
			const note = p.notes || (p.details && p.details.notes) || '';
				const mapParsed = (typeof p.map !== 'undefined') ? parseMapPrice(p.map) : ((typeof p.price !== 'undefined') ? parseMapPrice(p.price) : { type:'unknown', value:null });

			// Header line for product
			out.push(line(`### ${sku ? sku + ' — ' : ''}${title}`));

					// Variations
			if (Array.isArray(p.variations) && p.variations.length){
					out.push(line('Variants:'));
				for (const v of p.variations){
						const vMapParsed = (typeof v.map !== 'undefined') ? parseMapPrice(v.map) : ((typeof v.price !== 'undefined') ? parseMapPrice(v.price) : null);
						const wholesaleParsed = (typeof v.wholesale !== 'undefined') ? parseMapPrice(v.wholesale) : null;
					const ship = effectiveShippingDollars(p, v);
					const shipStr = ship === 0 ? 'Free' : currency(ship);
					const opt = v.option || v.name || 'Option';
						out.push(line(`- Option: ${opt}`));
						out.push(line(`  - MAP: ${vMapParsed ? (priceDisplay(vMapParsed) || '—') : '—'}`));
						out.push(line(`  - Wholesale: ${wholesaleParsed ? (priceDisplay(wholesaleParsed) || '—') : '—'}`));
						out.push(line(`  - Shipping: ${shipStr}`));
						const profitStr = profitDisplay(vMapParsed, wholesaleParsed);
						const pct = profitPercent(vMapParsed, wholesaleParsed);
						out.push(line(`  - Profit: ${profitStr || '—'}`));
						out.push(line(`  - Profit %: ${typeof pct === 'number' ? pct.toFixed(1)+'%' : '—'}`));
				}
			} else {
					// Single item format
					const mapOnlyParsed = (typeof p.map !== 'undefined') ? parseMapPrice(p.map) : ((typeof p.price !== 'undefined') ? parseMapPrice(p.price) : null);
					const wholesaleParsed = (typeof p.wholesale !== 'undefined') ? parseMapPrice(p.wholesale) : null;
				const ship = effectiveShippingDollars(p, null);
				const shipStr = ship === 0 ? 'Free' : currency(ship);
					out.push(line(`- MAP: ${mapOnlyParsed ? (priceDisplay(mapOnlyParsed) || '—') : '—'}`));
					out.push(line(`- Wholesale: ${wholesaleParsed ? (priceDisplay(wholesaleParsed) || '—') : '—'}`));
					out.push(line(`- Shipping: ${shipStr}`));
					const profitStr = profitDisplay(mapOnlyParsed, wholesaleParsed);
					const pct = profitPercent(mapOnlyParsed, wholesaleParsed);
					out.push(line(`- Profit: ${profitStr || '—'}`));
					out.push(line(`- Profit %: ${typeof pct === 'number' ? pct.toFixed(1)+'%' : '—'}`));
			}

			// Notes (optional)
			const notes = [];
			if (note) notes.push(String(note));
			if (isFreeShipOverride(p)) notes.push('Free shipping override applies');
			if (notes.length) out.push(line(`_Notes: ${notes.join(' • ')}_`));
			out.push('\n');
		}
	}

	// Admin How-To section
	out.push(line('---'));
	out.push(line('## Admin dashboard — how to use'));
	out.push(line('Open admin.html in your site and sign in with an admin account. Sections available:'));
	out.push(line('- Products: Run Product Sync to import/update the local catalog (Dry run to preview; Deactivate removed to clean up in Stripe when enabled).'));
	out.push(line('- Invoices: Filter by status and refresh to view recent Stripe invoices (if using Stripe Invoicing).'));
	out.push(line('- Orders: View local orders and statuses.'));
	out.push(line('- Users: Launch the Stripe Billing Portal on behalf of a customer (enter their email).'));
	out.push(line('- Marketing: See KPIs, list coupons/subscribers, create coupons, and queue newsletters.'));
	out.push(line('- Finance: Stripe summary (Gross, Refunds, Fees, Net), balance, payouts, and invoices with timeframe filters.'));
	out.push(line('- Traffic: Cloudflare analytics overview (requests, cache hit %, bandwidth, threats), top paths, trends by day and country.'));
	out.push('\n');
	out.push(line('Health endpoints (server):'));
	out.push(line('- GET /health — basic health check'));
	out.push(line('- GET /health/emails — queued/sending/failed emails with retry info'));
	out.push('\n');
	out.push(line('Notes: Admin API routes are protected by requireAdmin on the server. Ensure your admin session or token is configured before calling them directly.'));

	const content = out.join('');
	const outFile = path.join(__dirname, '..', 'Prices.md');
	await fsp.writeFile(outFile, content, 'utf8');
		// Also emit a plain text variant for easy sharing
		const plain = content
			.replace(/^#+\s*/gm, '')        // strip markdown headings
			.replace(/\*\*(.*?)\*\*/g, '$1') // bold
			.replace(/_(.*?)_/g, '$1')       // italics
			.replace(/`([^`]*)`/g, '$1')     // inline code
			.replace(/^---$/gm, '');         // hr
		const outTxt = path.join(__dirname, '..', 'Prices.txt');
		await fsp.writeFile(outTxt, plain, 'utf8');
		// Emit a CSV export for spreadsheets and bulk editing
		const csvHeader = ['category','sku','title','option','map','wholesale','shipping','profit','profitPct','notes'];
		const esc = (v) => {
			if (v == null) return '';
			const s = String(v);
			if (/[",\n]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
			return s;
		};
		const toStr = (parsed) => parsed ? (priceDisplay(parsed) || '') : '';
		const rows = totalEntries.map(e => {
			const mapStr = toStr(e.mapParsed);
			const whStr = toStr(e.wholesaleParsed);
			const shipStr = e.ship === 0 ? 'Free' : (typeof e.ship === 'number' ? `$${Number(e.ship).toFixed(2)}` : '');
			const profStr = (e.profitNum != null) ? `$${Number(e.profitNum).toFixed(2)}` : (e.profitPerFt != null ? `$${Number(e.profitPerFt).toFixed(2)}/ft` : '');
			const pctStr = (typeof e.profitPct === 'number' && isFinite(e.profitPct)) ? `${e.profitPct.toFixed(1)}%` : '';
			const notes = isFreeShipOverride({ sku: e.sku, name: e.title }) ? 'Free shipping override' : '';
			return [e.category, e.sku, e.title, e.option || '', mapStr, whStr, shipStr, profStr, pctStr, notes].map(esc).join(',');
		});
		const csv = [csvHeader.join(',')].concat(rows).join('\n');
		const outCsv = path.join(__dirname, '..', 'Prices.csv');
		await fsp.writeFile(outCsv, csv, 'utf8');
		console.log(`Wrote Prices.md, Prices.txt, and Prices.csv (${content.split('\n').length} lines).`);
}

generate().catch(err => {
	console.error('Failed to generate Prices.md:', err);
	process.exit(1);
});

