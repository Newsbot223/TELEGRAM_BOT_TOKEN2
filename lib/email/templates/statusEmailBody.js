/**
 * lib/email/templates/statusEmailBody.js
 * ─────────────────────────────────────────────────────────────
 * Assembles the 3 shared components (status header, progress
 * tracker, order summary) into one body. This is what lets each of
 * the 5 status template files contain only a headline, a body text,
 * and a status key — no layout code is duplicated between them.
 *
 * Not Telegram-aware, not messageStore-aware — takes a plain order
 * object and a status key, exactly like notifyCustomer() itself, so
 * the future Admin Dashboard's calls land here unchanged too.
 */
const config = require('../config');
const { statusHeader } = require('./statusHeader');
const { progressTracker } = require('./progressTracker');
const { orderSummaryHtml } = require('./orderSummary');
const { getStrings } = require('./i18n');

/**
 * @param {object} order       Plain order object (see orderSummary.js).
 * @param {string} lang        'de' | 'en'.
 * @param {string} statusKey   new | accepted | cooking | on_the_way | delivered.
 * @param {string} headline    Large title text for this status.
 * @param {string} bodyText    Short, friendly paragraph for this status.
 * @param {string} [extraHtml] Optional extra content appended after the
 *                              order summary (e.g. orderDelivered.js's
 *                              review/Instagram/order-again row).
 */
function buildStatusEmailBody({ order, lang, statusKey, headline, bodyText, extraHtml }) {
  const brand = config.brand;
  const badgeColor = config.statusColors[statusKey];
  const badgeText = getStrings(lang).tracker[statusKey];

  return `
    ${statusHeader({ badgeText, badgeColor, headline, body: bodyText, brand })}
    ${progressTracker(statusKey, lang, brand)}
    ${orderSummaryHtml(order, lang)}
    ${extraHtml || ''}
  `;
}

module.exports = { buildStatusEmailBody };
