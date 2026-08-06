/**
 * lib/email/templates/orderReceived.js
 * ─────────────────────────────────────────────────────────────
 * Sent immediately after checkout. Only this file (+ i18n.js) knows
 * the copy for this status — layout/summary markup is shared.
 */
const config = require('../config');
const { emailLayout } = require('./layout');
const { statusBanner } = require('./helpers');
const { orderSummaryHtml } = require('./orderSummary');
const { getStrings } = require('./i18n');

function orderReceivedEmail(order) {
  const lang = order.lang || config.defaultLang;
  const s = getStrings(lang).statuses.new;

  const bodyHtml = `
    ${statusBanner(config.statusColors.new, s.title, s.subtitle)}
    ${orderSummaryHtml(order, lang)}`;

  return {
    subject: s.subject(order.orderId),
    html: emailLayout({ previewText: s.subtitle, bodyHtml, lang })
  };
}

module.exports = orderReceivedEmail;
