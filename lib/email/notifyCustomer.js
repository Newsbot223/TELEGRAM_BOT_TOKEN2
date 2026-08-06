/**
 * lib/email/notifyCustomer.js
 * ─────────────────────────────────────────────────────────────
 * The single entry point into the email system. Callers — order.js
 * today, the Admin Dashboard's status-update route tomorrow, a
 * background worker after that — all call the exact same function
 * the exact same way. No template or provider logic is ever
 * duplicated between callers.
 *
 * DESIGN NOTES
 *
 * Storage-independent: notifyCustomer(order, statusKey) takes a
 * plain order object, not an ID. It never reads messageStore, a
 * database, or anything else — it has no idea where `order` came
 * from. Whoever calls it is responsible for fetching the order
 * first. This is what lets the eventual Supabase migration change
 * nothing in this file.
 *
 * HTTP-lifecycle-independent: this is a plain async function with
 * no req/res parameters and no assumption about when or how it's
 * invoked. Today, order.js awaits it after already sending the HTTP
 * response (see the touch points in order.js). Nothing here requires
 * that — it's just as valid to call this from a queue consumer, a
 * cron job, or a retry worker later; the function's contract
 * (order + status in, { sent, error } out) doesn't change either
 * way. If background/async execution is introduced later (e.g. a
 * queue), that logic wraps THIS function from the outside — this
 * file doesn't need to change.
 *
 * Failure-isolated: never throws. Every failure is caught, logged,
 * and returned as { sent: false, error } so a broken email can never
 * take down whatever called it.
 */
const config = require('./config');
const { sendOrderEmail } = require('./sendOrderEmail');

const templateBuilders = {
  new:        require('./templates/orderReceived'),
  accepted:   require('./templates/orderAccepted'),
  cooking:    require('./templates/orderPreparing'),
  on_the_way: require('./templates/orderOnTheWay'),
  delivered:  require('./templates/orderDelivered')
};

/**
 * @param {object} order    Plain order object — needs at minimum
 *                            orderId, customer.email, items, total.
 *                            order.lang ('de'|'en') controls the
 *                            template language; defaults to German.
 * @param {string} statusKey One of: new, accepted, cooking,
 *                            on_the_way, delivered.
 * @returns {Promise<{sent:boolean, error?:string}>}
 */
async function notifyCustomer(order, statusKey) {
  const buildEmail = templateBuilders[statusKey];
  if (!buildEmail) {
    const error = `Unknown status "${statusKey}" — no email template registered`;
    console.error(`[Email] notifyCustomer: ${error}`);
    return { sent: false, error };
  }

  const to = order && order.customer && order.customer.email;
  if (!to) {
    /* Not an error worth alarming about — older orders or malformed
       input may lack an email. Log quietly and move on. */
    console.warn(`[Email] notifyCustomer: order ${order && order.orderId} has no customer email — skipped`);
    return { sent: false, error: 'No customer email on order' };
  }

  try {
    const { subject, html } = buildEmail(order);
    await sendOrderEmail({ to, subject, html });
    return { sent: true };
  } catch (err) {
    console.error(
      `[Email] notifyCustomer: failed to send "${statusKey}" email for order ${order.orderId} —`,
      err && err.message
    );
    return { sent: false, error: err && err.message };
  }
}

module.exports = { notifyCustomer };
