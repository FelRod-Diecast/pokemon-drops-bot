const { Client, GatewayIntentBits } = require("discord.js");
const fs = require("fs");
const path = require("path");

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const CHANNEL_ID = process.env.DROPS_CHANNEL_ID;
const ZIP_CODE = "76040";
const SEARCH_RADIUS = 50;
// Railway's container filesystem is ephemeral unless a Volume is mounted.
 // Set PRODUCTS_FILE=/data/products.json when a Railway Volume is mounted at /data.
const PRODUCTS_FILE = process.env.PRODUCTS_FILE
  ? path.resolve(process.env.PRODUCTS_FILE)
  : path.join(__dirname, "products.json");
const { startRetailerApiMonitors } = require("./retailer-api-scanners");

function loadProducts() {
  try {
    const loaded = JSON.parse(fs.readFileSync(PRODUCTS_FILE, "utf8"));
    if (!loaded || typeof loaded !== "object" || Array.isArray(loaded)) {
      throw new Error("state file does not contain a product object");
    }
    return loaded;
  } catch (err) {
    console.warn(`Product state unavailable at ${PRODUCTS_FILE}: ${err.message}; starting with empty state`);
    return {};
  }
}
function saveProducts(data) {
  fs.mkdirSync(path.dirname(PRODUCTS_FILE), { recursive: true });
  fs.writeFileSync(PRODUCTS_FILE, JSON.stringify(data, null, 2));
}
const products = loadProducts();
console.log(`Product state file: ${PRODUCTS_FILE} | stored products: ${Object.keys(products).length}`);

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
    const alertType = product.alertType === "RESTOCK"
      ? "RESTOCK"
      : product.alertType === "LISTING"
        ? "LISTING"
        : "NEW";
    let message = alertType === "RESTOCK"
      ? `🚨 **POKÉMON TCG RESTOCK**\n\n**Store:** ${product.store}\n**Product:** ${product.name}`
      : alertType === "LISTING"
        ? `🔎 **NEW POKÉMON TCG LISTING — STOCK NOT VERIFIED**\n\n**Store:** ${product.store}\n**Product:** ${product.name}`
        : `🔥 **NEW POKÉMON TCG PRODUCT — AVAILABILITY VERIFIED**\n\n**Store:** ${product.store}\n**Product:** ${product.name}`;
    if (product.price) message += `\n**Price:** ${product.price}`;
    if (product.url) message += `\n**Link:** ${product.url}`;
    await channel.send(message);
    console.log(`Discord alert sent: ${alertType} | ${product.store} | ${product.name}`);
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
const SAMS_CLUB_ID = process.env.SAMS_CLUB_ID || "";
const SAMS_VISITOR_ID = process.env.SAMS_VISITOR_ID || require("crypto").randomUUID().replace(/-/g, "");

function collectSamProductObjects(value, found = new Map(), seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return found;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) collectSamProductObjects(item, found, seen);
    return found;
  }

  const name = cleanText(
    value.name || value.productName || value.displayName || value.title || value.productTitle || ""
  );
  const id = String(
    value.productId || value.itemId || value.itemNumber || value.sku || value.productNumber || value.id || ""
  ).trim();
  const url = value.itemPageUrl || value.productUrl || value.url || value.productURL || value.link || null;

  if (name && (id || url) && /pokemon|tcg|trading card|booster|elite trainer/i.test(name)) {
    const productUrl = isProductUrl(absoluteUrl(url, "Sam's Club"), "Sam's Club")
      ? absoluteUrl(url, "Sam's Club")
      : (id ? `https://www.samsclub.com/ip/-/${id}` : null);
    if (productUrl) addCandidate(found, "Sam's Club", name, productUrl, JSON.stringify(value));
  }

  for (const child of Object.values(value)) {
    if (child && typeof child === "object") collectSamProductObjects(child, found, seen);
  }
  return found;
}

async function samsApiSearch() {
  const params = new URLSearchParams({
    sourceType: "1",
    limit: "45",
    clubId: SAMS_CLUB_ID,
    searchCategoryId: "16860219",
    br: "true",
    secondaryResults: "2",
    wmsponsored: "1",
    wmsba: "true",
    wmVideo: "true",
  });
  const url = `https://www.samsclub.com/api/node/vivaldi/browse/v2/products/search?${params}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: "https://www.samsclub.com/browse/pokemon/16860219",
      visitorId: SAMS_VISITOR_ID,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36",
    },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function samsApiInventory(productIds) {
  if (!productIds.length) return new Map();

  const response = await fetch("https://www.samsclub.com/api/node/vivaldi/browse/v2/products", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/plain, */*",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36",
    },
    body: JSON.stringify({
      productIds,
      type: "LARGE",
      clubId: SAMS_CLUB_ID,
    }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const data = await response.json();
  const result = new Map();
  const visit = value => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.forEach(visit);

    const id = String(value.productId || value.itemId || value.id || "").trim();
    const status = String(
      value?.skus?.onlineoffer?.inventory?.status ||
      value?.onlineoffer?.inventory?.status ||
      value?.inventory?.status ||
      ""
    ).trim();

    if (id && status) result.set(id, status);
    Object.values(value).forEach(visit);
  };
  visit(data);
  return result;
}

async function scanSamsClubBrowser() {
  let puppeteer;
  try { puppeteer = require("puppeteer"); } catch (err) {
    console.warn(`Sam's Club browser scanner unavailable: ${err.message}`);
    return 0;
  }
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154 Safari/537.36");
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });
    const urls = ["https://www.samsclub.com/s/pokemon%20tcg", "https://www.samsclub.com/s/pokemon%20cards", "https://www.samsclub.com/browse/pokemon/16860219"];
    const found = new Map();
    for (const url of urls) {
      console.log(`Sam's Club browser request: ${url}`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await new Promise(resolve => setTimeout(resolve, 3000));
      const html = await page.content();
      console.log(`Sam's Club browser downloaded ${html.length} characters | title=${await page.title()}`);
      if (/are-you-human|let us know you're not a robot|robots? only|captcha/i.test(html)) {
        console.warn("Sam's Club browser received a challenge page; not attempting to bypass it");
        continue;
      }
      extractJsonLd(html, "Sam's Club", found);
      extractNamedFields(html, "Sam's Club", found);
      extractAnchors(html, "Sam's Club", found);
      extractVisibleProductWindows(html, "Sam's Club", found);
    }
    let newCount = 0;
    for (const product of found.values()) {
      const key = getProductKey("Sam's Club", product);
      if (!products[key]) {
        products[key] = { store: "Sam's Club", id: product.id || null, name: product.name, url: product.url || null, price: product.price || null, available: product.available, firstSeen: new Date().toISOString(), lastChecked: new Date().toISOString() };
        newCount++;
        if (product.available === true) await sendProductAlert({ store: "Sam's Club", name: product.name, url: product.url, price: product.price });
      }
    }
    if (found.size || newCount) saveProducts(products);
    console.log(`Sam's Club browser scan complete | candidates=${found.size} | new=${newCount}`);
    return found.size;
  } finally {
    await browser.close();
  }
}
async function scanSamsClub() {
  console.log("Scanning Sam's Club via Vivaldi API...");
  try {
    const data = await samsApiSearch();
    const found = collectSamProductObjects(data);
    console.log(`Sam's Club Vivaldi discovery: candidates=${found.size}`);

    const ids = [...found.values()]
      .map(product => product.id || productIdFromUrl(product.url))
      .filter(Boolean)
      .map(String);

    let inventory = new Map();
    try {
      inventory = await samsApiInventory(ids);
      console.log(`Sam's Club Vivaldi inventory: checked=${ids.length} | statuses=${inventory.size}`);
    } catch (err) {
      console.warn(`Sam's Club Vivaldi inventory check failed: ${err.message}`);
    }

    let newCount = 0;
    let restocks = 0;
    for (const product of found.values()) {
      const id = String(product.id || productIdFromUrl(product.url) || "");
      const status = inventory.get(id);
      const available = /IN.?STOCK|AVAILABLE|SELLABLE/i.test(status || "")
        ? true
        : /OUT.?OF.?STOCK|UNAVAILABLE|SOLD.?OUT/i.test(status || "")
          ? false
          : product.available;

      const key = getProductKey("Sam's Club", product);
      const existing = products[key];

      if (!existing) {
        products[key] = {
          store: "Sam's Club",
          id: product.id || id || null,
          name: product.name,
          url: product.url,
          price: product.price || null,
          available,
          firstSeen: new Date().toISOString(),
          lastChecked: new Date().toISOString(),
        };
        saveProducts(products);
        newCount++;
        await sendProductAlert({
          store: "Sam's Club",
          name: product.name,
          url: product.url,
          price: product.price,
          alertType: "NEW",
        });
        console.log(`Sam's Club NEW LISTING: ${product.name} | availability=${available === true ? "in stock" : available === false ? "out of stock" : "unknown"}`);
        continue;
      }

      const previous = existing.available;
      existing.name = product.name || existing.name;
      existing.url = product.url || existing.url;
      existing.price = product.price || existing.price;
      existing.lastChecked = new Date().toISOString();
      if (available !== null) existing.available = available;

      if (previous === false && available === true) {
        existing.lastRestock = new Date().toISOString();
        restocks++;
        await sendProductAlert({
          store: "Sam's Club",
          name: existing.name,
          url: existing.url,
          price: existing.price,
          alertType: "RESTOCK",
        });
        console.log(`Sam's Club RESTOCK: ${existing.name}`);
      }
    }

    saveProducts(products);
    console.log(`Sam's Club Vivaldi complete | candidates=${found.size} | new=${newCount} | restocks=${restocks}`);
    return found.size;
  } catch (err) {
    console.error(`Sam's Club Vivaldi API failed: ${err.message}`);
    console.log("Sam's Club Vivaldi API failed; trying normal Chromium page scan...");
    try { return await scanSamsClubBrowser(); } catch (browserErr) {
      console.error(`Sam's Club browser scan failed: ${browserErr.message}`);
      return scanStore("Sam's Club", ["https://www.samsclub.com/s/pokemon%20tcg","https://www.samsclub.com/s/pokemon%20cards","https://www.samsclub.com/browse/pokemon/16860219"]);
    }
  }
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
  console.log(`Scan Complete | Sam's Club: ${sams} | Target/Costco API monitors running`);
}
client.once("clientReady", async () => {
  console.log("PokemonTrackerV3 Online");
  console.log(`ZIP: ${ZIP_CODE}`);
  console.log(`Radius: ${SEARCH_RADIUS} miles`);
  console.log(`Stored products: ${Object.keys(products).length}`);
  await runScan();
  startRetailerApiMonitors({
    products,
    saveProducts,
    sendProductAlert,
    isPokemonTCGProduct,
    isSpecificTCGProductName,
  });
  setInterval(runScan, 30 * 60 * 1000);
});
client.login(process.env.DISCORD_TOKEN);
