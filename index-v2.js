const { Client, GatewayIntentBits } = require("discord.js");
const fs = require("fs");
const path = require("path");

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const CHANNEL_ID = process.env.DROPS_CHANNEL_ID;

const ZIP_CODE = "76040";
const SEARCH_RADIUS = 50;

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

async function sendProductAlert(product) {
  const channel = await client.channels.fetch(CHANNEL_ID);

  await channel.send(
    `🔥 NEW PRODUCT\n\n` +
    `Store: ${product.store}\n` +
    `Product: ${product.name}`
  );
}

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

    const pokemonMatches =
      html.match(/pokemon.{0,80}/gi) || [];

    const uniqueMatches = [
      ...new Set(pokemonMatches)
    ];

    console.log(
      "Pokemon Matches Found:",
      uniqueMatches.length
    );

    console.log(
      uniqueMatches.slice(0, 10)
    );

  } catch (err) {
    console.error(
      "Sam's Club Scan Error:",
      err
    );
  }
}

async function runScan() {
  console.log("================================");
  console.log("Starting Pokemon Scan");
  console.log("================================");

  await scanSamsClub();

  console.log("Scan Complete");
}

client.once("clientReady", async () => {
  console.log("PokemonTrackerV2 Online");
  console.log(`ZIP: ${ZIP_CODE}`);
  console.log(`Radius: ${SEARCH_RADIUS} miles`);

  await runScan();

  setInterval(runScan, 30 * 60 * 1000);
});

client.login(process.env.DISCORD_TOKEN);
