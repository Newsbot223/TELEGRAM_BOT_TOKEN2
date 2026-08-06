/**
 * lib/email/templates/orderDelivered.js
 * ─────────────────────────────────────────────────────────────
 * Sent when staff mark the order "Delivered" — the final status.
 * Only headline/body text/status live here; the review/Instagram/
 * order-again row is its own reusable component (footerActions.js),
 * passed in as this status's one bit of extra content.
 */
const config = require('../config');
const { emailLayout } = require('./layout');
const { buildStatusEmailBody } = require('./statusEmailBody');
const { footerActions } = require('./footerActions');
const { getStrings } = require('./i18n');

function orderDeliveredEmail(order) {
  const lang = order.lang || config.defaultLang;
  const s = getStrings(lang).statuses.delivered;
  const name = (order.customer && order.customer.name) || '';
  const bodyText = s.body(name);

  const bodyHtml = buildStatusEmailBody({
    order, lang,
    statusKey: 'delivered',
    headline:  s.headline,
    bodyText,
    extraHtml: footerActions(lang, config.brand, config.restaurant)
  });

  return {
    subject: s.subject,
    html: emailLayout({ previewText: bodyText, bodyHtml, lang })
  };
}

module.exports = orderDeliveredEmail;
