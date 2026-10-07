const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const TARGET_REDSKY_KEY =
  process.env.TARGET_REDSKY_KEY || "9f36aeafbe60771e321a7cc95a78140772ab3e96";
const TARGET_STORE_ID = process.env.TARGET_STORE_ID || "1368";
const ZIP_CODE = process.env.ZIP_CODE || "76040";

const TARGET_DISCOVERY_INTERVAL_MS = 5 * 60 * 1000;
const TARGET_STOCK_INTERVAL_MS = 60 * 1000;
const COSTCO_INTERVAL_MS = 5 * 60 * 1000;

const TARGET_SEARCH_TERMS = [
  "pokemon trading cards",
  "pokemon booster",
  "pokemon elite trainer",
  "pokemon collection",
];
const TARGET_VISITOR_ID = process.env.TARGET_VISITOR_ID || require("crypto").randomUUID().replace(/-/g, "");
const TARGET_TCG_CATEGORY = "4slqy";
const TARGET_TCG_FACET = "569t0";

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
    channel: "WEB",
    keyword,
    page: pagePath || `/s?searchTerm=${keyword.replace(/ /g, "+")}`,
    visitor_id: TARGET_VISITOR_ID,
    pricing_store_id: TARGET_STORE_ID,
    store_ids: TARGET_STORE_ID,
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

async function checkTargetPurchasable({ products, saveProducts, sendProductAlert }) {
  const tracked = Object.values(products).filter(product => product.store === "Target" && product.id);
  if (!tracked.length) {
    console.log("Target purchasable check | tracked=0");
    return;
  }

  const purchasable = new Set();
  try {
    const results = await targetSearch("pokemon", true, 3, TARGET_TCG_CATEGORY, TARGET_TCG_FACET, "/c/toys-new-arrivals/pokemon/-/N-4slqyZ569t0");
      for (const tcin of results.keys()) purchasable.add(String(tcin));
  } catch (err) {
    console.error(`Target purchasable category search error:`, err.message);
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

  try {
    const results = await targetSearch(
      "pokemon",
      false,
      3,
      TARGET_TCG_CATEGORY,
      TARGET_TCG_FACET,
      "/c/toys-new-arrivals/pokemon/-/N-4slqyZ569t0"
    );
    for (const [tcin, product] of results) {
      const name = targetProductName(product);
      if (name) console.log(`Target category candidate | ${tcin} | ${name}`);
      if (
        !isPokemonTCGProduct(name) ||
        !isSpecificTCGProductName(name)
      ) {
        continue;
      }

      discovered.set(tcin, {
        id: tcin,
        name,
        url: targetProductUrl(product, tcin),
        price: targetPrice(product),
      });
    }
  } catch (err) {
    console.error(`Target category discovery error:`, err.message);
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

async function scanCostco({
  products,
  saveProducts,
  isPokemonTCGProduct,
  isSpecificTCGProductName,
  sendProductAlert,
}) {
  const queries = ["pokemon trading cards", "pokemon booster", "pokemon elite trainer", "pokemon collection"];
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

      if (available === true) {
        await sendProductAlert({
          store: "Costco",
          name,
          url,
          price: item.price,
          alertType: "NEW",
        });
        console.log(`Costco NEW IN STOCK: ${name}`);
      }
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

  setInterval(runTargetStock, TARGET_STOCK_INTERVAL_MS);
  const runTargetPurchasable = async () => {
    try { await checkTargetPurchasable(deps); } catch (err) { console.error("Target purchasable monitor error:", err.message); }
  };
  void runTargetPurchasable();
  setInterval(runTargetPurchasable, TARGET_STOCK_INTERVAL_MS);
  setInterval(runTargetDiscovery, TARGET_DISCOVERY_INTERVAL_MS);
  setInterval(runCostco, COSTCO_INTERVAL_MS);

  console.log(
    `Retailer API monitors started | Target discovery=${TARGET_DISCOVERY_INTERVAL_MS / 60000}m | Target stock=${TARGET_STOCK_INTERVAL_MS / 1000}s | Target purchasable=${TARGET_STOCK_INTERVAL_MS / 1000}s | Costco=${COSTCO_INTERVAL_MS / 60000}m`
  );
}

module.exports = {
  startRetailerApiMonitors,
};
