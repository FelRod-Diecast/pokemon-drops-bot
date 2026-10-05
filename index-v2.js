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

function saveProducts(data) {
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(data, null, 2));
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

const TCG_INCLUDE_TERMS = [
  "pokemon tcg",
  "pokemon trading card",
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
  "trading cards"
];

const TCG_EXCLUDE_TERMS = [
  "cake",
  "cookie",
  "cupcake",
  "costume",
  "dress-up",
  "coloring",
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
  "sock",
  "sticker collection",
  "crochet",
  "throw",
  "pillow"
];

function normalizeText(value) {
  return String(value || "")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003c/gi, "<")
    .replace(/\\u003e/gi, ">")
    .replace(/\\u0022/gi, '"')
    .replace(/\\u0027/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(value) {
  return String(value || "")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003c/gi, "<")
    .replace(/\\u003e/gi, ">")
    .replace(/\\u0022/gi, '"')
    .replace(/\\u0027/gi, "'")
    .replace(/\\"/g, '"')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isPokemonTCGProduct(productName) {
  const name = normalizeText(productName);

  if (!name || !name.includes("pokemon")) {
    return false;
  }

  for (const term of TCG_EXCLUDE_TERMS) {
    if (name.includes(term)) {
      return false;
    }
  }

  return TCG_INCLUDE_TERMS.some((term) => name.includes(normalizeText(term)));
}

// =====================================
// PRODUCT MEMORY
// =====================================

function getProductKey(store, product) {
  if (product.id) {
    return `${store}:${product.id}`;
  }

  if (product.url) {
    return `${store}:url:${normalizeText(product.url)}`;
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
    if (!CHANNEL_ID) {
      console.error("Discord Alert Error: DROPS_CHANNEL_ID is not set");
      return;
    }

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
    console.log(`Discord alert sent: ${product.store} | ${product.name}`);
  } catch (err) {
    console.error("Discord Alert Error:", err);
  }
}

// =====================================
// EXTRACTION HELPERS
// =====================================

function absoluteUrl(url, store) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;

  const host =
    store === "Sam's Club"
      ? "https://www.samsclub.com"
      : store === "Costco"
        ? "https://www.costco.com"
        : "https://www.target.com";

  return `${host}${url.startsWith("/") ? "" : "/"}${url}`;
}

function extractPrice(text) {
  const match = String(text || "").match(/\$\s?[0-9][0-9,]*(?:\.\d{2})?/);
  return match ? match[0].replace(/\s+/g, "") : null;
}

function inferAvailability(text) {
  const value = normalizeText(text);

  if (/out of stock|sold out|unavailable|not available/.test(value)) {
    return false;
  }

  if (/add to cart|available for shipping|available for pickup|in stock|available online/.test(value)) {
    return true;
  }

  return null;
}

function productIdFromUrl(url) {
  if (!url) return null;
  const match = String(url).match(/(?:\/product\.|\/)(\d{7,14})(?:[/?#.]|$)/i);
  return match ? match[1] : null;
}

function addCandidate(found, store, rawName, rawUrl, context = "") {
  const name = cleanText(rawName)
    .replace(/\s+\$\s?[0-9][0-9,]*(?:\.\d{2})?.*$/i, "")
    .trim();

  if (!isPokemonTCGProduct(name)) {
    return;
  }

  const url = absoluteUrl(cleanText(rawUrl), store);
  const combinedContext = `${name} ${context}`;
  const price = extractPrice(combinedContext);
  const available = inferAvailability(combinedContext);
  const id = productIdFromUrl(url);
  const key = id || url || normalizeText(name);

  if (!found.has(key)) {
    found.set(key, {
      id,
      name,
      url,
      price,
      available
    });
  } else {
    const existing = found.get(key);
    if (!existing.url && url) existing.url = url;
    if (!existing.price && price) existing.price = price;
    if (existing.available === null && available !== null) {
      existing.available = available;
    }
  }
}

function extractJsonLd(html, store, found) {
  const scriptRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;

  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      const data = JSON.parse(cleanText(match[1]));

      const visit = (value) => {
        if (!value) return;

        if (Array.isArray(value)) {
          for (const item of value) visit(item);
          return;
        }

        if (typeof value !== "object") return;

        const name = value.name || value.productName || value.displayName || value.title;
        const url = value.url || value.productUrl || null;

        if (name) {
          addCandidate(found, store, name, url, JSON.stringify(value));
        }

        for (const child of Object.values(value)) {
          if (child && typeof child === "object") visit(child);
        }
      };

      visit(data);
    } catch {
      // Some retailers place non-standard JSON-LD in the page. Ignore it.
    }
  }
}

function extractNamedFields(html, store, found) {
  const decoded = html
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\\u0022/gi, '"')
    .replace(/\\u0027/gi, "'")
    .replace(/\\u0026/gi, "&");

  const fieldRegex = /(?:\\?["'])(?:name|productName|displayName|productTitle|title)(?:\\?["'])\s*:\s*(?:\\?["'])([^"'\\]{3,300})(?:\\?["'])/gi;
  let match;
  let count = 0;

  while ((match = fieldRegex.exec(decoded)) !== null) {
    count++;

    const name = cleanText(match[1]);
    const start = Math.max(0, match.index - 2500);
    const end = Math.min(decoded.length, fieldRegex.lastIndex + 2500);
    const context = decoded.slice(start, end);

    const urlMatch = context.match(/href=["']([^"']+)["']|(?:url|productUrl)\s*:\s*["']([^"']+)["']/i);
    const url = urlMatch ? (urlMatch[1] || urlMatch[2] || urlMatch[0]) : null;

    addCandidate(found, store, name, url, context);
  }

  return count;
}

function extractAnchors(html, store, found) {
  const anchorRegex = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  let anchors = 0;

  while ((match = anchorRegex.exec(html)) !== null) {
    const href = cleanText(match[1]);
    const body = cleanText(match[2]);

    if (!href || !body) continue;

    const lowerHref = href.toLowerCase();
    const productLink =
      store === "Sam's Club"
        ? lowerHref.includes("/ip/")
        : lowerHref.includes("/p/") || lowerHref.includes(".product.");

    if (!productLink) continue;

    anchors++;
    addCandidate(found, store, body, href, body);
  }

  return anchors;
}

function extractVisibleProductWindows(html, store, found) {
  const linkRegex = /(?:href|url)\s*=\s*["']([^"']+)["']/gi;
  let match;
  let links = 0;

  while ((match = linkRegex.exec(html)) !== null) {
    const href = cleanText(match[1]);
    const lower = href.toLowerCase();

    const productLink =
      store === "Sam's Club"
        ? lower.includes("/ip/")
        : lower.includes("/p/") || lower.includes(".product.");

    if (!productLink) continue;

    links++;

    const start = Math.max(0, match.index - 1800);
    const end = Math.min(html.length, match.index + 3500);
    const context = cleanText(html.slice(start, end));

    const candidateRegex = /(?:pokemon|pokémon)[^.!?\n]{0,220}(?:tcg|trading card|booster|elite trainer|collection|blister|mini tin|tin|cards?)[^.!?\n]{0,100}/gi;
    let candidate;

    while ((candidate = candidateRegex.exec(context)) !== null) {
      addCandidate(found, store, candidate[0], href, context);
    }
  }

  return links;
}

async function fetchPage(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache"
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
}

async function scanStore(store, urls) {
  const found = new Map();
  let totalNamedFields = 0;
  let totalAnchors = 0;
  let totalProductLinks = 0;

  for (const url of urls) {
    try {
      console.log(`${store} request: ${url}`);
      const html = await fetchPage(url);
      console.log(`${store} downloaded ${html.length} characters`);

      extractJsonLd(html, store, found);
      totalNamedFields += extractNamedFields(html, store, found);
      totalAnchors += extractAnchors(html, store, found);
      totalProductLinks += extractVisibleProductWindows(html, store, found);
    } catch (err) {
      console.error(`${store} request error:`, err.message);
    }
  }

  console.log(
    `${store} extraction: named fields=${totalNamedFields}, product anchors=${totalAnchors}, product links=${totalProductLinks}, TCG candidates=${found.size}`
  );

  const candidates = [...found.values()];

  for (const product of candidates) {
    console.log(`${store} candidate: ${product.name}`);

    const isNew = rememberProduct(store, product);
    if (!isNew) continue;

    console.log(`NEW ${store} Pokémon TCG product: ${product.name}`);
    await sendProductAlert({
      store,
      name: product.name,
      url: product.url,
      price: product.price
    });
  }

  return candidates.length;
}

// =====================================
// STORE SCANNERS
// =====================================

async function scanSamsClub() {
  console.log("Scanning Sam's Club...");

  return scanStore("Sam's Club", [
    "https://www.samsclub.com/s/pokemon%20tcg",
    "https://www.samsclub.com/s/pokemon%20cards",
    "https://www.samsclub.com/browse/pokemon/16860219"
  ]);
}

async function scanCostco() {
  console.log("Scanning Costco...");

  return scanStore("Costco", [
    "https://www.costco.com/s?keyword=pokemon+trading+cards",
    "https://www.costco.com/s?keyword=pokemon+tcg",
    "https://www.costco.com/CatalogSearch?keyword=pokemon%20trading%20cards",
    "https://www.costco.com/CatalogSearch?keyword=pokemon%20tcg"
  ]);
}

async function scanTarget() {
  console.log("Scanning Target...");

  return scanStore("Target", [
    "https://www.target.com/s/pokemon%20tcg",
    "https://www.target.com/s/pokemon%20trading%20cards"
  ]);
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
    "Pokemon TCG Booster Pack",
    "Pokémon Binder + Poster Collection with Booster Packs",
    "Pokémon Crown Zenith Sea & Sky Premium Collection"
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
// MASTER SCAN
// =====================================

async function runScan() {
  console.log("================================");
  console.log("Starting Pokémon TCG Scan");
  console.log("================================");

  testFilter();

  const sams = await scanSamsClub();
  const costco = await scanCostco();
  const target = await scanTarget();

  console.log(
    `Scan Complete | Sam's Club: ${sams} | Costco: ${costco} | Target: ${target}`
  );
}

// =====================================
// READY EVENT
// =====================================

client.once("clientReady", async () => {
  console.log("PokemonTrackerV3 Online");
  console.log(`ZIP: ${ZIP_CODE}`);
  console.log(`Radius: ${SEARCH_RADIUS} miles`);
  console.log(`Stored products: ${Object.keys(products).length}`);

  await runScan();

  setInterval(runScan, 30 * 60 * 1000);
});

// =====================================
// LOGIN
// =====================================

client.login(process.env.DISCORD_TOKEN);
