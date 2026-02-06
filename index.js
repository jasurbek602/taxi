import TelegramBot from "node-telegram-bot-api";
import { MongoClient, ObjectId } from "mongodb";
import cron from "node-cron";
import express from "express";

// ===== CONFIG =====
const TOKEN = "8552276644:AAEAFmwBiE0aYXIKeNVyOqIg6YiO3fC-Fgk";
const DB_NAME = "taxi";
const GROUP_ID = -1003880550047;

// 🚨 Railway bergan URL ni shu yerga yozing
const WEBHOOK_URL = "";

// ===== INIT =====
const bot = new TelegramBot(TOKEN);
const app = express();
app.use(express.json());

// ===== MONGO =====
const uri =
  "mongodb://user:user@ac-rxxuq98-shard-00-00.r5qzmqh.mongodb.net:27017,ac-rxxuq98-shard-00-01.r5qzmqh.mongodb.net:27017,ac-rxxuq98-shard-00-02.r5qzmqh.mongodb.net:27017/?replicaSet=atlas-wcifd0-shard-0&ssl=true&authSource=admin";

const client = new MongoClient(uri);

let db, usersCollection, requestsCollection, sessionsCollection;

async function connectDB() {
  await client.connect();
  db = client.db(DB_NAME);
  usersCollection = db.collection("users");
  requestsCollection = db.collection("requests");
  sessionsCollection = db.collection("sessions");
  console.log("MongoDB ulandi ✅");
}

await connectDB();

// ================= WEBHOOK =================
app.post(`/bot${TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// ================= SERVER START =================
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  await bot.setWebHook(`${WEBHOOK_URL}/bot${TOKEN}`);
  console.log("🚀 Webhook o‘rnatildi va server ishlayapti");
});

// ================= SESSION =================
async function setState(userId, data) {
  await sessionsCollection.updateOne(
    { telegramId: userId },
    { $set: data },
    { upsert: true }
  );
}

async function getState(userId) {
  return await sessionsCollection.findOne({ telegramId: userId });
}

async function clearState(userId) {
  await sessionsCollection.deleteOne({ telegramId: userId });
}

// ================= AUTOMATIC CLEANUP =================
cron.schedule("0 21 * * *", async () => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const result = await requestsCollection.deleteMany({
    createdAt: { $lt: yesterday },
  });

  console.log(`🗑️ ${result.deletedCount} ta eski so‘rov o‘chirildi`);
});

// ================= COMMAND =================
bot.setMyCommands([
  { command: "/start", description: "Botni boshlash" },
]);

// ================= START =================
bot.onText(/\/start/, async (msg) => {
  await clearState(msg.from.id);

  bot.sendMessage(msg.chat.id, "Tanlang:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🚖 Find Taxi", callback_data: "findTaxi" }],
        [{ text: "📝 So‘rov yaratish", callback_data: "createRequest" }],
        [{ text: "📋 Mening so'rovlarim", callback_data: "myRequests" }],
        [{ text: "📋 Malumotlarni tahrirlash", callback_data: "reset" }],
      ],
    },
  });
});

// ================= CALLBACK =================
bot.on("callback_query", async (q) => {
  const chatId = q.message.chat.id;
  const userId = q.from.id;
  const username = q.from.username || "No username";
  const data = q.data;

  let state = await getState(userId);

  if (data === "reset") {
    await usersCollection.deleteOne({ telegramId: userId });
    await sessionsCollection.deleteOne({ telegramId: userId });
    await bot.sendMessage(chatId, "✅ Sizning barcha malumotlaringiz o‘chirildi");
    return bot.answerCallbackQuery(q.id);
  }

  if (data === "myRequests") {
    const requests = await requestsCollection
      .find({ telegramId: userId })
      .sort({ createdAt: -1 })
      .toArray();

    if (!requests.length) {
      return bot.sendMessage(chatId, "Sizda hech qanday so‘rov yo‘q ❌");
    }

    for (const r of requests) {
      let text = `
🚖 TAXI

📍 ${r.direction}
⏰ ${r.time}
👥 ${r.peopleCount} TA JOY
🚕 ${r.car}
👤 ${r.name}
📞 ${r.phone}
👤 @${username}
`;

      if (r.post) text += "\n📦 POCHTA OLADI";
      if (r.female) text += "\n👩 SALONDA AYOL BOR";

      await bot.sendMessage(chatId, text, {
        reply_markup: {
          inline_keyboard: [
            [{ text: "📤 Send Again", callback_data: `send_again_${r._id}` }],
            [{ text: "❌ Delete", callback_data: `delete_${r._id}` }],
          ],
        },
      });
    }
  }

  if (data.startsWith("send_again_")) {
    const requestId = data.split("send_again_")[1];

    const request = await requestsCollection.findOne({
      _id: new ObjectId(requestId),
    });

    if (!request)
      return bot.sendMessage(chatId, "❌ So‘rov topilmadi");

    let text = `
🚖 TAXI

📍 ${request.direction}
⏰ ${request.time}
👥 ${request.peopleCount} TA JOY BOR
🚕 ${request.car}
👤 ${request.name}
📞 ${request.phone}
👤 @${request.username}
`;

    if (request.post) text += "\n📦 POCHTA OLADI";
    if (request.female) text += "\n👩 SALONDA AYOL BOR";

    await bot.sendMessage(GROUP_ID, text);
    return bot.sendMessage(chatId, "✅ So‘rov guruhga qayta yuborildi!");
  }

  if (data.startsWith("delete_")) {
    const id = data.split("_")[1];
    await requestsCollection.deleteOne({
      _id: new ObjectId(id),
      telegramId: userId,
    });
    return bot.sendMessage(chatId, "✅ So‘rov o‘chirildi");
  }

  bot.answerCallbackQuery(q.id);
});