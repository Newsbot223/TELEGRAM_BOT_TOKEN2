/**
 * lib/email/providers/resend.js
 * ─────────────────────────────────────────────────────────────
 * The ONLY file in the whole email system that knows Resend's API
 * shape. sendOrderEmail.js calls send({ to, subject, html, from,
 * replyTo }) — the same shape any future providers/<name>.js would
 * implement (e.g. providers/postmark.js) — so switching providers
 * never touches notifyCustomer.js, sendOrderEmail.js, or a single
 * template.
 *
 * ENV VAR NEEDED:
 *   RESEND_API_KEY — from the Resend dashboard
 */

/* Attaches `status` (for retry classification in sendOrderEmail.js)
   and `retryable` (to short-circuit retries on config errors, e.g.
   a missing/invalid API key — retrying those just wastes time). */
function apiError(message, status, retryable) {
  const err = new Error(message);
  err.status = status;
  err.retryable = retryable;
  return err;
}

async function send({ to, subject, html, from, replyTo }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw apiError('RESEND_API_KEY is not set', undefined, false);
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type':  'application/json'
    },
    body: JSON.stringify({
      from:    `${from.name} <${from.address}>`,
      to:      [to],
      subject,
      html,
      reply_to: replyTo || undefined
    })
  });

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).message; } catch (_) { /* ignore parse failure */ }
    /* 4xx (bad request/auth) → not retryable; 429/5xx → retryable.
       Classification is finished here so sendOrderEmail.js stays
       provider-agnostic. */
    const retryable = res.status === 429 || res.status >= 500;
    throw apiError(detail || `Resend API error (HTTP ${res.status})`, res.status, retryable);
  }

  return res.json();
}

module.exports = { send };
