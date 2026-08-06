/**
 * lib/email/templates/orderSummary.js
 * ─────────────────────────────────────────────────────────────
 * The part of the email that's identical across all 5 statuses:
 * order number, itemized list, totals, estimated time when present.
 * Each status template supplies its own banner above this block —
 * this is what keeps 5 templates from re-implementing the same
 * table markup 5 times.
 */
const config = require('../config');
const { formatMoney, itemsTable, totalsRow, escapeHtml } = require('./helpers');
const { getStrings } = require('./i18n');

function orderSummaryHtml(order, lang) {
  const brand = config.brand;
  const t = getStrings(lang).labels;
  const isLieferung = order.orderType === 'lieferung';
  const estimatedLabel = isLieferung ? t.estimatedTime : t.estimatedTimePickup;

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:22px;">
      <tr>
        <td style="font-size:12px;color:${brand.muted};padding-bottom:4px;">${escapeHtml(t.orderNumber)}</td>
      </tr>
      <tr>
        <td style="font-family:'Courier New',monospace;font-size:18px;color:${brand.text};font-weight:700;padding-bottom:2px;">
          #${escapeHtml(order.orderId)}
        </td>
      </tr>
      ${order.estimatedTime ? `
      <tr>
        <td style="font-size:12.5px;color:${brand.muted};padding-top:10px;">
          ${escapeHtml(estimatedLabel)}: <strong style="color:${brand.text};">${escapeHtml(order.estimatedTime)}</strong>
        </td>
      </tr>` : ''}
    </table>

    <div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${brand.gold};border-bottom:1px solid ${brand.border};padding-bottom:8px;margin-bottom:4px;">
      ${escapeHtml(t.items)}
    </div>
    ${itemsTable(order.items, brand)}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:10px;">
      ${totalsRow(t.subtotal, formatMoney(order.subtotal), brand)}
      ${Number(order.fee) > 0 ? totalsRow(t.deliveryFee, formatMoney(order.fee), brand) : ''}
      <tr><td colspan="2" style="border-top:1px solid ${brand.border};padding-top:6px;"></td></tr>
      ${totalsRow(t.total, formatMoney(order.total), brand, { strong: true })}
    </table>`;
}

module.exports = { orderSummaryHtml };
