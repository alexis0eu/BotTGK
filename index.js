const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const cors = require('cors');

// Берём данные из переменных окружения Railway
const TOKEN = process.env.TOKEN;
const GUILD_ID = process.env.GUILD_ID;
const PORT = process.env.PORT || 3000;

// Создаём Discord‑клиент
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences
  ]
});

// Создаём Express‑приложение
const app = express();

// Разрешаем CORS (можно сузить origin позже)
app.use(cors({
  origin: '*',
}));

let cache = {
  ready: false,
  lastUpdate: null,
  data: null
};

async function updateGuildData() {
  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const members = await guild.members.fetch({ withPresences: true });

    const total = guild.memberCount;
    const humans = members.filter(m => !m.user.bot);
    const online = humans.filter(m => {
      const s = m.presence?.status;
      return s === 'online' || s === 'idle' || s === 'dnd';
    }).size;

    const sample = humans
      .filter(m => m.user.avatar)
      .first(6)
      .map(m => ({
        id: m.id,
        name: m.displayName,
        avatar: m.displayAvatarURL({ size: 64, extension: 'png' })
      }));

    cache = {
      ready: true,
      lastUpdate: Date.now(),
      data: {
        totalMembers: total,
        onlineMembers: online,
        sampleMembers: sample
      }
    };
  } catch (e) {
    console.error('Ошибка обновления данных сервера:', e);
  }
}

client.once('ready', () => {
  console.log(`Бот залогинился как ${client.user.tag}`);
  updateGuildData();
  setInterval(updateGuildData, 30 * 1000);
});

// HTTP‑эндпоинт для сайта
app.get('/tgk-status', (req, res) => {
  if (!cache.ready) {
    return res.status(503).json({ ok: false, message: 'Данные ещё не готовы' });
  }
  res.json({
    ok: true,
    updatedAt: cache.lastUpdate,
    ...cache.data
  });
});

// Запуск HTTP‑сервера
app.listen(PORT, () => {
  console.log('HTTP API запущено на порту', PORT);
});

// Логин бота
client.login(TOKEN);
