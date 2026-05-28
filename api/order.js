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
 *  TODO (WhatsApp notification when driver leaves):
 *    On callback_data === 'status:on_the_way:*' below, add:
 *    Option A — Twilio WhatsApp:
 *      const client = require('twilio')(TWILIO_SID, TWILIO_AUTH);
 *      await client.messages.create({
 *        from: 'whatsapp:+14155238886',
 *        to:   'whatsapp:' + order.customer.phone,
 *        body: `Ihre Bestellung #${orderId} ist unterwegs! ~${order.estimatedTime}`
 *      });
 *    Option B — Meta WhatsApp Business Cloud API:
 *      fetch(`https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`, {
 *        method: 'POST',
 *        headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` },
 *        body: JSON.stringify({ messaging_product:'whatsapp', to: phone, type:'text',
 *          text:{ body:`Ihre Bestellung #${orderId} ist unterwegs!` } })
 *      });
 * ══════════════════════════════════════════════════════════════
 */

/* ─────────────────────────────────────────────────
   Works as-is on Vercel / Netlify / local Express
───────────────────────────────────────────────── */
const TELEGRAM_API = 'https://api.telegram.org/bot';

/* In-memory store for message_id ↔ orderId mapping.
   Replace with a real DB (Supabase, Redis, KV) in production. */
const messageStore = {};

/* ─── Main handler ─── */
module.exports = async function handler(req, res) {
  /* CORS — allow requests from your domain */
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST')    { res.status(405).json({ error: 'Method not allowed' }); return; }

  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!TOKEN) {
    console.error('[Proxy] TELEGRAM_BOT_TOKEN not set');
    res.status(500).json({ ok: false, error: 'Bot token not configured' });
    return;
  }

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch(e) { res.status(400).json({ ok: false, error: 'Invalid JSON' }); return; }

  /* ── Route: Telegram webhook (callback buttons) ── */
  if (body.callback_query) {
    return handleCallback(body.callback_query, TOKEN, res);
  }

  /* ── Route: New order from frontend ── */
  const { chat_id, text, parse_mode, reply_markup, _orderPayload } = body;
  if (!chat_id || !text) {
    res.status(400).json({ ok: false, error: 'Missing chat_id or text' });
    return;
  }

  try {
    const tgRes = await fetch(`${TELEGRAM_API}${TOKEN}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id, text, parse_mode, reply_markup })
    });
    const data = await tgRes.json();

    /* Store message_id so we can edit it when admin presses a button */
    if (data.ok && data.result && _orderPayload) {
      messageStore[_orderPayload.orderId] = {
        message_id: data.result.message_id,
        chat_id:    chat_id,
        payload:    _orderPayload
      };
    }

    res.status(200).json(data);
  } catch (err) {
    console.error('[Proxy] sendMessage error:', err);
    res.status(502).json({ ok: false, error: err.message });
  }
};

/* ─── Handle inline button presses ─── */
async function handleCallback(cbq, TOKEN, res) {
  const { id: cbId, data, message } = cbq;

  /* Answer the callback (removes the loading spinner in Telegram) */
  await fetch(`${TELEGRAM_API}${TOKEN}/answerCallbackQuery`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ callback_query_id: cbId })
  });

  if (!data || !data.startsWith('status:')) {
    res.status(200).json({ ok: true }); return;
  }

  const [, statusKey, orderId] = data.split(':');

  const STATUS_LABELS = {
    accepted:   '✅ Accepted — Bestellung angenommen',
    cooking:    '🍳 Cooking — In Zubereitung',
    on_the_way: '🛵 Driver left — Fahrer unterwegs',
    delivered:  '✅ Delivered — Zugestellt'
  };
  const statusText = STATUS_LABELS[statusKey] || statusKey;

  /* Look up the stored message */
  const stored = messageStore[orderId];
  const msgId  = (stored && stored.message_id) || (message && message.message_id);
  const chatId = (stored && stored.chat_id)    || (message && message.chat && message.chat.id);

  if (msgId && chatId) {
    /* Edit original message: update status line */
    const originalText = message && message.text ? message.text : '';
    const newText = originalText.replace(
      /📌 \*Status:\*.*$/m,
      '📌 *Status:* ' + statusText
    );

    await fetch(`${TELEGRAM_API}${TOKEN}/editMessageText`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        chat_id:    chatId,
        message_id: msgId,
        text:       newText || originalText,
        parse_mode: 'Markdown',
        /* Keep buttons but grey out completed one by removing them after delivery */
        reply_markup: statusKey === 'delivered' ? { inline_keyboard: [[
          { text: '✅ Delivered — Abgeschlossen', callback_data: 'noop' }
        ]] } : buildButtons(orderId)
      })
    });

    /* TODO (WhatsApp — on_the_way):
    if (statusKey === 'on_the_way' && stored && stored.payload) {
      const customerPhone = stored.payload.customer.phone;
      const estimatedTime = stored.payload.estimatedTime;
      // → call Twilio or Meta WhatsApp API here (server-side, never frontend)
    }
    */
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
