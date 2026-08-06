/**
 * lib/email/templates/layout.js
 * ─────────────────────────────────────────────────────────────
 * The one HTML shell every status email is wrapped in: black
 * header with the Takashi wordmark, white rounded content card,
 * black footer with contact details + website. Plain table-based
 * markup with inline styles throughout — no external stylesheet,
 * no flexbox/grid, no web fonts loaded by the email itself — this
 * is deliberate: it's what survives Outlook's rendering engine and
 * clients that strip <style> blocks or block remote content. The
 * wordmark is styled text, not a hosted image, so nothing breaks if
 * images are blocked (a common Gmail/Outlook default).
 *
 * Change the header/footer/colours once here and all 5 status
 * emails pick it up — templates only supply their headline/body
 * text; statusEmailBody.js supplies everything else in between.
 */
const config = require('../config');

function emailLayout({ previewText, bodyHtml, lang }) {
  const brand = config.brand;
  const r = config.restaurant;

  return `<!DOCTYPE html>
<html lang="${lang || 'de'}">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<meta name="x-apple-disable-message-reformatting"/>
<title>${r.name}</title>
</head>
<body style="margin:0;padding:0;background:#f2f2f2;font-family:Arial,Helvetica,sans-serif;">
<!-- Preview text: shown in the inbox list, hidden in the body -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${previewText || ''}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2;padding:32px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:${brand.black};padding:36px 30px 28px;text-align:center;border-radius:14px 14px 0 0;">
            <div style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:29px;letter-spacing:.03em;color:${brand.gold};">
              TAKASHI
            </div>
            <div style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:${brand.goldL};margin-top:4px;">
              Restaurant
            </div>
          </td>
        </tr>

        <!-- Content card -->
        <tr>
          <td style="background:${brand.white};padding:34px 30px 12px;">
            ${bodyHtml}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:${brand.black};padding:26px 30px 30px;text-align:center;border-radius:0 0 14px 14px;">
            <div style="font-family:Arial,sans-serif;font-size:12px;color:#c9c9c9;line-height:1.7;">
              <strong style="color:#e8e8e8;">${r.name}</strong><br/>
              ${r.address}<br/>
              ${r.phone}<br/>
              <a href="${r.website}" style="color:${brand.goldL};text-decoration:none;">${r.website.replace(/^https?:\/\//, '')}</a>
            </div>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

module.exports = { emailLayout };
