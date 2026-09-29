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

const PRODUCTS_FILE = path.join(__dirname, "products.json");

// =====================================
// PRODUCT DATABASE
// =====================================

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
// POKÉMON TCG FILTER
// =====================================

// Words that strongly indicate an actual Pokémon TCG product.
const TCG_INCLUDE_TERMS = [
  "pokemon tcg",
  "pokémon tcg",
  "pokemon trading card",
  "pokémon trading card",
  "trading card game",
  "booster pack",
  "booster bundle",
  "booster box",
  "booster display",
  "elite trainer box",
  "trainer box",
  "collection box",
  "premium collection",
  "special collection",
  "collector chest",
  "mini tin",
  "tin",
  "blister",
  "3-pack blister",
  "checklane blister",
  "pokemon cards",
  "pokémon cards"
];

// Words that identify Pokémon merchandise that we DON'T want.
const TCG_EXCLUDE_TERMS = [
  "cake",
  "cookie",
  "cupcake",
  "costume",
  "dress-up",
  "coloring",
  "coloring book",
  "coloring kit",
  "activity book",
  "storybook",
  "book",
  "manual",
  "plush",
  "stuffed animal",
  "toy",
  "figure",
  "figurine",
  "puzzle",
  "backpack",
  "clothing",
  "shirt",
  "t-shirt",
  "hat",
  "costume",
  "nintendo switch",
  "switch game",
  "video game",
  "dvd",
  "movie",
  "snack",
  "candy",
  "cereal",
  "cup",
  "plate",
  "party",
  "decoration",
  "bedding",
  "blanket",
  "shoe",
  "sock"
];

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isPokemonTCGProduct(productName) {
  const name = normalizeText(productName);

  if (!name) {
    return false;
  }

  // It must actually mention Pokémon.
  const mentionsPokemon =
    name.includes("pokemon");

  if (!mentionsPokemon) {
    return false;
  }

  // Immediately reject obvious non-TCG merchandise.
  for (const term of TCG_EXCLUDE_TERMS) {
    if (name.includes(term)) {
      return false;
    }
  }

  // Accept if it contains a strong TCG indicator.
  for (const term of TCG_INCLUDE_TERMS) {
    if (name.includes(normalizeText(term))) {
      return true;
    }
  }

  return false;
}

// =====================================
// PRODUCT MEMORY
// =====================================

function getProductKey(store, product) {
  if (product.id) {
    return `${store}:${product.id}`;
  }

  return `${store}:${normalizeText(product.name)}`;
}

function rememberProduct(store, product) {
  const key = getProductKey(store, product);

  if (products[key]) {
    return false;
  }

  products[key] = {
    store,
    id: product.id || null,
    name: product.name,
    url: product.url || null,
    price: product.price || null,
    firstSeen: new Date().toISOString()
  };

  saveProducts(products);

  return true;
}

// =====================================
// DISCORD ALERT
// =====================================

async function sendProductAlert(product) {
  try {
    const channel = await client.channels.fetch(CHANNEL_ID);

    let message =
      `🔥 **NEW POKÉMON TCG PRODUCT**\n\n` +
      `**Store:** ${product.store}\n` +
      `**Product:** ${product.name}`;

    if (product.price) {
      message += `\n**Price:** ${product.price}`;
    }

    if (product.url) {
      message += `\n**Link:** ${product.url}`;
    }

    await channel.send(message);
  } catch (err) {
    console.error("Discord Alert Error:", err);
  }
}

// =====================================
// TEST FILTER
// =====================================

function testFilter() {
  const testProducts = [
    "Pokemon Popkopia – Nintendo Switch 2",
    "Pokemon Half Sheet Cookie Cake",
    "Pokemon Two-Tier Cake",
    "Pokemon Cupcakes, 30 ct.",
    "Pokemon Charizard Children's Deluxe Costume",
    "Crayola Coloring Kit, Pokemon & Blue",
    "Pokemon – The Essential Trainer Manual",

    "Pokemon TCG Elite Trainer Box",
    "Pokemon TCG Booster Bundle",
    "Pokemon Trading Card Game Collection Box",
    "Pokemon TCG Booster Pack"
  ];

  console.log("");
  console.log("================================");
  console.log("POKÉMON TCG FILTER TEST");
  console.log("================================");

  for (const name of testProducts) {
    console.log(
      `${isPokemonTCGProduct(name) ? "✅ KEEP" : "❌ IGNORE"} | ${name}`
    );
  }

  console.log("================================");
  console.log("");
}

// =====================================
// SAM'S CLUB SCANNER
// =====================================

async function scanSamsClub() {
  try {
    console.log("Scanning Sam's Club...");

    const url =
      "https://www.samsclub.com/s/pokemon%20cards";

    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36"
      }
    });

    if (!response.ok) {
      throw new Error(
        `Sam's Club HTTP ${response.status}`
      );
    }

    const html = await response.text();

    console.log(
      `Sam's Club downloaded ${html.length} characters`
    );

    const productNames = [];

    const nameMatches =
      html.match(/"name":"[^"]+"/gi) || [];

    for (const match of nameMatches) {
      const productName = match
        .replace('"name":"', "")
        .replace('"', "")
        .trim();

      if (!isPokemonTCGProduct(productName)) {
        continue;
      }

      productNames.push(productName);
    }

    const uniqueProducts = [
      ...new Set(productNames)
    ];

    console.log(
      `Sam's Club Pokémon TCG products found: ${uniqueProducts.length}`
    );

    for (const productName of uniqueProducts) {
      const product = {
        name: productName
      };

      const isNew = rememberProduct(
        "Sam's Club",
        product
      );

      if (!isNew) {
        continue;
      }

      console.log(
        `NEW Sam's Club Pokémon TCG product: ${productName}`
      );

      await sendProductAlert({
        store: "Sam's Club",
        name: productName
      });
    }
  } catch (err) {
    console.error(
      "Sam's Club Scan Error:",
      err
    );
  }
}

// =====================================
// COSTCO SCANNER
// =====================================

async function scanCostco() {
  console.log("Costco scanner: coming next.");
}

// =====================================
// TARGET SCANNER
// =====================================

async function scanTarget() {
  console.log("Target scanner: coming next.");
}

// =====================================
// MASTER SCAN
// =====================================

async function runScan() {
  console.log("================================");
  console.log("Starting Pokémon TCG Scan");
  console.log("================================");

  testFilter();

  await scanSamsClub();
  await scanCostco();
  await scanTarget();

  console.log("Scan Complete");
}

// =====================================
// READY EVENT
// =====================================

client.once("clientReady", async () => {
  console.log("PokemonTrackerV3 Online");
  console.log(`ZIP: ${ZIP_CODE}`);
  console.log(`Radius: ${SEARCH_RADIUS} miles`);

  await runScan();

  setInterval(
    runScan,
    30 * 60 * 1000
  );
});

// =====================================
// LOGIN
// =====================================

client.login(
  process.env.DISCORD_TOKEN
);
