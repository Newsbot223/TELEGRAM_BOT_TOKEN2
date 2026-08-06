/**
 * lib/email/templates/orderReceived.js
 * ─────────────────────────────────────────────────────────────
 * Sent immediately after checkout. Per the design brief, this file
 * contains only this status's headline/body text/subject — the
 * header badge, progress tracker, and order summary are all shared
 * components assembled by statusEmailBody.js.
 */
const config = require('../config');
const { emailLayout } = require('./layout');
const { buildStatusEmailBody } = require('./statusEmailBody');
const { getStrings } = require('./i18n');

function orderReceivedEmail(order) {
  const lang = order.lang || config.defaultLang;
  const s = getStrings(lang).statuses.new;
  const name = (order.customer && order.customer.name) || '';
  const bodyText = s.body(name);

  const bodyHtml = buildStatusEmailBody({
    order, lang,
    statusKey: 'new',
    headline:  s.headline,
    bodyText
  });

  return {
    subject: s.subject,
    html: emailLayout({ previewText: bodyText, bodyHtml, lang })
  };
}

module.exports = orderReceivedEmail;
