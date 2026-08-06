/**
 * lib/email/templates/orderDelivered.js
 * ─────────────────────────────────────────────────────────────
 * Sent when staff mark the order "Delivered" — the final status.
 */
const config = require('../config');
const { emailLayout } = require('./layout');
const { statusBanner } = require('./helpers');
const { orderSummaryHtml } = require('./orderSummary');
const { getStrings } = require('./i18n');

function orderDeliveredEmail(order) {
  const lang = order.lang || config.defaultLang;
  const s = getStrings(lang).statuses.delivered;

  const bodyHtml = `
    ${statusBanner(config.statusColors.delivered, s.title, s.subtitle)}
    ${orderSummaryHtml(order, lang)}`;

  return {
    subject: s.subject(order.orderId),
    html: emailLayout({ previewText: s.subtitle, bodyHtml, lang })
  };
}

module.exports = orderDeliveredEmail;
