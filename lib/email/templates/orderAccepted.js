/**
 * lib/email/templates/orderAccepted.js
 * ─────────────────────────────────────────────────────────────
 * Sent when staff mark the order "Accepted" (from Telegram today,
 * from the Admin Dashboard in the future — same function either way).
 */
const config = require('../config');
const { emailLayout } = require('./layout');
const { statusBanner } = require('./helpers');
const { orderSummaryHtml } = require('./orderSummary');
const { getStrings } = require('./i18n');

function orderAcceptedEmail(order) {
  const lang = order.lang || config.defaultLang;
  const s = getStrings(lang).statuses.accepted;

  const bodyHtml = `
    ${statusBanner(config.statusColors.accepted, s.title, s.subtitle)}
    ${orderSummaryHtml(order, lang)}`;

  return {
    subject: s.subject(order.orderId),
    html: emailLayout({ previewText: s.subtitle, bodyHtml, lang })
  };
}

module.exports = orderAcceptedEmail;
