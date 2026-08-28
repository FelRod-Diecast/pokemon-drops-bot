const { Client, GatewayIntentBits } = require('discord.js');
const fetch = require('node-fetch');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const CHANNEL_ID = process.env.DROPS_CHANNEL_ID;

// URLs to scan
const SOURCES = [
  {
    name: "Sam's Club",
    url: "https://www.samsclub.com/s/pokemon"
  },
  {
    name: "Costco",
    url: "https://www.costco.com/CatalogSearch?dept=All&keyword=pokemon"
  },
  {
    name: "Target",
    url: "https://www.target.com/s?searchTerm=pokemon+cards"
  }
];

// Prevent duplicate alerts
let seenItems = new Set();

async function scanStore(store) {
  try {
    const res = await fetch(store.url);
    const html = await res.text();

    // Basic Pokémon keyword detection
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
  for (const store of SOURCES) {
    await scanStore(store);
  }
}

client.once('ready', () => {
  console.log(`Bot is online as ${client.user.tag}`);

  // Run immediately
  runScan();

  // Run every 4 hours
  setInterval(runScan, 4 * 60 * 60 * 1000);
});

client.login(process.env.DISCORD_TOKEN);
