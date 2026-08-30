const { Client, GatewayIntentBits } = require("discord.js");
const fs = require("fs");
const path = require("path");

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

// =====================================
// CONFIG
// =====================================

const CHANNEL_ID = process.env.DROPS_CHANNEL_ID;

const ZIP_CODE = "76040";
const SEARCH_RADIUS = 50;

// =====================================
// PRODUCT DATABASE
// =====================================

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

    await channel.send(
      `🔥 NEW POKÉMON PRODUCT\n\n` +
      `Store: ${product.store}\n` +
      `Product: ${product.name}`
    );
  } catch (err) {
    console.error("Alert Error:", err);
  }
}

// =====================================
// PRODUCT MEMORY
// =====================================

function rememberProduct(productName) {
  if (products[productName]) {
    return false;
  }

  products[productName] = {
    firstSeen: new Date().toISOString()
  };

  saveProducts(products);
  return true;
}

// =====================================
// SAM'S CLUB SCANNER
// =====================================

async function scanSamsClub() {
  try {
    console.log("Scanning Sam's Club...");

    const url =
      "https://www.samsclub.com/s/pokemon%20cards";

    const response = await fetch(url);

    const html = await response.text();

    console.log(
      `Downloaded ${html.length} characters`
    );

    const productNames = [];

    const nameMatches =
      html.match(/"name":"[^"]+"/gi) || [];

    for (const match of nameMatches) {
      const productName = match
        .replace('"name":"', "")
        .replace('"', "")
        .trim();

      if (
        productName.toLowerCase().includes("pokemon")
      ) {
        productNames.push(productName);
      }
    }

    const uniqueProducts = [
      ...new Set(productNames)
    ];

    console.log(
      `Pokemon Products Found: ${uniqueProducts.length}`
    );

    console.log(
      uniqueProducts.slice(0, 25)
    );

    for (const product of uniqueProducts) {
      const isNewProduct =
        rememberProduct(product);

      if (!isNewProduct) continue;

      console.log(
        `New Product Detected: ${product}`
      );

      await sendProductAlert({
        store: "Sam's Club",
        name: product
      });
    }
  } catch (err) {
    console.error(
      "
