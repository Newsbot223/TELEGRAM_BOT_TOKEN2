/**
 * ══════════════════════════════════════════════════════════════
 *  TAKASHI RESTAURANT — Telegram Order Proxy
 *  ─────────────────────────────────────────────────────────────
 *  This file is the ONLY place the Telegram Bot Token lives.
 *  Never put the token in index.html or any frontend file.
 *
 *  DEPLOYMENT OPTIONS (all free tiers available):
 *
 *  A) Vercel (recommended — easiest)
 *     1. npm i -g vercel
 *     2. Create /api/order.js  (rename this file, place in /api/)
 *     3. vercel env add TELEGRAM_BOT_TOKEN
 *     4. vercel --prod
 *     → Your endpoint: https://your-project.vercel.app/api/order
 *
 *  B) Netlify Functions
 *     1. Place in /netlify/functions/order.js
 *     2. netlify env:set TELEGRAM_BOT_TOKEN <token>
 *     3. netlify deploy --prod
 *     → Endpoint: https://your-site.netlify.app/.netlify/functions/order
 *
 *  C) Cloudflare Workers
 *     1. npm i -g wrangler
 *     2. wrangler secret put TELEGRAM_BOT_TOKEN
 *     3. wrangler deploy
 *     → Endpoint: https://takashi-proxy.your-subdomain.workers.dev
 *
 *  D) Local (for testing)
 *     npm install express node-fetch
 *     TELEGRAM_BOT_TOKEN=xxx node telegram-proxy.js
 *     → http://localhost:3000/api/order
 *
 *  ENVIRONMENT VARIABLES NEEDED:
 *    TELEGRAM_BOT_TOKEN  — from @BotFather on Telegram
 *
 *  CHAT ID (already hardcoded in index.html frontend):
 *    -5262422113  (Takashi group)
 *
 *  CUSTOMER STATUS EMAILS (replaces the old WhatsApp handoff):
 *    Every status change (order received, accepted, cooking, driver
 *    left, delivered) sends the customer an email via the isolated
 *    system in ../lib/email/ (see notifyCustomer.js there for the
 *    full design). Sending happens AFTER this file's HTTP response
 *    and is fully wrapped in try/catch, so an email-provider issue
 *    can never affect order creation, Telegram, or the PDF receipt.
 *
 *  OPTIONAL — TELEGRAM_WEBHOOK_SECRET:
 *    If set, incoming webhook calls must include a matching
 *    X-Telegram-Bot-Api-Secret-Token header (configure this token via
 *    Telegram's setWebhook `secret_token` param). If unset, this check is
 *    skipped — existing deployments keep working without changes.
 * ══════════════════════════════════════════════════════════════
 */

/* ─────────────────────────────────────────────────
   Works as-is on Vercel / Netlify / local Express
───────────────────────────────────────────────── */
const PDFDocument = require('pdfkit'); // npm i pdfkit — used only to render the receipt PDF below
const { notifyCustomer } = require('../lib/email/notifyCustomer'); // customer status emails — see lib/email/ for the whole isolated system

const TELEGRAM_API = 'https://api.telegram.org/bot';
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET; // optional, see header docs

/* In-memory store for message_id ↔ orderId mapping.
   Using a Map (not a plain object) so a crafted orderId like "__proto__"
   or "constructor" can never touch Object.prototype.
   NOTE: this is still per-process memory — on serverless platforms
   (Vercel/Netlify) each cold start gets a fresh, empty store, and status
   edits/WhatsApp buttons for orders placed on a different instance will
   silently no-op. Replace with a real DB (Supabase, Redis, KV) in
   production; the TTL cleanup below only bounds memory for long-lived
   processes (e.g. the local dev server). */
const messageStore = new Map();
const ORDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const STORE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/* Opportunistic sweep, run on every new order, to stop the Map from
   growing without bound in long-lived processes. Cheap: only touches
   entries once they're a full day old. */
function cleanupStaleOrders() {
  const cutoff = Date.now() - STORE_TTL_MS;
  for (const [orderId, entry] of messageStore) {
    if (entry.createdAt && entry.createdAt < cutoff) {
      messageStore.delete(orderId);
    }
  }
}

/* ─── Shared Telegram API caller ───
   Centralizes the fetch + error handling that used to be duplicated across
   sendMessage / answerCallbackQuery / editMessageText call sites. Never
   throws — callers get `null` on failure and can decide how to proceed,
   so one failed Telegram call (e.g. the WhatsApp button) can never crash
   the request or block unrelated logic (e.g. the status edit). Never logs
   the bot token or full request payloads (which may contain customer PII). */
async function callTelegramApi(TOKEN, method, payload, context) {
  let res;
  try {
    res = await fetch(`${TELEGRAM_API}${TOKEN}/${method}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload)
    });
  } catch (err) {
    console.error(`[Proxy] ${context}: network error —`, err.message);
    return null;
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    console.error(`[Proxy] ${context}: could not parse Telegram response (status ${res.status})`);
    return null;
  }

  if (!data.ok) {
    if (data.description?.includes('message is not modified')) {
      return data;
    }

    console.error(
      `[Proxy] ${context}: Telegram API error —`,
      data.description || 'unknown error'
    );
  }

  return data;
}

/* ══════════════════════════════════════════════════════════════
   PDF RECEIPT  (Requirement 1)
   Renders a receipt visually matching the website's post-checkout
   receipt (navy/gold header, itemized list, totals) using PDFKit.
   Pure server-side rendering — no external service/API involved.
   ══════════════════════════════════════════════════════════════ */
const BRAND_NAVY = '#0b1830';
const BRAND_GOLD = '#c4993a';
const BRAND_DIM  = '#6b7280';

/* Builds the receipt PDF for a given order payload and resolves with a
   Buffer. Never throws synchronously — the returned Promise rejects on
   error so the caller can treat it as best-effort, same as the other
   Telegram calls in this file. */
function generateReceiptPdfBuffer(payload) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageWidth  = doc.page.width;
      const contentW    = pageWidth - 80;
      const isLieferung = payload.orderType === 'lieferung';
      const customer     = payload.customer || {};
      const created       = payload.createdAt ? new Date(payload.createdAt) : new Date();
      const dateStr = created.toLocaleDateString('de-DE');
      const timeStr = created.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

      /* ── Header band (brand) ── */
      doc.rect(0, 0, pageWidth, 92).fill(BRAND_NAVY);
      doc.fillColor(BRAND_GOLD).font('Helvetica-Bold').fontSize(21)
        .text('TAKASHI RESTAURANT', 40, 26, { characterSpacing: 1.2 });
      doc.fillColor('#ffffff').font('Helvetica').fontSize(9)
        .text('Wilhelmstraße 122, 72764 Reutlingen  ·  +49 7121 3829996', 40, 55);
      doc.fillColor('#ffffff').font('Helvetica').fontSize(9)
        .text(isLieferung ? 'Lieferung' : 'Abholung', 40, 70);

      let y = 112;
      doc.fillColor(BRAND_NAVY).font('Helvetica-Bold').fontSize(13)
        .text('Bestellbeleg / Order Receipt', 40, y);
      y += 22;

      doc.fillColor('#333').font('Helvetica').fontSize(9.5);
      doc.text(`Bestellnummer: ${payload.orderId || '—'}`, 40, y);
      doc.text(`Datum: ${dateStr}   Uhrzeit: ${timeStr}`, 300, y);
      y += 22;

      doc.moveTo(40, y).lineTo(pageWidth - 40, y).strokeColor(BRAND_GOLD).lineWidth(1).stroke();
      y += 14;

      /* ── Customer / order details ── */
      doc.font('Helvetica-Bold').fontSize(10).fillColor(BRAND_NAVY).text('Kunde', 40, y);
      y += 15;
      doc.font('Helvetica').fontSize(9.5).fillColor('#222');
      const detailLines = [
        ['Name', customer.name || '—'],
        ['Telefon', customer.phone || '—']
      ];
      if (isLieferung) {
        detailLines.push(['Lieferadresse', payload.deliveryAddress || '—']);
        if (payload.deliveryZone) detailLines.push(['Liefergebiet', payload.deliveryZone]);
      }
      detailLines.push(['Art der Bestellung', isLieferung ? 'Lieferung' : 'Abholung']);
      detailLines.push(['Zahlungsart', payload.paymentMethod || '—']);
      detailLines.push([isLieferung ? 'Geschätzte Lieferzeit' : 'Geschätzte Abholzeit', payload.estimatedTime || '—']);
      if (payload.wunschzeit) detailLines.push(['Wunschzeit', payload.wunschzeit]);

      detailLines.forEach(([label, value]) => {
        doc.font('Helvetica-Bold').fillColor(BRAND_DIM).text(`${label}:`, 40, y, { continued: true, width: 150 });
        doc.font('Helvetica').fillColor('#222').text(`  ${value}`, { width: contentW - 150 });
        y = doc.y + 2;
      });

      y += 6;
      doc.moveTo(40, y).lineTo(pageWidth - 40, y).strokeColor('#dcdcdc').lineWidth(0.5).stroke();
      y += 14;

      /* ── Items table ── */
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(BRAND_NAVY);
      doc.text('Menge', 40, y, { width: 45 });
      doc.text('Artikel', 90, y, { width: 300 });
      doc.text('Preis', pageWidth - 120, y, { width: 80, align: 'right' });
      y += 15;
      doc.moveTo(40, y).lineTo(pageWidth - 40, y).strokeColor('#dcdcdc').lineWidth(0.5).stroke();
      y += 8;

      (payload.items || []).forEach((item) => {
        if (y > doc.page.height - 170) { doc.addPage(); y = 40; }
        const nameLine = item.variant ? `${item.name} (${item.variant})` : item.name;
        doc.font('Helvetica').fontSize(9.5).fillColor('#222');
        doc.text(`${item.qty}×`, 40, y, { width: 45 });
        doc.text(nameLine, 90, y, { width: 300 });
        doc.text(`${item.lineTotal}€`, pageWidth - 120, y, { width: 80, align: 'right' });
        y = Math.max(doc.y, y + 14);
        if (item.comment) {
          doc.font('Helvetica-Oblique').fontSize(8).fillColor(BRAND_DIM)
            .text(`- ${item.comment}`, 90, y, { width: 350 }); /* plain ASCII: PDFKit's standard fonts don't cover the ↳ glyph */
          y = doc.y + 2;
        }
      });

      y += 6;
      doc.moveTo(40, y).lineTo(pageWidth - 40, y).strokeColor(BRAND_GOLD).lineWidth(1).stroke();
      y += 14;

      /* ── Order-level comment ── */
      if (payload.comment) {
        doc.font('Helvetica-Bold').fontSize(9.5).fillColor(BRAND_NAVY).text('Kommentar:', 40, y);
        y = doc.y + 2;
        doc.font('Helvetica').fontSize(9.5).fillColor('#333').text(payload.comment, 40, y, { width: contentW });
        y = doc.y + 14;
      }

      /* ── Totals ── */
      const totalsLabelX = pageWidth - 200;
      const totalsValueX = pageWidth - 100;
      doc.font('Helvetica').fontSize(9.5).fillColor('#333');
      doc.text('Zwischensumme:', totalsLabelX, y, { width: 100 });
      doc.text(`${payload.subtotal}€`, totalsValueX, y, { width: 60, align: 'right' });
      y += 14;
      if (payload.fee && Number(payload.fee) > 0) {
        doc.text('Liefergebühr:', totalsLabelX, y, { width: 100 });
        doc.text(`${payload.fee}€`, totalsValueX, y, { width: 60, align: 'right' });
        y += 14;
      }
      doc.moveTo(totalsLabelX, y).lineTo(pageWidth - 40, y).strokeColor('#dcdcdc').lineWidth(0.5).stroke();
      y += 8;
      doc.font('Helvetica-Bold').fontSize(12).fillColor(BRAND_NAVY);
      doc.text('Gesamt:', totalsLabelX, y, { width: 100 });
      doc.text(`${payload.total}€`, totalsValueX, y, { width: 60, align: 'right' });

      /* ── Footer ── */
      doc.font('Helvetica-Oblique').fontSize(8).fillColor(BRAND_DIM)
        .text('Vielen Dank für Ihre Bestellung bei Takashi Restaurant!', 40, doc.page.height - 55, { width: contentW, align: 'center' });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/* Sends a Buffer as a Telegram document (multipart/form-data), separate
   from callTelegramApi() because sendDocument needs multipart, not JSON.
   Best-effort: never throws, returns null on failure so it can never
   block or crash the rest of the order flow. */
async function sendTelegramDocument(TOKEN, chatId, buffer, filename, caption) {
  try {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    if (caption) form.append('caption', caption);
    form.append('document', new Blob([buffer], { type: 'application/pdf' }), filename);

    const res = await fetch(`${TELEGRAM_API}${TOKEN}/sendDocument`, { method: 'POST', body: form });
    let data = null;
    try { data = await res.json(); } catch (_) { /* ignore parse failure, handled below */ }

    if (!data || !data.ok) {
      console.error('[Proxy] sendDocument: Telegram API error —', (data && data.description) || `HTTP ${res.status}`);
      return null;
    }
    return data;
  } catch (err) {
    console.error('[Proxy] sendDocument: network error —', err.message);
    return null;
  }
}

/* ══════════════════════════════════════════════════════════════
   GOOGLE MAPS BUTTON  (Requirement 2)
   Reuses coordinates already captured by the existing frontend
   address-autocomplete. No geocoding/Distance-Matrix API is called —
   this only builds a deep-link URL from numbers already on hand.
   ══════════════════════════════════════════════════════════════ */

/* Looks for delivery coordinates under a few common field-name
   variants so this works whether the frontend nests them as
   `coordinates: {lat, lon}`, `location: {lat, lng}`, or flat
   `lat`/`lon` (`latitude`/`longitude`) fields on the payload itself.
   Returns null if nothing usable is found — never guesses/geocodes. */
function extractOrderCoordinates(payload) {
  if (!payload) return null;
  const candidates = [payload.coordinates, payload.location, payload.deliveryCoordinates, payload];
  for (const c of candidates) {
    if (!c || typeof c !== 'object') continue;
    const lat = c.lat ?? c.latitude ?? c.deliveryLat;
    const lon = c.lon ?? c.lng ?? c.longitude ?? c.deliveryLon;
    if (isFiniteCoord(lat) && isFiniteCoord(lon)) {
      return { lat: Number(lat), lon: Number(lon) };
    }
  }
  return null;
}
function isFiniteCoord(v) {
  return v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v));
}

/* Coordinates are always preferred; the text address is only used as a
   fallback (still just a maps.google.com link — no API call) when no
   coordinates were provided for this order. */
function getMapsUrl(payload) {
  const coords = extractOrderCoordinates(payload);
  if (coords) {
    return `https://www.google.com/maps/dir/?api=1&destination=${coords.lat},${coords.lon}`;
  }
  if (payload && payload.deliveryAddress) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(payload.deliveryAddress)}`;
  }
  return null;
}

/* Appends a "📍 Open in Google Maps" row to an existing inline keyboard
   without touching the existing rows/buttons (Accept/Cooking/Driver
   left/Delivered keep their exact text + callback_data). Only applies
   to Lieferung orders, and only when an address/coordinates exist. */
function buildReplyMarkupWithMaps(baseMarkup, orderPayload) {
  if (!orderPayload || orderPayload.orderType !== 'lieferung') return baseMarkup;
  const url = getMapsUrl(orderPayload);
  if (!url) return baseMarkup;

  const existingRows = (baseMarkup && Array.isArray(baseMarkup.inline_keyboard)) ? baseMarkup.inline_keyboard : [];
  return {
    inline_keyboard: [...existingRows, [{ text: '📍 Open in Google Maps', url }]]
  };
}

/* ─── Main handler ─── */
module.exports = async function handler(req, res) {
  /* CORS — allow requests from your domain */
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST')    { res.status(405).json({ error: 'Method not allowed' }); return; }

  /* Optional: verify Telegram's webhook secret header, if configured.
     No-op (same behavior as before) when TELEGRAM_WEBHOOK_SECRET isn't set. */
  if (WEBHOOK_SECRET && req.headers['x-telegram-bot-api-secret-token'] !== WEBHOOK_SECRET) {
    res.status(401).json({ ok: false, error: 'Unauthorized' });
    return;
  }

  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!TOKEN) {
    console.error('[Proxy] TELEGRAM_BOT_TOKEN not set');
    res.status(500).json({ ok: false, error: 'Bot token not configured' });
    return;
  }

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch(e) { res.status(400).json({ ok: false, error: 'Invalid JSON' }); return; }

  if (!body || typeof body !== 'object') {
    res.status(400).json({ ok: false, error: 'Invalid request body' });
    return;
  }

  /* ── Route: Telegram webhook (callback buttons) ── */
  if (body.callback_query) {
    return handleCallback(body.callback_query, TOKEN, res);
  }

  /* ── Route: New order from frontend ── */
  const { chat_id, text, parse_mode, reply_markup, _orderPayload } = body;
  if (!chat_id || typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ ok: false, error: 'Missing chat_id or text' });
    return;
  }

  cleanupStaleOrders();

  /* Requirement 1: PDF receipt, sent BEFORE the tracked order message so
     it appears above it in the chat. Best-effort — a PDF failure must
     never prevent the actual order message from going out. */
  if (_orderPayload) {
    try {
      const pdfBuffer = await generateReceiptPdfBuffer(_orderPayload);
      const fileName = `Beleg-${_orderPayload.orderId || 'order'}.pdf`;
      await sendTelegramDocument(TOKEN, chat_id, pdfBuffer, fileName);
    } catch (err) {
      console.error('[Proxy] Receipt PDF generation failed —', err.message);
    }
  }

  /* Requirement 2: append the Google Maps button to the existing status
     buttons (Accept/Cooking/Driver left/Delivered are untouched). */
  const replyMarkupWithMaps = buildReplyMarkupWithMaps(reply_markup, _orderPayload);

  const data = await callTelegramApi(TOKEN, 'sendMessage', { chat_id, text, parse_mode, reply_markup: replyMarkupWithMaps }, 'New order sendMessage');
  if (!data) {
    res.status(502).json({ ok: false, error: 'Failed to reach Telegram' });
    return;
  }

  /* Store message_id so we can edit it when admin presses a button.
     orderId is validated first so it can never be used as an unsafe Map
     key or, later, interpolated unescaped into callback_data/messages. */
  const orderId = _orderPayload && _orderPayload.orderId;
  if (data.ok && data.result && orderId && ORDER_ID_PATTERN.test(orderId)) {
    messageStore.set(orderId, {
      message_id:       data.result.message_id,
      chat_id:           chat_id,
      payload:           _orderPayload,
      createdAt:         Date.now(),
      /* Tracks which statuses a customer email has already gone out
         for, so a Telegram webhook retry (or, later, a re-click in
         the Admin Dashboard) can never double-send. Replaces the old
         notifiedAccepted/notifiedOnTheWay flags used for WhatsApp. */
      notifiedStatuses: { new: false, accepted: false, cooking: false, on_the_way: false, delivered: false }
    });
  } else if (orderId) {
    console.warn('[Proxy] Order not stored — orderId failed validation');
  }

  /* Respond to the customer FIRST. Everything below this line is
     best-effort and must never delay or affect the response they've
     already received. */
  res.status(200).json(data);

  /* Order-confirmation email. Runs after the response on purpose —
     see lib/email/notifyCustomer.js's header comment for why this is
     safe on Vercel's Node runtime (the function stays alive until it
     returns, even though res.json() already flushed to the client).
     Wrapped in try/catch so an email-provider outage can never affect
     order creation, Telegram, or the PDF above. */
  const stored = orderId && messageStore.get(orderId);
  if (stored && !stored.notifiedStatuses.new) {
    try {
      await notifyCustomer(_orderPayload, 'new');
      stored.notifiedStatuses.new = true;
    } catch (err) {
      console.error('[Proxy] Order-confirmation email failed —', err.message);
    }
  }
};

/* Strictly whitelists the shape of callback_data we accept:
   "status:<one of the four known keys>:<safe orderId>". Anything else
   (extra colons, unknown status, garbage orderId, injected characters)
   is rejected up front instead of being split/trusted downstream. */
const CALLBACK_DATA_PATTERN = /^status:(accepted|cooking|on_the_way|delivered):([A-Za-z0-9_-]{1,64})$/;

const STATUS_LABELS = {
  accepted:   '✅ Accepted — Bestellung angenommen',
  cooking:    '🍳 Cooking — In Zubereitung',
  on_the_way: '🛵 Driver left — Fahrer unterwegs',
  delivered:  '✅ Delivered — Zugestellt'
};

/* ─── Handle inline button presses ─── */
async function handleCallback(cbq, TOKEN, res) {
  const { id: cbId, data, message } = (cbq || {});

  /* Answer the callback (removes the loading spinner in Telegram).
     Best-effort: if this fails, we still want to process the status
     change, so we don't bail out on a null/failed result here. */
  await callTelegramApi(TOKEN, 'answerCallbackQuery', { callback_query_id: cbId }, 'answerCallbackQuery');

  const match = typeof data === 'string' ? data.match(CALLBACK_DATA_PATTERN) : null;
  if (!match) {
    // Covers the "noop" button (post-delivery) and any malformed/unexpected payload alike.
    res.status(200).json({ ok: true }); return;
  }

  const [, statusKey, orderId] = match;
  const statusText = STATUS_LABELS[statusKey];

  /* Look up the stored message */
  const stored = messageStore.get(orderId);
  const msgId  = (stored && stored.message_id) || (message && message.message_id);
  const chatId = (stored && stored.chat_id)    || (message && message.chat && message.chat.id);

  if (msgId && chatId) {
    /* Edit original message: update status line */
const originalText =
  message && typeof message.text === 'string'
    ? message.text
    : '';

let newText = originalText;

// Пытаемся заменить существующий статус
if (/📌 \*?Status:?\*?/i.test(originalText)) {
  newText = originalText.replace(
    /📌 \*?Status:?\*?.*$/m,
    `📌 *Status:* ${statusText}`
  );
} else {
  // Если статуса нет — просто добавляем его
  newText = `${originalText}\n\n📌 *Status:* ${statusText}`;
}

// Не пытаемся редактировать сообщение, если ничего не изменилось
const replyMarkup =
  statusKey === 'delivered'
    ? {
        inline_keyboard: [[
          {
            text: '✅ Delivered — Abgeschlossen',
            callback_data: 'noop'
          }
        ]]
      }
    /* Re-append the Maps button (Requirement 2) so it survives the
       status-button rebuild; buildButtons(orderId) itself is untouched. */
    : buildReplyMarkupWithMaps(buildButtons(orderId), stored && stored.payload);

if (
  newText !== originalText ||
  statusKey === 'delivered'
) {
  await callTelegramApi(
    TOKEN,
    'editMessageText',
    {
      chat_id: chatId,
      message_id: msgId,
      text: newText,
      parse_mode: 'Markdown',
      reply_markup: replyMarkup
    },
    'editMessageText'
  );
}

    /* Respond to Telegram's webhook now — everything below is
       best-effort and must never delay this response or the message
       edit above. */
    res.status(200).json({ ok: true });

    /* Customer status email — replaces the old WhatsApp handoff at
       this exact point in the flow. Fires for accepted / cooking /
       on_the_way / delivered ("new" is emailed from the order-creation
       handler above, not here). Guarded by notifiedStatuses so a
       Telegram webhook retry can never double-send.
       notifyCustomer() is storage-independent (takes the order object,
       not an ID or a Map reference) and failure-isolated (never
       throws past this try/catch) — see lib/email/notifyCustomer.js. */
    if (stored && stored.payload && stored.notifiedStatuses && !stored.notifiedStatuses[statusKey]) {
      try {
        await notifyCustomer(stored.payload, statusKey);
        stored.notifiedStatuses[statusKey] = true;
      } catch (err) {
        console.error(`[Proxy] Status email (${statusKey}) failed —`, err.message);
      }
    }

    /* Order lifecycle is complete — free the entry instead of waiting for
       the 24h sweep, but only for orders we actually have in the store. */
    if (statusKey === 'delivered' && stored) {
      messageStore.delete(orderId);
    }
    return;
  }

  res.status(200).json({ ok: true });
}

function buildButtons(orderId) {
  return {
    inline_keyboard: [[
      { text: '✅ Accepted',    callback_data: 'status:accepted:'   + orderId },
      { text: '🍳 Cooking',     callback_data: 'status:cooking:'    + orderId }
    ],[
      { text: '🛵 Driver left', callback_data: 'status:on_the_way:' + orderId },
      { text: '✅ Delivered',   callback_data: 'status:delivered:'  + orderId }
    ]]
  };
}

/* ─────────────────────────────────────────────────
   LOCAL DEV SERVER (for testing without Vercel)
   Run: TELEGRAM_BOT_TOKEN=xxx node telegram-proxy.js
───────────────────────────────────────────────── */
if (require.main === module) {
  const http = require('http');
  const PORT = process.env.PORT || 3000;

  http.createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(200, { 'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type' });
      res.end(); return;
    }
    if (req.url !== '/api/order') { res.writeHead(404); res.end('Not found'); return; }
    let rawBody = '';
    req.on('data', d => rawBody += d);
    req.on('end', async () => {
      req.body = rawBody;
      await module.exports(req, res);
    });
  }).listen(PORT, () => console.log('[Proxy] Listening on http://localhost:' + PORT + '/api/order'));
}