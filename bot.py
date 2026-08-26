import asyncio
import logging
import os
import random
import tempfile
from datetime import date, datetime, timedelta
from pathlib import Path

import aiosqlite
import edge_tts
from aiogram import Bot, Dispatcher, F, types
from aiogram.filters import Command, CommandStart
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import (
    FSInputFile,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    ReplyKeyboardMarkup,
)
from apscheduler.schedulers.asyncio import AsyncIOScheduler

# ─── Config ───────────────────────────────────────────────
BOT_TOKEN   = os.getenv("BOT_TOKEN", "")
ADMIN_ID    = int(os.getenv("ADMIN_ID", "0"))
CARD_NUMBER = os.getenv("CARD_NUMBER", "1234 5678 9012 3456")
CARD_NAME   = os.getenv("CARD_NAME", "Shamil S.")
PRICE       = 50_000
DB_PATH     = "english_bot.db"

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

bot = Bot(token=BOT_TOKEN)
dp  = Dispatcher(storage=MemoryStorage())
scheduler = AsyncIOScheduler()

# ─── FSM States ───────────────────────────────────────────
class PaymentState(StatesGroup):
    waiting_screenshot = State()

# ─── Database ─────────────────────────────────────────────
async def setup_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                user_id         INTEGER PRIMARY KEY,
                username        TEXT,
                full_name       TEXT,
                is_paid         INTEGER DEFAULT 0,
                joined_date     TEXT,
                current_day     INTEGER DEFAULT 1,
                last_lesson_date TEXT,
                streak          INTEGER DEFAULT 0,
                total_words     INTEGER DEFAULT 0,
                total_phrases   INTEGER DEFAULT 0
            )""")
        await db.execute("""
            CREATE TABLE IF NOT EXISTS payment_requests (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id         INTEGER,
                username        TEXT,
                full_name       TEXT,
                screenshot_id   TEXT,
                request_date    TEXT,
                status          TEXT DEFAULT 'pending'
            )""")
        await db.commit()

async def get_user(user_id: int):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM users WHERE user_id=?", (user_id,)) as c:
            return await c.fetchone()

async def upsert_user(user: types.User):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            INSERT OR IGNORE INTO users (user_id, username, full_name, joined_date)
            VALUES (?,?,?,?)""",
            (user.id, user.username, user.full_name, date.today().isoformat()))
        await db.commit()

async def update_user(user_id: int, **kwargs):
    if not kwargs:
        return
    sets = ", ".join(f"{k}=?" for k in kwargs)
    vals = list(kwargs.values()) + [user_id]
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(f"UPDATE users SET {sets} WHERE user_id=?", vals)
        await db.commit()

# ─── TTS ──────────────────────────────────────────────────
async def tts_audio(text: str, voice: str = "en-US-AriaNeural") -> str:
    communicate = edge_tts.Communicate(text, voice)
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".mp3")
    await communicate.save(tmp.name)
    return tmp.name

async def send_word_with_audio(chat_id: int, word: dict):
    caption = (
        f"🔤 *{word['en']}*  {word['trans']}\n"
        f"🇺🇿 {word['uz']}\n"
        f"📝 _{word['example']}_"
    )
    try:
        path = await tts_audio(word['en'])
        await bot.send_voice(chat_id, FSInputFile(path), caption=caption, parse_mode="Markdown")
        Path(path).unlink(missing_ok=True)
    except Exception as e:
        logger.warning(f"TTS failed: {e}")
        await bot.send_message(chat_id, caption, parse_mode="Markdown")

async def send_phrase_with_audio(chat_id: int, phrase: dict):
    caption = f"💬 *{phrase['en']}*\n🇺🇿 {phrase['uz']}"
    try:
        path = await tts_audio(phrase['en'])
        await bot.send_voice(chat_id, FSInputFile(path), caption=caption, parse_mode="Markdown")
        Path(path).unlink(missing_ok=True)
    except Exception as e:
        logger.warning(f"TTS phrase failed: {e}")
        await bot.send_message(chat_id, caption, parse_mode="Markdown")

# ─── Course Content ───────────────────────────────────────
# 90 days × (5 words + 3 phrases + 1 dialogue)
# Add more days by extending this dict!
COURSE: dict = {
    1: {
        "topic": "Salomlashish / Greetings",
        "words": [
            {"en": "hello",    "trans": "[həˈloʊ]",    "uz": "salom",       "example": "Hello! How are you?"},
            {"en": "goodbye",  "trans": "[ˌɡʊdˈbaɪ]",  "uz": "xayr",        "example": "Goodbye! See you soon!"},
            {"en": "yes",      "trans": "[jɛs]",        "uz": "ha",          "example": "Yes, I understand."},
            {"en": "no",       "trans": "[noʊ]",        "uz": "yo'q",        "example": "No, thank you."},
            {"en": "please",   "trans": "[pliːz]",      "uz": "iltimos",     "example": "Please help me."},
        ],
        "phrases": [
            {"en": "How are you?",          "uz": "Qandaysiz?"},
            {"en": "I'm fine, thank you.",  "uz": "Yaxshiman, rahmat."},
            {"en": "Nice to meet you!",     "uz": "Tanishganimdan xursandman!"},
        ],
        "dialogue": {
            "title": "Birinchi tanishish / First meeting",
            "lines": [
                {"who": "Ali",  "en": "Hello! My name is Ali.",         "uz": "Salom! Mening ismim Ali."},
                {"who": "Sara", "en": "Hi Ali! My name is Sara.",        "uz": "Salom Ali! Mening ismim Sara."},
                {"who": "Ali",  "en": "Nice to meet you, Sara!",         "uz": "Tanishganimdan xursandman, Sara!"},
                {"who": "Sara", "en": "Nice to meet you too! Goodbye!",  "uz": "Men ham xursandman! Xayr!"},
            ],
        },
    },
    2: {
        "topic": "Do'konda / At the shop",
        "words": [
            {"en": "water",  "trans": "[ˈwɔːtər]", "uz": "suv",     "example": "I drink water every day."},
            {"en": "bread",  "trans": "[brɛd]",     "uz": "non",     "example": "Please give me bread."},
            {"en": "money",  "trans": "[ˈmʌni]",    "uz": "pul",     "example": "How much money do you have?"},
            {"en": "price",  "trans": "[praɪs]",    "uz": "narx",    "example": "What is the price?"},
            {"en": "cheap",  "trans": "[tʃiːp]",    "uz": "arzon",   "example": "This is very cheap."},
        ],
        "phrases": [
            {"en": "How much does it cost?",   "uz": "Bu qancha turadi?"},
            {"en": "Do you have this in red?", "uz": "Buning qizili bormi?"},
            {"en": "I'll take it.",            "uz": "Olaman."},
        ],
        "dialogue": {
            "title": "Do'konda / In the shop",
            "lines": [
                {"who": "Sotuvchi", "en": "Hello! Can I help you?",          "uz": "Salom! Sizga yordam bera olaymi?"},
                {"who": "Xaridor",  "en": "Yes. How much is this bread?",    "uz": "Ha. Bu non qancha turadi?"},
                {"who": "Sotuvchi", "en": "It's 3000 sum.",                   "uz": "3000 so'm."},
                {"who": "Xaridor",  "en": "OK, I'll take two. Thank you!",   "uz": "Yaxshi, ikkita olaman. Rahmat!"},
            ],
        },
    },
    3: {
        "topic": "Vaqt / Time",
        "words": [
            {"en": "morning",   "trans": "[ˈmɔːrnɪŋ]", "uz": "ertalab",  "example": "Good morning!"},
            {"en": "evening",   "trans": "[ˈiːvnɪŋ]",  "uz": "kechqurun","example": "Good evening!"},
            {"en": "today",     "trans": "[təˈdeɪ]",   "uz": "bugun",    "example": "What do you do today?"},
            {"en": "tomorrow",  "trans": "[təˈmɒroʊ]", "uz": "ertaga",   "example": "See you tomorrow!"},
            {"en": "week",      "trans": "[wiːk]",     "uz": "hafta",    "example": "I work five days a week."},
        ],
        "phrases": [
            {"en": "What time is it?",       "uz": "Soat necha?"},
            {"en": "I'm running late.",      "uz": "Men kechikayapman."},
            {"en": "See you tomorrow!",      "uz": "Ertaga ko'rishguncha!"},
        ],
        "dialogue": {
            "title": "Kelishuv / Making a plan",
            "lines": [
                {"who": "A", "en": "Are you free tomorrow?",           "uz": "Ertaga bo'shsizmi?"},
                {"who": "B", "en": "Yes, what time?",                   "uz": "Ha, soat nechada?"},
                {"who": "A", "en": "At 3 o'clock in the afternoon.",    "uz": "Tushdan keyin soat 3 da."},
                {"who": "B", "en": "Perfect! See you then.",            "uz": "Zo'r! Ko'rishguncha."},
            ],
        },
    },
    4: {
        "topic": "Oila / Family",
        "words": [
            {"en": "mother",   "trans": "[ˈmʌðər]",  "uz": "ona",     "example": "My mother is kind."},
            {"en": "father",   "trans": "[ˈfɑːðər]", "uz": "ota",     "example": "My father works hard."},
            {"en": "brother",  "trans": "[ˈbrʌðər]", "uz": "aka/uka", "example": "I have one brother."},
            {"en": "sister",   "trans": "[ˈsɪstər]", "uz": "opa/singil","example": "My sister is a doctor."},
            {"en": "child",    "trans": "[tʃaɪld]",  "uz": "bola",    "example": "The child is sleeping."},
        ],
        "phrases": [
            {"en": "I have a big family.",     "uz": "Mening katta oilam bor."},
            {"en": "How old are you?",         "uz": "Yoshingiz necha?"},
            {"en": "Where are you from?",      "uz": "Qayerdansiz?"},
        ],
        "dialogue": {
            "title": "Oila haqida / About family",
            "lines": [
                {"who": "A", "en": "Do you have brothers or sisters?",   "uz": "Aka-ukangiz yoki opa-singillaringiz bormi?"},
                {"who": "B", "en": "Yes, I have one brother and two sisters.", "uz": "Ha, bitta akam va ikkita singlim bor."},
                {"who": "A", "en": "What does your brother do?",          "uz": "Akangiz nima ish qiladi?"},
                {"who": "B", "en": "He is an engineer.",                   "uz": "U muhandis."},
            ],
        },
    },
    5: {
        "topic": "Taom / Food",
        "words": [
            {"en": "rice",     "trans": "[raɪs]",    "uz": "guruch / osh", "example": "I love rice."},
            {"en": "meat",     "trans": "[miːt]",    "uz": "go'sht",       "example": "Do you eat meat?"},
            {"en": "vegetable","trans": "[ˈvɛdʒtəbəl]","uz": "sabzavot",   "example": "Vegetables are healthy."},
            {"en": "delicious","trans": "[dɪˈlɪʃəs]","uz": "mazali",       "example": "This food is delicious!"},
            {"en": "hungry",   "trans": "[ˈhʌŋɡri]", "uz": "och",          "example": "I am very hungry."},
        ],
        "phrases": [
            {"en": "I'm hungry.",             "uz": "Men ochdirman."},
            {"en": "What would you like?",    "uz": "Nima olmqochisiz?"},
            {"en": "The food was amazing!",   "uz": "Taom ajoyib edi!"},
        ],
        "dialogue": {
            "title": "Kafeда / At the café",
            "lines": [
                {"who": "Ofitsiant", "en": "Good afternoon! What would you like?",  "uz": "Xayrli tush! Nima olmqochisiz?"},
                {"who": "Mehmon",    "en": "I'd like rice and tea, please.",         "uz": "Menga osh va choy iltimos."},
                {"who": "Ofitsiant", "en": "Of course! Anything else?",              "uz": "Albatta! Yana nima kerak?"},
                {"who": "Mehmon",    "en": "No, that's all. Thank you.",             "uz": "Yo'q, hammasi shu. Rahmat."},
            ],
        },
    },
    # ── Days 6-30: Month 1 (Basic vocabulary) ──────────────────────
    # ── Days 31-60: Month 2 (Conversational phrases) ───────────────
    # ── Days 61-90: Month 3 (Free speech & stories) ────────────────
    # Copy the structure above and add more days!
}

def get_content(day: int) -> dict:
    """Return content for a day; cycles if day not yet written."""
    if day in COURSE:
        return COURSE[day]
    keys = list(COURSE.keys())
    return COURSE[keys[(day - 1) % len(keys)]]

def month_label(day: int) -> str:
    if day <= 30:
        return "📘 1-oy: Asoslar"
    if day <= 60:
        return "📗 2-oy: Suhbat"
    return "📙 3-oy: Erkin nutq"

# ─── Keyboards ────────────────────────────────────────────
def kb_guest():
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="💳 To'lov qilish")],
            [KeyboardButton(text="ℹ️ Kurs haqida")],
        ], resize_keyboard=True)

def kb_student():
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="📚 Dars boshlash"), KeyboardButton(text="📊 Progressim")],
            [KeyboardButton(text="🔁 Takrorlash"),    KeyboardButton(text="ℹ️ Yordam")],
        ], resize_keyboard=True)

# ─── /start ───────────────────────────────────────────────
@dp.message(CommandStart())
async def cmd_start(message: types.Message, state: FSMContext):
    await state.clear()
    await upsert_user(message.from_user)
    user = await get_user(message.from_user.id)

    if user and user["is_paid"]:
        day = user["current_day"] or 1
        await message.answer(
            f"👋 Xush kelibsiz, *{message.from_user.first_name}!*\n\n"
            f"📅 Hozirgi kun: *{day}/90*\n"
            f"🔥 Streak: *{user['streak']} kun*\n"
            f"🔤 So'zlar: *{user['total_words']}*\n\n"
            "Davom etasizmi? 💪",
            reply_markup=kb_student(), parse_mode="Markdown")
    else:
        await message.answer(
            "🎓 *English 90 Days* — ingliz tili kursi\n\n"
            "✅ 90 kunda inglizcha gapirasiz\n"
            "🔊 Har bir so'z eshitiladi (audio)\n"
            "🇺🇿 Tarjima — o'zbek tilida\n"
            "💬 Haqiqiy dialoglar va iboralar\n"
            "📊 Har kunlik progress\n\n"
            f"💰 Narx: *{PRICE:,} so'm* (bir martalik)\n\n"
            "Boshlash uchun to'lov qiling 👇",
            reply_markup=kb_guest(), parse_mode="Markdown")

# ─── Payment ──────────────────────────────────────────────
@dp.message(F.text == "💳 To'lov qilish")
async def payment_info(message: types.Message, state: FSMContext):
    await message.answer(
        f"💳 *To'lov ma'lumotlari:*\n\n"
        f"Karta: `{CARD_NUMBER}`\n"
        f"Ism: *{CARD_NAME}*\n"
        f"Summa: *{PRICE:,} so'm*\n\n"
        f"To'lovdan keyin *skrinshot* yuboring 📸",
        parse_mode="Markdown")
    await state.set_state(PaymentState.waiting_screenshot)

@dp.message(PaymentState.waiting_screenshot, F.photo)
async def receive_screenshot(message: types.Message, state: FSMContext):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            INSERT INTO payment_requests (user_id, username, full_name, screenshot_id, request_date)
            VALUES (?,?,?,?,?)""",
            (message.from_user.id, message.from_user.username,
             message.from_user.full_name, message.photo[-1].file_id,
             datetime.now().isoformat()))
        await db.commit()
    await state.clear()

    await message.answer(
        "✅ *Skrinshot qabul qilindi!*\n\n"
        "⏳ Admin tekshiradi — 1-2 soat ichida kurs ochiladi.\n"
        "Sabr qiling! 🙏", parse_mode="Markdown")

    if ADMIN_ID:
        await bot.send_photo(
            ADMIN_ID, message.photo[-1].file_id,
            caption=(
                f"💰 *Yangi to'lov so'rovi*\n\n"
                f"👤 {message.from_user.full_name}\n"
                f"📱 @{message.from_user.username or '—'}\n"
                f"🆔 `{message.from_user.id}`\n\n"
                f"✅ Tasdiqlash: `/approve {message.from_user.id}`\n"
                f"❌ Rad etish: `/reject {message.from_user.id}`"
            ), parse_mode="Markdown")

@dp.message(PaymentState.waiting_screenshot)
async def screenshot_wrong_format(message: types.Message):
    await message.answer("📸 Iltimos, to'lov skrinshot-ini *rasm* sifatida yuboring.", parse_mode="Markdown")

# ─── Admin commands ───────────────────────────────────────
@dp.message(Command("approve"))
async def cmd_approve(message: types.Message):
    if message.from_user.id != ADMIN_ID:
        return
    parts = message.text.split()
    if len(parts) < 2:
        await message.answer("Foydalanish: /approve USER_ID")
        return
    uid = int(parts[1])
    await update_user(uid, is_paid=1, current_day=1,
                      last_lesson_date=None, streak=0, total_words=0, total_phrases=0)
    await message.answer(f"✅ {uid} uchun kurs ochildi!")
    try:
        await bot.send_message(
            uid,
            "🎉 *To'lovingiz tasdiqlandi!*\n\n"
            "Kursga xush kelibsiz!\n"
            "Birinchi darsni boshlaylik 👇",
            reply_markup=kb_student(), parse_mode="Markdown")
    except Exception:
        pass

@dp.message(Command("reject"))
async def cmd_reject(message: types.Message):
    if message.from_user.id != ADMIN_ID:
        return
    parts = message.text.split()
    if len(parts) < 2:
        await message.answer("Foydalanish: /reject USER_ID")
        return
    uid = int(parts[1])
    await message.answer(f"❌ {uid} rad etildi.")
    try:
        await bot.send_message(
            uid,
            "❌ To'lovingiz tasdiqlanmadi.\n"
            "Iltimos, qayta skrinshot yuboring yoki admin bilan bog'laning.")
    except Exception:
        pass

@dp.message(Command("stats"))
async def cmd_stats(message: types.Message):
    if message.from_user.id != ADMIN_ID:
        return
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT COUNT(*) FROM users") as c:
            total = (await c.fetchone())[0]
        async with db.execute("SELECT COUNT(*) FROM users WHERE is_paid=1") as c:
            paid = (await c.fetchone())[0]
        async with db.execute(
            "SELECT COUNT(*) FROM payment_requests WHERE status='pending'") as c:
            pending = (await c.fetchone())[0]
    await message.answer(
        f"📊 *Statistika*\n\n"
        f"👥 Jami: {total}\n"
        f"💚 To'lagan: {paid}\n"
        f"⏳ Kutmoqda: {pending}\n"
        f"💰 Daromad: {paid * PRICE:,} so'm",
        parse_mode="Markdown")

@dp.message(Command("broadcast"))
async def cmd_broadcast(message: types.Message):
    if message.from_user.id != ADMIN_ID:
        return
    text = message.text.replace("/broadcast", "").strip()
    if not text:
        await message.answer("Foydalanish: /broadcast Xabar matni")
        return
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT user_id FROM users") as c:
            rows = await c.fetchall()
    sent = 0
    for (uid,) in rows:
        try:
            await bot.send_message(uid, text)
            sent += 1
        except Exception:
            pass
    await message.answer(f"✅ {sent}/{len(rows)} foydalanuvchiga yuborildi.")

# ─── Lesson delivery ──────────────────────────────────────
async def deliver_lesson(user_id: int, day: int):
    content = get_content(day)

    # Header
    await bot.send_message(
        user_id,
        f"━━━━━━━━━━━━━━━━━━\n"
        f"📅 *{day}-kun*  |  {month_label(day)}\n"
        f"📌 Mavzu: _{content['topic']}_\n"
        f"━━━━━━━━━━━━━━━━━━\n\n"
        f"*🔤 Bugungi so'zlar:*",
        parse_mode="Markdown")

    for word in content["words"]:
        await send_word_with_audio(user_id, word)
        await asyncio.sleep(0.6)

    await bot.send_message(user_id, "*💬 Bugungi iboralar:*", parse_mode="Markdown")
    for phrase in content["phrases"]:
        await send_phrase_with_audio(user_id, phrase)
        await asyncio.sleep(0.6)

    # Dialogue
    dlg = content["dialogue"]
    dlg_text = f"🗣 *Dialog: {dlg['title']}*\n\n"
    for line in dlg["lines"]:
        dlg_text += f"*{line['who']}:* {line['en']}\n_{line['uz']}_\n\n"
    await bot.send_message(user_id, dlg_text, parse_mode="Markdown")
    await asyncio.sleep(1)

    # Quiz
    await send_quiz(user_id, content["words"], day)

async def send_quiz(user_id: int, words: list, day: int):
    correct = random.choice(words)

    # Build wrong options from other words
    all_words = [w for c in COURSE.values() for w in c["words"]]
    wrong_pool = [w for w in all_words if w["uz"] != correct["uz"]]
    wrongs = random.sample(wrong_pool, min(3, len(wrong_pool)))

    options = [correct["uz"]] + [w["uz"] for w in wrongs]
    random.shuffle(options)
    ci = options.index(correct["uz"])

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(
            text=opt,
            callback_data=f"q:{'ok' if i == ci else 'no'}:{day}"
        )]
        for i, opt in enumerate(options)
    ])
    await bot.send_message(
        user_id,
        f"✅ *Mini-test!*\n\n*\"{correct['en']}\"* — bu qaysi so'z?",
        reply_markup=keyboard, parse_mode="Markdown")

@dp.callback_query(F.data.startswith("q:"))
async def quiz_answer(cb: types.CallbackQuery):
    _, result, day_str = cb.data.split(":")
    day = int(day_str)

    if result == "ok":
        user = await get_user(cb.from_user.id)
        if user:
            today = date.today().isoformat()
            yesterday = (date.today() - timedelta(days=1)).isoformat()
            last = user["last_lesson_date"]

            if last == yesterday:
                new_streak = user["streak"] + 1
            elif last == today:
                new_streak = user["streak"]
            else:
                new_streak = 1

            new_day = min(user["current_day"] + 1, 91)
            await update_user(
                cb.from_user.id,
                current_day=new_day,
                total_words=user["total_words"] + 5,
                total_phrases=user["total_phrases"] + 3,
                last_lesson_date=today,
                streak=new_streak,
            )

        streak_line = f"🔥 {new_streak} kun ketma-ket!" if new_streak >= 2 else ""
        await cb.message.edit_text(
            f"🎉 *To'g'ri!*\n\n"
            f"Bugungi dars tugadi! {streak_line}\n\n"
            f"Ertaga yangi dars kutadi 💪",
            parse_mode="Markdown")
    else:
        await cb.message.edit_text(
            "❌ *Noto'g'ri.* Xafa bo'lmang!\n\n"
            "Takrorlang va ertaga davom eting 💪",
            parse_mode="Markdown")
    await cb.answer()

# ─── Student buttons ──────────────────────────────────────
@dp.message(F.text == "📚 Dars boshlash")
async def btn_lesson(message: types.Message):
    user = await get_user(message.from_user.id)
    if not user or not user["is_paid"]:
        await message.answer("❌ Avval to'lov qiling.", reply_markup=kb_guest())
        return

    today = date.today().isoformat()
    day = user["current_day"] or 1

    if user["last_lesson_date"] == today:
        await message.answer(
            f"✅ *Bugungi dars o'tdi!*\n\n"
            f"🔥 Streak: {user['streak']} kun\n"
            f"📅 Ertaga {day + 1}-kun kutadi! 💪",
            parse_mode="Markdown")
        return

    if day > 90:
        await message.answer(
            "🏆 *Tabriklaymiz!*\n\n"
            "90 kunlik kursni yakunladingiz!\n"
            "Siz endi ingliz tilida gapira olasiz! 🇬🇧🎉",
            parse_mode="Markdown")
        return

    await message.answer(f"⏳ {day}-kun dars yuklanmoqda...")
    await deliver_lesson(message.from_user.id, day)

@dp.message(F.text == "📊 Progressim")
async def btn_progress(message: types.Message):
    user = await get_user(message.from_user.id)
    if not user or not user["is_paid"]:
        await message.answer("❌ Avval to'lov qiling.", reply_markup=kb_guest())
        return

    day   = user["current_day"] or 1
    words = user["total_words"]
    pct   = min(int((day / 90) * 100), 100)
    bar   = "🟩" * (pct // 10) + "⬜" * (10 - pct // 10)

    await message.answer(
        f"📊 *Sizning progressingiz:*\n\n"
        f"📅 Kun: *{day}/90*\n"
        f"{bar}  {pct}%\n\n"
        f"🔤 So'zlar: *{words}/4 000*\n"
        f"💬 Iboralar: *{user['total_phrases']}/500*\n"
        f"🔥 Streak: *{user['streak']} kun*\n\n"
        f"{'🏆 Zo'r natija!' if user['streak'] >= 7 else '💪 Davom et, bo'ladi!'}",
        parse_mode="Markdown")

@dp.message(F.text == "🔁 Takrorlash")
async def btn_repeat(message: types.Message):
    user = await get_user(message.from_user.id)
    if not user or not user["is_paid"]:
        await message.answer("❌ Avval to'lov qiling.")
        return
    day = max((user["current_day"] or 1) - 1, 1)
    await message.answer(f"🔁 {day}-kun takrorlanmoqda...")
    await deliver_lesson(message.from_user.id, day)

@dp.message(F.text.in_(["ℹ️ Kurs haqida", "ℹ️ Yordam"]))
async def btn_help(message: types.Message):
    await message.answer(
        "ℹ️ *English 90 Days*\n\n"
        "📚 *Dars boshlash* — bugungi darsni ko'rish\n"
        "📊 *Progressim* — statistika\n"
        "🔁 *Takrorlash* — kechagi darsni qaytarish\n\n"
        "📧 Muammo bo'lsa: /start yozing\n"
        "👤 Admin: @admin_username",
        parse_mode="Markdown")

# ─── Daily push notifications (09:00) ────────────────────
async def daily_push():
    logger.info("Daily push started")
    today = date.today().isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT user_id, current_day, streak FROM users WHERE is_paid=1 AND current_day<=90 AND (last_lesson_date!=? OR last_lesson_date IS NULL)",
            (today,)) as c:
            users = await c.fetchall()

    for u in users:
        try:
            day = u["current_day"] or 1
            await bot.send_message(
                u["user_id"],
                f"🌅 *Xayrli tong!*\n\n"
                f"📅 Bugun *{day}-kun*\n"
                f"🔥 Streak: {u['streak']} kun\n\n"
                "Darsni boshlash uchun tugmani bosing 👇",
                reply_markup=kb_student(), parse_mode="Markdown")
        except Exception as e:
            logger.warning(f"Push failed for {u['user_id']}: {e}")

# ─── Main ─────────────────────────────────────────────────
async def main():
    await setup_db()
    scheduler.add_job(daily_push, "cron", hour=9, minute=0)
    scheduler.start()
    logger.info("Bot is running...")
    await dp.start_polling(bot, skip_updates=True)

if __name__ == "__main__":
    asyncio.run(main())
