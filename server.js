require('dotenv').config();
const http = require('http');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');
const Lead = require('./models/Lead');

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
  `💰 Narxi: $800\n\n` +
  `Narxga test davomida to'liq yordam kiradi.\n` +
  `To'lovni natijani qo'lingizga olgandan keyin qilasiz ✅`;

const CONTACT_TEXT =
  `📞 Biz bilan bog'lanish:\n\n` +
  `Qo'ng'iroq: ${ADMIN_PHONE || '+998335246820'}`;

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

  const fullName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ');
  const username = msg.from.username || null;
  const now = new Date();

  try {
    // Save to toefl-ads-bot DB
    await Lead.findOneAndUpdate(
      { userId },
      { userId, fullName, username, adId },
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

  // Welcome + only first button
  await bot.sendMessage(userId, WELCOME_TEXT, {
    reply_markup: BTN_1,
    disable_web_page_preview: true,
  });
});

// Inline button handler
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  await bot.answerCallbackQuery(query.id);

  switch (query.data) {
    case 'how':
      // Answer + reveal button 2
      await bot.sendMessage(chatId, HOW_TEXT, { reply_markup: BTN_2 });
      break;

    case 'timeline':
      try { await bot.deleteMessage(chatId, query.message.message_id); } catch (e) {}
      await bot.sendMessage(chatId, TIMELINE_TEXT, { reply_markup: BTN_3 });
      break;

    case 'price':
      try { await bot.deleteMessage(chatId, query.message.message_id); } catch (e) {}
      await bot.sendMessage(chatId, PRICE_TEXT);
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

// Contact share handler
bot.on('contact', async (msg) => {
  const userId   = msg.from.id;
  const phone    = msg.contact.phone_number;
  const fullName = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ');
  const username = msg.from.username || 'yoq';

  try {
    await Lead.findOneAndUpdate(
      { userId },
      { phone, fullName, username },
      { upsert: true }
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

  await bot.sendMessage(userId, "✅ Rahmat! Tez orada siz bilan bog'lanamiz 😊", {
    reply_markup: { remove_keyboard: true },
  });

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
});

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
