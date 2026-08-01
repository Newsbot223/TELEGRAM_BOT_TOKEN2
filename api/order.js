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
 *  WHATSAPP HANDOFF (status:on_the_way):
 *    No Twilio / Meta Cloud API needed. When "Driver left" is pressed, the
 *    proxy sends a NEW Telegram message to the group containing a button
 *    that deep-links staff into a prefilled WhatsApp chat with the customer
 *    (wa.me/<phone>?text=...). The phone number is validated first; if it's
 *    missing or not a plausible number, the button is silently skipped and
 *    the rest of the flow (status edit, etc.) is unaffected.
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

  const data = await callTelegramApi(TOKEN, 'sendMessage', { chat_id, text, parse_mode, reply_markup }, 'New order sendMessage');
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
      notifiedAccepted:  false,
      notifiedOnTheWay:  false
    });
  } else if (orderId) {
    console.warn('[Proxy] Order not stored — orderId failed validation');
  }

  res.status(200).json(data);
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
    : buildButtons(orderId);

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

    /* WhatsApp handoff (accepted / on_the_way) — no Twilio/Meta API, just a
       wa.me deep-link sent as a NEW Telegram message with an inline button.
       Guarded by a per-status "notified" flag so a double-tap on the button
       (or a Telegram retry) can't send the customer's staff-facing button
       twice. Both statuses share the same sendWhatsAppButton() mechanism —
       only the message text differs, picked internally by statusKey. */
    const notifiedFlagKey = WHATSAPP_NOTIFIED_FLAG[statusKey];
    if (notifiedFlagKey && stored && stored.payload && stored.payload.customer && !stored[notifiedFlagKey]) {
      stored[notifiedFlagKey] = true; // set before awaiting to shrink the race window
      const sent = await sendWhatsAppButton(chatId, stored.payload.customer, TOKEN, statusKey);
      if (!sent) stored[notifiedFlagKey] = false; // allow retry on next press if it failed
    }

    /* Order lifecycle is complete — free the entry instead of waiting for
       the 24h sweep, but only for orders we actually have in the store. */
    if (statusKey === 'delivered' && stored) {
      messageStore.delete(orderId);
    }
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

/* ─── WhatsApp helpers (no Twilio / Meta API — plain wa.me deep-link) ─── */

/* Germany is Takashi's home market, so a local number written with a
   single leading "0" (e.g. "0151 2345678") is assumed to be German unless
   it's already international ("+..." or "00..."). Adjust if the customer
   base isn't primarily German numbers. */
const DEFAULT_COUNTRY_CODE = '49';

/* E.164-ish check: "+" then 8–15 digits, first digit 1-9. Good enough to
   filter out empty/garbage input without pulling in a full phone-number
   parsing library for a single wa.me link. */
const E164_PATTERN = /^\+[1-9]\d{7,14}$/;

/* Turn messy user input ("0151 234-56 78", "0049 (151) 2345678", "00491512345678")
   into an E.164-style string ("+491512345678"), or null if it can't be
   confidently normalized. Never throws. */
function normalizePhoneForWhatsApp(rawPhone) {
  if (!rawPhone) return null;

  let cleaned = String(rawPhone).trim().replace(/[\s\-()]/g, '');
  if (!cleaned) return null;

  if (cleaned.startsWith('00')) {
    cleaned = '+' + cleaned.slice(2);
  } else if (/^0\d+$/.test(cleaned)) {
    cleaned = '+' + DEFAULT_COUNTRY_CODE + cleaned.slice(1);
  }

  return cleaned;
}

function isValidWhatsAppPhone(phone) {
  return E164_PATTERN.test(phone);
}

/* wa.me wants digits only (no "+"). */
function buildWhatsAppLink(e164Phone, message) {
  const waPhone = e164Phone.replace(/^\+/, '');
  return `https://wa.me/${waPhone}?text=${encodeURIComponent(message)}`;
}

/* Maps a WhatsApp "type" to which per-order flag guards its button, so
   handleCallback can trigger the same sendWhatsAppButton() mechanism for
   several statuses without duplicating the send/guard logic. */
const WHATSAPP_NOTIFIED_FLAG = {
  accepted:   'notifiedAccepted',
  on_the_way: 'notifiedOnTheWay'
};

/* Customer-facing WhatsApp message text, per type ("accepted" / "on_the_way").
   Kept as functions so the name can be interpolated without building every
   message eagerly. */
const WHATSAPP_CUSTOMER_MESSAGE = {
  accepted: (name) => [
    `Hallo ${name}! 👋`,
    ``,
    `Ihre Bestellung wurde angenommen.`,
    ``,
    `Wir beginnen jetzt mit der Zubereitung Ihrer Bestellung.`,
    ``,
    `Vielen Dank für Ihre Bestellung bei Takashi Restaurant! 🍣`
  ].join('\n'),
  on_the_way: (name) => [
    `Hallo ${name}! 👋`,
    ``,
    `Ihre Bestellung ist jetzt unterwegs und wird in Kürze bei Ihnen eintreffen. 🚗`,
    ``,
    `Vielen Dank für Ihre Bestellung bei Takashi Restaurant! 🍣`
  ].join('\n')
};

/* Group-facing label shown above the WhatsApp button, per type. */
const WHATSAPP_GROUP_LABEL = {
  accepted:   '✅ *Accepted*',
  on_the_way: '🚗 *Driver left*'
};

/* Send a NEW Telegram message (does not touch the original status message)
   with a button that opens a prefilled WhatsApp chat with the customer.
   Returns true on (best-effort) success, false if it was skipped or failed
   — the caller uses this to decide whether a retry should be allowed, and
   in all cases the rest of the order flow keeps working either way. */
async function sendWhatsAppButton(chatId, customer, TOKEN, type) {
  const buildMessage = WHATSAPP_CUSTOMER_MESSAGE[type];
  if (!buildMessage) return false; // unknown/unsupported type — nothing to send

  const name = customer && customer.name ? String(customer.name).trim() : 'Kunde';
  const phone = normalizePhoneForWhatsApp(customer && customer.phone);

  if (!phone || !isValidWhatsAppPhone(phone)) {
    // Never log the raw phone number — just note that it was unusable.
    console.warn('[Proxy] Skipping WhatsApp button — missing or invalid customer phone number');
    return false;
  }

  const waMessage = buildMessage(name);
  const waLink = buildWhatsAppLink(phone, waMessage);

  /* Group-facing message intentionally omits the phone number — staff
     only need the name and the one-tap button to reach the customer. */
  const text = [
    WHATSAPP_GROUP_LABEL[type] || 'Status update',
    `Customer: ${name}`,
    ``,
    `Tap the button below to open WhatsApp.`
  ].join('\n');

  const data = await callTelegramApi(TOKEN, 'sendMessage', {
    chat_id:      chatId,
    text,
    parse_mode:   'Markdown',
    reply_markup: { inline_keyboard: [[{ text: '💬 WhatsApp', url: waLink }]] }
  }, 'WhatsApp button sendMessage');

  return Boolean(data && data.ok);
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
