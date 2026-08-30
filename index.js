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

const knownProducts = new Set();

async function trackedFetch(url) {
  console.log(`Fetching: ${url}`);

  const response = await fetch(url);

  console.log(`Success: ${url}`);

  return response;
}

async function scanStore(store) {
  try {
    const res = await trackedFetch(store.url);
    const html = await res.text();

    console.log(`Downloaded ${html.length} characters`);

   const cardKeywords = [
  "pokemon cards",
  "pokemon trading card game",
  "pokemon tcg",
  "booster pack",
  "booster bundle",
  "bundle",
  "elite trainer box",
  "etb",
  "collection box",
  "premium collection",
  "trainer box",
  "battle deck",
  "tin",
  "3 pack blister",
  "6 pack booster",
  "pokemon bundle"
];

    const matches = [];

    cardKeywords.forEach(keyword => {
      if (html.toLowerCase().includes(keyword)) {
        matches.push(keyword);
      }
    });

    console.log("Matches:", matches);

    if (matches.length === 0) {
      return;
    }

    for (const match of matches) {
      if (knownProducts.has(match)) continue;

      knownProducts.add(match);

      const channel = await client.channels.fetch(CHANNEL_ID);

      const embed = new EmbedBuilder()
        .setTitle("🔥 Pokémon TCG Product Detected")
        .setColor(0xFEE75C)
        .setThumbnail(store.thumbnail)
        .addFields(
          { name: "Store", value: store.name },
          { name: "Keyword Found", value: match }
        )
        .setURL(store.url)
        .setTimestamp();

      await channel.send({
        embeds: [embed]
      });
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

client.once("clientReady", async () => {
  console.log(`Bot is online as ${client.user.tag}`);

  try {
    const channel = await client.channels.fetch(CHANNEL_ID);

    await channel.send(
      "✅ Pokémon Tracker Online - Monitoring Sam's Club for Pokémon TCG products."
    );
  } catch (err) {
    console.error(err);
  }

  await runScan();

  setInterval(runScan, 60 * 60 * 1000);
});

client.login(process.env.DISCORD_TOKEN);
