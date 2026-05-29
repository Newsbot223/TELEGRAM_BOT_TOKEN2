/**
 * Takashi Restaurant — Reservation Email API
 * Vercel Serverless Function: /api/reservation
 *
 * Sends two emails on successful reservation:
 *   1. Restaurant notification → RESERVATION_EMAIL
 *   2. Customer confirmation  → customer's email (only if provided)
 *
 * Environment variables (Vercel → Settings → Environment Variables):
 *   RESEND_API_KEY       — from resend.com dashboard
 *   RESERVATION_EMAIL    — restaurant inbox, e.g. kontakt@takashi-restaurant.com
 *
 * No npm packages — native fetch only.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const FROM_ADDRESS    = 'Takashi Website <reservierung@takashi-restaurant.com>';

/* ─── Helpers ────────────────────────────────────────────────────────── */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function formatDate(dateStr) {
  const p = String(dateStr).split('-');
  return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : dateStr;
}
function formatTimestamp(iso) {
  try {
    return new Date(iso).toLocaleString('de-DE', {
      day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'
    });
  } catch { return iso; }
}

/* ─── Restaurant notification email ─────────────────────────────────── */
function buildRestaurantHtml(d) {
  const rows = [
    ['Name',        d.name],
    ['Telefon',     d.phone],
    ['E-Mail',      d.email || '–'],
    ['Datum',       formatDate(d.date)],
    ['Uhrzeit',     d.time],
    ['Personen',    d.persons + ' Person' + (parseInt(d.persons) !== 1 ? 'en' : '')],
    ['Kommentar',   d.comment || '–'],
    ['Sprache',     d.language === 'en' ? 'Englisch' : 'Deutsch'],
    ['Eingegangen', formatTimestamp(d.createdAt)],
  ];
  const tableRows = rows.map(([label, value]) => `
    <tr>
      <td style="padding:8px 14px;font-size:13px;color:#888;white-space:nowrap;vertical-align:top;border-bottom:1px solid #1e1e1e">${label}</td>
      <td style="padding:8px 14px;font-size:13px;color:#f0f0f0;vertical-align:top;border-bottom:1px solid #1e1e1e">${escHtml(String(value))}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="de"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#111;border:1px solid #2a2a2a;border-radius:6px;overflow:hidden;">
<tr><td style="background:#111;border-bottom:2px solid #C4993A;padding:26px 28px 20px;text-align:center;">
  <div style="font-family:Georgia,serif;font-size:24px;font-weight:400;letter-spacing:.22em;color:#C4993A;text-transform:uppercase;margin-bottom:5px;">TAKASHI</div>
  <div style="font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:rgba(196,153,58,.5);">Asiatische Küche &bull; Reutlingen</div>
</td></tr>
<tr><td style="padding:20px 28px 14px;border-bottom:1px solid #1e1e1e;">
  <div style="font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:#C4993A;margin-bottom:4px;">Neue Reservierungsanfrage</div>
  <div style="font-family:Georgia,serif;font-size:20px;font-weight:400;color:#f0f0f0;">Tischreservierung</div>
</td></tr>
<tr><td style="padding:6px 0;">
  <table width="100%" cellpadding="0" cellspacing="0">${tableRows}</table>
</td></tr>
<tr><td style="padding:18px 28px;border-top:1px solid #1e1e1e;text-align:center;">
  <div style="font-size:10px;color:#555;line-height:1.6;">Automatisch gesendet von <a href="https://takashi-reutlingen.de" style="color:#C4993A;text-decoration:none;">takashi-reutlingen.de</a></div>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

/* ─── Customer confirmation email ────────────────────────────────────── */
function buildCustomerHtml(d) {
  const isEN    = d.language === 'en';
  const persons = d.persons + (isEN
    ? (' person' + (parseInt(d.persons) !== 1 ? 's' : ''))
    : (' Person' + (parseInt(d.persons) !== 1 ? 'en' : '')));

  const commentBlock = d.comment
    ? `<tr>
        <td style="padding:6px 14px;font-size:12px;color:#888;vertical-align:top;">${isEN ? 'Comment' : 'Kommentar'}:</td>
        <td style="padding:6px 14px;font-size:12px;color:#ddd;vertical-align:top;">${escHtml(d.comment)}</td>
       </tr>`
    : '';

  const intro = isEN
    ? 'Thank you for your reservation at Takashi Restaurant. Your reservation has been successfully registered and confirmed. We look forward to welcoming you on the selected date. If any questions arise, we will contact you by phone or email.'
    : 'Vielen Dank für Ihre Reservierung bei Takashi Restaurant. Ihre Reservierung wurde erfolgreich registriert und bestätigt. Wir freuen uns, Sie am ausgewählten Datum begrüßen zu dürfen. Sollten Rückfragen entstehen, kontaktieren wir Sie telefonisch oder per E-Mail.';

  return `<!DOCTYPE html>
<html lang="${d.language || 'de'}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:500px;background:#111;border:1px solid #2a2a2a;border-radius:6px;overflow:hidden;">

<tr><td style="background:linear-gradient(135deg,#111,#181818);border-bottom:2px solid #C4993A;padding:28px 28px 22px;text-align:center;">
  <div style="font-family:Georgia,serif;font-size:26px;font-weight:400;letter-spacing:.24em;color:#C4993A;text-transform:uppercase;margin-bottom:5px;">TAKASHI</div>
  <div style="font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:rgba(196,153,58,.5);margin-bottom:12px;">Asiatische Küche &bull; Reutlingen</div>
  <div style="font-family:Georgia,serif;font-size:17px;font-style:italic;font-weight:300;color:rgba(237,233,227,.7);">${isEN ? 'Reservation Confirmation' : 'Reservierungsbestätigung'}</div>
</td></tr>

<tr><td style="padding:22px 28px 16px;">
  <p style="margin:0;font-size:13px;color:#ccc;line-height:1.7;">${isEN ? 'Dear' : 'Liebe/r'} ${escHtml(d.name)},</p>
  <p style="margin:10px 0 0;font-size:13px;color:#aaa;line-height:1.75;">${intro}</p>
</td></tr>

<tr><td style="padding:0 20px 20px;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d0d;border:1px solid #2a2a2a;border-radius:6px;overflow:hidden;">
    <tr><td colspan="2" style="padding:10px 14px 8px;background:#151515;border-bottom:1px solid #1e1e1e;">
      <span style="font-size:9px;letter-spacing:.13em;text-transform:uppercase;color:#C4993A;">${isEN ? 'Booking Details' : 'Ihre Angaben'}</span>
    </td></tr>
    <tr>
      <td style="padding:8px 14px;font-size:12px;color:#888;white-space:nowrap;border-bottom:1px solid #1e1e1e;">${isEN ? 'Date' : 'Datum'}:</td>
      <td style="padding:8px 14px;font-size:12px;border-bottom:1px solid #1e1e1e;"><strong style="color:#C4993A;">${formatDate(d.date)}</strong></td>
    </tr>
    <tr>
      <td style="padding:8px 14px;font-size:12px;color:#888;white-space:nowrap;border-bottom:1px solid #1e1e1e;">${isEN ? 'Time' : 'Uhrzeit'}:</td>
      <td style="padding:8px 14px;font-size:12px;border-bottom:1px solid #1e1e1e;"><strong style="color:#C4993A;">${d.time} ${isEN ? "o'clock" : 'Uhr'}</strong></td>
    </tr>
    <tr>
      <td style="padding:8px 14px;font-size:12px;color:#888;white-space:nowrap;border-bottom:1px solid #1e1e1e;">${isEN ? 'Guests' : 'Personen'}:</td>
      <td style="padding:8px 14px;font-size:12px;color:#ddd;border-bottom:1px solid #1e1e1e;">${escHtml(persons)}</td>
    </tr>
    ${commentBlock}
  </table>
</td></tr>

<tr><td style="padding:0 20px 24px;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d0d;border:1px solid #2a2a2a;border-radius:6px;overflow:hidden;">
    <tr><td colspan="2" style="padding:10px 14px 8px;background:#151515;border-bottom:1px solid #1e1e1e;">
      <span style="font-size:9px;letter-spacing:.13em;text-transform:uppercase;color:#C4993A;">${isEN ? 'Find Us' : 'So finden Sie uns'}</span>
    </td></tr>
    <tr><td style="padding:12px 14px;font-size:12px;color:#aaa;line-height:1.7;">
      <strong style="color:#ddd;">Takashi Restaurant</strong><br>
      Wilhelmstra&szlig;e 122<br>72764 Reutlingen<br>
      <a href="tel:+4971213829996" style="color:#C4993A;text-decoration:none;">+49 7121 3829996</a>
    </td></tr>
  </table>
</td></tr>

<tr><td style="padding:16px 28px 20px;border-top:1px solid #1e1e1e;text-align:center;">
  <div style="font-size:10px;color:#555;line-height:1.6;">
    <a href="https://takashi-reutlingen.de" style="color:#C4993A;text-decoration:none;">takashi-reutlingen.de</a>
    &nbsp;&bull;&nbsp;
    <a href="https://www.instagram.com/takashi_restaurant_reutlingen_" style="color:#C4993A;text-decoration:none;">Instagram</a>
  </div>
</td></tr>

</table>
</td></tr></table>
</body></html>`;
}

/* ─── Send one email via Resend ──────────────────────────────────────── */
async function sendEmail(apiKey, { from, to, subject, html, replyTo }) {
  const res = await fetch(RESEND_ENDPOINT, {
    method:  'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to:      Array.isArray(to) ? to : [to],
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    const msg = (data.error && data.error.message) || data.message || 'Resend error';
    throw new Error(msg + ' (HTTP ' + res.status + ')');
  }
  return data;
}

/* ─── Main handler ───────────────────────────────────────────────────── */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const RESEND_KEY    = process.env.RESEND_API_KEY;
  const RESTAURANT_TO = process.env.RESERVATION_EMAIL;

  if (!RESEND_KEY)    return res.status(500).json({ ok: false, error: 'RESEND_API_KEY not set' });
  if (!RESTAURANT_TO) return res.status(500).json({ ok: false, error: 'RESERVATION_EMAIL not set' });

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch (e) { return res.status(400).json({ ok: false, error: 'Invalid JSON body' }); }

  const { name, phone, email, date, time, persons, comment, language, createdAt } = body;

  if (!name || !phone || !date || !time || !persons)
    return res.status(400).json({ ok: false, error: 'Missing required fields: name, phone, date, time, persons' });

  const d = {
    name,
    phone,
    email:     email     || '',
    date,
    time,
    persons:   String(persons),   /* exact number "1"–"20" */
    comment:   comment   || '',
    language:  language  || 'de',
    createdAt: createdAt || new Date().toISOString(),
  };

  const restaurantSubject = `Neue Reservierung — Takashi | ${formatDate(d.date)} ${d.time} | ${d.name}`;
  const customerSubject   = d.language === 'en'
    ? `Your Reservation Confirmation at Takashi — ${formatDate(d.date)} ${d.time}`
    : `Ihre Reservierungsbestätigung bei Takashi — ${formatDate(d.date)} ${d.time}`;

  const results = {};

  /* 1. Restaurant email — mandatory */
  try {
    const r = await sendEmail(RESEND_KEY, {
      from:    FROM_ADDRESS,
      to:      RESTAURANT_TO,
      subject: restaurantSubject,
      html:    buildRestaurantHtml(d),
      replyTo: d.email || undefined,
    });
    results.restaurant = r.id;
    console.log('[Reservation] Restaurant email sent id:', r.id,
      '| for:', d.name, d.date, d.time, 'persons:', d.persons);
  } catch (err) {
    console.error('[Reservation] Restaurant email FAILED:', err.message);
    return res.status(502).json({ ok: false, error: err.message });
  }

  /* 2. Customer confirmation — optional */
  if (d.email) {
    try {
      const r = await sendEmail(RESEND_KEY, {
        from:    FROM_ADDRESS,
        to:      d.email,
        subject: customerSubject,
        html:    buildCustomerHtml(d),
      });
      results.customer = r.id;
      console.log('[Reservation] Customer email sent id:', r.id, '→', d.email);
    } catch (err) {
      /* Non-fatal — still return success */
      console.error('[Reservation] Customer email FAILED (non-fatal):', err.message);
      results.customerError = err.message;
    }
  } else {
    console.log('[Reservation] No customer email — skipping auto-reply');
  }

  return res.status(200).json({
    ok:         true,
    restaurant: results.restaurant,
    customer:   results.customer || null,
    ...(results.customerError ? { customerError: results.customerError } : {}),
  });
}
