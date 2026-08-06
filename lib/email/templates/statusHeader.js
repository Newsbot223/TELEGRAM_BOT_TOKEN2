/**
 * lib/email/templates/statusHeader.js
 * ─────────────────────────────────────────────────────────────
 * The visual focus of every status email — a small colour-coded
 * eyebrow badge, a large headline, and a short body paragraph.
 * This is the ONE place that layout lives; every template file
 * just supplies its headline/body text/colour, so restyling this
 * once (bigger type, different spacing, etc.) updates all 5 emails
 * at once. Centered, generous spacing, restrained colour — the
 * "premium delivery app" feel comes from restraint here, not from
 * decoration.
 */
const { escapeHtml } = require('./helpers');

function statusHeader({ badgeText, badgeColor, headline, body, brand }) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
      <tr>
        <td align="center" style="padding:4px 10px 26px;">
          <span style="display:inline-block;background:${badgeColor};color:#0c0c0c;font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;padding:6px 15px;border-radius:999px;">
            ${escapeHtml(badgeText)}
          </span>
          <div style="font-family:Georgia,'Times New Roman',serif;font-size:25px;color:${brand.text};margin:16px 0 8px;line-height:1.25;">
            ${escapeHtml(headline)}
          </div>
          <div style="font-size:14px;color:${brand.muted};line-height:1.65;max-width:380px;margin:0 auto;">
            ${escapeHtml(body)}
          </div>
        </td>
      </tr>
    </table>`;
}

module.exports = { statusHeader };
