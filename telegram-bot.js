require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

const users = {};

bot.onText(/\/start/, (msg) => {
  const id = msg.chat.id;
  users[id] = users[id] || { access: false };
  bot.sendMessage(id,
    "🇺🇿🇬🇧 English UZ botga xush kelibsiz!\n\n" +
    "📖 /darslar — darslarni ko'rish\n" +
    "💳 /tolov — to'lov ($2)\n" +
    "📊 /progress — mening holatim",
  );
});

bot.onText(/\/tolov/, (msg) => {
  const id = msg.chat.id;
  const card = process.env.CARD_NUMBER || "0000 0000 0000 0000";
  const owner = process.env.CARD_OWNER || "Ism Familiya";
  const bank = process.env.CARD_BANK || "Bank";
  bot.sendMessage(id,
    "💳 To'lov uchun kartaga o'tkazing:\n\n" +
    "💳 " + card + "\n" +
    "👤 " + owner + "\n" +
    "🏦 " + bank + "\n" +
    "💰 25 600 so'm\n\n" +
    "O'tkazmadan so'ng skrinshotni yuboring!",
  );
});

bot.onText(/\/darslar/, (msg) => {
  const id = msg.chat.id;
  bot.sendMessage(id,
    "📚 Mavzular:\n\n" +
    "1. 👋 Salomlashish\n" +
    "2. 🔢 Raqamlar\n" +
    "3. 🎨 Ranglar\n" +
    "4. 👨‍👩‍👧 Oila\n" +
    "5. 🏙️ Shahar\n" +
    "6. 🌅 Kundalik hayot\n\n" +
    "/dars1 yoki /dars2 yozing",
  );
});

bot.onText(/\/dars1/, (msg) => {
  bot.sendMessage(msg.chat.id,
    "👋 SALOMLASHISH\n\n" +
    "🇺🇿 Salom = 🇬🇧 Hello\n" +
    "🇺🇿 Xayr = 🇬🇧 Goodbye\n" +
    "🇺🇿 Rahmat = 🇬🇧 Thank you\n" +
    "🇺🇿 Iltimos = 🇬🇧 Please\n" +
    "🇺🇿 Xayrli tong = 🇬🇧 Good morning\n\n" +
    "Keyingi dars: /dars2",
  );
});

bot.onText(/\/dars2/, (msg) => {
  bot.sendMessage(msg.chat.id,
    "🔢 RAQAMLAR\n\n" +
    "🇺🇿 Bir = 🇬🇧 One\n" +
    "🇺🇿 Ikki = 🇬🇧 Two\n" +
    "🇺🇿 Uch = 🇬🇧 Three\n" +
    "🇺🇿 To'rt = 🇬🇧 Four\n" +
    "🇺🇿 Besh = 🇬🇧 Five\n\n" +
    "Keyingi dars: /dars3",
  );
});

bot.onText(/\/dars3/, (msg) => {
  bot.sendMessage(msg.chat.id,
    "🎨 RANGLAR\n\n" +
    "🇺🇿 Qizil = 🇬🇧 Red\n" +
    "🇺🇿 Ko'k = 🇬🇧 Blue\n" +
    "🇺🇿 Yashil = 🇬🇧 Green\n" +
    "🇺🇿 Sariq = 🇬🇧 Yellow\n" +
    "🇺🇿 Oq = 🇬🇧 White\n\n" +
    "Keyingi dars: /dars4",
  );
});

bot.onText(/\/progress/, (msg) => {
  bot.sendMessage(msg.chat.id, "📊 Siz o'qimoqdasiz! Davom eting 💪");
});

bot.on("photo", (msg) => {
  const adminId = process.env.ADMIN_ID;
  if (adminId) {
    bot.sendMessage(adminId,
      "📸 Skrinshot keldi!\n" +
      "👤 " + (msg.from.first_name || "") + "\n" +
      "🆔 " + msg.from.id + "\n\n" +
      "Kirish berish uchun:\n/approve " + msg.from.id
    );
    bot.forwardMessage(adminId, msg.chat.id, msg.message_id);
  }
  bot.sendMessage(msg.chat.id, "✅ Skrinshot qabul qilindi! Tez orada kirish ochamiz.");
});

bot.onText(/\/approve (\d+)/, (msg, match) => {
  if (String(msg.from.id) !== String(process.env.ADMIN_ID)) return;
  const targetId = match[1];
  users[targetId] = { access: true };
  bot.sendMessage(msg.chat.id, "✅ Kirish berildi: " + targetId);
  bot.sendMessage(parseInt(targetId), "🎉 To'lovingiz tasdiqlandi!\n\nBarcha darslar ochiq!\n/darslar");
});

console.log("🤖 English UZ Bot ishga tushdi!");
