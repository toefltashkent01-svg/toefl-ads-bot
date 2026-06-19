require('dotenv').config();
const http = require('http');
const mongoose = require('mongoose');
const TelegramBot = require('node-telegram-bot-api');

const { BOT_TOKEN, MONGODB_URI, PORT = 3000 } = process.env;

if (!BOT_TOKEN) throw new Error('BOT_TOKEN is required');
if (!MONGODB_URI) throw new Error('MONGODB_URI is required');

// Connect to MongoDB
mongoose
  .connect(MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch((err) => {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  });

// Initialize bot without built-in server — we manage the HTTP layer ourselves
const bot = new TelegramBot(BOT_TOKEN, { polling: false });

// /start command handler — log the update, no business logic yet
bot.onText(/\/start/, (msg) => {
  console.log('[/start] Incoming update:', JSON.stringify(msg, null, 2));
});

// Single HTTP server: handles Telegram webhook POST + Railway health-check GET
const WEBHOOK_PATH = `/bot${BOT_TOKEN}`;

const server = http.createServer((req, res) => {
  // Health check
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
    return;
  }

  // Telegram webhook
  if (req.method === 'POST' && req.url === WEBHOOK_PATH) {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const update = JSON.parse(body);
        bot.processUpdate(update);
        res.writeHead(200);
        res.end();
      } catch (err) {
        console.error('Failed to parse update:', err.message);
        res.writeHead(400);
        res.end();
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  console.log(`Webhook endpoint: POST ${WEBHOOK_PATH}`);

  // Register webhook with Telegram if WEBHOOK_URL is set
  const WEBHOOK_URL = process.env.WEBHOOK_URL;
  if (WEBHOOK_URL) {
    bot
      .setWebHook(`${WEBHOOK_URL}${WEBHOOK_PATH}`)
      .then(() => console.log(`Webhook registered: ${WEBHOOK_URL}${WEBHOOK_PATH}`))
      .catch((err) => console.error('Failed to set webhook:', err.message));
  } else {
    console.warn('WEBHOOK_URL not set — register the webhook manually via Telegram API');
  }
});
