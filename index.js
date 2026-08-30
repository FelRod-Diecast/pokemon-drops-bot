const { Client, GatewayIntentBits, EmbedBuilder } = require("discord.js");

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const CHANNEL_ID = process.env.DROPS_CHANNEL_ID;

const SOURCES = [
  {
    name: "Sam's Club Pokemon Cards",
    url: "https://www.samsclub.com/s/pokemon%20cards",
    thumbnail:
      "https://upload.wikimedia.org/wikipedia/commons/5/5f/Sams_Club_logo.svg"
  }
];

const knownProducts = new Set();

async function trackedFetch(url) {
  console.log(`Fetching: ${url}`);

  const response = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }
  });

  console.log(`Success: ${url}`);

  return response;
}

async function scanStore(store) {
  try {
    const res = await trackedFetch(store.url);
    const html = await res.text();

    console.log(`Downloaded ${html.length} characters`);

    const rawMatches =
      html.match(
        /pokemon.{0,100}(card|tcg|booster|bundle|elite trainer|etb|collection|battle deck|tin)/gi
      ) || [];

    const products = [...new Set(rawMatches)].filter((product) => {
      const p = product.toLowerCase();

      return (
        p.includes("card") ||
        p.includes("tcg") ||
        p.includes("booster") ||
        p.includes("bundle") ||
        p.includes("elite trainer") ||
        p.includes("etb") ||
        p.includes("collection") ||
        p.includes("battle deck") ||
        p.includes("tin")
      );
    });

    console.log("Products Found:", products);

    if (products.length === 0) {
      return;
    }

    const channel = await client.channels.fetch(CHANNEL_ID);

    for (const product of products) {
      if (knownProducts.has(product)) continue;

      knownProducts.add(product);

      const embed = new EmbedBuilder()
        .setTitle("🔥 Pokémon TCG Product Detected")
        .setColor(0xFEE75C)
        .setThumbnail(store.thumbnail)
        .addFields(
          {
            name: "Store",
            value: store.name
          },
          {
            name: "Product Found",
            value: product.substring(0, 1024)
          }
        )
        .setURL(store.url)
        .setTimestamp();

      await channel.send({
        embeds: [embed]
      });

      console.log(`Alert sent: ${product}`);
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
      "✅ Pokémon Tracker Online - Monitoring Pokémon cards, bundles, ETBs, booster packs, tins, and collections."
    );
  } catch (err) {
    console.error("Startup message error:", err);
  }

  await runScan();

  setInterval(runScan, 60 * 60 * 1000);
});

client.login(process.env.DISCORD_TOKEN);
