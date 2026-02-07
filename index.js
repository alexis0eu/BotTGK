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
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

const GUILD_ID = process.env.GUILD_ID;
const STATUS_CHANNEL_ID = process.env.STATUS_CHANNEL_ID || null;
const MEDIA_CHANNEL_IDS = (process.env.MEDIA_CHANNEL_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

// простейший кэш
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

// --- помощники ---

function isImage(url) {
  return /\.(png|jpe?g|gif|webp)$/i.test(url);
}

function isVideo(url) {
  return /\.(mp4|mov|webm|mkv)$/i.test(url);
}

// --- сбор инфы о сервере и медиа ---

async function updateServerStatus() {
  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.members.fetch();

  const total = guild.memberCount;
  const online = guild.members.cache.filter(m =>
    !m.user.bot &&
    m.presence &&
    m.presence.status !== 'offline'
  ).size;

  // любые 3 участника как пример
  const sampleMembers = guild.members.cache
    .filter(m => !m.user.bot)
    .random(3)
    .map(m => ({
      id: m.id,
      name: m.displayName,
      avatar: m.displayAvatarURL({ size: 64, extension: 'png' })
    }));

  cache.data.onlineMembers = online;
  cache.data.totalMembers = total;
  cache.data.sampleMembers = sampleMembers;
}

// собираем вложения из каналов
async function updateMedia() {
  const videos = [];
  const photos = [];

  for (const channelId of MEDIA_CHANNEL_IDS) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) continue;

      // берём последние ~100 сообщений
      let lastId = null;
      for (let i = 0; i < 3; i++) {
        const messages = await channel.messages.fetch({
          limit: 50,
          before: lastId || undefined
        });
        if (messages.size === 0) break;

        messages.forEach(msg => {
          msg.attachments.forEach(att => {
            const url = att.url;
            const title = att.name || 'Медиа с TGK';

            if (isImage(url)) {
              photos.push({ title, url });
            } else if (isVideo(url)) {
              videos.push({ title, url });
            }
          });
        });

        lastId = messages.last().id;
        if (messages.size < 50) break;
      }
    } catch (e) {
      console.error('Error reading channel', channelId, e);
    }
  }

  cache.data.videos = videos.slice(0, 30);
  cache.data.photos = photos.slice(0, 60);
}

// общий апдейт
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

// ===== запуск всего =====

const PORT = process.env.PORT || 8080;

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);

  await refreshCache();
  setInterval(refreshCache, 60 * 1000); // обновление раз в минуту

  app.listen(PORT, () => {
    console.log('API listening on port', PORT);
  });
});

client.login(process.env.DISCORD_TOKEN);
