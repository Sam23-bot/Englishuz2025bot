// ╔══════════════════════════════════════════════════════════════╗
// ║        English UZ — Telegram Bot                            ║
// ║  Dars beradi · Click orqali to'lov · Avtomatik kirish      ║
// ╚══════════════════════════════════════════════════════════════╝

require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const express     = require("express");
const crypto      = require("crypto");
const Database    = require("better-sqlite3");

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── БАЗА ДАННЫХ ────────────────────────────────────────────────────
const db = new Database("./englishuz.db");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY,   -- Telegram user ID
    username     TEXT,
    first_name   TEXT,
    has_access   INTEGER DEFAULT 0,
    quiz_unit    INTEGER DEFAULT 0,
    quiz_idx     INTEGER DEFAULT 0,
    quiz_score   INTEGER DEFAULT 0,
    lesson_unit  INTEGER DEFAULT 0,
    lesson_word  INTEGER DEFAULT 0,
    joined_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS orders (
    id           TEXT PRIMARY KEY,
    user_id      INTEGER,
    amount       REAL,
    status       TEXT DEFAULT 'pending',
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    paid_at      DATETIME
  );
`);

const getUser  = id  => db.prepare("SELECT * FROM users WHERE id = ?").get(id);
const setField = (id, field, val) =>
  db.prepare(`UPDATE users SET ${field} = ? WHERE id = ?`).run(val, id);

function ensureUser(msg) {
  const { id, username, first_name } = msg.from;
  if (!getUser(id)) {
    db.prepare("INSERT INTO users (id, username, first_name) VALUES (?,?,?)")
      .run(id, username || "", first_name || "");
  }
  return getUser(id);
}

// ─── КОНТЕНТ: УРОКИ ─────────────────────────────────────────────────
const UNITS = [
  {
    id: 0, emoji: "👋", title: "Salomlashish", titleEn: "Greetings",
    words: [
      { uz: "Salom",       en: "Hello",        ex: "Hello! My name is Amir." },
      { uz: "Xayr",        en: "Goodbye",      ex: "Goodbye! See you tomorrow." },
      { uz: "Rahmat",      en: "Thank you",    ex: "Thank you very much!" },
      { uz: "Iltimos",     en: "Please",       ex: "Please help me." },
      { uz: "Xayrli tong", en: "Good morning", ex: "Good morning! How are you?" },
    ],
    quiz: [
      { q: "\"Salom\" inglizcha?",       opts: ["Hello","Goodbye","Thanks","Please"], ans: 0 },
      { q: "\"Thank you\" o'zbekcha?",   opts: ["Salom","Xayr","Rahmat","Iltimos"],  ans: 2 },
      { q: "\"Good morning\" o'zbekcha?",opts: ["Xayrli kech","Xayrli tong","Xayrli kun","Salom"], ans: 1 },
    ]
  },
  {
    id: 1, emoji: "🔢", title: "Raqamlar", titleEn: "Numbers",
    words: [
      { uz: "Bir",   en: "One",   ex: "I have one cat." },
      { uz: "Ikki",  en: "Two",   ex: "Two plus two is four." },
      { uz: "Uch",   en: "Three", ex: "I have three brothers." },
      { uz: "To'rt", en: "Four",  ex: "Four seasons in a year." },
      { uz: "Besh",  en: "Five",  ex: "Five fingers on each hand." },
    ],
    quiz: [
      { q: "\"Besh\" inglizcha?",   opts: ["Four","Five","Six","Three"],  ans: 1 },
      { q: "\"Three\" o'zbekcha?",  opts: ["Ikki","Bir","Uch","To'rt"],   ans: 2 },
      { q: "\"Two\" o'zbekcha?",    opts: ["Uch","Besh","Bir","Ikki"],    ans: 3 },
    ]
  },
  {
    id: 2, emoji: "🎨", title: "Ranglar", titleEn: "Colors",
    words: [
      { uz: "Qizil",  en: "Red",    ex: "The apple is red." },
      { uz: "Ko'k",   en: "Blue",   ex: "The sky is blue." },
      { uz: "Yashil", en: "Green",  ex: "The grass is green." },
      { uz: "Sariq",  en: "Yellow", ex: "The sun is yellow." },
      { uz: "Oq",     en: "White",  ex: "Snow is white." },
    ],
    quiz: [
      { q: "\"Ko'k\" inglizcha?",  opts: ["Green","Red","Blue","Yellow"], ans: 2 },
      { q: "\"Red\" o'zbekcha?",   opts: ["Ko'k","Qizil","Sariq","Oq"],  ans: 1 },
      { q: "\"Yellow\" o'zbekcha?",opts: ["Oq","Yashil","Ko'k","Sariq"], ans: 3 },
    ]
  },
  {
    id: 3, emoji: "👨‍👩‍👧", title: "Oila", titleEn: "Family",
    words: [
      { uz: "Ona",         en: "Mother",      ex: "My mother is very kind." },
      { uz: "Ota",         en: "Father",      ex: "My father works in the city." },
      { uz: "Aka / Uka",   en: "Brother",     ex: "I have two brothers." },
      { uz: "Opa / Singil",en: "Sister",      ex: "My sister is a doctor." },
      { uz: "Bobo",        en: "Grandfather", ex: "My grandfather is 70 years old." },
    ],
    quiz: [
      { q: "\"Ona\" inglizcha?",     opts: ["Father","Sister","Brother","Mother"],    ans: 3 },
      { q: "\"Brother\" o'zbekcha?", opts: ["Singil","Bobo","Aka / Uka","Ona"],       ans: 2 },
      { q: "\"Grandfather\"?",       opts: ["Bobo","Buvi","Ota","Aka"],               ans: 0 },
    ]
  },
  {
    id: 4, emoji: "🏙️", title: "Shahar", titleEn: "City",
    words: [
      { uz: "Do'kon",    en: "Shop",       ex: "The shop is near here." },
      { uz: "Kasalxona", en: "Hospital",   ex: "The hospital is on the main street." },
      { uz: "Maktab",    en: "School",     ex: "Children go to school at 8 AM." },
      { uz: "Bank",      en: "Bank",       ex: "I need to go to the bank today." },
      { uz: "Ko'cha",    en: "Street",     ex: "Walk down this street." },
    ],
    quiz: [
      { q: "\"Maktab\" inglizcha?",    opts: ["Bank","Hospital","School","Shop"],   ans: 2 },
      { q: "\"Street\" o'zbekcha?",    opts: ["Do'kon","Ko'cha","Bank","Maktab"],   ans: 1 },
      { q: "\"Hospital\" o'zbekcha?",  opts: ["Kasalxona","Maktab","Bank","Ko'cha"],ans: 0 },
    ]
  },
  {
    id: 5, emoji: "🌅", title: "Kundalik hayot", titleEn: "Daily Life",
    words: [
      { uz: "Ovqat yemoq", en: "To eat",   ex: "I eat breakfast every morning." },
      { uz: "Ichmoq",      en: "To drink", ex: "She drinks water every day." },
      { uz: "O'qimoq",     en: "To study", ex: "He studies English every day." },
      { uz: "Ishlash",     en: "To work",  ex: "She works in a hospital." },
      { uz: "Gapirmoq",    en: "To speak", ex: "Can you speak English?" },
    ],
    quiz: [
      { q: "\"O'qimoq\" inglizcha?",  opts: ["To eat","To sleep","To study","To work"],  ans: 2 },
      { q: "\"To speak\" o'zbekcha?", opts: ["Yozmoq","Gapirmoq","Yurishmoq","Ichmoq"], ans: 1 },
      { q: "\"To work\" o'zbekcha?",  opts: ["O'qimoq","Uxlamoq","Ishlash","Ichmoq"],   ans: 2 },
    ]
  },
];

const FREE_UNITS = 1;  // первый урок бесплатно

// ─── УТИЛИТЫ ────────────────────────────────────────────────────────
const md5 = s => crypto.createHash("md5").update(s).digest("hex");

function genOrderId(userId) {
  return `EUZ-${userId}-${Date.now()}`;
}

function buildClickUrl(orderId, amount) {
  const p = new URLSearchParams({
    service_id:        process.env.CLICK_SERVICE_ID,
    merchant_id:       process.env.CLICK_MERCHANT_ID,
    amount,
    transaction_param: orderId,
    return_url:        process.env.BOT_URL + "/payment/success",
  });
  return `https://my.click.uz/services/pay?${p}`;
}

// ─── ФОРМАТИРОВАНИЕ СООБЩЕНИЙ ────────────────────────────────────────
function wordMsg(unit, wordIdx) {
  const w = unit.words[wordIdx];
  const num = wordIdx + 1;
  const total = unit.words.length;
  return (
    `${unit.emoji} *${unit.title}* — so'z ${num}/${total}\n\n` +
    `🇺🇿 *${w.uz}*\n` +
    `🇬🇧 *${w.en}*\n\n` +
    `💬 _${w.ex}_`
  );
}

function quizMsg(unit, qIdx) {
  const q = unit.quiz[qIdx];
  return (
    `✏️ *Test* — savol ${qIdx + 1}/${unit.quiz.length}\n\n` +
    `❓ ${q.q}`
  );
}

function quizKeyboard(unit, qIdx) {
  const q = unit.quiz[qIdx];
  return {
    inline_keyboard: q.opts.map((opt, i) => [{
      text: opt,
      callback_data: `quiz_${unit.id}_${qIdx}_${i}`
    }])
  };
}

function unitsKeyboard(user) {
  const rows = UNITS.map(u => {
    const locked = u.id >= FREE_UNITS && !user.has_access;
    return [{
      text: locked ? `🔒 ${u.emoji} ${u.title}` : `${u.emoji} ${u.title}`,
      callback_data: locked ? "locked" : `unit_${u.id}`
    }];
  });
  return { inline_keyboard: rows };
}

// ─── КОМАНДА /start ──────────────────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
  const user = ensureUser(msg);
  const chat = msg.chat.id;

  await bot.sendMessage(chat,
    `🇺🇿🇬🇧 *English UZ*ga xush kelibsiz!\n\n` +
    `Bu bot orqali ingliz tilini o'rganasiz:\n` +
    `📖 So'z kartalari\n` +
    `✏️ Testlar\n` +
    `📊 Progress kuzatuvi\n\n` +
    `*1-dars bepul!* Keyingi darslar uchun to'lov kerak.\n\n` +
    `Quyidagi tugmani bosing:`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "📖 Darslarni ko'rish", callback_data: "show_units" }],
          [{ text: "💳 To'lov — $2", callback_data: "buy" }],
        ]
      }
    }
  );
});

// ─── КОМАНДА /darslar ────────────────────────────────────────────────
bot.onText(/\/darslar/, async (msg) => {
  const user = ensureUser(msg);
  await bot.sendMessage(msg.chat.id, "📚 *Mavzular:*", {
    parse_mode: "Markdown",
    reply_markup: unitsKeyboard(user)
  });
});

// ─── КОМАНДА /tolov ──────────────────────────────────────────────────
bot.onText(/\/tolov/, async (msg) => {
  const user = ensureUser(msg);
  await sendPaymentMessage(msg.chat.id, user.id);
});

// ─── КОМАНДА /progress ───────────────────────────────────────────────
bot.onText(/\/progress/, async (msg) => {
  const user = ensureUser(msg);
  const chat = msg.chat.id;
  const access = user.has_access ? "✅ To'liq kirish" : `⚠️ Faqat ${FREE_UNITS}-dars bepul`;

  await bot.sendMessage(chat,
    `📊 *Sizning progressingiz*\n\n` +
    `👤 ${user.first_name || "Foydalanuvchi"}\n` +
    `🔓 Kirish: ${access}\n` +
    `📚 Jami mavzular: ${UNITS.length}\n\n` +
    (user.has_access ? "Barcha darslar ochiq! Davom eting 💪" : "Barcha darslar uchun $2 to'lang 👇"),
    {
      parse_mode: "Markdown",
      reply_markup: user.has_access ? undefined : {
        inline_keyboard: [[{ text: "💳 $2 to'lash", callback_data: "buy" }]]
      }
    }
  );
});

// ─── CALLBACK HANDLER ────────────────────────────────────────────────
bot.on("callback_query", async (cb) => {
  const msg   = cb.message;
  const chat  = msg.chat.id;
  const data  = cb.data;
  const user  = ensureUser({ from: cb.from, chat });

  await bot.answerCallbackQuery(cb.id);

  // Показать список уроков
  if (data === "show_units") {
    return bot.sendMessage(chat, "📚 *Mavzuni tanlang:*", {
      parse_mode: "Markdown",
      reply_markup: unitsKeyboard(user)
    });
  }

  // Заблокированный урок
  if (data === "locked") {
    return bot.sendMessage(chat,
      `🔒 Bu dars to'liq versiyada mavjud.\n\n` +
      `*Barcha darslar* — atigi *$2* (25 600 so'm)`,
      {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [[{ text: "💳 $2 to'lash", callback_data: "buy" }]] }
      }
    );
  }

  // Выбор урока
  if (data.startsWith("unit_")) {
    const unitId = parseInt(data.split("_")[1]);
    const unit = UNITS[unitId];
    if (!unit) return;

    setField(user.id, "lesson_unit", unitId);
    setField(user.id, "lesson_word", 0);

    await bot.sendMessage(chat,
      `${unit.emoji} *${unit.title}* — ${unit.titleEn}\n\n` +
      `${unit.words.length} ta so'z · ${unit.quiz.length} ta test savoli\n\n` +
      `Boshamizmi?`,
      {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: [[{ text: "📖 Boshlash", callback_data: `word_${unitId}_0` }]] }
      }
    );
    return;
  }

  // Слово урока
  if (data.startsWith("word_")) {
    const [, unitId, wordIdx] = data.split("_").map(Number);
    const unit = UNITS[unitId];
    if (!unit) return;

    const isLast = wordIdx === unit.words.length - 1;
    const keyboard = isLast
      ? { inline_keyboard: [[{ text: "✏️ Testni boshlash", callback_data: `startquiz_${unitId}` }]] }
      : { inline_keyboard: [[
          { text: "➡️ Keyingi", callback_data: `word_${unitId}_${wordIdx + 1}` },
          { text: "⏭️ Testga o'tish", callback_data: `startquiz_${unitId}` },
        ]] };

    await bot.sendMessage(chat, wordMsg(unit, wordIdx), {
      parse_mode: "Markdown",
      reply_markup: keyboard
    });
    return;
  }

  // Начало теста
  if (data.startsWith("startquiz_")) {
    const unitId = parseInt(data.split("_")[1]);
    const unit = UNITS[unitId];
    if (!unit) return;

    setField(user.id, "quiz_unit",  unitId);
    setField(user.id, "quiz_idx",   0);
    setField(user.id, "quiz_score", 0);

    await bot.sendMessage(chat, quizMsg(unit, 0), {
      parse_mode: "Markdown",
      reply_markup: quizKeyboard(unit, 0)
    });
    return;
  }

  // Ответ на вопрос теста
  if (data.startsWith("quiz_")) {
    const [, unitId, qIdx, chosen] = data.split("_").map(Number);
    const unit   = UNITS[unitId];
    const q      = unit?.quiz[qIdx];
    if (!unit || !q) return;

    const correct  = chosen === q.ans;
    const freshUser = getUser(user.id);
    const newScore  = (freshUser.quiz_score || 0) + (correct ? 1 : 0);
    const nextIdx   = qIdx + 1;
    const isLast    = nextIdx >= unit.quiz.length;

    setField(user.id, "quiz_score", newScore);

    const feedback = correct
      ? `✅ *To'g'ri!* "${q.opts[q.ans]}" — ${unit.words.find(w => w.en === q.opts[q.ans])?.uz || ""}`
      : `❌ *Noto'g'ri.* To'g'ri javob: *${q.opts[q.ans]}*`;

    await bot.sendMessage(chat, feedback, { parse_mode: "Markdown" });

    if (isLast) {
      const pct   = Math.round(newScore / unit.quiz.length * 100);
      const pass  = newScore >= Math.ceil(unit.quiz.length * 0.6);
      const stars = pass ? "⭐⭐⭐" : newScore > 0 ? "⭐" : "";
      await bot.sendMessage(chat,
        `🏁 *Test yakunlandi!*\n\n` +
        `${stars}\n` +
        `Natija: *${newScore}/${unit.quiz.length}* (${pct}%)\n\n` +
        (pass ? "🎉 Ajoyib! Keyingi mavzuga o'ting!" : "💪 Qayta urinib ko'ring!"),
        {
          parse_mode: "Markdown",
          reply_markup: { inline_keyboard: [
            [{ text: pass ? "➡️ Keyingi mavzu" : "🔄 Qayta", callback_data: pass ? `unit_${unitId + 1 < UNITS.length ? unitId + 1 : 0}` : `startquiz_${unitId}` }],
            [{ text: "📚 Barcha mavzular", callback_data: "show_units" }],
          ]}
        }
      );
    } else {
      await bot.sendMessage(chat, quizMsg(unit, nextIdx), {
        parse_mode: "Markdown",
        reply_markup: quizKeyboard(unit, nextIdx)
      });
    }
    return;
  }

  // Купить
  if (data === "buy") {
    return sendPaymentMessage(chat, user.id);
  }

  // Показать карту
  if (data.startsWith("card_")) {
    const orderId = data.replace("card_", "");
    return sendCardDetails(chat, orderId);
  }

  // Пользователь нажал "Скриншот отправил"
  if (data.startsWith("screenshot_")) {
    const orderId = data.replace("screenshot_", "");
    db.prepare("UPDATE orders SET status='awaiting' WHERE id=?").run(orderId);

    // Уведомление администратору
    const adminId = process.env.ADMIN_ID;
    if (adminId) {
      const u = getUser(user.id);
      const name = u.first_name || "Noma'lum";
      const uname = u.username ? `@${u.username}` : `ID: ${user.id}`;
      await bot.sendMessage(adminId,
        `🔔 *Yangi to'lov so'rovi!*\n\n` +
        `👤 ${name} (${uname})\n` +
        `🆔 User ID: \`${user.id}\`\n` +
        `📦 Buyurtma: \`${orderId}\`\n` +
        `💰 Summa: 25 600 so'm\n\n` +
        `Kirish berish uchun:\n` +
        `/approve ${user.id}`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [[
              { text: "✅ Tasdiqlash", callback_data: `approve_${user.id}_${orderId}` },
              { text: "❌ Rad etish",  callback_data: `reject_${user.id}` },
            ]]
          }
        }
      );
    }

    return bot.sendMessage(chat,
      `✅ *Rahmat!*\n\n` +
      `So'rovingiz qabul qilindi.\n` +
      `⏱ Tez orada kirish ochamiz (5–15 daqiqa).\n\n` +
      `Kuting, xabar yuboramiz! 🙏`,
      { parse_mode: "Markdown" }
    );
  }

  // Админ одобряет через кнопку
  if (data.startsWith("approve_")) {
    if (String(cb.from.id) !== String(process.env.ADMIN_ID)) return;
    const [, targetId, orderId] = data.split("_");
    db.prepare("UPDATE users  SET has_access=1           WHERE id=?").run(targetId);
    db.prepare("UPDATE orders SET status='paid', paid_at=CURRENT_TIMESTAMP WHERE id=?").run(orderId);
    await bot.answerCallbackQuery(cb.id, { text: "✅ Kirish berildi!" });
    await bot.sendMessage(chat, `✅ User ${targetId} ga kirish berildi.`);
    try {
      await bot.sendMessage(parseInt(targetId),
        `🎉 *To'lovingiz tasdiqlandi!*\n\n` +
        `Barcha darslar ochiq!\n` +
        `📚 Boshlash uchun /darslar`,
        { parse_mode: "Markdown" }
      );
    } catch {}
    return;
  }

  // Админ отклоняет
  if (data.startsWith("reject_")) {
    if (String(cb.from.id) !== String(process.env.ADMIN_ID)) return;
    const targetId = data.split("_")[1];
    await bot.answerCallbackQuery(cb.id, { text: "❌ Rad etildi" });
    try {
      await bot.sendMessage(parseInt(targetId),
        `❌ *To'lov tasdiqlanmadi.*\n\n` +
        `Iltimos, qaytadan to'lov qiling yoki admin bilan bog'laning.`,
        { parse_mode: "Markdown" }
      );
    } catch {}
    return;
  }
});

// ─── ПЛАТЁЖНАЯ ССЫЛКА ────────────────────────────────────────────────
async function sendPaymentMessage(chat, userId) {
  const orderId = genOrderId(userId);
  const amount  = 2;

  try {
    db.prepare("INSERT OR IGNORE INTO orders (id, user_id, amount) VALUES (?,?,?)")
      .run(orderId, userId, amount);
  } catch {}

  const url = buildClickUrl(orderId, amount);

  await bot.sendMessage(chat,
    `💳 *To'lov usulini tanlang*\n\n` +
    `📦 *English UZ — To'liq kurs*\n` +
    `💰 Narxi: *25 600 so'm* ($2)\n\n` +
    `✅ Nimalar kiradi:\n` +
    `• 6 ta mavzu · 30+ so'z\n` +
    `• Barcha testlar\n` +
    `• Doimiy kirish`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🏦 Karta raqamiga o'tkazish", callback_data: `card_${orderId}` }],
          [{ text: "💳 Click orqali to'lash",      url }],
          [{ text: "✅ To'lovni tekshirish",        callback_data: `check_${orderId}` }],
        ]
      }
    }
  );
}

// ─── КАРТОЧНЫЙ ПЛАТЁЖ ────────────────────────────────────────────────
async function sendCardDetails(chat, orderId) {
  const CARD   = process.env.CARD_NUMBER  || "0000 0000 0000 0000";
  const OWNER  = process.env.CARD_OWNER   || "Ism Familiya";
  const BANK   = process.env.CARD_BANK    || "Bank nomi";
  const AMOUNT = "25 600 so'm";

  await bot.sendMessage(chat,
    `🏦 *Karta orqali to'lash*\n\n` +
    `Quyidagi kartaga pul o'tkazing:\n\n` +
    `┌─────────────────────────┐\n` +
    `│ 💳 *${CARD}*\n` +
    `│ 👤 ${OWNER}\n` +
    `│ 🏦 ${BANK}\n` +
    `│ 💰 *${AMOUNT}*\n` +
    `└─────────────────────────┘\n\n` +
    `*O'tkazmadan so'ng:*\n` +
    `📸 To'lov skrinshotini shu yerga yuboring\n` +
    `⏱ 5–15 daqiqa ichida kirish ochamiz`,
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [[
          { text: "📸 Skrinshot yubordim", callback_data: `screenshot_${orderId}` }
        ]]
      }
    }
  );
}

// ─── CLICK WEBHOOK ───────────────────────────────────────────────────
function verifySign(body, action) {
  const KEY = process.env.CLICK_SECRET_KEY;
  const sig = action === 0
    ? md5(`${body.click_trans_id}${body.service_id}${KEY}${body.merchant_trans_id}${body.amount}${body.action}${body.sign_time}`)
    : md5(`${body.click_trans_id}${body.service_id}${KEY}${body.merchant_trans_id}${body.merchant_prepare_id}${body.amount}${body.action}${body.sign_time}`);
  return sig === body.sign_string;
}

app.post("/click/prepare", (req, res) => {
  const d = req.body;
  if (!verifySign(d, 0)) return res.json({ error: -1, error_note: "SIGN CHECK FAILED!" });

  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(d.merchant_trans_id);
  if (!order)                         return res.json({ error: -5, error_note: "Order not found" });
  if (order.status === "paid")        return res.json({ error: -4, error_note: "Already paid" });
  if (Math.abs(order.amount - parseFloat(d.amount)) > 0.1)
    return res.json({ error: -2, error_note: "Wrong amount" });

  db.prepare("UPDATE orders SET status='processing' WHERE id=?").run(order.id);
  res.json({ click_trans_id: d.click_trans_id, merchant_trans_id: d.merchant_trans_id, merchant_prepare_id: Date.now(), error: 0, error_note: "Success" });
});

app.post("/click/complete", async (req, res) => {
  const d = req.body;
  if (!verifySign(d, 1)) return res.json({ error: -1, error_note: "SIGN CHECK FAILED!" });
  if (parseInt(d.error) < 0) {
    db.prepare("UPDATE orders SET status='cancelled' WHERE id=?").run(d.merchant_trans_id);
    return res.json({ error: 0, error_note: "Success" });
  }

  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(d.merchant_trans_id);
  if (!order)              return res.json({ error: -5, error_note: "Order not found" });
  if (order.status === "paid") return res.json({ error: -4, error_note: "Already paid" });

  db.prepare("UPDATE orders SET status='paid', paid_at=CURRENT_TIMESTAMP WHERE id=?").run(order.id);
  db.prepare("UPDATE users SET has_access=1 WHERE id=?").run(order.user_id);

  // Уведомление в Telegram
  try {
    await bot.sendMessage(order.user_id,
      `🎉 *To'lov qabul qilindi!*\n\n` +
      `Tabriklaymiz! Siz endi *barcha darslar*ga kirishingiz mumkin.\n\n` +
      `📚 Boshlash uchun /darslar ni bosing!`,
      { parse_mode: "Markdown" }
    );
  } catch (e) { console.error("[BOT SEND ERROR]", e.message); }

  res.json({ click_trans_id: d.click_trans_id, merchant_trans_id: d.merchant_trans_id, merchant_confirm_id: Date.now(), error: 0, error_note: "Success" });
});

// ─── ПРОВЕРКА ОПЛАТЫ ─────────────────────────────────────────────────
bot.on("callback_query", async (cb) => {
  if (!cb.data?.startsWith("check_")) return;
  const orderId = cb.data.replace("check_", "");
  const order   = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId);

  await bot.answerCallbackQuery(cb.id);

  if (order?.status === "paid") {
    db.prepare("UPDATE users SET has_access=1 WHERE id=?").run(cb.from.id);
    await bot.sendMessage(cb.message.chat.id,
      `✅ *To'lov tasdiqlandi!*\n\nBarcha darslar ochiq. /darslar`,
      { parse_mode: "Markdown" }
    );
  } else {
    await bot.sendMessage(cb.message.chat.id,
      `⏳ To'lov hali kelmadi. Click orqali to'lovni amalga oshiring, so'ng qaytadan tekshiring.`
    );
  }
});

// ─── ФОТО/СКРИНШОТ ОТ ПОЛЬЗОВАТЕЛЯ ─────────────────────────────────
bot.on("photo", async (msg) => {
  const user   = ensureUser(msg);
  const chat   = msg.chat.id;
  const adminId = process.env.ADMIN_ID;
  if (!adminId) return;

  // Пересылаем скриншот админу
  const name  = user.first_name || "Foydalanuvchi";
  const uname = msg.from.username ? `@${msg.from.username}` : `ID: ${user.id}`;
  await bot.sendMessage(adminId,
    `📸 *Skrinshot keldi!*\n👤 ${name} (${uname})\n🆔 \`${user.id}\`\n\nTasdiqlash uchun: /approve ${user.id}`,
    { parse_mode: "Markdown" }
  );
  await bot.forwardMessage(adminId, chat, msg.message_id);
  await bot.sendMessage(chat,
    `📸 Skrinshot qabul qilindi!\n⏱ Tez orada kirish ochamiz.`
  );
});

// ─── КОМАНДА /approve ────────────────────────────────────────────────
bot.onText(/\/approve (\d+)/, async (msg, match) => {
  if (String(msg.from.id) !== String(process.env.ADMIN_ID)) return;
  const targetId = match[1];
  db.prepare("UPDATE users SET has_access=1 WHERE id=?").run(targetId);
  await bot.sendMessage(msg.chat.id, `✅ User ${targetId} ga kirish berildi.`);
  try {
    await bot.sendMessage(parseInt(targetId),
      `🎉 *To'lovingiz tasdiqlandi!*\n\nBarcha darslar ochiq!\n📚 /darslar`,
      { parse_mode: "Markdown" }
    );
  } catch {}
});

// ─── ADMIN ───────────────────────────────────────────────────────────
bot.onText(/\/admin/, async (msg) => {
  if (String(msg.from.id) !== String(process.env.ADMIN_ID)) return;

  const stats = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM users)                             AS total_users,
      (SELECT COUNT(*) FROM users WHERE has_access=1)         AS paid_users,
      (SELECT COUNT(*) FROM orders WHERE status='paid')       AS total_orders,
      (SELECT COALESCE(SUM(amount),0) FROM orders WHERE status='paid') AS revenue,
      (SELECT COALESCE(SUM(amount),0) FROM orders WHERE status='paid' AND paid_at >= date('now')) AS today
  `).get();

  await bot.sendMessage(msg.chat.id,
    `📊 *Admin Panel*\n\n` +
    `👥 Jami foydalanuvchi: *${stats.total_users}*\n` +
    `💳 To'lagan: *${stats.paid_users}*\n` +
    `📦 Buyurtmalar: *${stats.total_orders}*\n` +
    `💰 Jami daromad: *$${stats.revenue.toFixed(2)}*\n` +
    `📅 Bugun: *$${stats.today.toFixed(2)}*`,
    { parse_mode: "Markdown" }
  );
});

// ─── СТАРТ СЕРВЕРА ───────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🤖 English UZ Bot ishga tushdi!`);
  console.log(`📡 Server: http://localhost:${PORT}`);
  console.log(`💳 Click Prepare:  POST /click/prepare`);
  console.log(`💳 Click Complete: POST /click/complete\n`);
});
