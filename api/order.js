/**
 * Takashi Restaurant — Telegram Bot API
 * Vercel Serverless Function: /api/order
 *
 * Handles two request types:
 *   1. POST from frontend  { chat_id, text, parse_mode, reply_markup, _orderPayload }
 *      → sends the formatted order message to the Telegram group
 *
 *   2. POST from Telegram  { callback_query: { data, message, from } }
 *      → handles inline button presses, edits the original message with new status
 *
 * Environment variables (set in Vercel dashboard → Settings → Environment Variables):
 *   TELEGRAM_BOT_TOKEN   — from @BotFather
 *
 * Webhook registration (run once after deploy):
 *   https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://telegram-bot-token-2.vercel.app/api/order
 */

const TELEGRAM_BASE = 'https://api.telegram.org/bot';

/* ─── Status config ──────────────────────────────────────────────────── */
const STATUSES = {
  accepted:    { emoji: '✅', label: 'Accepted',    next: 'cooking'     },
  cooking:     { emoji: '👨‍🍳', label: 'Cooking',     next: 'driver_left' },
  driver_left: { emoji: '🚗', label: 'Driver Left', next: 'delivered'   },
  delivered:   { emoji: '✅', label: 'Delivered',   next: null          },
};

/* ─── Build inline keyboard — active status is highlighted with • ────── */
function buildKeyboard(orderId, activeStatus) {
  const steps = ['accepted', 'cooking', 'driver_left', 'delivered'];
  // Two rows of two buttons each
  const row1 = steps.slice(0, 2).map(key => ({
    text: (key === activeStatus ? '• ' : '') + STATUSES[key].emoji + ' ' + STATUSES[key].label,
    callback_data: 'status:' + key + ':' + orderId,
  }));
  const row2 = steps.slice(2).map(key => ({
    text: (key === activeStatus ? '• ' : '') + STATUSES[key].emoji + ' ' + STATUSES[key].label,
    callback_data: 'status:' + key + ':' + orderId,
  }));
  return { inline_keyboard: [row1, row2] };
}

/* ─── Replace status line in message text ────────────────────────────── */
function updateStatusLine(text, statusKey) {
  const s = STATUSES[statusKey];
  const newLine = '📌 *Status:* ' + s.emoji + ' ' + s.label;
  // Replace existing status line (matches any content after "📌 *Status:*")
  if (/📌 \*Status:\*/.test(text)) {
    return text.replace(/📌 \*Status:\*.*/, newLine);
  }
  // Append if not found
  return text + '\n' + newLine;
}

/* ─── Telegram API helper ────────────────────────────────────────────── */
async function tgCall(token, method, body) {
  const res = await fetch(TELEGRAM_BASE + token + '/' + method, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) {
    // editMessageText returns ok:false with code 400 if text is unchanged — ignore silently
    if (data.error_code === 400 && data.description && data.description.includes('not modified')) {
      return data;
    }
    console.error('[TG] ' + method + ' failed:', data.description);
  }
  return data;
}

/* ─── Twilio WhatsApp helper ─────────────────────────────────────────── */
async function sendWhatsApp(toPhone) {
  const SID   = process.env.TWILIO_ACCOUNT_SID;
  const TOKEN = process.env.TWILIO_AUTH_TOKEN;
  const FROM  = process.env.TWILIO_WHATSAPP_FROM;

  if (!SID || !TOKEN || !FROM) {
    console.error('[WhatsApp] Missing env vars: TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_WHATSAPP_FROM');
    return;
  }
  if (!toPhone) {
    console.error('[WhatsApp] No customer phone number — skipping');
    return;
  }

  // Normalise: strip spaces, ensure + prefix, wrap in whatsapp: scheme
  const normalised = String(toPhone).replace(/\s+/g, '');
  const to = normalised.startsWith('whatsapp:') ? normalised : 'whatsapp:' + (normalised.startsWith('+') ? normalised : '+' + normalised);

  const credentials = Buffer.from(SID + ':' + TOKEN).toString('base64');
  const endpoint    = `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`;

  const body = new URLSearchParams({
    From: FROM,
    To:   to,
    Body: 'Ihre Bestellung ist unterwegs 🚗\nTakashi Restaurant Reutlingen',
  }).toString();

  try {
    const res  = await fetch(endpoint, {
      method:  'POST',
      headers: {
        'Authorization': 'Basic ' + credentials,
        'Content-Type':  'application/x-www-form-urlencoded',
      },
      body,
    });
    const data = await res.json();
    if (data.sid) {
      console.log('[WhatsApp] Sent successfully. SID:', data.sid, '→', to);
    } else {
      console.error('[WhatsApp] Twilio error:', data.code, data.message, '→', to);
    }
  } catch (err) {
    console.error('[WhatsApp] fetch failed:', err.message);
  }
}

/* ─── Handle callback_query (button press) ───────────────────────────── */
async function handleCallback(token, cbq, res) {
  const { id: cbId, data, message } = cbq;

  // Always answer immediately to remove Telegram's loading spinner
  await tgCall(token, 'answerCallbackQuery', {
    callback_query_id: cbId,
    text: '',
    show_alert: false,
  });

  if (!data || !data.startsWith('status:')) {
    return res.status(200).json({ ok: true });
  }

  const parts     = data.split(':');    // ['status', 'accepted', 'TK-XXXXX']
  const statusKey = parts[1];
  const orderId   = parts.slice(2).join(':');   // safe even if orderId had colons

  if (!STATUSES[statusKey]) {
    return res.status(200).json({ ok: true, warning: 'Unknown status: ' + statusKey });
  }

  const chatId    = message.chat.id;
  const messageId = message.message_id;
  const oldText   = message.text || '';

  const newText   = updateStatusLine(oldText, statusKey);
  const newMarkup = buildKeyboard(orderId, statusKey);

  // Edit message text (includes status line update)
  await tgCall(token, 'editMessageText', {
    chat_id:    chatId,
    message_id: messageId,
    text:       newText,
    parse_mode: 'Markdown',
    reply_markup: newMarkup,
  });

  // WhatsApp notification — only on driver_left, never blocks Telegram response
  if (statusKey === 'driver_left') {
    const customerPhone = message.text && (() => {
      // Extract phone from the order message text (line: "📞 *Telefon:* +49...")
      const match = message.text.match(/📞[^\n]*?(\+[\d\s]{7,})/);
      return match ? match[1] : null;
    })();
    await sendWhatsApp(customerPhone);
  }

  return res.status(200).json({ ok: true });
}

/* ─── Handle new order from frontend ────────────────────────────────── */
async function handleNewOrder(token, body, res) {
  const { chat_id, text, parse_mode, reply_markup, _orderPayload } = body;

  if (!chat_id || !text) {
    return res.status(400).json({ ok: false, error: 'Missing chat_id or text' });
  }

  const data = await tgCall(token, 'sendMessage', {
    chat_id,
    text,
    parse_mode:   parse_mode || 'Markdown',
    reply_markup: reply_markup || undefined,
  });

  return res.status(200).json(data);
}

/* ─── Main handler ───────────────────────────────────────────────────── */
export default async function handler(req, res) {
  // CORS — allow frontend origin
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, service: 'Takashi Telegram Bot' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  if (!TOKEN) {
    console.error('[Proxy] TELEGRAM_BOT_TOKEN environment variable is not set');
    return res.status(500).json({ ok: false, error: 'Bot token not configured' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (e) {
    return res.status(400).json({ ok: false, error: 'Invalid JSON body' });
  }

  // Route: Telegram webhook → callback_query
  if (body && body.callback_query) {
    return handleCallback(TOKEN, body.callback_query, res);
  }

  // Route: New order from frontend
  return handleNewOrder(TOKEN, body, res);
}
