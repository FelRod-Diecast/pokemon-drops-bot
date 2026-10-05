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
  try { return JSON.parse(fs.readFileSync(PRODUCTS_FILE, "utf8")); }
  catch { return {}; }
}
function saveProducts(data) {
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(data, null, 2));
}
const products = loadProducts();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const TCG_INCLUDE_TERMS = [
  "pokemon tcg","pokemon trading card","trading card game","booster pack",
  "booster bundle","booster box","booster display","elite trainer box",
  "trainer box","collection box","premium collection","special collection",
  "collector chest","mini tin","tin","blister","3-pack blister",
  "checklane blister","pokemon cards","trading cards"
];
const TCG_EXCLUDE_TERMS = [
  "cake","cookie","cupcake","costume","dress-up","coloring","activity book",
  "storybook","book","manual","plush","stuffed animal","toy","figure",
  "figurine","puzzle","backpack","clothing","shirt","t-shirt","hat",
  "nintendo switch","switch game","video game","dvd","movie","snack",
  "candy","cereal","cup","plate","party","decoration","bedding","blanket",
  "shoe","sock","sticker collection","crochet","throw","pillow"
];

function normalizeText(value) {
  return String(value || "")
    .replace(/\\u0026/gi, "&").replace(/\\u003c/gi, "<")
    .replace(/\\u003e/gi, ">").replace(/\\u0022/gi, '"')
    .replace(/\\u0027/gi, "'").replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'").replace(/&amp;/gi, "&")
    .replace(/&nbsp;/gi, " ").replace(/<[^>]+>/g, " ")
    .toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ").trim();
}
function cleanText(value) {
  return String(value || "")
    .replace(/\\u0026/gi, "&").replace(/\\u003c/gi, "<")
    .replace(/\\u003e/gi, ">").replace(/\\u0022/gi, '"')
    .replace(/\\u0027/gi, "'").replace(/\\"/g, '"')
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&").replace(/&nbsp;/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
function isPokemonTCGProduct(name) {
  const value = normalizeText(name);
  if (!value || !value.includes("pokemon")) return false;
  if (TCG_EXCLUDE_TERMS.some(term => value.includes(term))) return false;
  return TCG_INCLUDE_TERMS.some(term => value.includes(normalizeText(term)));
}
function isSpecificTCGProductName(name) {
  return !new Set([
    "pokemon tcg","pokemon trading cards","pokemon trading card",
    "pokemon cards","trading cards","trading card game"
  ]).has(normalizeText(name));
}
function absoluteUrl(url, store) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  const host = store === "Sam's Club" ? "https://www.samsclub.com"
    : store === "Costco" ? "https://www.costco.com" : "https://www.target.com";
  return `${host}${url.startsWith("/") ? "" : "/"}${url}`;
}
function productIdFromUrl(url) {
  if (!url) return null;
  const value = String(url);
  const patterns = [
    /\/A-(\d{7,14})(?:[/?#]|$)/i,
    /\/product\.(\d{7,14})(?:[/?#.]|$)/i,
    /\/(?:ip|p)\/[^/]+\/(\d{7,14})(?:[/?#]|$)/i,
    /[?&]partNumbers=(\d{7,14})(?:[&#]|$)/i
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) return match[1];
  }
  return null;
}
function isProductUrl(url, store) {
  if (!url) return false;
  const value = String(url).toLowerCase();
  if (store === "Sam's Club") return value.includes("/ip/") || value.includes("/p/");
  if (store === "Costco") return value.includes("/p/") || value.includes(".product.") || value.includes("compareproductsdisplay?partnumbers=");
  return value.includes("/p/") || value.includes(".product.");
}
function deriveProductUrl(context, store) {
  const text = String(context || "");
  if (store === "Target") {
    const tcin = text.match(/(?:\bA-|["']tcin["']\s*:\s*["']?)(\d{7,14})/i);
    if (tcin) return `https://www.target.com/p/-/A-${tcin[1]}`;
  }
  if (store === "Costco") {
    const direct = text.match(/(?:productUrl|productURL|url)\s*[:=]\s*["']([^"']+)["']/i);
    if (direct && isProductUrl(absoluteUrl(direct[1], store), store)) return absoluteUrl(direct[1], store);
    const id = text.match(/(?:product[_-]?id|partNumber|partNumbers|itemNumber|sku)\s*["']?\s*[:=]\s*["']?(\d{7,14})/i);
    if (id) return `https://www.costco.com/CompareProductsDisplay?partNumbers=${id[1]}`;
  }
  if (store === "Sam's Club") {
    const direct = text.match(/(?:itemPageUrl|productUrl|url)\s*[:=]\s*["']([^"']+)["']/i);
    if (direct) return absoluteUrl(direct[1], store);
  }
  return null;
}
function extractPrice(text) {
  const match = String(text || "").match(/\$\s?[0-9][0-9,]*(?:\.\d{2})?/);
  return match ? match[0].replace(/\s+/g, "") : null;
}
function inferAvailability(text) {
  const value = normalizeText(text);
  if (/out of stock|sold out|unavailable|not available/.test(value)) return false;
  if (/add to cart|available for shipping|available for pickup|in stock|available online/.test(value)) return true;
  return null;
}
function getProductKey(store, product) {
  if (product.id) return `${store}:${product.id}`;
  if (product.url) return `${store}:url:${normalizeText(product.url)}`;
  return `${store}:${normalizeText(product.name)}`;
}
function rememberProduct(store, product) {
  const key = getProductKey(store, product);
  if (products[key]) return false;
  products[key] = { store, id: product.id || null, name: product.name, url: product.url || null, price: product.price || null, firstSeen: new Date().toISOString() };
  saveProducts(products);
  return true;
}
async function sendProductAlert(product) {
  try {
    if (!CHANNEL_ID) return console.error("Discord Alert Error: DROPS_CHANNEL_ID is not set");
    const channel = await client.channels.fetch(CHANNEL_ID);
    let message = `🔥 **NEW POKÉMON TCG PRODUCT**\n\n**Store:** ${product.store}\n**Product:** ${product.name}`;
    if (product.price) message += `\n**Price:** ${product.price}`;
    if (product.url) message += `\n**Link:** ${product.url}`;
    await channel.send(message);
    console.log(`Discord alert sent: ${product.store} | ${product.name}`);
  } catch (err) { console.error("Discord Alert Error:", err); }
}
function addCandidate(found, store, rawName, rawUrl, context = "") {
  const name = cleanText(rawName).replace(/\s+\$\s?[0-9][0-9,]*(?:\.\d{2})?.*$/i, "").trim();
  if (!isPokemonTCGProduct(name) || !isSpecificTCGProductName(name)) return;
  let url = absoluteUrl(cleanText(rawUrl), store);
  if (!isProductUrl(url, store)) url = deriveProductUrl(context, store);
  if (!isProductUrl(url, store)) return;
  const combined = `${name} ${context}`;
  const product = { id: productIdFromUrl(url), name, url, price: extractPrice(combined), available: inferAvailability(combined) };
  const key = product.id || url || normalizeText(name);
  const existing = found.get(key);
  if (!existing) found.set(key, product);
  else {
    if (!existing.url && product.url) existing.url = product.url;
    if (!existing.price && product.price) existing.price = product.price;
    if (existing.available === null && product.available !== null) existing.available = product.available;
  }
}
function extractJsonLd(html, store, found) {
  const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html))) {
    try {
      const data = JSON.parse(cleanText(match[1]));
      const visit = value => {
        if (!value) return;
        if (Array.isArray(value)) return value.forEach(visit);
        if (typeof value !== "object") return;
        const name = value.name || value.productName || value.displayName || value.title;
        const url = value.url || value.productUrl || value.itemPageUrl || null;
        if (name) addCandidate(found, store, name, url, JSON.stringify(value));
        Object.values(value).forEach(child => { if (child && typeof child === "object") visit(child); });
      };
      visit(data);
    } catch {}
  }
}
function extractNamedFields(html, store, found) {
  const decoded = html.replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&amp;/gi, "&").replace(/\\u0022/gi, '"').replace(/\\u0027/gi, "'").replace(/\\u0026/gi, "&");
  const regex = /(?:\\?["'])(?:name|productName|displayName|productTitle|title)(?:\\?["'])\s*:\s*(?:\\?["'])([^"'\\]{3,300})(?:\\?["'])/gi;
  let match, count = 0;
  while ((match = regex.exec(decoded))) {
    count++;
    const name = cleanText(match[1]);
    const start = Math.max(0, match.index - 4000);
    const end = Math.min(decoded.length, regex.lastIndex + 4000);
    const context = decoded.slice(start, end);
    const urlMatch = context.match(/(?:href|url|productUrl|productURL|itemPageUrl|productLink|canonicalUrl)\s*[:=]\s*["']([^"']+)["']/i);
    const url = urlMatch ? urlMatch[1] : null;
    addCandidate(found, store, name, url, context);
  }
  return count;
}
function extractAnchors(html, store, found) {
  const regex = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match, count = 0;
  while ((match = regex.exec(html))) {
    const href = cleanText(match[1]);
    const body = cleanText(match[2]);
    if (!href || !body || !isProductUrl(href, store)) continue;
    count++;
    addCandidate(found, store, body, href, body);
  }
  return count;
}
function extractVisibleProductWindows(html, store, found) {
  const regex = /(?:href|url|productUrl|itemPageUrl)\s*[:=]\s*["']([^"']+)["']/gi;
  let match, count = 0;
  while ((match = regex.exec(html))) {
    const href = cleanText(match[1]);
    if (!isProductUrl(href, store)) continue;
    count++;
    const start = Math.max(0, match.index - 2500);
    const end = Math.min(html.length, match.index + 4500);
    const context = cleanText(html.slice(start, end));
    const candidates = /(?:pokemon|pokémon)[^.!?\n]{0,260}(?:tcg|trading card|booster|elite trainer|collection|blister|mini tin|tin|cards?)[^.!?\n]{0,120}/gi;
    let candidate;
    while ((candidate = candidates.exec(context))) addCandidate(found, store, candidate[0], href, context);
  }
  return count;
}
async function fetchPage(url) {
  const response = await fetch(url, { redirect: "follow", headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9", "Cache-Control": "no-cache"
  }});
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}
async function scanStore(store, urls) {
  const found = new Map();
  let named = 0, anchors = 0, links = 0;
  for (const url of urls) {
    try {
      console.log(`${store} request: ${url}`);
      const html = await fetchPage(url);
      console.log(`${store} downloaded ${html.length} characters`);
      if (store === "Sam's Club" && /are-you-human|let us know you're not a robot|robots? only/i.test(html)) {
        console.warn(`${store} response is a bot/challenge page; product HTML was not returned`);
        continue;
      }
      extractJsonLd(html, store, found);
      named += extractNamedFields(html, store, found);
      anchors += extractAnchors(html, store, found);
      links += extractVisibleProductWindows(html, store, found);
    } catch (err) { console.error(`${store} request error:`, err.message); }
  }
  console.log(`${store} extraction: named fields=${named}, product anchors=${anchors}, product links=${links}, TCG candidates=${found.size}`);
  for (const product of found.values()) {
    console.log(`${store} candidate: ${product.name} | ${product.url}`);
    if (!rememberProduct(store, product)) continue;
    console.log(`NEW ${store} Pokémon TCG product: ${product.name}`);
    await sendProductAlert({ store, name: product.name, url: product.url, price: product.price });
  }
  return found.size;
}
async function scanSamsClub() {
  console.log("Scanning Sam's Club...");
  return scanStore("Sam's Club", ["https://www.samsclub.com/s/pokemon%20tcg","https://www.samsclub.com/s/pokemon%20cards","https://www.samsclub.com/browse/pokemon/16860219"]);
}
async function scanCostco() {
  console.log("Scanning Costco...");
  return scanStore("Costco", ["https://www.costco.com/s?keyword=pokemon+trading+cards","https://www.costco.com/s?keyword=pokemon+tcg","https://www.costco.com/CatalogSearch?keyword=pokemon%20trading%20cards","https://www.costco.com/CatalogSearch?keyword=pokemon%20tcg"]);
}
async function scanTarget() {
  console.log("Scanning Target...");
  return scanStore("Target", ["https://www.target.com/s/pokemon%20tcg","https://www.target.com/s/pokemon%20trading%20cards"]);
}
function testFilter() {
  const tests = ["Pokemon Popkopia – Nintendo Switch 2","Pokemon Half Sheet Cookie Cake","Pokemon Two-Tier Cake","Pokemon Cupcakes, 30 ct.","Pokemon Charizard Children's Deluxe Costume","Crayola Coloring Kit, Pokemon & Blue","Pokemon – The Essential Trainer Manual","Pokemon TCG Elite Trainer Box","Pokemon TCG Booster Bundle","Pokemon Trading Card Game Collection Box","Pokemon TCG Booster Pack","Pokémon Binder + Poster Collection with Booster Packs","Pokémon Crown Zenith Sea & Sky Premium Collection"];
  console.log("================================\nPOKÉMON TCG FILTER TEST\n================================");
  for (const name of tests) console.log(`${isPokemonTCGProduct(name) ? "✅ KEEP" : "❌ IGNORE"} | ${name}`);
  console.log("================================");
}
async function runScan() {
  console.log("================================\nStarting Pokémon TCG Scan\n================================");
  testFilter();
  const sams = await scanSamsClub();
  const costco = await scanCostco();
  const target = await scanTarget();
  console.log(`Scan Complete | Sam's Club: ${sams} | Costco: ${costco} | Target: ${target}`);
}
client.once("clientReady", async () => {
  console.log("PokemonTrackerV3 Online");
  console.log(`ZIP: ${ZIP_CODE}`);
  console.log(`Radius: ${SEARCH_RADIUS} miles`);
  console.log(`Stored products: ${Object.keys(products).length}`);
  await runScan();
  setInterval(runScan, 30 * 60 * 1000);
});
client.login(process.env.DISCORD_TOKEN);
