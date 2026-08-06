/**
 * lib/email/sendOrderEmail.js
 * ─────────────────────────────────────────────────────────────
 * Provider-agnostic send + retry. This file has zero Resend-specific
 * code — it picks a providers/<name>.js module by config.provider
 * and retries transient failures the same way regardless of which
 * provider is active. Adding a new provider never touches this file
 * beyond registering it in the `providers` map below.
 */
const config = require('./config');
const resendProvider = require('./providers/resend');

const providers = {
  resend: resendProvider
  // postmark: require('./providers/postmark'),  ← future provider, same send() shape
};

/* A failure is worth retrying if it's plausibly transient (network
   blip, rate limit, provider-side 5xx). Config/auth/validation
   errors (bad API key, malformed request) are not retried — retrying
   those just delays the log for no chance of success.
   The provider (matching reservation.js's error shape) attaches
   `retryable` explicitly only for config errors (e.g. missing API
   key); for a Resend API error it attaches `status` instead, same
   as the HTTP status reservation.js already includes in its thrown
   message — this falls back to classifying by that status. Anything
   with neither (e.g. a raw network exception) is treated as transient. */
function isRetryable(err) {
  if (err && typeof err.retryable === 'boolean') return err.retryable;
  if (err && typeof err.status === 'number') return err.status === 429 || err.status >= 500;
  return true;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sends one email through the configured provider, retrying
 * transient failures up to config.retry.maxAttempts times with a
 * short backoff between attempts. Throws on final failure — the
 * caller (notifyCustomer.js) is responsible for catching it, since
 * an email failure must never propagate as an order-flow failure.
 */
async function sendOrderEmail({ to, subject, html }) {
  const provider = providers[config.provider];
  if (!provider) {
    throw new Error(`Unknown email provider "${config.provider}" (check EMAIL_PROVIDER)`);
  }

  const { maxAttempts, baseDelayMs } = config.retry;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await provider.send({
        to,
        subject,
        html,
        from:    config.from,
        replyTo: config.replyTo
      });
    } catch (err) {
      lastError = err;
      const isLastAttempt = attempt === maxAttempts;
      if (!isRetryable(err) || isLastAttempt) break;
      await delay(baseDelayMs * attempt);
    }
  }

  throw lastError;
}

module.exports = { sendOrderEmail };
