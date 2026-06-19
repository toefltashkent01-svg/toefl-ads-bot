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

// ── Static content (edit these freely) ──────────────────────────────────────

const WELCOME_TEXT =
  `TOEFL Tashkent jamoasi shu kungacha 600+ studentga sertifikat olishda yordam bergan ✅\n\n` +
  `📢 Kanalimiz: https://t.me/${CHANNEL_USERNAME || 'toefltashkent1'}\n\n` +
  `Quyidagilardan birini tanlang:`;

const HOW_TO_GET_TEXT =
  `🎓 Qanday qilib olsa bo'ladi?\n\n` +
  `[Bu qismni keyinroq to'ldirasiz]`;

const TIMELINE_TEXT =
  `⏳ Qancha vaqtda tayyorlanish mumkin?\n\n` +
  `• Ingliz tilini umuman bilmasangiz → 2 haftada\n` +
  `• Boshlang'ich daraja bo'lsa → 10 kunda\n` +
  `• B1-B2 darajasi bo'lsa → 1 haftada`;

const PRICE_TEXT =
  `💰 Xizmat narxi: $800\n\n` +
  `Narxga nima kiradi:\n` +
  `[Bu qismni keyinroq to'ldirasiz]`;

const CONTACT_TEXT = `📞 Biz bilan bog'lanish:`;

// ── Keyboards ────────────────────────────────────────────────────────────────

const BACK_ROW = [{ text: '⬅️ Orqaga', callback_data: 'back_main' }];

const MAIN_KEYBOARD = {
  inline_keyboard: [
    [{ text: "🎓 Qanday qilib olsa bo'ladi?",          callback_data: 'how_to_get' }],
    [{ text: '⏳ Qancha vaqtda tayyorlanish mumkin?',   callback_data: 'timeline'   }],
    [{ text: '💰 Narxi qancha?',                        callback_data: 'price'      }],
    [{ text: "📞 Bog'lanish",                           callback_data: 'contact'    }],
  ],
};

const contactKeyboard = () => ({
  inline_keyboard: [
    [{ text: '💬 Telegram orqali',      url: `https://t.me/${ADMIN_USERNAME || 'TOEFLadmint'}` }],
    [{ text: '📞 Qo\'ng\'iroq qilish',  url: `tel:${ADMIN_PHONE || '+998335246820'}`           }],
    [{ text: '📲 Telefon raqam qoldirish', callback_data: 'share_contact' }],
    [BACK_ROW[0]],
  ],
});

// ── MongoDB ──────────────────────────────────────────────────────────────────

mongoose
  .connect(MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch((err) => { console.error('MongoDB error:', err.message); process.exit(1); });

// ── Bot ──────────────────────────────────────────────────────────────────────

const bot = new TelegramBot(BOT_TOKEN, { polling: false });

// /start — deep-link payload becomes the adId
bot.onText(/\/start ?(.*)/, async (msg, match) => {
  const userId = msg.from.id;
  const adId   = match[1].trim() || null;

  try {
    await Lead.findOneAndUpdate(
      { userId },
      {
        userId,
        fullName: [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' '),
        username: msg.from.username || null,
        adId,
      },
      { upsert: true, new: true }
    );

    if (ADMIN_CHAT_ID) {
      await bot.sendMessage(
        ADMIN_CHAT_ID,
        `🆕 Yangi foydalanuvchi!\n` +
        `👤 ${[msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ')}\n` +
        `🔗 @${msg.from.username || 'yoq'}\n` +
        `🆔 ID: ${userId}` +
        (adId ? `\n📢 Reklama: ${adId}` : '')
      );
    }
  } catch (err) {
    console.error('DB error on /start:', err.message);
  }

  await bot.sendMessage(userId, WELCOME_TEXT, { reply_markup: MAIN_KEYBOARD });
});

// Inline button handler
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const msgId  = query.message.message_id;
  await bot.answerCallbackQuery(query.id);

  const edit = (text, keyboard) =>
    bot.editMessageText(text, {
      chat_id: chatId, message_id: msgId,
      reply_markup: { inline_keyboard: [...(keyboard || []), BACK_ROW] },
    });

  switch (query.data) {
    case 'how_to_get':
      await edit(HOW_TO_GET_TEXT);
      break;

    case 'timeline':
      await edit(TIMELINE_TEXT);
      break;

    case 'price':
      await edit(PRICE_TEXT);
      break;

    case 'contact':
      await bot.editMessageText(CONTACT_TEXT, {
        chat_id: chatId, message_id: msgId,
        reply_markup: contactKeyboard(),
      });
      break;

    case 'back_main':
      await bot.editMessageText(WELCOME_TEXT, {
        chat_id: chatId, message_id: msgId,
        reply_markup: MAIN_KEYBOARD,
      });
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
      console.error('Failed to notify admin:', err.message);
    }
  }
});

// ── HTTP server (webhook + health check) ─────────────────────────────────────

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
  } else {
    console.warn('WEBHOOK_URL not set — set it after Railway deploy');
  }
});
