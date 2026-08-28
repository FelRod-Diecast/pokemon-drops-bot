const { Client, GatewayIntentBits } = require('discord.js');
const fetch = require('node-fetch');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const CHANNEL_ID = process.env.DROPS_CHANNEL_ID;

// Online sources to scan
const SOURCES = [
  {
    name: "Sam's Club (Online)",
    url: "https://www.samsclub.com/s/pokemon"
  },
  {
    name: "Costco (Online)",
    url: "https://www.costco.com/CatalogSearch?dept=All&keyword=pokemon"
  }
];

// Prevent duplicate alerts
let seenItems = new Set();

// Usage stats
let usageStats = {
  fetchCalls: 0,
  scansRun: 0,
  startTime: Date.now()
};

// Tracked fetch for usage monitoring
async function trackedFetch(url) {
  usageStats.fetchCalls++;
  return fetch(url);
}

async function scanStore(store) {
  try {
    const res = await trackedFetch(store.url);
    const html = await res.text();

    // Look for any "pokemon" mention – all Pokémon cards/products
    const matches = html.match(/pokemon/gi);

    if (matches && matches.length > 0) {
      const alertKey = `${store.name}-${Date.now()}`;

      if (!seenItems.has(alertKey)) {
        seenItems.add(alertKey);

        const channel = await client.channels.fetch(CHANNEL_ID);
        await channel.send(
          `🔥 **POKÉMON DROP DETECTED!**\nStore: **${store.name}**\nLink: ${store.url}`
        );
      }
    }
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

// Daily usage report
async function sendDailyUsageReport() {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);

    const hoursRunning = ((Date.now() - usageStats.startTime) / 3600000).toFixed(2);
    const estimatedCost = (usageStats.fetchCalls * 0.00002).toFixed(4);
    const remainingCredit = (5 - estimatedCost).toFixed(2);

    await channel.send(
      `📊 **Daily Usage Report**\n` +
      `• Runtime: **${hoursRunning} hours**\n` +
      `• Scans run: **${usageStats.scansRun}**\n` +
      `• Fetch calls: **${usageStats.fetchCalls}**\n` +
      `• Estimated cost today: **$${estimatedCost}**\n` +
      `• Free credit remaining (approx): **$${remainingCredit}**`
    );

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

  // Test message on startup
  const channel = await client.channels.fetch(CHANNEL_ID);
  await channel.send("✅ Bot is online and scanner is active (Sam's + Costco online)!");

  // Run initial scan
  runScan();

  // Scan every 4 hours
  setInterval(runScan, 4 * 60 * 60 * 1000);

  // Start daily usage report
  scheduleDailyReport();
});

client.login(process.env.DISCORD_TOKEN);
