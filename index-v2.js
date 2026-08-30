const { Client, GatewayIntentBits } = require("discord.js");
const fs = require("fs");
const path = require("path");

// =====================================
// CONFIG
// =====================================

const CHANNEL_ID = process.env.DROPS_CHANNEL_ID;

const ZIP_CODE = "76040";
const SEARCH_RADIUS = 50;

const STORES = [
  {
    name: "Target",
    enabled: true
  },
  {
    name: "Sam's Club",
    enabled: true
  },
  {
    name: "Costco",
    enabled: true
  }
];

// Pokémon TCG product types we care about
const PRODUCT_KEYWORDS = [
  "booster pack",
  "booster bundle",
  "elite trainer box",
  "etb",
  "collection box",
  "premium collection",
  "battle deck",
  "tin",
  "mini tin",
  "pokemon tcg",
  "pokemon cards"
];

// =====================================
// PRODUCT DATABASE
// =====================================

const PRODUCTS_FILE = path.join(__dirname, "products.json");

function loadProducts() {
  try {
    return JSON.parse(
      fs.readFileSync(PRODUCTS_FILE, "utf8")
    );
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

// =====================================
// DISCORD CLIENT
// =====================================

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// =====================================
// ALERT SYSTEM
// =====================================

async function sendProductAlert(product) {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);

    await channel.send({
      content:
        `🔥 POKÉMON PRODUCT ALERT\n\n` +
        `Store: ${product.store}\n` +
        `Product: ${product.name}\n` +
        `Location: ${product.location || "Online"}\n` +
        `Status: ${product.status || "New Product"}\n` +
        `URL: ${product.url || "N/A"}`
    });
  } catch (err) {
    console.error("Alert Error:", err);
  }
}

// =====================================
// PRODUCT TRACKING
// =====================================

function rememberProduct(productId, productData) {
  if (products[productId]) {
    return false;
  }

  products[productId] = {
    ...productData,
    firstSeen: new Date().toISOString()
  };

  saveProducts(products);

  return true;
}

// =====================================
// STORE SCANNERS
// =====================================

async function scanTarget() {
  console.log("Scanning Target...");

  // TODO:
  // Search Pokemon TCG products
  // Filter for ZIP 76040
  // Filter within 50 miles
  // Compare against products.json
}

async function scanSamsClub() {
  console.log("Scanning Sam's Club...");

  // TODO:
  // Search Pokemon TCG products
  // Compare against products.json
}

async function scanCostco() {
  console.log("Scanning Costco...");

  // TODO:
  // Search Pokemon TCG products
  // Compare against products.json
}

// =====================================
// MASTER SCAN
// =====================================

async function runScan() {
  console.log("================================");
  console.log("Starting Pokemon Scan");
  console.log(`ZIP: ${ZIP_CODE}`);
  console.log(`Radius: ${SEARCH_RADIUS} miles`);
  console.log("================================");

  if (STORES.find(s => s.name === "Target")?.enabled) {
    await scanTarget();
  }

  if (STORES.find(s => s.name === "Sam's Club")?.enabled) {
    await scanSamsClub();
  }

  if (STORES.find(s => s.name === "Costco")?.enabled) {
    await scanCostco();
  }

  console.log("Scan Complete");
}

// =====================================
// READY EVENT
// =====================================

client.once("clientReady", async () => {
  console.log("PokemonTrackerV2 Online");
  console.log(`ZIP: ${ZIP_CODE}`);
  console.log(`Radius: ${SEARCH_RADIUS} miles`);

  console.log("Enabled Stores:");

  for (const store of STORES) {
    if (store.enabled) {
      console.log(`- ${store.name}`);
    }
  }

  await runScan();

  // Every 30 minutes
  setInterval(runScan, 30 * 60 * 1000);
});

// =====================================
// LOGIN
// =====================================

client.login(process.env.DISCORD_TOKEN);
