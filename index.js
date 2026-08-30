const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');

const fetch = (...args) =>
  import('node-fetch').then(({ default: fetch }) => fetch(...args));

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const CHANNEL_ID = process.env.DROPS_CHANNEL_ID;

const SOURCES = [
  {
    name: "Sam's Club (Online)",
    url: "https://www.samsclub.com/s/pokemon",
    thumbnail: "https://upload.wikimedia.org/wikipedia/commons/5/5f/Sams_Club_logo.svg"
  }
];

const storeState = {};
const seenAlerts = new Set();

let usageStats = {
  fetchCalls: 0,
  scansRun: 0,
  startTime: Date.now()
};

async function trackedFetch(url) {
  console.log(`Fetching: ${url}`);

  usageStats.fetchCalls++;

  try {
    const response = await fetch(url);

    console.log(`Success: ${url}`);

    return response;
  } catch (err) {
    console.error(`Failed: ${url}`, err);
    throw err;
  }
}

async function scanStore(store) {
  try {
    const res = await trackedFetch(store.url);

    const html = await res.text();

    console.log(`Downloaded ${html.length} characters from ${store.name}`);

   const cardKeywords = [
  "booster pack",
  "booster bundle",
  "elite trainer box",
  "etb",
  "pokemon tcg",
  "trading card game",
  "collection box",
  "premium collection",
  "pokemon cards",
  "tin"
];

const cardKeywords = [
  "pokemon cards",
  "pokemon tcg",
  "trading card game",
  "booster pack",
  "booster bundle",
  "elite trainer box",
  "etb",
  "collection box",
  "premium collection",
  "battle deck",
  "trainer box",
  "tin",
  "blister pack"
];

const hasPokemon = cardKeywords.some(keyword =>
  html.toLowerCase().includes(keyword)
);

    console.log(`${store.name}: hasPokemon=${hasPokemon}`);

    if (!storeState[store.name]) {
      storeState[store.name] = {
        hadPokemon: false
      };
    }

    const previouslyHadPokemon = storeState[store.name].hadPokemon;

    if (!previouslyHadPokemon && hasPokemon) {
      const alertKey = `${store.name}-${Date.now()}`;

      if (!seenAlerts.has(alertKey)) {
        seenAlerts.add(alertKey);

        const channel = await client.channels.fetch(CHANNEL_ID);

        const embed = new EmbedBuilder()
          .setTitle("🔥 Pokémon Restock / New Drop Detected!")
          .setDescription(
            `Store: **${store.name}**\n` +
            `Status: **RESTOCK / NEW DROP**\n` +
            `Link: ${store.url}`
          )
          .setColor(0xFEE75C)
          .setThumbnail(store.thumbnail)
          .setTimestamp();

        await channel.send({
          embeds: [embed]
        });
      }
    }

    storeState[store.name].hadPokemon = hasPokemon;
  } catch (err) {
    console.error(`Error scanning ${store.name}:`, err);
  }
}

async function runScan() {
  console.log("Running Pokémon scan...");

  usageStats.scansRun++;

  for (const store of SOURCES) {
    await scanStore(store);
  }
}

async function sendDailyUsageReport() {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);

    const hoursRunning = (
      (Date.now() - usageStats.startTime) /
      3600000
    ).toFixed(2);

    const embed = new EmbedBuilder()
      .setTitle("📊 Daily Usage Report")
      .setColor(0x5865F2)
      .setDescription(
        `Runtime: ${hoursRunning} hours\n` +
        `Scans run: ${usageStats.scansRun}\n` +
        `Fetch calls: ${usageStats.fetchCalls}`
      )
      .setTimestamp();

    await channel.send({
      embeds: [embed]
    });
  } catch (err) {
    console.error("Daily report error:", err);
  }
}

client.once("clientReady", async () => {
  console.log(`Bot is online as ${client.user.tag}`);

  try {
    const channel = await client.channels.fetch(CHANNEL_ID);

    await channel.send(
      "✅ Pokémon Tracker is online and scanning Sam's Club."
    );
  } catch (err) {
    console.error("Startup message error:", err);
  }

  await runScan();

  setInterval(runScan, 4 * 60 * 60 * 1000);
});

client.login(process.env.DISCORD_TOKEN);
