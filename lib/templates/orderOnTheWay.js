/**
 * lib/email/templates/orderOnTheWay.js
 * ─────────────────────────────────────────────────────────────
 * Sent when staff mark the order "Driver left". This is the direct
 * replacement for the old customer-facing WhatsApp message at this
 * status — same trigger point, different channel.
 */
const config = require('../config');
const { emailLayout } = require('./layout');
const { statusBanner } = require('./helpers');
const { orderSummaryHtml } = require('./orderSummary');
const { getStrings } = require('./i18n');

function orderOnTheWayEmail(order) {
  const lang = order.lang || config.defaultLang;
  const s = getStrings(lang).statuses.on_the_way;

  const bodyHtml = `
    ${statusBanner(config.statusColors.on_the_way, s.title, s.subtitle)}
    ${orderSummaryHtml(order, lang)}`;

  return {
    subject: s.subject(order.orderId),
    html: emailLayout({ previewText: s.subtitle, bodyHtml, lang })
  };
}

module.exports = orderOnTheWayEmail;
