/**
 * lib/email/templates/layout.js
 * ─────────────────────────────────────────────────────────────
 * The one HTML shell every status email is wrapped in: black
 * header with the Takashi wordmark, white content card, black
 * footer. Plain table-based markup with inline styles throughout
 * — no external stylesheet, no flexbox/grid, no web fonts loaded
 * by the email itself — this is deliberate: it's what survives
 * Outlook's rendering engine and clients that strip <style> blocks
 * or block remote content. The wordmark is styled text, not a
 * hosted image, so nothing breaks if images are blocked (a common
 * Gmail/Outlook default).
 *
 * Change the header/footer/colours once here and all 5 status
 * emails pick it up — templates only supply the body content.
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
<body style="margin:0;padding:0;background:${brand.black};font-family:Arial,Helvetica,sans-serif;">
<!-- Preview text: shown in the inbox list, hidden in the body -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${previewText || ''}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${brand.black};padding:24px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:${brand.black};padding:28px 30px 22px;text-align:center;border-radius:10px 10px 0 0;">
            <div style="font-family:Georgia,'Times New Roman',serif;font-style:italic;font-size:26px;letter-spacing:.03em;color:${brand.gold};">
              TAKASHI
            </div>
            <div style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:${brand.goldL};margin-top:2px;">
              Restaurant
            </div>
          </td>
        </tr>

        <!-- Content card -->
        <tr>
          <td style="background:${brand.white};padding:28px 26px 8px;">
            ${bodyHtml}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:${brand.black};padding:22px 30px 26px;text-align:center;border-radius:0 0 10px 10px;">
            <div style="font-family:Arial,sans-serif;font-size:12px;color:#c9c9c9;line-height:1.6;">
              ${r.name}<br/>
              ${r.address}<br/>
              ${r.phone}
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
