/**
 * lib/email/config.js
 * ─────────────────────────────────────────────────────────────
 * Single source of truth for the email system's configuration.
 * Nothing else in lib/email/ reads process.env directly — this is
 * the only file that does, so every knob (sender identity, which
 * provider is active, retry behaviour, brand colours) lives in one
 * place instead of being scattered across templates/providers.
 *
 * ENV VARS (all optional — sensible defaults below):
 *   EMAIL_PROVIDER       — 'resend' (default; only one implemented today)
 *   EMAIL_FROM_NAME       — display name on outgoing emails
 *   EMAIL_FROM_ADDRESS     — must be a verified sender/domain with the provider
 *   EMAIL_REPLY_TO           — optional, defaults to no reply-to header
 *   RESEND_API_KEY             — read directly by providers/resend.js only
 */
module.exports = {
  /* Which providers/<name>.js module sendOrderEmail.js delegates to.
     Swapping providers later is: add providers/postmark.js with the
     same send() shape, change this one string. */
  provider: process.env.EMAIL_PROVIDER || 'resend',

  from: {
    name:    process.env.EMAIL_FROM_NAME    || 'Takashi Restaurant',
    address: process.env.EMAIL_FROM_ADDRESS || 'orders@takashi-restaurant.de'
  },
  replyTo: process.env.EMAIL_REPLY_TO || null,

  /* Transient-failure retry policy, applied in sendOrderEmail.js
     regardless of which provider is active. */
  retry: {
    maxAttempts:  3,
    baseDelayMs:  400 // exponential-ish: 400ms, 800ms between attempts
  },

  /* Shared visual identity for every template — change once here,
     every status email (and future ones) picks it up. Matches the
     existing PDF receipt's navy/gold so the brand is consistent
     across Telegram PDF, website and email. */
  brand: {
    black:  '#0b0b0c',
    navy:   '#0b1830',
    gold:   '#c4993a',
    goldL:  '#e0bb68',
    white:  '#ffffff',
    text:   '#1a1a1a',
    muted:  '#6b7280',
    border: '#e5e2da'
  },

  /* Status → accent colour, reused as the email's banner colour.
     Intentionally the same palette used elsewhere in the project
     for the same statuses, for visual consistency — not a code
     dependency, this file has no import from anywhere else. */
  statusColors: {
    new:        '#C4993A',
    accepted:   '#5B8DEF',
    cooking:    '#E0A63E',
    on_the_way: '#8B7CF6',
    delivered:  '#4C9F70'
  },

  restaurant: {
    name:    'Takashi Restaurant',
    address: 'Wilhelmstraße 122, 72764 Reutlingen',
    phone:   '+49 7121 3829996'
  },

  /* Default language if an order somehow has none (older orders
     placed before the language field existed). */
  defaultLang: 'de'
};
