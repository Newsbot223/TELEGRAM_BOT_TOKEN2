/**
 * lib/email/templates/orderPreparing.js
 * ─────────────────────────────────────────────────────────────
 * Sent when staff mark the order "Cooking".
 */
const config = require('../config');
const { emailLayout } = require('./layout');
const { statusBanner } = require('./helpers');
const { orderSummaryHtml } = require('./orderSummary');
const { getStrings } = require('./i18n');

function orderPreparingEmail(order) {
  const lang = order.lang || config.defaultLang;
  const s = getStrings(lang).statuses.cooking;

  const bodyHtml = `
    ${statusBanner(config.statusColors.cooking, s.title, s.subtitle)}
    ${orderSummaryHtml(order, lang)}`;

  return {
    subject: s.subject(order.orderId),
    html: emailLayout({ previewText: s.subtitle, bodyHtml, lang })
  };
}

module.exports = orderPreparingEmail;
