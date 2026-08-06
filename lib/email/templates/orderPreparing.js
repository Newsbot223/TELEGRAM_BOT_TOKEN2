/**
 * lib/email/templates/orderPreparing.js
 * ─────────────────────────────────────────────────────────────
 * Sent when staff mark the order "Cooking". Only headline/body
 * text/status live here.
 */
const config = require('../config');
const { emailLayout } = require('./layout');
const { buildStatusEmailBody } = require('./statusEmailBody');
const { getStrings } = require('./i18n');

function orderPreparingEmail(order) {
  const lang = order.lang || config.defaultLang;
  const s = getStrings(lang).statuses.cooking;
  const name = (order.customer && order.customer.name) || '';
  const bodyText = s.body(name);

  const bodyHtml = buildStatusEmailBody({
    order, lang,
    statusKey: 'cooking',
    headline:  s.headline,
    bodyText
  });

  return {
    subject: s.subject,
    html: emailLayout({ previewText: bodyText, bodyHtml, lang })
  };
}

module.exports = orderPreparingEmail;
