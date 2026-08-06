/**
 * lib/email/templates/orderSummary.js
 * ─────────────────────────────────────────────────────────────
 * The ONE reusable order-summary card, shared by every status
 * email: order number, delivery/pickup type + address, itemized
 * list, totals, estimated time. Each of the 5 status templates
 * renders this unchanged — none of them re-implement any part of
 * it, so a pricing/layout tweak here updates all 5 emails at once.
 */
const config = require('../config');
const { formatMoney, itemsTable, totalsRow, escapeHtml } = require('./helpers');
const { getStrings } = require('./i18n');

function orderSummaryHtml(order, lang) {
  const brand = config.brand;
  const t = getStrings(lang).labels;
  const isLieferung = order.orderType === 'lieferung';
  const estimatedLabel = isLieferung ? t.estimatedTime : t.estimatedTimePickup;
  const typeLabel = isLieferung ? t.orderTypeDelivery : t.orderTypePickup;

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:${brand.white};border:1px solid ${brand.border};border-radius:12px;margin-bottom:22px;overflow:hidden;">

      <!-- Order number + type -->
      <tr>
        <td style="padding:18px 20px 14px;border-bottom:1px solid ${brand.border};">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td>
                <div style="font-size:11px;color:${brand.muted};margin-bottom:3px;">${escapeHtml(t.orderNumber)}</div>
                <div style="font-family:'Courier New',monospace;font-size:17px;color:${brand.text};font-weight:700;">#${escapeHtml(order.orderId)}</div>
              </td>
              <td align="right" style="vertical-align:top;">
                <span style="display:inline-block;background:${brand.goldSoft};color:${brand.text};font-size:11px;font-weight:600;padding:5px 11px;border-radius:999px;">
                  ${escapeHtml(typeLabel)}
                </span>
              </td>
            </tr>
          </table>
          ${isLieferung && order.deliveryAddress ? `
          <div style="margin-top:12px;font-size:12.5px;color:${brand.muted};">
            ${escapeHtml(t.deliveryAddress)}<br/>
            <span style="color:${brand.text};">${escapeHtml(order.deliveryAddress)}</span>
          </div>` : ''}
          ${order.estimatedTime ? `
          <div style="margin-top:10px;font-size:12.5px;color:${brand.muted};">
            ${escapeHtml(estimatedLabel)}: <strong style="color:${brand.text};">${escapeHtml(order.estimatedTime)}</strong>
          </div>` : ''}
        </td>
      </tr>

      <!-- Items -->
      <tr>
        <td style="padding:16px 20px 4px;">
          <div style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${brand.gold};margin-bottom:2px;">
            ${escapeHtml(t.items)}
          </div>
          ${itemsTable(order.items, brand)}
        </td>
      </tr>

      <!-- Totals -->
      <tr>
        <td style="padding:6px 20px 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            ${totalsRow(t.subtotal, formatMoney(order.subtotal), brand)}
            ${Number(order.fee) > 0 ? totalsRow(t.deliveryFee, formatMoney(order.fee), brand) : ''}
            <tr><td colspan="2" style="border-top:1px solid ${brand.border};padding-top:8px;"></td></tr>
            ${totalsRow(t.total, formatMoney(order.total), brand, { strong: true })}
          </table>
        </td>
      </tr>

    </table>`;
}

module.exports = { orderSummaryHtml };
