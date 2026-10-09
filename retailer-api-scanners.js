const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const TARGET_REDSKY_KEY =
  process.env.TARGET_REDSKY_KEY || "9f36aeafbe60771e321a7cc95a78140772ab3e96";
const TARGET_STORE_ID = process.env.TARGET_STORE_ID || "1368";
const ZIP_CODE = process.env.ZIP_CODE || "76040";

const TARGET_DISCOVERY_INTERVAL_MS = 10 * 60 * 1000;
const TARGET_STOCK_INTERVAL_MS = 3 * 60 * 1000;
const COSTCO_INTERVAL_MS = 5 * 60 * 1000;

const TARGET_SEARCH_TERMS = [
  "pokemon booster pack",
  "pokemon tcg",
];
const TARGET_VISITOR_ID = process.env.TARGET_VISITOR_ID || require("crypto").randomUUID().replace(/-/g, "");
const TARGET_TCG_CATEGORY = "27p31";
const TARGET_TCG_FACET = "569t0";
const TARGET_TCG_PAGE = "/c/trading-cards-toys-games/-/N-27p31";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://www.target.com",
  Referer: "https://www.target.com/",
  "redsky-client-name": "browse",
  "redsky-client-version": "1.0.0",
};

const COSTCO_HEADERS = {
  ...HEADERS,
  "Sec-Ch-Ua": '"Not_A Brand";v="8", "Chromium";v="154", "Google Chrome";v="154"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-origin",
  Referer: "https://www.costco.com/",
  Cookie: `invCheckPostalCode=${encodeURIComponent(ZIP_CODE)}; invCheckCity=Euless`,
};

function targetProductUrl(product, tcin) {
  const buyUrl = product?.item?.enrichment?.buy_url;
  if (buyUrl) {
    return /^https?:\/\//i.test(buyUrl)
      ? buyUrl
      : `https://www.target.com${buyUrl.startsWith("/") ? "" : "/"}${buyUrl}`;
  }
  return `https://www.target.com/p/-/A-${tcin}`;
}

function targetProductName(product) {
  return String(
    product?.item?.product_description?.title ||
      product?.item?.product_description?.product_title ||
      ""
  ).trim();
}

function targetPrice(product) {
  const price = product?.price || {};
  return (
    price.formatted_current_price ||
    (price.current_retail != null ? `$${price.current_retail}` : null)
  );
}

async function fetchJson(url, headers = HEADERS) {
  const response = await fetch(url, {
    redirect: "follow",
    headers,
  });

  if (!response.ok && response.status !== 206) {
    throw new Error(`HTTP ${response.status}`);
  }

  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Expected JSON, received non-JSON response (${text.slice(0, 80).replace(/\\s+/g, " ")})`
    );
  }
}

function targetSearchUrl(keyword, purchasable, offset = 0, category = null, facet = null, pagePath = null) {
  const params = new URLSearchParams({
    key: TARGET_REDSKY_KEY,
    keyword,
    channel: "WEB",
    page: pagePath || `/s?searchTerm=${keyword.replace(/ /g, "+")}`,
    visitor_id: TARGET_VISITOR_ID,
    pricing_store_id: TARGET_STORE_ID,
    store_ids: TARGET_STORE_ID,
    scheduled_delivery_store_id: TARGET_STORE_ID,
    zip: ZIP_CODE,
    default_purchasability_filter: String(purchasable),
    include_sponsored: "false",
    platform: "desktop",
    count: "24",
    offset: String(offset),
  });
  if (category) params.set("category", category);
  if (facet) params.set("faceted_value", facet);
  return `https://redsky.target.com/redsky_aggregations/v1/web/plp_search_v2?${params}`;
}

async function targetSearch(keyword, purchasable, maxPages = 1, category = null, facet = null, pagePath = null) {
  const products = new Map();

  const pageSize = 24;
  for (let page = 0; page < maxPages; page++) {
    const offset = page * pageSize;
    const url = targetSearchUrl(keyword, purchasable, offset, category, facet, pagePath);
    const data = await fetchJson(url);
    const rows = data?.data?.search?.products || [];

    console.log(
      `Target RedSky search | term="${keyword}" | category=${category || "none"} | facet=${facet || "none"} | purchasable=${purchasable} | offset=${offset} | results=${rows.length}`
    );

    for (const product of rows) {
      const tcin = product?.tcin != null ? String(product.tcin) : null;
      if (tcin) products.set(tcin, product);
    }

    if (rows.length < pageSize) break;
  }

  return products;
}

function targetAvailability(summary) {
  const fulfillment = summary?.fulfillment || {};
  const shipping = String(
    fulfillment?.shipping_options?.availability_status || ""
  ).toUpperCase();

  const storeOptions = Array.isArray(fulfillment?.store_options)
    ? fulfillment.store_options
    : [];

  const pickup = storeOptions.some(
    option =>
      String(option?.order_pickup?.availability_status || "").toUpperCase() ===
      "IN_STOCK"
  );
  const inStore = storeOptions.some(
    option =>
      String(option?.in_store_only?.availability_status || "").toUpperCase() ===
      "IN_STOCK"
  );

  const available =
    ["IN_STOCK", "PRE_ORDER_SELLABLE", "LIMITED_STOCK"].includes(shipping) ||
    pickup ||
    inStore;

  return {
    available,
    shipping,
    pickup,
    inStore,
  };
}

async function targetFulfillment(tcins) {
  const params = new URLSearchParams({
    key: TARGET_REDSKY_KEY,
    tcins: tcins.join(","),
    store_id: TARGET_STORE_ID,
    pricing_store_id: TARGET_STORE_ID,
    scheduled_delivery_store_id: TARGET_STORE_ID,
    zip: ZIP_CODE,
    channel: "WEB",
  });

  const url =
    "https://redsky.target.com/redsky_aggregations/v1/web/" +
    `product_summary_with_fulfillment_v1?${params}`;

  const data = await fetchJson(url);
  return Array.isArray(data?.data?.product_summaries)
    ? data.data.product_summaries
    : [];
}

async function checkCostcoProductDetails(items) {
  if (!items.length) return [];

  const itemNumbers = items.map(item => String(item.id)).filter(Boolean);
  const query = `query {
    products(
      itemNumbers: [${itemNumbers.map(id => `"${id}"`).join(", ")}],
      clientId: "4900eb1f-0c10-4bd9-99c3-c59e6c1ecebf",
      locale: "en-us",
    ) {
      catalogData {
        itemNumber
        buyable
        programTypes
        priceData { price listPrice }
        description { shortDescription }
      }
    }
  }`;

  const response = await fetch("https://ecom-api.costco.com/ebusiness/product/v1/products/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "client-identifier": "4900eb1f-0c10-4bd9-99c3-c59e6c1ecebf",
      "costco.env": "ecom",
      "costco.service": "restProduct",
      Origin: "https://www.costco.com",
      Referer: "https://www.costco.com/",
      "User-Agent": HEADERS["User-Agent"],
    },
    body: JSON.stringify({ query }),
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  const rows = data?.data?.products?.catalogData;
  if (!Array.isArray(rows)) return [];

  return rows.map(item => ({
    id: String(item.itemNumber),
    name: String(item.description?.shortDescription || "").trim(),
    available: item.buyable === 1,
    price: item.priceData?.price || null,
    programTypes: Array.isArray(item.programTypes)
      ? item.programTypes
      : typeof item.programTypes === "string"
        ? item.programTypes.split(",")
        : [],
  }));
}

async function checkTargetPurchasable({ products, saveProducts, sendProductAlert }) {
  const tracked = Object.values(products).filter(product => product.store === "Target" && product.id);
  if (!tracked.length) {
    console.log("Target purchasable check | tracked=0");
    return;
  }

  const purchasable = new Set();
  try {
    for (const [index, term] of TARGET_SEARCH_TERMS.entries()) {
      if (index > 0) await new Promise(resolve => setTimeout(resolve, 5000));
      const results = await targetSearch(term, true, 1);
      for (const tcin of results.keys()) purchasable.add(String(tcin));
    }
  } catch (err) {
    console.error(`Target purchasable search failed; preserving previous stock state: ${err.message}`);
    return;
  }

  let changed = false;
  let restocks = 0;
  let sellouts = 0;
  const now = new Date().toISOString();

  for (const product of tracked) {
    const available = purchasable.has(String(product.id));
    const previous = product.available;
    product.lastPurchasableCheck = now;

    if (previous === false && available) {
      product.available = true;
      product.lastRestock = now;
      restocks++;
      changed = true;
      await sendProductAlert({ store: "Target", name: product.name, url: product.url, price: product.price, alertType: "RESTOCK" });
      console.log(`Target RESTOCK (purchasable): ${product.name}`);
    } else if (previous === true && !available) {
      product.available = false;
      product.lastSellout = now;
      sellouts++;
      changed = true;
      console.log(`Target SELL-OUT (purchasable): ${product.name}`);
    } else if (previous === null && available) {
      product.available = true;
      await sendProductAlert({ store: "Target", name: product.name, url: product.url, price: product.price, alertType: "NEW" });
      console.log(`Target NEW IN STOCK (purchasable): ${product.name}`);
      changed = true;
    }
  }

  if (changed) saveProducts(products);
  console.log(`Target purchasable check complete | tracked=${tracked.length} | purchasable=${purchasable.size} | restocks=${restocks} | sellouts=${sellouts}`);
}

async function discoverTarget({
  products,
  saveProducts,
  isPokemonTCGProduct,
  isSpecificTCGProductName,
  sendProductAlert,
}) {
  const discovered = new Map();

  for (const [index, term] of TARGET_SEARCH_TERMS.entries()) {
    try {
      if (index > 0) await new Promise(resolve => setTimeout(resolve, 5000));
      const results = await targetSearch(term, false, 1);
      for (const [tcin, product] of results) {
        const name = targetProductName(product);
        if (name) console.log(`Target search candidate | term="${term}" | ${tcin} | ${name}`);
        if (!isPokemonTCGProduct(name) || !isSpecificTCGProductName(name)) continue;
        discovered.set(tcin, {
          id: tcin,
          name,
          url: targetProductUrl(product, tcin),
          price: targetPrice(product),
        });
      }
    } catch (err) {
      console.error(`Target search error | term="${term}":`, err.message);
      if (String(err.message).includes("HTTP 435")) break;
    }
  }

  let newCount = 0;
  for (const item of discovered.values()) {
    const key = `Target:${item.id}`;
    const existing = products[key];

    if (!existing) {
      products[key] = {
        store: "Target",
        id: item.id,
        name: item.name,
        url: item.url,
        price: item.price || null,
        available: null,
        firstSeen: new Date().toISOString(),
        lastChecked: null,
        lastRestock: null,
        lastSellout: null,
      };
      newCount++;
      await sendProductAlert({
        store: "Target",
        name: item.name,
        url: item.url,
        price: item.price,
        alertType: "NEW",
      });
      console.log(`Target NEW LISTING: ${item.name}`);
    } else {
      existing.name = item.name;
      existing.url = item.url || existing.url;
      if (item.price) existing.price = item.price;
    }
  }

  if (newCount) saveProducts(products);

  console.log(
    `Target RedSky discovery complete | TCG products=${discovered.size} | new=${newCount} | tracked=${Object.keys(products).filter(k => k.startsWith("Target:")).length}`
  );
}

async function checkTargetStock({
  products,
  saveProducts,
  sendProductAlert,
}) {
  const tracked = Object.values(products).filter(
    product => product.store === "Target" && product.id
  );

  if (!tracked.length) {
    console.log("Target RedSky stock check | tracked=0");
    return;
  }

  let changed = false;
  let availableCount = 0;
  let restocks = 0;
  let sellouts = 0;
  const now = new Date().toISOString();

  for (let start = 0; start < tracked.length; start += 24) {
    const batch = tracked.slice(start, start + 24);
    try {
      const summaries = await targetFulfillment(batch.map(p => String(p.id)));
      const byTcin = new Map(
        summaries
          .filter(summary => summary?.tcin != null)
          .map(summary => [String(summary.tcin), summary])
      );

      for (const product of batch) {
        const summary = byTcin.get(String(product.id));
        if (!summary) continue;

        const status = targetAvailability(summary);
        const previous = product.available;

        product.available = status.available;
        product.lastChecked = now;
        product.shippingStatus = status.shipping;
        product.pickupAvailable = status.pickup;
        product.inStoreAvailable = status.inStore;

        if (status.available) availableCount++;

        if (previous === false && status.available) {
          product.lastRestock = now;
          restocks++;
          await sendProductAlert({
            store: "Target",
            name: product.name,
            url: product.url,
            price: product.price,
            alertType: "RESTOCK",
          });
          console.log(`Target RESTOCK: ${product.name}`);
        } else if (previous === true && !status.available) {
          product.lastSellout = now;
          sellouts++;
          console.log(`Target SELL-OUT: ${product.name}`);
        } else if (previous === null && status.available) {
          await sendProductAlert({
            store: "Target",
            name: product.name,
            url: product.url,
            price: product.price,
            alertType: "NEW",
          });
          console.log(`Target NEW IN STOCK: ${product.name}`);
        }

        changed = true;
      }
    } catch (err) {
      console.error(
        `Target fulfillment batch error (${start + 1}-${start + batch.length}):`,
        err.message
      );
    }
  }

  if (changed) saveProducts(products);

  console.log(
    `Target RedSky stock check complete | tracked=${tracked.length} | available=${availableCount} | restocks=${restocks} | sellouts=${sellouts}`
  );
}

function extractCostcoProducts(data) {
  const rows = Array.isArray(data?.searchResult?.results)
    ? data.searchResult.results
    : [];
  return rows.map(row => {
    const product = row?.product || {};
    const variants = row?.variantRollupValues || {};
    const availabilityValues = Object.entries(variants)
      .filter(([key]) => /availability/i.test(key))
      .flatMap(([, value]) => Array.isArray(value) ? value : [value])
      .map(value => String(value || "").toUpperCase());

    let available = null;
    if (availabilityValues.some(value =>
      /IN_STOCK|LOW_STOCK|AVAILABLE|SELLABLE|INVENTORY/.test(value)
    )) {
      available = true;
    } else if (availabilityValues.some(value =>
      /OUT_OF_STOCK|UNAVAILABLE|SOLD_OUT|NOT_AVAILABLE/.test(value)
    )) {
      available = false;
    }

    const priceValues = Object.entries(variants)
      .filter(([key]) => /(^|,)price$|originalPrice/i.test(key))
      .flatMap(([, value]) => Array.isArray(value) ? value : [value])
      .filter(value => value != null && value !== "");

    return {
      id: row?.id || product?.id || product?.itemNumber || null,
      name: product?.title || product?.name || "",
      url: product?.uri || product?.url || null,
      price: priceValues[0] != null ? priceValues[0] : null,
      available,
      availabilityValues,
    };
  }).filter(item => item.id && item.name);
}

async function scanCostcoBrowser({
  products,
  saveProducts,
  isPokemonTCGProduct,
  isSpecificTCGProductName,
  sendProductAlert,
}) {
  let puppeteer;
  try {
    puppeteer = require("puppeteer");
  } catch (err) {
    console.warn(`Costco browser scanner unavailable: ${err.message}`);
    return 0;
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent(HEADERS["User-Agent"]);
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });

    const urls = [
      "https://www.costco.com/s?keyword=pokemon%20tcg",
      "https://www.costco.com/s?keyword=pokemon%20trading%20cards",
      "https://www.costco.com/s?keyword=pokemon%20booster",
    ];
    const found = new Map();

    for (const url of urls) {
      console.log(`Costco browser request: ${url}`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await new Promise(resolve => setTimeout(resolve, 4000));

      const rows = await page.evaluate(() => {
        const clean = value => String(value || "").replace(/\\s+/g, " ").trim();
        const rows = [];
        const seen = new Set();

        for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
          try {
            const data = JSON.parse(script.textContent || "");
            const visit = value => {
              if (!value || typeof value !== "object") return;
              if (Array.isArray(value)) return value.forEach(visit);
              const name = clean(value.name || value.productName || value.title);
              const url = clean(value.url || value.productUrl || "");
              if (name && url && /pokemon|tcg|trading card|booster|elite trainer/i.test(name)) {
                const key = url || name;
                if (!seen.has(key)) {
                  seen.add(key);
                  rows.push({ name, url, text: name });
                }
              }
              Object.values(value).forEach(visit);
            };
            visit(data);
          } catch {}
        }

        for (const anchor of document.querySelectorAll("a[href]")) {
          const text = clean(anchor.textContent);
          const href = anchor.href || "";
          const context = clean(anchor.closest("li, article, div")?.innerText || text).slice(0, 1500);
          if (!text || !href || !/costco\\.com/i.test(href)) continue;
          if (!/pokemon|tcg|trading card|booster|elite trainer/i.test(text)) continue;
          if (!/\\.product\\.|product/i.test(href)) continue;
          const key = href || text;
          if (!seen.has(key)) {
            seen.add(key);
            rows.push({ name: text, url: href, text: context });
          }
        }
        return rows.slice(0, 200);
      });

      console.log(`Costco browser page | title=${await page.title()} | candidates=${rows.length}`);
      for (const row of rows) {
        const name = String(row.name || "").trim();
        if (!isPokemonTCGProduct(name) || !isSpecificTCGProductName(name)) continue;
        const url = String(row.url || "").trim();
        const idMatch = url.match(/(?:\\.product\\.|itemNumber=)([0-9]+)/i);
        const id = idMatch ? idMatch[1] : url;
        if (!id || !url) continue;
        const available = /add to cart|in stock|available for shipping|available online/i.test(String(row.text || ""))
          ? true
          : /out of stock|sold out|unavailable|not available/i.test(String(row.text || ""))
            ? false
            : null;
        found.set(String(id), { id: String(id), name, url, price: null, available });
      }
    }

    let changed = false;
    let newProducts = 0;
    let restocks = 0;
    const now = new Date().toISOString();

    for (const item of found.values()) {
      const key = `Costco:${item.id}`;
      const existing = products[key];
      if (!existing) {
        products[key] = {
          store: "Costco",
          id: item.id,
          name: item.name,
          url: item.url,
          price: item.price || null,
          available: item.available,
          firstSeen: now,
          lastChecked: now,
          lastRestock: item.available === true ? now : null,
          lastSellout: null,
        };
        newProducts++;
        changed = true;
        if (item.available === true) {
          await sendProductAlert({ store: "Costco", name: item.name, url: item.url, price: item.price, alertType: "NEW" });
        }
        continue;
      }

      const previous = existing.available;
      existing.name = item.name;
      existing.url = item.url || existing.url;
      existing.lastChecked = now;
      if (item.available !== null) existing.available = item.available;

      if (previous === false && item.available === true) {
        existing.lastRestock = now;
        restocks++;
        changed = true;
        await sendProductAlert({ store: "Costco", name: existing.name, url: existing.url, price: existing.price, alertType: "RESTOCK" });
        console.log(`Costco RESTOCK (browser): ${existing.name}`);
      }
    }

    if (changed) saveProducts(products);
    console.log(`Costco browser discovery complete | TCG=${found.size} | new=${newProducts} | restocks=${restocks}`);
    return found.size;
  } finally {
    await browser.close();
  }
}

const COSTCO_KNOWN_TCG_ITEMS = [
  { id: "3540887", name: "Pokémon Collector's Chest + Great Ball + Ultra Ball + 3 Eevee Promo Cards" },
  { id: "1739847", name: "Pokémon Scarlet & Violet V-Tin & Window Tin" },
  { id: "2351599", name: "Pokémon 4 Pack V Tins" },
  { id: "1901714", name: "Pokémon 3-pack Paldea Partners Tins" },
  { id: "1828995", name: "Pokémon Elite Trainer Box: Crown Zenith + Koraidon ex Tin + Miraidon Window Tin" },
  { id: "1861371", name: "Pokémon TCG: Charizard ex Super-Premium Collection" },
];

async function scanCostco({
  products,
  saveProducts,
  isPokemonTCGProduct,
  isSpecificTCGProductName,
  sendProductAlert,
}) {
  const queries = ["pokemon", "pokemon trading cards", "pokemon booster", "pokemon elite trainer", "pokemon collection"];
  const allMatches = new Map();

  for (const query of queries) {
    try {
      const response = await fetch(
        "https://gdx-api.costco.com/catalog/search/api/v1/search",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "client_id": "USBC",
            "client-identifier": "168287ea-1201-45f6-9b45-5bbea49f8ee7",
            "searchresultprovider": "GRS",
            "locale": "en-US",
            "Origin": "https://www.costco.com",
            "Referer": "https://www.costco.com/",
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36",
          },
          body: JSON.stringify({
            visitorId: "0000000000000000000000000000000000",
            query,
            pageSize: 96,
            offset: 0,
            orderBy: null,
            searchMode: "page",
            personalizationEnabled: false,
            warehouseId: "129-wh",
            shipToPostal: ZIP_CODE,
            shipToState: "TX",
            deliveryLocations: ["129-wh"],
            filterBy: [],
            pageCategories: [],
          }),
        }
      );

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const rawItems = extractCostcoProducts(data);
      console.log(
        `Costco candidates | query="${query}" | ${rawItems.slice(0, 20).map(item => item.name).join(" || ")}`
      );
      const matches = rawItems.filter(item =>
        isPokemonTCGProduct(item.name) &&
        isSpecificTCGProductName(item.name)
      );

      console.log(
        `Costco GDX search | query="${query}" | raw=${rawItems.length} | TCG=${matches.length}`
      );

      for (const item of matches) allMatches.set(String(item.id), item);
    } catch (err) {
      console.error(`Costco GDX error (query="${query}"):`, err.message);
    }
  }

  for (const seed of COSTCO_KNOWN_TCG_ITEMS) {
    if (!allMatches.has(seed.id)) {
      allMatches.set(seed.id, {
        id: seed.id,
        name: seed.name,
        url: "https://www.costco.com/.product." + seed.id + ".html",
        price: null,
        available: null,
      });
    }
  }

  if (allMatches.size) {
    try {
      const details = await checkCostcoProductDetails([...allMatches.values()]);
      for (const detail of details) {
        const existing = allMatches.get(detail.id);
        if (existing) {
          existing.name = detail.name || existing.name;
          existing.price = detail.price || existing.price;
          existing.available = detail.available;
          existing.programTypes = detail.programTypes;
        }
      }
      console.log(`Costco GraphQL detail check | requested=${allMatches.size} | returned=${details.length} | buyable=${details.filter(item => item.available).length}`);
    } catch (err) {
      console.error(`Costco GraphQL detail error:`, err.message);
    }
  }

  let changed = false;
  let newProducts = 0;
  let restocks = 0;
  let sellouts = 0;
  const now = new Date().toISOString();

  for (const item of allMatches.values()) {
    const id = String(item.id);
    const name = String(item.name).trim();
    const url = item.url
      ? (/^https?:\/\//i.test(item.url)
        ? item.url
        : `https://www.costco.com${item.url.startsWith("/") ? "" : "/"}${item.url}`)
      : `https://www.costco.com/.product.${id}.html`;
    const available = item.available;
    const key = `Costco:${id}`;
    const existing = products[key];

    if (!existing) {
      products[key] = {
        store: "Costco",
        id,
        name,
        url,
        price: item.price || null,
        available,
        firstSeen: now,
        lastChecked: now,
        lastRestock: available === true ? now : null,
        lastSellout: null,
      };
      newProducts++;
      changed = true;

      await sendProductAlert({
        store: "Costco",
        name,
        url,
        price: item.price,
        alertType: "NEW",
      });
      console.log(`Costco NEW LISTING: ${name} | availability=${available === true ? "in stock" : available === false ? "out of stock" : "unknown"}`);
      continue;
    }

    existing.name = name;
    existing.url = url || existing.url;
    if (item.price) existing.price = item.price;
    existing.lastChecked = now;

    if (existing.available === false && available === true) {
      existing.available = true;
      existing.lastRestock = now;
      restocks++;
      changed = true;
      await sendProductAlert({
        store: "Costco",
        name,
        url: existing.url,
        price: existing.price,
        alertType: "RESTOCK",
      });
      console.log(`Costco RESTOCK: ${name}`);
    } else if (existing.available === true && available === false) {
      existing.available = false;
      existing.lastSellout = now;
      sellouts++;
      changed = true;
      console.log(`Costco SELL-OUT: ${name}`);
    } else if (existing.available === null && available !== null) {
      existing.available = available;
      changed = true;
    }
  }

  if (changed) saveProducts(products);

  console.log(
    `Costco GDX extraction complete | TCG=${allMatches.size} | new=${newProducts} | restocks=${restocks} | sellouts=${sellouts}`
  );

  if (allMatches.size === 0) {
    console.log("Costco GDX returned no verified Pokémon TCG products; trying normal Chromium discovery...");
    try {
      return await scanCostcoBrowser({
        products,
        saveProducts,
        isPokemonTCGProduct,
        isSpecificTCGProductName,
        sendProductAlert,
      });
    } catch (browserErr) {
      console.error(`Costco browser scan failed: ${browserErr.message}`);
    }
  }

  return allMatches.size;
}

function startRetailerApiMonitors(deps) {
  let targetStockRunning = false;
  let targetDiscoveryRunning = false;
  let costcoRunning = false;

  const runTargetStock = async () => {
    if (targetStockRunning) return;
    targetStockRunning = true;
    try {
      await checkTargetStock(deps);
    } finally {
      targetStockRunning = false;
    }
  };

  const runTargetDiscovery = async () => {
    if (targetDiscoveryRunning) return;
    targetDiscoveryRunning = true;
    try {
      await discoverTarget(deps);
      await runTargetStock();
    } finally {
      targetDiscoveryRunning = false;
    }
  };

  const runCostco = async () => {
    if (costcoRunning) return;
    costcoRunning = true;
    try {
      await scanCostco(deps);
    } finally {
      costcoRunning = false;
    }
  };

  void runTargetDiscovery();
  void runCostco();

  // Fulfillment is the single stock authority. The duplicate keyword-based
  // purchasability loop generated unnecessary requests and could misread a
  // blocked search as a stock-out.
  setInterval(runTargetStock, TARGET_STOCK_INTERVAL_MS);
  setInterval(runTargetDiscovery, TARGET_DISCOVERY_INTERVAL_MS);
  setInterval(runCostco, COSTCO_INTERVAL_MS);

  console.log(
    `Retailer API monitors started | Target discovery=${TARGET_DISCOVERY_INTERVAL_MS / 60000}m | Target fulfillment stock=${TARGET_STOCK_INTERVAL_MS / 1000}s | Costco=${COSTCO_INTERVAL_MS / 60000}m`
  );
}

module.exports = {
  startRetailerApiMonitors,
};
