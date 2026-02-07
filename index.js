require('dotenv').config();

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const express = require('express');
const cors = require('cors');

const app = express();

// ===== CORS =====
app.use(cors({
  origin: '*'
}));

// ===== Discord client =====
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent   // интент содержимого сообщений
  ],
  partials: [Partials.Channel]
});

const GUILD_ID = process.env.GUILD_ID;
const STATUS_CHANNEL_ID = process.env.STATUS_CHANNEL_ID || null;
const MEDIA_CHANNEL_IDS = (process.env.MEDIA_CHANNEL_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

// простейший кэш для ответа API
const cache = {
  ready: false,
  lastUpdate: null,
  data: {
    onlineMembers: 0,
    totalMembers: 0,
    sampleMembers: [],
    videos: [],
    photos: []
  }
};

// ===== помощники =====

function isImage(url) {
  return /\.(png|jpe?g|gif|webp)$/i.test(url);
}

function isVideo(url) {
  return /\.(mp4|mov|webm|mkv)$/i.test(url);
}

// ===== обновление статуса сервера =====

async function updateServerStatus() {
  if (!GUILD_ID) {
    console.error('GUILD_ID is not set');
    return;
  }

  const guild = await client.guilds.fetch(GUILD_ID);

  const total = guild.memberCount;

  // временный вариант: считаем всех как "онлайн"
  const online = total;

  // пробуем взять немного участников из кэша, без принудительного fetch
  let members = guild.members.cache.filter(m => !m.user.bot);

  if (members.size === 0) {
    cache.data.sampleMembers = [];
  } else {
    const samples = members.random(Math.min(3, members.size));
    const arr = Array.isArray(samples) ? samples : [samples];

    cache.data.sampleMembers = arr.map(m => ({
      id: m.id,
      name: m.displayName,
      avatar: m.displayAvatarURL({ size: 64, extension: 'png' })
    }));
  }

  cache.data.onlineMembers = online;
  cache.data.totalMembers = total;
}

// ===== сбор медиа из каналов (фото + видео) =====

async function updateMedia() {
  const newVideos = [];
  const newPhotos = [];

  console.log('MEDIA_CHANNEL_IDS =', MEDIA_CHANNEL_IDS);

  for (const channelId of MEDIA_CHANNEL_IDS) {
    try {
      const channel = await client.channels.fetch(channelId);
      console.log('Fetched channel', channelId, !!channel);

      if (!channel || !channel.isTextBased()) continue;

      let lastId = null;
      for (let i = 0; i < 3; i++) {
        const messages = await channel.messages.fetch({
          limit: 50,
          before: lastId || undefined
        });

        console.log('Messages fetched:', messages.size, 'from', channelId);

        if (messages.size === 0) break;

        messages.forEach(msg => {
          msg.attachments.forEach(att => {
            const url = att.url;
            const title = att.name || 'Медиа с TGK';

            if (isImage(url)) {
              newPhotos.push({ title, url });
            } else if (isVideo(url)) {
              newVideos.push({ title, url });
            }

            console.log('ATTACHMENT in', channelId, '->', url);
          });
        });

        lastId = messages.last().id;
        if (messages.size < 50) break;
      }
    } catch (e) {
      console.error('Error reading channel', channelId, e);
    }
  }

  console.log('AFTER SCAN photos:', newPhotos.length, 'videos:', newVideos.length);

  // обновляем кэш только если что‑то нашли, чтобы не затирать прошлые данные нулями
  if (newPhotos.length) {
    cache.data.photos = newPhotos.slice(0, 120);
  }
  if (newVideos.length) {
    cache.data.videos = newVideos.slice(0, 60);
  }
}

// ===== общий рефреш кэша =====

async function refreshCache() {
  try {
    await updateServerStatus();
    await updateMedia();
    cache.ready = true;
    cache.lastUpdate = new Date().toISOString();
    console.log('Cache updated at', cache.lastUpdate);
  } catch (e) {
    console.error('Error updating cache', e);
  }
}

// ===== Express API =====

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

// healthcheck
app.get('/', (req, res) => {
  res.send('TGK bot + API is running');
});

// ===== запуск всего =====

const PORT = process.env.PORT || 8080;

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  await refreshCache();
  setInterval(refreshCache, 60 * 1000);

  app.listen(PORT, () => {
    console.log('API listening on port', PORT);
  });
});

// проверяем токен перед логином
const token = process.env.DISCORD_TOKEN;
if (!token || typeof token !== 'string') {
  console.error('DISCORD_TOKEN is not set or invalid');
  process.exit(1);
}

client.login(token);
