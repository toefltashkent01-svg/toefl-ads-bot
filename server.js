require('dotenv').config();
const http = require('http');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');
const Lead = require('./models/Lead');
const { resolveLead } = require('./identity-resolve');
const { captureLead } = require('./sales-engine');
const { recordTouch } = require('./content-intelligence');

const {
  BOT_TOKEN,
  MONGODB_URI,
  PORT = 3000,
  ADMIN_CHAT_ID,
  ADMIN_USERNAME,
  ADMIN_PHONE,
  CHANNEL_USERNAME,
} = process.env;

if (!BOT_TOKEN)   throw new Error('BOT_TOKEN is required');
if (!MONGODB_URI) throw new Error('MONGODB_URI is required');

// ── Static content ───────────────────────────────────────────────────────────

const WELCOME_TEXT =
  `TOEFL Tashkent jamoasi shu kungacha 600+ studentga sertifikat olishda yordam bergan ✅\n\n` +
  `Natijalarimiz: https://t.me/${CHANNEL_USERNAME || 'toefltashkent1'}`;

const HOW_TEXT =
  `Testni biz ishlaymiz, natija esa sizniki — yuqori natija kafolatlangan 🎯`;

const TIMELINE_TEXT =
  `⏳ Tayyorlanish muddati:\n\n` +
  `• Ingliz tilini umuman bilmasangiz → 2 haftada\n` +
  `• Boshlang'ich daraja bo'lsa → 10 kunda\n` +
  `• B1-B2 darajasi bo'lsa → 1 haftada`;

const PRICE_TEXT =
  `💰 Narxi: $1200\n\n` +
  `Narxga test davomida to'liq yordam kiradi.\n` +
  `To'lovni natijani qo'lingizga olgandan keyin qilasiz ✅`;

const CONTACT_TEXT =
  `📞 Biz bilan bog'lanish:\n\n` +
  `Qo'ng'iroq: ${ADMIN_PHONE || '+998335246820'}`;

// ── DET Help content — OWNER-APPROVED 2026-09-09 ────────────────────────────
//
// This bot was built TOEFL-only (see WELCOME_TEXT/PRICE_TEXT above —
// hardcoded $1200, TOEFL-specific framing). Extending it to DET without also
// giving it DET's own words would have shown a real DET prospect TOEFL's
// price and process, which is worse than not tracking DET ads at all — so
// this text exists alongside the tracking capability below, not as an
// afterthought.
//
// The FACTS in it are verified against `DET-and-DET-Help.md` (sourced from
// `seed-staff-knowledge-facts.ts` in `maktab-english`): $50 question-bank
// access, a free YouTube prep playlist, Duolingo's own $70 registration fee
// (passthrough, never this company's revenue), and a $400 help fee that is
// only fully collected if the certificate arrives AND the student is
// satisfied — otherwise $200 plus a free course. The wording itself was
// reviewed and approved by the owner on 2026-09-09 — a real "det_"-prefixed
// ad campaign may now use this bot as-is.
const DET_WELCOME_TEXT =
  `TOEFL Tashkent jamoasi endi Duolingo English Test (DET) sertifikatini olishda ham yordam beradi ✅`;

const DET_HOW_TEXT =
  `Savollar bazasi va bepul tayyorgarlik videolari orqali tayyorlanasiz, keyin rasmiy ro'yxatdan o'tasiz 🎯`;

const DET_TIMELINE_TEXT =
  `⏳ Tayyorlanish muddati sizning boshlang'ich darajangizga bog'liq — ro'yxatdan o'tgach individual belgilanadi.`;

const DET_PRICE_TEXT =
  `💰 Narxi:\n\n` +
  `• $50 — savollar bazasiga kirish\n` +
  `• $70 — Duolingo'ning o'z rasmiy ro'yxatdan o'tish to'lovi (to'g'ridan-to'g'ri Duolingo'ga boradi, bizga emas)\n` +
  `• $400 — yordam xizmati narxi (sertifikat kelib, natijadan mamnun bo'lsangiz to'liq olinadi; aks holda $200 + bepul kurs)`;

/**
 * The ONE place `Lead.product` is ever derived. A plain `adId` naming
 * convention — "det_..." means DET, anything else means TOEFL — not a guess
 * made anywhere else in this file. See `Lead.js`'s own field comment and the
 * "DET Help content" note above for why setting this alone does not make a
 * real DET funnel live.
 */
function productFor(adId) {
  return adId && /^det_/i.test(adId) ? 'DET' : 'TOEFL';
}

// ── Phone-first funnel (same flow as the toefl/cefr/edugo lead bots) ─────────
// /start -> phone (contact button, name from Telegram profile) -> purpose
// -> timeline -> level -> done.

const PHONE_ASK = `📱 Boshlash uchun telefon raqamingizni pastdagi tugma bilan ulashing.`;
const ASK_PURPOSE  = 'TOEFL sertifikati sizga nima uchun kerak?';
const ASK_TIMELINE = 'Testni qancha muddatda topshirishingiz kerak?';
const ASK_LEVEL    = 'Hozirgi ingliz tili darajangiz qanday?';
const DONE_TEXT    = "Rahmat! ✅\n\nMa'lumotlaringiz qabul qilindi. Tez orada bog'lanamiz.";
const BAD_PHONE    = "Iltimos, to'g'ri raqam yuboring (masalan: 90 123 45 67).";

const PURPOSE_OPTS = [
  ['🎓 Universitetga hujjat uchun', 'university'],
  ['💼 Ish uchun', 'job'],
  ['✈️ Migratsiya uchun', 'migration'],
  ['🤔 Shunchaki bilmoqchiman', 'curious'],
];
const TIMELINE_OPTS = [
  ['⚡ Shu oy', 'this_month'],
  ['📅 1-3 oy ichida', '1_3_months'],
  ['🗓 3+ oydan keyin', 'later'],
  ['🤔 Hali aniq emas', 'unsure'],
];
const LEVEL_OPTS = [
  ['🌱 Boshlang\'ich', 'beginner'],
  ['📘 O\'rta', 'intermediate'],
  ['🚀 Yuqori', 'advanced'],
  ['🤷 Bilmayman', 'unsure'],
];
const FUNNEL_NEXT = {
  purpose:  { field: 'purpose',  opts: PURPOSE_OPTS,  next: 'timeline', ask: ASK_TIMELINE, nextOpts: TIMELINE_OPTS },
  timeline: { field: 'timeline', opts: TIMELINE_OPTS, next: 'level',    ask: ASK_LEVEL,    nextOpts: LEVEL_OPTS },
  level:    { field: 'level',    opts: LEVEL_OPTS,    next: 'done' },
};

const PHONE_KEYBOARD = {
  keyboard: [[{ text: '📱 Raqamni ulashish', request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

function optionsKeyboard(opts, kind) {
  return { inline_keyboard: opts.map(([label, value]) => [{ text: label, callback_data: `${kind}:${value}` }]) };
}
function labelFor(opts, value) {
  const hit = opts.find(([, v]) => v === value);
  return hit ? hit[0] : value;
}

// ── Keyboards ────────────────────────────────────────────────────────────────

const BTN_1 = { inline_keyboard: [[{ text: "❓ Qanday qilib olsa bo'ladi?", callback_data: 'how' }]] };
const BTN_2 = { inline_keyboard: [[{ text: '⏳ Qancha vaqtda olsa bo\'ladi?',  callback_data: 'timeline' }]] };
const BTN_3 = { inline_keyboard: [[{ text: '💰 Narxi qancha?',                  callback_data: 'price' }]] };

const CONTACT_KEYBOARD = {
  inline_keyboard: [
    [{ text: '💬 Telegram orqali bog\'lanish', url: `https://t.me/${ADMIN_USERNAME || 'TOEFLadmint'}` }],
    [{ text: '📲 Telefon raqamimni qoldirish', callback_data: 'share_contact' }],
  ],
};

// ── MongoDB ──────────────────────────────────────────────────────────────────

// Primary DB: toefl-ads-bot
mongoose
  .connect(MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch((err) => { console.error('MongoDB error:', err.message); process.exit(1); });

// Secondary DB: sales-bot (for COMPANY HUB dashboard)
function buildSalesBotUri(uri) {
  const q = uri.indexOf('?');
  const lastSlash = uri.lastIndexOf('/', q > -1 ? q : undefined);
  return uri.substring(0, lastSlash + 1) + 'sales-bot' + (q > -1 ? uri.substring(q) : '');
}

const salesDbConn = mongoose.createConnection(buildSalesBotUri(MONGODB_URI));
salesDbConn.on('connected', () => console.log('Sales DB connected (COMPANY HUB)'));
salesDbConn.on('error', (e) => console.error('Sales DB error:', e.message));

const SalesUser = salesDbConn.model('SalesUser', new mongoose.Schema({
  _id: Number,
  name: String,
  username: String,
  tag: String,
  phone_number: String,
  funnel_step: mongoose.Schema.Types.Mixed,
  follow_up_step: Number,
  last_message: Date,
  created_at: Date,
}, { strict: false }), 'users');

// ── Bot ──────────────────────────────────────────────────────────────────────

const bot = new TelegramBot(BOT_TOKEN, { polling: false });

// /start
bot.onText(/\/start ?(.*)/, async (msg, match) => {
  const userId = msg.from.id;
  const adId   = match[1].trim() || null;
  const product = productFor(adId);

  const fullName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ');
  const username = msg.from.username || null;
  const now = new Date();

  try {
    // Save to toefl-ads-bot DB
    await Lead.findOneAndUpdate(
      { userId },
      { userId, fullName, username, adId, product, step: 'phone' },
      { upsert: true, new: true }
    );

    // Save to sales-bot DB so COMPANY HUB dashboard shows this lead
    await SalesUser.findOneAndUpdate(
      { _id: userId },
      {
        $set: {
          name: fullName,
          username: username || 'yoq',
          tag: adId ? `ads:${adId}` : 'ads_lead',
          funnel_step: 'ads_funnel',
          follow_up_step: 0,
          last_message: now,
        },
        $setOnInsert: { created_at: now },
      },
      { upsert: true, new: true }
    );

    if (ADMIN_CHAT_ID) {
      await bot.sendMessage(
        ADMIN_CHAT_ID,
        `🆕 Yangi foydalanuvchi!\n` +
        `👤 ${fullName}\n` +
        `🔗 @${username || 'yoq'}\n` +
        `🆔 ID: ${userId}` +
        (adId ? `\n📢 Reklama: ${adId}` : '')
      );
    }
  } catch (err) {
    console.error('DB error on /start:', err.message);
  }

  // A person-level ContentTouch the moment the ad deep link is actually
  // opened — see content-intelligence.js's own header for why this is worth
  // a separate call from sales-engine's later campaign-level match.
  void recordTouch({ userId, fullName, adId });

  // Welcome + phone request — product-specific text, see `productFor`.
  await bot.sendMessage(userId, `${product === 'DET' ? DET_WELCOME_TEXT : WELCOME_TEXT}\n\n${PHONE_ASK}`, {
    reply_markup: PHONE_KEYBOARD,
    disable_web_page_preview: true,
  });
});

// Inline button handler
//
// 🚨 `query.data` alone never says which product this chat started with —
// the callback only fires after `/start` already ran, so the lead's own
// stored `product` (set once, at `/start`, by `productFor`) is looked up by
// `chatId` here rather than re-derived or guessed.
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  await bot.answerCallbackQuery(query.id);

  // Funnel answers arrive as "kind:value"; the legacy plain "timeline" button
  // (no value) still falls through to the switch below.
  const [kind, value] = (query.data || '').split(':');
  if (value && FUNNEL_NEXT[kind]) {
    await handleFunnelAnswer(chatId, kind, value);
    return;
  }

  let product = 'TOEFL';
  try {
    const lead = await Lead.findOne({ userId: chatId }, 'product').lean();
    if (lead && lead.product === 'DET') product = 'DET';
  } catch (err) {
    console.error('DB error reading lead product on callback:', err.message);
  }
  const isDet = product === 'DET';

  switch (query.data) {
    case 'how':
      // Answer + reveal button 2
      await bot.sendMessage(chatId, isDet ? DET_HOW_TEXT : HOW_TEXT, { reply_markup: BTN_2 });
      break;

    case 'timeline':
      try { await bot.deleteMessage(chatId, query.message.message_id); } catch (e) {}
      await bot.sendMessage(chatId, isDet ? DET_TIMELINE_TEXT : TIMELINE_TEXT, { reply_markup: BTN_3 });
      break;

    case 'price':
      try { await bot.deleteMessage(chatId, query.message.message_id); } catch (e) {}
      await bot.sendMessage(chatId, isDet ? DET_PRICE_TEXT : PRICE_TEXT);
      await bot.sendMessage(chatId, CONTACT_TEXT, { reply_markup: CONTACT_KEYBOARD });
      break;

    case 'share_contact':
      await bot.sendMessage(chatId, '📲 Telefon raqamingizni ulashing:', {
        reply_markup: {
          keyboard: [[{ text: '📲 Raqamni ulashish', request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      });
      break;

    default:
      break;
  }
});

// Phone step — shared by the contact button and a typed number.
async function acceptPhone(from, phone) {
  const userId   = from.id;
  const fullName = [from.first_name, from.last_name].filter(Boolean).join(' ');
  const username = from.username || 'yoq';

  // `{ new: true }` — sales-engine's own capture below needs this lead's
  // already-stored `adId`/`product` (set at /start), which this update does
  // not itself change; without `new: true`, findOneAndUpdate returns the
  // PRE-update doc (or null on a fresh upsert), silently losing them.
  let leadDoc = null;
  try {
    leadDoc = await Lead.findOneAndUpdate(
      { userId },
      { phone, fullName, username, step: 'purpose' },
      { upsert: true, new: true }
    );

    // Update phone in sales-bot DB for COMPANY HUB
    await SalesUser.findOneAndUpdate(
      { _id: userId },
      { phone_number: phone, last_message: new Date() },
      { upsert: true }
    );
  } catch (err) {
    console.error('DB error on contact:', err.message);
  }

  // Master Student Identity (identity-service) — fire-and-forget, never
  // awaited by anything that would delay this lead's own confirmation.
  void resolveLead({ userId, fullName, phone, username });
  // Sales Automation Engine (sales-engine) — same fire-and-forget discipline.
  void captureLead({
    userId,
    fullName,
    phone,
    username,
    adId: leadDoc?.adId,
    product: leadDoc?.product,
  });

  await bot.sendMessage(userId, '✅', { reply_markup: { remove_keyboard: true } });
  await bot.sendMessage(userId, ASK_PURPOSE, { reply_markup: optionsKeyboard(PURPOSE_OPTS, 'purpose') });

  if (ADMIN_CHAT_ID) {
    try {
      await bot.sendMessage(
        ADMIN_CHAT_ID,
        `📲 Yangi telefon raqam!\n\n` +
        `👤 ${fullName}\n` +
        `🔗 @${username}\n` +
        `📱 ${phone}\n` +
        `🆔 ID: ${userId}`
      );
    } catch (err) {
      console.error('Admin notify error:', err.message);
    }
  }
}

bot.on('contact', (msg) => acceptPhone(msg.from, msg.contact.phone_number));

// A typed number while the lead is on the phone step; any other text at that
// step just gets the phone request again.
bot.on('message', async (msg) => {
  if (msg.contact || !msg.text || msg.text.startsWith('/')) return;
  try {
    const lead = await Lead.findOne({ userId: msg.from.id }, 'step').lean();
    if (!lead || lead.step !== 'phone') return;
    const digits = msg.text.replace(/\D/g, '');
    if (digits.length < 9) {
      await bot.sendMessage(msg.chat.id, BAD_PHONE, { reply_markup: PHONE_KEYBOARD });
      return;
    }
    await acceptPhone(msg.from, msg.text.trim());
  } catch (err) {
    console.error('DB error on typed phone:', err.message);
  }
});

// purpose -> timeline -> level -> done
async function handleFunnelAnswer(chatId, kind, value) {
  const step = FUNNEL_NEXT[kind];
  try {
    const lead = await Lead.findOne({ userId: chatId }).lean();
    if (!lead || lead.step !== kind) return; // stale/duplicate tap
    const label = labelFor(step.opts, value);
    const updated = await Lead.findOneAndUpdate(
      { userId: chatId },
      { [step.field]: label, step: step.next },
      { new: true }
    );

    if (step.next !== 'done') {
      await bot.sendMessage(chatId, step.ask, { reply_markup: optionsKeyboard(step.nextOpts, step.next) });
      return;
    }

    await bot.sendMessage(chatId, DONE_TEXT);
    if (ADMIN_CHAT_ID) {
      await bot.sendMessage(
        ADMIN_CHAT_ID,
        `🔥 YANGI LEAD!\n` +
        `👤 ${updated.fullName}\n` +
        `📱 ${updated.phone}\n` +
        `💬 @${updated.username || 'yoq'}\n` +
        `🎯 ${updated.purpose}\n` +
        `📅 ${updated.timeline}\n` +
        `📶 ${updated.level}\n\n` +
        `🆔 ID: ${chatId}` +
        (updated.adId ? `\n📢 Reklama: ${updated.adId}` : '')
      );
    }
  } catch (err) {
    console.error('Funnel error:', err.message);
  }
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const WEBHOOK_PATH = `/bot${BOT_TOKEN}`;

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
    return;
  }

  if (req.method === 'POST' && req.url === WEBHOOK_PATH) {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        bot.processUpdate(JSON.parse(body));
        res.writeHead(200); res.end();
      } catch (err) {
        console.error('Bad update:', err.message);
        res.writeHead(400); res.end();
      }
    });
    return;
  }

  res.writeHead(404); res.end();
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  const WEBHOOK_URL = process.env.WEBHOOK_URL;
  if (WEBHOOK_URL) {
    bot.setWebHook(`${WEBHOOK_URL}${WEBHOOK_PATH}`)
      .then(() => console.log(`Webhook set: ${WEBHOOK_URL}${WEBHOOK_PATH}`))
      .catch((err) => console.error('Webhook error:', err.message));
  }
});
