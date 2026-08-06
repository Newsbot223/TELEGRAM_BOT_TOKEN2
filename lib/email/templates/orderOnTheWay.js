/**
 * lib/email/templates/orderOnTheWay.js
 * ─────────────────────────────────────────────────────────────
 * Sent when staff mark the order "Driver left". Only headline/body
 * text/status live here — the delivery address is already shown by
 * the shared order-summary component (orderSummary.js) for every
 * delivery-type order, so it doesn't need to be repeated here.
 */
const config = require('../config');
const { emailLayout } = require('./layout');
const { buildStatusEmailBody } = require('./statusEmailBody');
const { getStrings } = require('./i18n');

function orderOnTheWayEmail(order) {
  const lang = order.lang || config.defaultLang;
  const s = getStrings(lang).statuses.on_the_way;
  const name = (order.customer && order.customer.name) || '';
  const bodyText = s.body(name);

  const bodyHtml = buildStatusEmailBody({
    order, lang,
    statusKey: 'on_the_way',
    headline:  s.headline,
    bodyText
  });

  return {
    subject: s.subject,
    html: emailLayout({ previewText: bodyText, bodyHtml, lang })
  };
}

module.exports = orderOnTheWayEmail;
