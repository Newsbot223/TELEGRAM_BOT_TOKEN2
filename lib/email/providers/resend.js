/**
 * lib/email/providers/resend.js
 * ─────────────────────────────────────────────────────────────
 * The ONLY file in the whole email system that knows Resend's API
 * shape. sendOrderEmail.js calls send({ to, subject, html, from,
 * replyTo }) — the same shape any future providers/<name>.js would
 * implement — so switching providers never touches
 * notifyCustomer.js, sendOrderEmail.js, or a single template.
 *
 * This mirrors api/reservation.js's existing, already-working
 * sendEmail() helper on purpose — same endpoint, same fetch/header
 * shape, same request body shape, same response handling
 * (`!res.ok || data.error`, same error-message assembly) — so the
 * project has ONE consistent way of talking to Resend instead of
 * two slightly different ones. reservation.js itself is untouched;
 * this file just reproduces its approach for order status emails.
 * No Resend npm SDK — native fetch only, same as reservation.js.
 *
 * ENV VAR NEEDED (same variable reservation.js already uses):
 *   RESEND_API_KEY — from the Resend dashboard
 */
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

async function send({ to, subject, html, from, replyTo }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    const err = new Error('RESEND_API_KEY not set');
    err.retryable = false; // config error — retrying can't help
    throw err;
  }

  /* Same "Name <address>" style reservation.js's FROM_ADDRESS uses,
     built from config.js's from.name/from.address instead of a
     hardcoded constant, since order emails need their own sender
     identity but the same format. */
  const fromAddress = `${from.name} <${from.address}>`;

  const res = await fetch(RESEND_ENDPOINT, {
    method:  'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from:    fromAddress,
      to:      Array.isArray(to) ? to : [to],
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {})
    })
  });

  /* Identical check to reservation.js: Resend can return a non-2xx
     status OR a 200 with an `error` field, so both are checked. */
  const data = await res.json();
  if (!res.ok || data.error) {
    const msg = (data.error && data.error.message) || data.message || 'Resend error';
    const err = new Error(msg + ' (HTTP ' + res.status + ')');
    /* Not part of reservation.js's version (it doesn't need retries) —
       attached here only so sendOrderEmail.js's retry wrapper can
       classify the failure. Doesn't change the thrown message. */
    err.status = res.status;
    throw err;
  }

  return data;
}

module.exports = { send };
