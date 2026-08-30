const { Client, GatewayIntentBits } = require("discord.js");
const fs = require("fs");
const path = require("path");

const PRODUCTS_FILE = path.join(__dirname, "products.json");

function loadProducts() {
  try {
    return JSON.parse(fs.readFileSync(PRODUCTS_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveProducts(products) {
  fs.writeFileSync(
    PRODUCTS_FILE,
    JSON.stringify(products, null, 2)
  );
}

const products = loadProducts();

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const CHANNEL_ID = process.env.DROPS_CHANNEL_ID;

async function sendProductAlert(product) {
  const channel = await client.channels.fetch(CHANNEL_ID);

  await channel.send({
    content:
      `🔥 NEW POKÉMON PRODUCT\n\n` +
      `Store: ${product.store}\n` +
      `Product: ${product.name}\n` +
      `URL: ${product.url}`
  });
}

client.once("clientReady", async () => {
  console.log("PokemonTrackerV2 Online");

 console.log("Tracker startup test passed");

  // Target Scanner
  // Sam's Scanner
  // Costco Scanner
});

client.login(process.env.DISCORD_TOKEN);
