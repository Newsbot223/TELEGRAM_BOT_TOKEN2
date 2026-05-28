/**
 * Takashi Restaurant — Reservation Email API
 * Vercel Serverless Function: /api/reservation
 *
 * Receives reservation data from the website form and sends
 * a formatted email to the restaurant via Resend.
 *
 * Environment variables (Vercel dashboard → Settings → Environment Variables):
 *   RESEND_API_KEY      — from resend.com dashboard
 *   RESERVATION_EMAIL   — restaurant inbox, e.g. kontakt@takashi-restaurant.com
 *
 * No npm packages used — native fetch only.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/* ─── Build plain-text email body ───────────────────────────────────── */
function buildEmailHtml(d) {
  const isDE = d.language === 'de';

  const rows = [
    ['Name',          d.name                    ],
    ['Telefon',       d.phone                   ],
    ['E-Mail',        d.email       || '–'      ],
    ['Datum',         d.date                    ],
    ['Uhrzeit',       d.time                    ],
    ['Personen',      d.persons                 ],
    ['Kommentar',     d.comment     || '–'      ],
    ['Sprache',       d.language === 'en' ? 'Englisch' : 'Deutsch'],
    ['Eingegangen',   new Date(d.createdAt).toLocaleString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })],
  ];

  const tableRows = rows.map(([label, value]) => `
    <tr>
      <td style="padding:8px 14px;font-size:13px;color:#888;white-space:nowrap;vertical-align:top;border-bottom:1px solid #1e1e1e;">${label}</td>
      <td style="padding:8px 14px;font-size:13px;color:#f0f0f0;vertical-align:top;border-bottom:1px solid #1e1e1e;">${value}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#111;border:1px solid #2a2a2a;border-radius:6px;overflow:hidden;">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#111,#1a1a1a);border-bottom:2px solid #C4993A;padding:28px 28px 22px;text-align:center;">
            <div style="font-family:Georgia,serif;font-size:26px;font-weight:400;letter-spacing:.24em;color:#C4993A;text-transform:uppercase;margin-bottom:6px;">
              TAKASHI
            </div>
            <div style="font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:rgba(196,153,58,.5);">
              Asiatische Küche &bull; Reutlingen
            </div>
          </td>
        </tr>

        <!-- Title strip -->
        <tr>
          <td style="padding:20px 28px 16px;border-bottom:1px solid #1e1e1e;">
            <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#C4993A;margin-bottom:4px;">
              Neue Reservierungsanfrage
            </div>
            <div style="font-family:Georgia,serif;font-size:22px;font-weight:400;color:#f0f0f0;line-height:1.2;">
              Tischreservierung
            </div>
          </td>
        </tr>

        <!-- Data table -->
        <tr>
          <td style="padding:8px 14px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              ${tableRows}
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 28px;border-top:1px solid #1e1e1e;text-align:center;">
            <div style="font-size:10px;color:#555;line-height:1.6;">
              Diese E-Mail wurde automatisch vom Reservierungsformular auf<br>
              <a href="https://takashi-reutlingen.de" style="color:#C4993A;text-decoration:none;">takashi-reutlingen.de</a> gesendet.
            </div>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/* ─── Main handler ───────────────────────────────────────────────────── */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')
    return res.status(405).json({ ok: false, error: 'Method not allowed' });

  const RESEND_KEY       = process.env.RESEND_API_KEY;
  const RESERVATION_TO   = process.env.RESERVATION_EMAIL;

  if (!RESEND_KEY) {
    console.error('[Reservation] RESEND_API_KEY is not set');
    return res.status(500).json({ ok: false, error: 'Email service not configured' });
  }
  if (!RESERVATION_TO) {
    console.error('[Reservation] RESERVATION_EMAIL is not set');
    return res.status(500).json({ ok: false, error: 'Recipient email not configured' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (e) {
    return res.status(400).json({ ok: false, error: 'Invalid JSON body' });
  }

  const { name, phone, email, date, time, persons, comment, language, createdAt } = body;

  if (!name || !phone || !date || !time || !persons) {
    return res.status(400).json({ ok: false, error: 'Missing required fields' });
  }

  const data = {
    name:      name,
    phone:     phone,
    email:     email     || '',
    date:      date,
    time:      time,
    persons:   persons,
    comment:   comment   || '',
    language:  language  || 'de',
    createdAt: createdAt || new Date().toISOString(),
  };

  const subject = `Neue Reservierung — Takashi | ${date} ${time} | ${name}`;

  try {
    const resendRes = await fetch(RESEND_ENDPOINT, {
      method:  'POST',
      headers: {
        'Authorization': 'Bearer ' + RESEND_KEY,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    'Takashi Website <onboarding@resend.dev>',
        to:      [RESERVATION_TO],
        subject: subject,
        html:    buildEmailHtml(data),
        reply_to: email || undefined,
      }),
    });

    const result = await resendRes.json();

    if (!resendRes.ok || result.error) {
      const errMsg = (result.error && result.error.message) || result.message || 'Resend API error';
      console.error('[Reservation] Resend error:', errMsg, '| status:', resendRes.status);
      return res.status(502).json({ ok: false, error: errMsg });
    }

    console.log('[Reservation] Email sent. id:', result.id, '| to:', RESERVATION_TO, '| for:', name, date, time);
    return res.status(200).json({ ok: true, id: result.id });

  } catch (err) {
    console.error('[Reservation] fetch failed:', err.message);
    return res.status(502).json({ ok: false, error: err.message });
  }
}
