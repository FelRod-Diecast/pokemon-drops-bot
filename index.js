const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const fetch = (...args) =>
import('node-fetch').then(({ default: fetch }) => fetch(...args));

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const CHANNEL_ID = process.env.DROPS_CHANNEL_ID;

// Online sources to scan
const SOURCES = [
  {
    name: "Sam's Club (Online)",
    url: "https://www.samsclub.com/s/pokemon",
    thumbnail: "https://upload.wikimedia.org/wikipedia/commons/5/5f/Sams_Club_logo.svg"
  }
];

// Track per-store state for restock detection
const storeState = {};

// Prevent duplicate alerts in a short window
let seenAlerts = new Set();

// Usage stats
let usageStats = {
  fetchCalls: 0,
  scansRun: 0,
  startTime: Date.now()
};

// Tracked fetch for usage monitoring
async function trackedFetch(url) {
console.log(`Fetching: ${url}`);
 
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

    const hasPokemon = !!html.match(/pokemon/gi);

    if (!storeState[store.name]) {
      storeState[store.name] = { hadPokemon: false };
    }

    const previouslyHadPokemon = storeState[store.name].hadPokemon;

    // Restock / new drop detection:
    // - previouslyHadPokemon === false
    // - hasPokemon === true
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
          .setColor(0xFEE75C) // yellow-ish
          .setThumbnail(store.thumbnail)
          .setFooter({ text: "All Pokémon products (keyword: pokemon)" })
          .setTimestamp();

        await channel.send({ embeds: [embed] });
      }
    }

    // Update state
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

  // Clean up old alert keys occasionally
  if (seenAlerts.size > 1000) {
    seenAlerts.clear();
  }
}

// Daily usage report
async function sendDailyUsageReport() {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);

    const hoursRunning = ((Date.now() - usageStats.startTime) / 3600000).toFixed(2);
    const estimatedCost = (usageStats.fetchCalls * 0.00002).toFixed(4);
    const remainingCredit = (5 - estimatedCost).toFixed(2);

    const embed = new EmbedBuilder()
      .setTitle("📊 Daily Usage Report")
      .setColor(0x5865F2)
      .setDescription(
        `• Runtime: **${hoursRunning} hours**\n` +
        `• Scans run: **${usageStats.scansRun}**\n` +
        `• Fetch calls: **${usageStats.fetchCalls}**\n` +
        `• Estimated cost today: **$${estimatedCost}**\n` +
        `• Free credit remaining (approx): **$${remainingCredit}**`
      )
      .setTimestamp();

    await channel.send({ embeds: [embed] });

    // Reset daily stats
    usageStats.fetchCalls = 0;
    usageStats.scansRun = 0;
    usageStats.startTime = Date.now();
  } catch (err) {
    console.error("Error sending daily usage report:", err);
  }
}

// Schedule daily report at noon CST
function scheduleDailyReport() {
  const now = new Date();
  const nextNoon = new Date();

  nextNoon.setHours(12, 0, 0, 0);

  if (now > nextNoon) {
    nextNoon.setDate(nextNoon.getDate() + 1);
  }

  const msUntilNoon = nextNoon - now;

  setTimeout(() => {
    sendDailyUsageReport();
    setInterval(sendDailyUsageReport, 24 * 60 * 60 * 1000);
  }, msUntilNoon);
}

client.once('ready', async () => {
  console.log(`Bot is online as ${client.user.tag}`);

  const channel = await client.channels.fetch(CHANNEL_ID);
  await channel.send("✅ Bot is online — restock detection + thumbnails enabled for Sam's & Costco!");

  // Run initial scan
  runScan();

  // Scan every 4 hours
  setInterval(runScan, 4 * 60 * 60 * 1000);

  // Start daily usage report
  scheduleDailyReport();
});

client.login(process.env.DISCORD_TOKEN);
