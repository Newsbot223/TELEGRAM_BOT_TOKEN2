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
 *
 *  PERSISTENCE — Supabase (fixes the "WhatsApp button missing on later
 *  orders" bug caused by serverless instances not sharing memory):
 *    SUPABASE_URL                — your project's REST URL
 *                                   (https://<project>.supabase.co)
 *    SUPABASE_SERVICE_ROLE_KEY   — service role key (NOT the anon key —
 *                                   this proxy needs to bypass RLS to
 *                                   read/write orders from the server side)
 *
 *    Create the table once in the Supabase SQL editor:
 *
 *      create table takashi_orders (
 *        order_id           text primary key,
 *        message_id         bigint not null,
 *        chat_id             bigint not null,
 *        payload             jsonb not null,
 *        notified_accepted   boolean not null default false,
 *        notified_on_the_way boolean not null default false,
 *        created_at          timestamptz not null default now()
 *      );
 *
 *    No client library is used (plain REST via fetch, PostgREST), so no
 *    new npm dependency is required.
 *
 *    Recommended index (order_id already has one via the primary key):
 *      create index takashi_orders_created_at_idx on takashi_orders (created_at);
 *
 *    RLS: the table is only ever touched with the SERVICE ROLE key, which
 *    bypasses Row Level Security by design — so no policy is functionally
 *    required. As defense-in-depth (in case the anon/public key is ever
 *    used against this project), it's still recommended to:
 *      alter table takashi_orders enable row level security;
 *    ...and simply add no policies — RLS with zero policies denies all
 *    access to non-service-role callers while leaving this proxy unaffected.
 * ══════════════════════════════════════════════════════════════
 */

/* ─────────────────────────────────────────────────
   Works as-is on Vercel / Netlify / local Express
───────────────────────────────────────────────── */
const TELEGRAM_API = 'https://api.telegram.org/bot';
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET; // optional, see header docs

/* Shared fetch timeout wrapper (used by both Telegram and Supabase calls).
   Without this, a hung TCP connection could stall the whole request until
   the platform's own function timeout kills it, wasting the entire budget
   on a single call. Aborting early lets the existing try/catch paths in
   callTelegramApi/sbFetch handle it exactly like any other network error
   (log + return null) — no behavior change on the happy path. */
const FETCH_TIMEOUT_MS = 8000;
async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/* In-process WARM CACHE for message_id ↔ orderId mapping.
   Using a Map (not a plain object) so a crafted orderId like "__proto__"
   or "constructor" can never touch Object.prototype.
   Supabase (below) is now the source of truth, so this Map is purely a
   speed-up for repeat callback presses that happen to land on the same
   warm instance — it is never the only place an order lives. Losing it
   on a cold start / different instance is harmless: handleCallback falls
   back to Supabase automatically. The TTL cleanup below only bounds
   memory for long-lived processes (e.g. the local dev server). */
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

/* ─── Supabase persistence (source of truth for order data) ───
   Plain REST calls (PostgREST) via the built-in fetch — no client library,
   so no new npm dependency. Every function is best-effort: on missing
   config or a network/API error it logs and returns null/false rather
   than throwing, so a Supabase outage degrades to "no WhatsApp button"
   instead of breaking Telegram status updates. */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_TABLE = 'takashi_orders';

// Trim a trailing slash so a SUPABASE_URL set with or without one both work.
const SUPABASE_BASE = SUPABASE_URL ? SUPABASE_URL.replace(/\/+$/, '') : SUPABASE_URL;

async function sbFetch(path, options = {}) {
  if (!SUPABASE_BASE || !SUPABASE_KEY) {
    console.error('[Proxy] Supabase not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing)');
    return null;
  }
  let res;
  try {
    res = await fetchWithTimeout(`${SUPABASE_BASE}/rest/v1/${path}`, {
      ...options,
      headers: {
        'apikey':        SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type':  'application/json',
        ...(options.headers || {})
      }
    });
  } catch (err) {
    console.error(`[Proxy] Supabase ${options.method || 'GET'} ${path.split('?')[0]}: network error —`, err.name === 'AbortError' ? 'timed out' : err.message);
    return null;
  }

  if (!res.ok) {
    /* Parse out just the error message/code — never log the raw response
       body verbatim, since PostgREST can echo back submitted values
       (which may include customer name/phone) in some constraint errors. */
    const errText = await res.text().catch(() => '');
    let errDetail = 'unknown error';
    try {
      const errJson = JSON.parse(errText);
      errDetail = errJson.message || errJson.hint || errJson.code || errDetail;
    } catch { /* non-JSON body — keep generic detail, don't log raw text */ }
    console.error(`[Proxy] Supabase ${options.method || 'GET'} ${path.split('?')[0]} failed (${res.status}) —`, errDetail);
    return null;
  }
  if (res.status === 204) return true; // no content, e.g. return=minimal
  return res.json().catch(() => true);
}

/* Upsert (insert-or-update) the order row. Used both for the initial save
   and to keep notified_* flags in sync across instances. */
async function saveOrderToSupabase(orderId, entry) {
  const row = {
    order_id:            orderId,
    message_id:          entry.message_id,
    chat_id:              entry.chat_id,
    payload:              entry.payload,
    notified_accepted:    Boolean(entry.notifiedAccepted),
    notified_on_the_way:  Boolean(entry.notifiedOnTheWay)
  };
  return sbFetch(`${SUPABASE_TABLE}?on_conflict=order_id`, {
    method:  'POST',
    headers: { 'Prefer': 'resolution=merge-duplicates,return=minimal' },
    body:    JSON.stringify(row)
  });
}

/* Load a single order by id. Returns the same shape previously produced
   by messageStore.get(orderId), or null if not found / on error. */
async function getOrderFromSupabase(orderId) {
  const rows = await sbFetch(`${SUPABASE_TABLE}?order_id=eq.${encodeURIComponent(orderId)}&select=*&limit=1`, { method: 'GET' });
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const row = rows[0];
  return {
    message_id:        row.message_id,
    chat_id:            row.chat_id,
    payload:            row.payload,
    notifiedAccepted:   Boolean(row.notified_accepted),
    notifiedOnTheWay:   Boolean(row.notified_on_the_way),
    createdAt:          row.created_at ? new Date(row.created_at).getTime() : Date.now()
  };
}

/* Persist a single notified_* flag update (best-effort). */
async function updateNotifiedFlagInSupabase(orderId, flagKey, value) {
  const column = flagKey === 'notifiedAccepted' ? 'notified_accepted' : 'notified_on_the_way';
  return sbFetch(`${SUPABASE_TABLE}?order_id=eq.${encodeURIComponent(orderId)}`, {
    method:  'PATCH',
    headers: { 'Prefer': 'return=minimal' },
    body:    JSON.stringify({ [column]: value })
  });
}

/* Atomically "claims" a notified_* flag: flips it false → true only if it
   is still false at the moment Postgres evaluates the row filter. This is
   the authoritative guard against duplicate WhatsApp messages — a plain
   read-then-write (as used elsewhere for speed) has a race window where
   two near-simultaneous callbacks (a fast double-tap, a Telegram retry, or
   two different serverless instances) can both read "not yet notified"
   before either writes back. Using the WHERE filter as part of the UPDATE
   closes that window: only the request that actually performs the flip
   gets a row back in the response; the loser gets an empty array and
   knows to skip sending. Returns true if this call won the claim. */
async function claimNotifiedFlag(orderId, flagKey) {
  const column = flagKey === 'notifiedAccepted' ? 'notified_accepted' : 'notified_on_the_way';
  const rows = await sbFetch(
    `${SUPABASE_TABLE}?order_id=eq.${encodeURIComponent(orderId)}&${column}=eq.false`,
    {
      method:  'PATCH',
      headers: { 'Prefer': 'return=representation' },
      body:    JSON.stringify({ [column]: true })
    }
  );
  return Array.isArray(rows) && rows.length > 0;
}

/* Delivered orders may optionally be removed from Supabase — mirrors the
   old messageStore.delete() cleanup. Idempotent: safe to call even if the
   row doesn't exist (e.g. it was already deleted by a concurrent request). */
async function deleteOrderFromSupabase(orderId) {
  return sbFetch(`${SUPABASE_TABLE}?order_id=eq.${encodeURIComponent(orderId)}`, {
    method:  'DELETE',
    headers: { 'Prefer': 'return=minimal' }
  });
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
    res = await fetchWithTimeout(`${TELEGRAM_API}${TOKEN}/${method}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload)
    });
  } catch (err) {
    console.error(`[Proxy] ${context}: network error —`, err.name === 'AbortError' ? 'timed out' : err.message);
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
     key or, later, interpolated unescaped into callback_data/messages.
     Saved to Supabase (source of truth, survives cold starts / other
     instances) and mirrored into the local warm cache (speed-up only). */
  const orderId = _orderPayload && _orderPayload.orderId;
  if (data.ok && data.result && orderId && ORDER_ID_PATTERN.test(orderId)) {
    const entry = {
      message_id:       data.result.message_id,
      chat_id:           chat_id,
      payload:           _orderPayload,
      createdAt:         Date.now(),
      notifiedAccepted:  false,
      notifiedOnTheWay:  false
    };
    messageStore.set(orderId, entry);
    await saveOrderToSupabase(orderId, entry); // awaited: the function may freeze right after res is sent
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

  /* Look up the stored message — check the warm local cache first, and
     fall back to Supabase (source of truth) on a miss, e.g. a cold start
     or a callback landing on a different serverless instance than the one
     that created the order. This is what fixes WhatsApp buttons no longer
     appearing after the first order. */
  let stored = messageStore.get(orderId);
  if (!stored) {
    stored = await getOrderFromSupabase(orderId);
    if (stored) messageStore.set(orderId, stored); // warm the cache for this instance
  }
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
       Guarded by an ATOMIC claim on the per-status "notified" flag so a
       double-tap on the button, a Telegram retry, or two different
       serverless instances handling near-simultaneous callbacks can never
       send the customer's staff-facing button twice — a plain read-then-
       write here would leave a race window since the read (local cache or
       Supabase) and the write aren't one operation. Both statuses share
       the same sendWhatsAppButton() mechanism — only the message text
       differs, picked internally by statusKey. */
    const notifiedFlagKey = WHATSAPP_NOTIFIED_FLAG[statusKey];
    if (notifiedFlagKey && stored && stored.payload && stored.payload.customer && !stored[notifiedFlagKey]) {
      const claimed = await claimNotifiedFlag(orderId, notifiedFlagKey);
      if (claimed) {
        stored[notifiedFlagKey] = true;
        messageStore.set(orderId, stored);
        const sent = await sendWhatsAppButton(chatId, stored.payload.customer, TOKEN, statusKey);
        if (!sent) {
          // Release the claim so a later retry (this or another instance) can still send it.
          stored[notifiedFlagKey] = false;
          messageStore.set(orderId, stored);
          await updateNotifiedFlagInSupabase(orderId, notifiedFlagKey, false);
        }
      } else {
        // Another concurrent request already won the claim — just sync the local cache.
        stored[notifiedFlagKey] = true;
        messageStore.set(orderId, stored);
      }
    }

    /* Order lifecycle is complete — free the entry instead of waiting for
       the 24h sweep. Always attempt the Supabase delete (cheap, idempotent)
       even if this instance didn't have it cached locally. */
    if (statusKey === 'delivered') {
      messageStore.delete(orderId);
      await deleteOrderFromSupabase(orderId);
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
    `Hallo ${name}! `,
    ``,
    `Ihre Bestellung wurde angenommen.`,
    ``,
    `Wir beginnen jetzt mit der Zubereitung Ihrer Bestellung.`,
    ``,
    `Vielen Dank für Ihre Bestellung bei Takashi Restaurant! `
  ].join('\n'),
  on_the_way: (name) => [
    `Hallo ${name}! `,
    ``,
    `Ihre Bestellung ist jetzt unterwegs und wird in Kürze bei Ihnen eintreffen. `,
    ``,
    `Vielen Dank für Ihre Bestellung bei Takashi Restaurant! `
  ].join('\n')
};

/* Group-facing label shown above the WhatsApp button, per type. */
const WHATSAPP_GROUP_LABEL = {
  accepted: '✅ Accepted',
  on_the_way: '🛵 Driver left'
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
