const { Client, GatewayIntentBits } = require("discord.js");
const fs = require("fs");
const path = require("path");

// =========================
// CONFIG
// =========================

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

// =========================
// PRODUCT DATABASE
// =========================

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

// =========================
// DISCORD CLIENT
// =========================

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// =========================
// ALERT SYSTEM
// =========================

async function sendProductAlert(product) {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);

    await channel.send({
      content:
        `🔥 POKÉMON PRODUCT ALERT\n\n` +
        `Store: ${product.store}\n` +
        `Product: ${product.name}\n` +
        `Location: ${product.location || "Online"}\n` +
        `Status: ${product.status || "Detected"}\n` +
        `URL: ${product.url}`
    });
  } catch (err) {
    console.error("Alert Error:", err);
  }
}

// =========================
// STORE SCANNERS
// =========================

async function scanTarget() {
  console.log("Scanning Target...");
}

async function scanSamsClub() {
  console.log("Scanning Sam's Club...");
}

async function scanCostco() {
  console.log("Scanning Costco...");
}

// =========================
// MASTER SCAN
// =========================

async function runScan() {
  console.log("Starting Pokemon Scan");

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

// =========================
// BOT READY
// =========================

client.once("clientReady", async () => {
  console.log("PokemonTrackerV2 Online");

  console.log(`ZIP: ${ZIP_CODE}`);
  console.log(`Radius: ${SEARCH_RADIUS} miles`);

  console.log("Enabled Stores:");

  for (const store of STORES) {
    if (store.enabled) {
      
