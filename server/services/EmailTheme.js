const THEME = {
  bg: '#ffffff',
  surface: '#ffffff',
  border: '#d3d0d7',
  ink: '#000000',
  muted: '#5a5a5a',
  brand: '#241773'
};

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderBrandedEmailHtml({
  title,
  subtitle,
  bodyHtml,
  maxWidth = 600,
  brandName = 'EZ Sports Netting',
  logoUrl = 'https://ezsportsnetting.com/assets/img/EZSportslogo.png'
} = {}) {
  const safeTitle = escapeHtml(title || brandName);
  const safeSubtitle = subtitle ? escapeHtml(subtitle) : '';
  const width = Number(maxWidth) || 600;

  const logo = logoUrl
    ? `
      <div style="margin-bottom:12px;">
        <div style="display:inline-block;background:#ffffff;border-radius:12px;padding:8px 12px;">
          <img src="${escapeHtml(logoUrl)}" alt="${escapeHtml(brandName)} logo" width="170" style="display:block;height:auto;max-width:170px;border:0;outline:none;text-decoration:none;" />
        </div>
      </div>
    `
    : '';

  return `<div style="margin:0;padding:0;background:${THEME.bg};">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:${THEME.bg};padding:24px 0;">
    <tr>
      <td align="center" style="padding:0 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" width="${width}" style="width:${width}px;max-width:${width}px;border:1px solid ${THEME.border};border-radius:12px;overflow:hidden;background:${THEME.surface};">
          <tr>
            <td style="background:${THEME.brand};padding:16px 18px;">
              ${logo}
              <div style="color:#ffffff;font-weight:900;font-size:18px;line-height:22px;">${safeTitle}</div>
              ${safeSubtitle ? `<div style="color:#ffffff;opacity:.92;font-size:13px;line-height:18px;margin-top:4px;">${safeSubtitle}</div>` : ''}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 20px;color:${THEME.ink};font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
              ${bodyHtml || ''}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</div>`;
}

module.exports = {
  THEME,
  escapeHtml,
  renderBrandedEmailHtml
};
