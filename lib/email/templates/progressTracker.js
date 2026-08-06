/**
 * lib/email/templates/progressTracker.js
 * ─────────────────────────────────────────────────────────────
 * The single progress-tracker component every status email reuses —
 * this file is the ONLY place its markup exists. Given the order's
 * current status, it renders all 5 lifecycle steps: completed steps
 * in green, the current step highlighted, future steps in light
 * grey. A vertical list (one step per line) rather than a horizontal
 * bar — this is deliberate: horizontal step-bars are notoriously
 * unreliable in Outlook's rendering engine, while a simple vertical
 * table row per step renders identically everywhere.
 */
const { escapeHtml } = require('./helpers');
const { getStrings } = require('./i18n');

const STEP_ORDER = ['new', 'accepted', 'cooking', 'on_the_way', 'delivered'];

function progressTracker(currentStatusKey, lang, brand) {
  const labels = getStrings(lang).tracker;
  const currentIndex = STEP_ORDER.indexOf(currentStatusKey);

  const rows = STEP_ORDER.map((key, i) => {
    const isCurrent = i === currentIndex;
    const isDone    = i < currentIndex;
    const isFuture  = i > currentIndex;

    const dot = isFuture ? '\u26AA' : '\uD83D\uDFE2'; // ⚪ future, 🟢 done/current
    const color = isCurrent ? brand.gold : isDone ? brand.success : brand.dim;
    const weight = isCurrent ? '700' : '400';
    const rowBg = isCurrent ? brand.goldSoft : 'transparent';

    return `
      <tr>
        <td style="padding:9px 14px;background:${rowBg};border-radius:6px;">
          <span style="font-size:12px;">${dot}</span>
          <span style="font-size:13.5px;color:${color};font-weight:${weight};margin-left:10px;">
            ${escapeHtml(labels[key])}
          </span>
        </td>
      </tr>`;
  }).join('');

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:${brand.panel};border:1px solid ${brand.border};border-radius:10px;margin-bottom:24px;">
      ${rows}
    </table>`;
}

module.exports = { progressTracker };
