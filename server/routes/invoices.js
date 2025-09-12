const express = require('express');
const router = express.Router();
const InvoiceService = require('../services/InvoiceService');
const { requireAdmin, requireAuth } = require('../middleware/auth');

const invoiceService = new InvoiceService();

// Get all invoices (admin only)
router.get('/admin/all', requireAdmin, async (req, res) => {
  try {
    const { status, page, pageSize, sortBy, sortDir } = req.query;
    const result = await invoiceService.getAllInvoices(status, { page, pageSize, sortBy, sortDir });
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get single invoice by invoice ID (admin or owner)
router.get('/:invoiceId', requireAuth, async (req, res) => {
  try {
    const invoice = await invoiceService.getInvoiceById(req.params.invoiceId);
    if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
    // If not admin, ensure the requester owns the invoice's order via email match if available
    if (!req.user.isAdmin) {
      const userEmail = (req.user.email || '').toLowerCase();
      const invEmail = (invoice.customer?.email || '').toLowerCase();
      if (!userEmail || !invEmail || userEmail !== invEmail) {
        return res.status(403).json({ message: 'Forbidden' });
      }
    }
    res.json(invoice);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;

// Printable invoice (HTML) - admin or owner
router.get('/:invoiceId/print', requireAuth, async (req, res) => {
  try {
    const invoice = await invoiceService.getInvoiceById(req.params.invoiceId);
    if (!invoice) return res.status(404).send('Invoice not found');
    if (!req.user.isAdmin) {
      const userEmail = (req.user.email || '').toLowerCase();
      const invEmail = (invoice.customer?.email || '').toLowerCase();
      if (!userEmail || !invEmail || userEmail !== invEmail) {
        return res.status(403).send('Forbidden');
      }
    }
    const rows = (invoice.items||[]).map(it => `
      <tr>
        <td>${it.productName||it.productId}</td>
        <td class="num">${it.quantity||it.qty}</td>
        <td class="num">$${Number(it.price||0).toFixed(2)}</td>
        <td class="num">$${Number(it.subtotal||((it.price||0)*(it.quantity||1))).toFixed(2)}</td>
      </tr>`).join('');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html>
      <html><head><meta charset="utf-8" />
      <title>${invoice.id}</title>
  <style>body{font-family:Arial,Helvetica,sans-serif;padding:24px;color:#111}
  h1{margin:0 0 8px} table{width:100%;border-collapse:collapse;margin-top:12px}
  th,td{padding:8px;border-bottom:1px solid #eee;text-align:left}
  th.num, td.num{ text-align:right; }
      .totals{margin-top:12px;text-align:right}
      .meta{color:#555;margin:0 0 12px}
      .actions{margin-top:16px;text-align:right}
  .btn{background:#241773;color:#fff;border:none;padding:8px 12px;border-radius:6px;cursor:pointer}
      </style></head><body>
        <h1>Invoice ${invoice.id}</h1>
        <p class="meta">Date: ${new Date(invoice.createdAt).toLocaleString()}</p>
        <p class="meta">Customer: ${invoice.customer?.name || ''} (${invoice.customer?.email || ''})</p>
        <table>
          <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Subtotal</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="totals">
          <div>Subtotal: $${Number(invoice.subtotal||0).toFixed(2)}</div>
          <div>Tax: $${Number(invoice.tax||0).toFixed(2)}</div>
          <div>Shipping: $${Number(invoice.shipping||0).toFixed(2)}</div>
          <div><strong>Total: $${Number(invoice.total||0).toFixed(2)}</strong></div>
        </div>
        <div class="actions"><button class="btn" onclick="window.print()">Print</button></div>
      </body></html>`);
  } catch (err) {
    res.status(500).send(err.message);
  }
});
