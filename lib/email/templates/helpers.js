/**
 * lib/email/templates/helpers.js
 * ─────────────────────────────────────────────────────────────
 * Generic, low-level building blocks with no opinion about a
 * specific email's layout: escaping, money formatting, the items
 * table, a totals row. The bigger, opinionated reusable pieces
 * (status header, progress tracker, order summary) each get their
 * own file — see statusHeader.js / progressTracker.js /
 * orderSummary.js — so this file stays small and generic.
 */

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatMoney(value) {
  const n = Number(value) || 0;
  return n.toFixed(2) + '\u20AC';
}

/* Table-based markup throughout (not flexbox/grid) — this is what
   renders correctly in Outlook's Word-based HTML engine, which is
   the strictest of the clients this needs to support. */
function itemsTable(items, brand) {
  const rows = (items || []).map((item) => {
    const nameLine = item.variant
      ? `${escapeHtml(item.name)} <span style="color:${brand.muted};">(${escapeHtml(item.variant)})</span>`
      : escapeHtml(item.name);
    const comment = item.comment
      ? `<div style="font-size:12px;color:${brand.muted};font-style:italic;margin-top:2px;">${escapeHtml(item.comment)}</div>`
      : '';
    return `
      <tr>
        <td style="padding:11px 0;border-bottom:1px solid ${brand.border};font-size:14px;color:${brand.text};vertical-align:top;width:36px;">
          ${escapeHtml(item.qty)}&times;
        </td>
        <td style="padding:11px 0;border-bottom:1px solid ${brand.border};font-size:14px;color:${brand.text};vertical-align:top;">
          ${nameLine}${comment}
        </td>
        <td style="padding:11px 0;border-bottom:1px solid ${brand.border};font-size:14px;color:${brand.text};vertical-align:top;text-align:right;white-space:nowrap;">
          ${formatMoney(item.lineTotal)}
        </td>
      </tr>`;
  }).join('');

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      ${rows}
    </table>`;
}

function totalsRow(label, value, brand, opts) {
  opts = opts || {};
  const weight = opts.strong ? '700' : '400';
  const size = opts.strong ? '17px' : '13.5px';
  const color = opts.strong ? brand.gold : brand.muted;
  return `
    <tr>
      <td style="padding:5px 0;font-size:${size};font-weight:${weight};color:${color};">${escapeHtml(label)}</td>
      <td style="padding:5px 0;font-size:${size};font-weight:${weight};color:${color};text-align:right;">${value}</td>
    </tr>`;
}

module.exports = { escapeHtml, formatMoney, itemsTable, totalsRow };
