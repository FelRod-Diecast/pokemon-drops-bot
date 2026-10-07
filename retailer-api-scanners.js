const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const TARGET_REDSKY_KEY =
  process.env.TARGET_REDSKY_KEY || "9f36aeafbe60771e321a7cc95a78140772ab3e96";
const TARGET_STORE_ID = process.env.TARGET_STORE_ID || "1368";
const ZIP_CODE = process.env.ZIP_CODE || "76040";

const TARGET_DISCOVERY_INTERVAL_MS = 15 * 60 * 1000;
const TARGET_STOCK_INTERVAL_MS = 3 * 60 * 1000;
const COSTCO_INTERVAL_MS = 5 * 60 * 1000;

const TARGET_SEARCH_TERMS = ["pokemon tcg", "pokemon trading cards"];

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/154 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://www.target.com",
  Referer: "https://www.target.com/",
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

function targetSearchUrl(keyword, purchasable, offset = 0) {
  const params = new URLSearchParams({
    key: TARGET_REDSKY_KEY,
    channel: "WEB",
    keyword,
    page: `/s/${keyword}`,
    visitor_id: "0000000000000000000000000000000000",
    pricing_store_id: TARGET_STORE_ID,
    store_ids: TARGET_STORE_ID,
    zip: ZIP_CODE,
    default_purchasability_filter: String(purchasable),
    include_sponsored: "false",
    platform: "desktop",
    count: "24",
    offset: String(offset),
  });
  return `https://redsky.target.com/redsky_aggregations/v1/web/plp_search_v2?${params}`;
}

async function targetSearch(keyword, purchasable, maxPages = 1) {
  const products = new Map();

  for (let page = 0; page < maxPages; page++) {
    const offset = page * 24;
    const url = targetSearchUrl(keyword, purchasable, offset);
    const data = await fetchJson(url);
    const rows = data?.data?.search?.products || [];

    console.log(
      `Target RedSky search | term="${keyword}" | purchasable=${purchasable} | offset=${offset} | results=${rows.length}`
    );

    for (const product of rows) {
      const tcin = product?.tcin != null ? String(product.tcin) : null;
      if (tcin) products.set(tcin, product);
    }

    if (rows.length < 24) break;
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

async function discoverTarget({
  products,
  saveProducts,
  isPokemonTCGProduct,
  isSpecificTCGProductName,
  sendProductAlert,
}) {
  const discovered = new Map();

  for (const term of TARGET_SEARCH_TERMS) {
    try {
      const results = await targetSearch(term, false, 3);
      for (const [tcin, product] of results) {
        const name = targetProductName(product);
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
      console.error(`Target discovery error (${term}):`, err.message);
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
  const found = [];
  const seen = new Set();

  function visit(value) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    const id =
      value.productId ??
      value.itemNumber ??
      value.product_id ??
      value.itemId ??
      value.partNumber;

    const name = value.name ?? value.productName ?? value.title ?? value.description;

    if (id != null && name && typeof name === "string") {
      const key = String(id);
      if (!seen.has(key)) {
        seen.add(key);
        found.push(value);
      }
    }

    for (const child of Object.values(value)) {
      if (child && typeof child === "object") visit(child);
    }
  }

  visit(data);
  return found;
}

function costcoUrl(item) {
  const raw = item?.url || item?.productUrl || item?.productURL;
  if (raw) {
    if (/^https?:\/\//i.test(raw)) return raw;
    return `https://www.costco.com${raw.startsWith("/") ? "" : "/"}${raw}`;
  }

  const id =
    item?.productId ??
    item?.itemNumber ??
    item?.product_id ??
    item?.itemId ??
    item?.partNumber;

  return id ? `https://www.costco.com/.product.${id}.html` : null;
}

function costcoAvailability(item) {
  if (typeof item?.isInStock === "boolean") return item.isInStock;
  if (typeof item?.inStock === "boolean") return item.inStock;
  if (typeof item?.available === "boolean") return item.available;

  const text = JSON.stringify(item).toLowerCase();
  if (/out[_ -]?of[_ -]?stock|sold[_ -]?out|unavailable/.test(text)) return false;
  if (/in[_ -]?stock|available/.test(text)) return true;
  return null;
}

async function scanCostco({
  products,
  saveProducts,
  isPokemonTCGProduct,
  isSpecificTCGProductName,
  sendProductAlert,
}) {
  const params = new URLSearchParams({
    keyword: "pokemon tcg",
    pageSize: "48",
    currentPage: "1",
    responseFormat: "json",
    storeId: "10301",
    catalogId: "10701",
    langId: "-1",
  });

  const url = `https://www.costco.com/CatalogSearch?${params}`;

  try {
    console.log(`Costco API request: ${url}`);
    const data = await fetchJson(url, COSTCO_HEADERS);
    const rawItems = extractCostcoProducts(data);
    const matches = rawItems.filter(item => {
      const name = String(
        item.name ?? item.productName ?? item.title ?? item.description ?? ""
      ).trim();
      return isPokemonTCGProduct(name) && isSpecificTCGProductName(name);
    });

    let changed = false;
    let newProducts = 0;
    let restocks = 0;
    let sellouts = 0;
    const now = new Date().toISOString();

    for (const item of matches) {
      const id = String(
        item.productId ??
          item.itemNumber ??
          item.product_id ??
          item.itemId ??
          item.partNumber
      );
      const name = String(
        item.name ?? item.productName ?? item.title ?? item.description ?? ""
      ).trim();
      const url = costcoUrl(item);
      const price =
        item.price ||
        item.formattedPrice ||
        (item.priceNumeric != null ? `$${item.priceNumeric}` : null);
      const available = costcoAvailability(item);
      const key = `Costco:${id}`;
      const existing = products[key];

      if (!existing) {
        products[key] = {
          store: "Costco",
          id,
          name,
          url,
          price: price || null,
          available,
          firstSeen: now,
          lastChecked: now,
          lastRestock: available ? now : null,
          lastSellout: null,
        };
        newProducts++;
        changed = true;

        if (available === true) {
          await sendProductAlert({
            store: "Costco",
            name,
            url,
            price,
            alertType: "NEW",
          });
          console.log(`Costco NEW IN STOCK: ${name}`);
        }
        continue;
      }

      existing.name = name;
      existing.url = url || existing.url;
      if (price) existing.price = price;
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
      `Costco API extraction: raw=${rawItems.length}, TCG=${matches.length}, new=${newProducts}, restocks=${restocks}, sellouts=${sellouts}`
    );
    return matches.length;
  } catch (err) {
    console.error("Costco API error:", err.message);
    return 0;
  }
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
  setInterval(runTargetDiscovery, TARGET_DISCOVERY_INTERVAL_MS);
  setInterval(runCostco, COSTCO_INTERVAL_MS);

  console.log(
    `Retailer API monitors started | Target discovery=${TARGET_DISCOVERY_INTERVAL_MS / 60000}m | Target stock=${TARGET_STOCK_INTERVAL_MS / 60000}m | Costco=${COSTCO_INTERVAL_MS / 60000}m`
  );
}

module.exports = {
  startRetailerApiMonitors,
};
