/**
 * lib/email/templates/orderAccepted.js
 * ─────────────────────────────────────────────────────────────
 * Sent when staff mark the order "Accepted" (from Telegram today,
 * from the Admin Dashboard in the future — same notifyCustomer()
 * call either way). Only headline/body text/status live here.
 */
const config = require('../config');
const { emailLayout } = require('./layout');
const { buildStatusEmailBody } = require('./statusEmailBody');
const { getStrings } = require('./i18n');

function orderAcceptedEmail(order) {
  const lang = order.lang || config.defaultLang;
  const s = getStrings(lang).statuses.accepted;
  const name = (order.customer && order.customer.name) || '';
  const bodyText = s.body(name);

  const bodyHtml = buildStatusEmailBody({
    order, lang,
    statusKey: 'accepted',
    headline:  s.headline,
    bodyText
  });

  return {
    subject: s.subject,
    html: emailLayout({ previewText: bodyText, bodyHtml, lang })
  };
}

module.exports = orderAcceptedEmail;
