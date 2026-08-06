/**
 * lib/email/templates/footerActions.js
 * ─────────────────────────────────────────────────────────────
 * The "leave a review / follow us / order again" row shown on the
 * Delivered email. A reusable component (not inlined into
 * orderDelivered.js) so a future email that wants the same row
 * doesn't duplicate this markup.
 *
 * "Order again" has no self-service reorder flow yet, so it's a
 * styled placeholder (href="#") — design only, per the brief. The
 * review and Instagram links reuse the same URLs already used
 * elsewhere in the project (see config.js's restaurant.* fields).
 */
const { escapeHtml } = require('./helpers');
const { getStrings } = require('./i18n');

function actionPill(text, url, brand) {
  return `
    <a href="${url}" style="display:block;background:${brand.panel};border:1px solid ${brand.border};border-radius:10px;padding:13px 16px;margin-bottom:10px;font-size:13.5px;color:${brand.text};text-decoration:none;text-align:center;">
      ${escapeHtml(text)}
    </a>`;
}

function footerActions(lang, brand, restaurant) {
  const t = getStrings(lang).footer;
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:6px;">
      <tr><td>
        ${actionPill(t.googleReview, restaurant.googleReviewUrl || '#', brand)}
        ${actionPill(t.instagram, restaurant.instagramUrl || '#', brand)}
        ${actionPill(t.orderAgain, '#', brand)}
      </td></tr>
    </table>`;
}

module.exports = { footerActions };
