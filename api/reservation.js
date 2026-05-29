/**
 * Takashi Restaurant — Reservation Email API
 * Vercel Serverless Function: api/reservation.js
 *
 * Environment variables (Vercel → Settings → Environment Variables):
 *   RESEND_API_KEY     — from resend.com
 *   RESERVATION_EMAIL  — restaurant inbox e.g. kontakt@takashi-restaurant.com
 *
 * No npm packages — native fetch only.
 */

const RESEND_URL   = 'https://api.resend.com/emails';
const FROM_ADDRESS = 'Takashi Restaurant <onboarding@resend.dev>';

/* ─── helpers ───────────────────────────────────────────────────────── */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function fmtDate(d) {
  /* "2025-06-15" → "15.06.2025" */
  const p = String(d).split('-');
  return p.length === 3 ? `${p[2]}.${p[1]}.${p[0]}` : d;
}
function fmtTs(iso) {
  try {
    return new Date(iso).toLocaleString('de-DE', {
      day:'2-digit', month:'2-digit', year:'numeric',
      hour:'2-digit', minute:'2-digit',
    });
  } catch { return iso; }
}

/* ─── Restaurant notification HTML ──────────────────────────────────── */
function restaurantHtml(d) {
  const rows = [
    ['Name',        d.name],
    ['Telefon',     d.phone],
    ['E-Mail',      d.email || '–'],
    ['Datum',       fmtDate(d.date)],
    ['Uhrzeit',     d.time],
    ['Personen',    d.persons],
    ['Kommentar',   d.comment || '–'],
    ['Sprache',     d.language === 'en' ? 'Englisch' : 'Deutsch'],
    ['Eingegangen', fmtTs(d.createdAt)],
  ].map(([k, v]) => `
    <tr>
      <td style="padding:8px 14px;font-size:13px;color:#888;white-space:nowrap;vertical-align:top;border-bottom:1px solid #1e1e1e">${k}</td>
      <td style="padding:8px 14px;font-size:13px;color:#f0f0f0;vertical-align:top;border-bottom:1px solid #1e1e1e">${esc(v)}</td>
    </tr>`).join('');

  return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#111;border:1px solid #2a2a2a;border-radius:6px;overflow:hidden;">
  <tr><td style="background:#111;border-bottom:2px solid #C4993A;padding:24px 28px;text-align:center;">
    <div style="font-family:Georgia,serif;font-size:22px;letter-spacing:.22em;color:#C4993A;text-transform:uppercase;">TAKASHI</div>
    <div style="font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:rgba(196,153,58,.5);margin-top:4px;">Neue Reservierungsanfrage</div>
  </td></tr>
  <tr><td><table width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>
  <tr><td style="padding:16px 28px;border-top:1px solid #1e1e1e;text-align:center;font-size:10px;color:#555;">
    Automatisch gesendet von <a href="https://takashi-reutlingen.de" style="color:#C4993A;text-decoration:none;">takashi-reutlingen.de</a>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

/* ─── Customer confirmation HTML ─────────────────────────────────────── */
function customerHtml(d) {
  const de = d.language !== 'en';

  const intro = de
    ? 'Vielen Dank für Ihre Reservierungsanfrage. Wir haben Ihre Anfrage erhalten. Dies ist noch keine endgültige Bestätigung. Wir melden uns, falls es Rückfragen gibt.'
    : 'Thank you for your reservation request. We have received your request. This is not a final confirmation yet. We will contact you if there are any questions.';

  const commentRow = d.comment
    ? `<tr>
        <td style="padding:6px 14px;font-size:12px;color:#888;white-space:nowrap;">${de ? 'Kommentar' : 'Comment'}:</td>
        <td style="padding:6px 14px;font-size:12px;color:#ddd;">${esc(d.comment)}</td>
       </tr>`
    : '';

  return `<!DOCTYPE html><html lang="${d.language || 'de'}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 16px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:500px;background:#111;border:1px solid #2a2a2a;border-radius:6px;overflow:hidden;">

  <!-- header -->
  <tr><td style="background:linear-gradient(135deg,#111,#181818);border-bottom:2px solid #C4993A;padding:28px;text-align:center;">
    <div style="font-family:Georgia,serif;font-size:24px;letter-spacing:.24em;color:#C4993A;text-transform:uppercase;margin-bottom:4px;">TAKASHI</div>
    <div style="font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:rgba(196,153,58,.5);margin-bottom:10px;">Asiatische Küche &bull; Reutlingen</div>
    <div style="font-family:Georgia,serif;font-size:16px;font-style:italic;font-weight:300;color:rgba(237,233,227,.65);">${de ? 'Reservierungsanfrage' : 'Reservation Request'}</div>
  </td></tr>

  <!-- greeting + intro -->
  <tr><td style="padding:22px 28px 14px;">
    <p style="margin:0 0 10px;font-size:13px;color:#ccc;">${de ? 'Liebe/r' : 'Dear'} ${esc(d.name)},</p>
    <p style="margin:0;font-size:13px;color:#aaa;line-height:1.75;">${intro}</p>
  </td></tr>

  <!-- booking details -->
  <tr><td style="padding:0 20px 18px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d0d;border:1px solid #2a2a2a;border-radius:6px;overflow:hidden;">
      <tr><td colspan="2" style="padding:9px 14px;background:#151515;border-bottom:1px solid #1e1e1e;">
        <span style="font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#C4993A;">${de ? 'Ihre Angaben' : 'Your Details'}</span>
      </td></tr>
      <tr>
        <td style="padding:8px 14px;font-size:12px;color:#888;white-space:nowrap;border-bottom:1px solid #1e1e1e;">${de ? 'Datum' : 'Date'}:</td>
        <td style="padding:8px 14px;font-size:12px;border-bottom:1px solid #1e1e1e;"><strong style="color:#C4993A;">${fmtDate(d.date)}</strong></td>
      </tr>
      <tr>
        <td style="padding:8px 14px;font-size:12px;color:#888;white-space:nowrap;border-bottom:1px solid #1e1e1e;">${de ? 'Uhrzeit' : 'Time'}:</td>
        <td style="padding:8px 14px;font-size:12px;border-bottom:1px solid #1e1e1e;"><strong style="color:#C4993A;">${esc(d.time)} ${de ? 'Uhr' : "o'clock"}</strong></td>
      </tr>
      <tr>
        <td style="padding:8px 14px;font-size:12px;color:#888;white-space:nowrap;border-bottom:1px solid #1e1e1e;">${de ? 'Personen' : 'Guests'}:</td>
        <td style="padding:8px 14px;font-size:12px;color:#ddd;border-bottom:1px solid #1e1e1e;">${esc(d.persons)}</td>
      </tr>
      ${commentRow}
    </table>
  </td></tr>

  <!-- not-yet-confirmed notice -->
  <tr><td style="padding:0 20px 18px;">
    <div style="background:rgba(196,153,58,.06);border:1px solid rgba(196,153,58,.2);border-radius:5px;padding:12px 14px;">
      <p style="margin:0;font-size:11px;color:#aaa;line-height:1.65;">
        ${de
          ? 'Dies ist <strong style="color:#ddd;">noch keine endgültige Buchungsbestätigung</strong>. Wir bestätigen Ihren Tisch telefonisch oder per E-Mail.'
          : 'This is <strong style="color:#ddd;">not a final booking confirmation</strong>. We will confirm your table by phone or email.'}
      </p>
    </div>
  </td></tr>

  <!-- restaurant address -->
  <tr><td style="padding:0 20px 24px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0d0d0d;border:1px solid #2a2a2a;border-radius:6px;overflow:hidden;">
      <tr><td style="padding:9px 14px;background:#151515;border-bottom:1px solid #1e1e1e;">
        <span style="font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#C4993A;">${de ? 'Adresse' : 'Address'}</span>
      </td></tr>
      <tr><td style="padding:12px 14px;font-size:12px;color:#aaa;line-height:1.75;">
        <strong style="color:#ddd;">Takashi Restaurant</strong><br>
        Wilhelmstra&szlig;e 122, 72764 Reutlingen<br>
        <a href="tel:+4971213829996" style="color:#C4993A;text-decoration:none;">+49 7121 3829996</a>
      </td></tr>
    </table>
  </td></tr>

  <!-- footer -->
  <tr><td style="padding:14px 28px 18px;border-top:1px solid #1e1e1e;text-align:center;font-size:10px;color:#555;">
    <a href="https://takashi-reutlingen.de" style="color:#C4993A;text-decoration:none;">takashi-reutlingen.de</a>
    &nbsp;&bull;&nbsp;
    <a href="https://www.instagram.com/takashi_restaurant_reutlingen_" style="color:#C4993A;text-decoration:none;">Instagram</a>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

/* ─── send one email via Resend ─────────────────────────────────────── */
async function sendEmail(apiKey, opts) {
  const res = await fetch(RESEND_URL, {
    method:  'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      from:     opts.from,
      to:       Array.isArray(opts.to) ? opts.to : [opts.to],
      subject:  opts.subject,
      html:     opts.html,
      ...(opts.replyTo ? { reply_to: opts.replyTo } : {}),
    }),
  });

  const data = await res.json();

  /* Log exact Resend response for debugging */
  console.log('[Resend] HTTP', res.status, '→', JSON.stringify(data));

  if (!res.ok || data.error) {
    const msg = (data.error?.message) || data.message || JSON.stringify(data);
    throw new Error(msg);
  }
  return data;   /* { id: "re_..." } */
}

/* ─── main handler ──────────────────────────────────────────────────── */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const API_KEY      = process.env.RESEND_API_KEY;
  const RESTAURANT   = process.env.RESERVATION_EMAIL;

  if (!API_KEY)    return res.status(500).json({ ok: false, error: 'RESEND_API_KEY not set' });
  if (!RESTAURANT) return res.status(500).json({ ok: false, error: 'RESERVATION_EMAIL not set' });

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ ok: false, error: 'Invalid JSON body' }); }

  const { name, phone, email, date, time, persons, comment, language, createdAt } = body;

  if (!name || !phone || !date || !time || !persons)
    return res.status(400).json({ ok: false, error: 'Missing required fields' });

  const d = {
    name,
    phone,
    email:     typeof email === 'string' ? email.trim() : '',
    date,
    time,
    persons:   String(persons),
    comment:   comment || '',
    language:  language || 'de',
    createdAt: createdAt || new Date().toISOString(),
  };

  /* ── 1. Restaurant email (mandatory) ── */
  let restaurantId;
  try {
    const r = await sendEmail(API_KEY, {
      from:    FROM_ADDRESS,
      to:      RESTAURANT,
      subject: `Neue Reservierung — Takashi | ${fmtDate(d.date)} ${d.time} | ${d.name}`,
      html:    restaurantHtml(d),
      replyTo: d.email || undefined,
    });
    restaurantId = r.id;
    console.log('[Reservation] Restaurant email sent:', restaurantId, '| for:', d.name, d.date, d.time, 'persons:', d.persons);
  } catch (err) {
    console.error('[Reservation] Restaurant email FAILED:', err.message);
    return res.status(502).json({ ok: false, error: err.message });
  }

  /* ── 2. Customer auto-reply (optional — only if email given) ── */
  let customerEmailSent = false;
  let customerEmailId   = null;

  console.log('[Reservation] Customer email:', d.email || '(not provided — skipping)');

  if (d.email) {
    const de = d.language !== 'en';
    const subject = de
      ? `Ihre Reservierungsanfrage bei Takashi`
      : `Your reservation request at Takashi`;
    try {
      const r = await sendEmail(API_KEY, {
        from:    FROM_ADDRESS,
        to:      d.email,
        subject,
        html:    customerHtml(d),
      });
      customerEmailSent = true;
      customerEmailId   = r.id;
      console.log('[Reservation] Customer auto-reply sent:', r.id, '→', d.email);
    } catch (err) {
      /* Non-fatal: log but still return success */
      console.error('[Reservation] Customer auto-reply failed:', err.message);
    }
  }

  return res.status(200).json({
    ok:                  true,
    restaurantEmailSent: true,
    restaurantEmailId,
    customerEmailSent,
    customerEmailId,
  });
}
