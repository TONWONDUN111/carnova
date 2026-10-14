// CarNova.com published-inventory reader.
//
// The dealership's live inventory is published on carnova.com. The storefront is
// a client-rendered app that reads its vehicle listings from a public,
// read-only REST collection, so this module reads exactly the same published
// listings a visitor's browser does and maps them onto NOVACARAI inventory
// records.
//
// Nothing here writes to the database and nothing here is dealership specific:
// the module fetches and maps, and the caller decides which dealership the
// mapped vehicles belong to. That keeps the mapping pure and directly testable.

export const CARNOVA_SITE_URL = "https://carnova.com";

/** Every dealership gets one feed record with this name for CarNova.com. */
export const CARNOVA_SOURCE_NAME = "CarNova.com published inventory";
export const CARNOVA_SOURCE_TYPE = "api";
export const CARNOVA_SOURCE_PROVIDER = "CarNova.com";

/** Reason recorded when a vehicle stops appearing in the published listings. */
export const CARNOVA_REMOVED_REASON = "No longer listed on CarNova.com";
export const CARNOVA_RELISTED_REASON = "Relisted on CarNova.com";

const LISTING_COLLECTION = "vehicles";
const PAGE_SIZE = 500;
const MAX_LISTINGS = 5000;

// The published storefront config is read from the site itself so this
// integration keeps working when the site is redeployed. It is cached in
// module scope purely to avoid re-downloading the storefront bundle for every
// vehicle page of a single sync; it is a request-level cache of public data,
// never a store of record.
const DISCOVERY_TTL_MS = 15 * 60 * 1000;
let discoveryCache = null;

const text = (value) =>
  typeof value === "string" ? value.trim() : value === 0 ? "0" : "";

const number = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const positive = (value) => {
  const parsed = number(value);
  return parsed !== null && parsed > 0 ? parsed : null;
};

const titleCase = (value) =>
  text(value)
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");

/** Dealer comments arrive as marketing HTML; inventory stores plain text. */
export const stripHtml = (value) =>
  text(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr)>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();

/**
 * Locate the public listing endpoint by reading the published storefront, the
 * same way a browser does: the page references its application bundle, and the
 * bundle carries the public read-only listing endpoint and its publishable
 * client key.
 */
export const discoverCarnovaFeed = async ({
  fetchImpl = fetch,
  siteUrl = CARNOVA_SITE_URL,
  now = Date.now,
} = {}) => {
  const envUrl = text(process.env.CARNOVA_INVENTORY_URL);
  const envKey = text(process.env.CARNOVA_INVENTORY_KEY);
  if (envUrl && envKey) return { baseUrl: envUrl, apiKey: envKey };

  if (discoveryCache && now() - discoveryCache.at < DISCOVERY_TTL_MS)
    return discoveryCache.value;

  const pageResponse = await fetchImpl(siteUrl, {
    headers: { accept: "text/html" },
  });
  if (!pageResponse.ok)
    throw new Error(
      `CarNova.com returned ${pageResponse.status} when loading the storefront.`,
    );
  const html = await pageResponse.text();

  const bundlePaths = [...html.matchAll(/src="((?:\/|https?:\/\/)[^"]+\.js)"/g)]
    .map((match) => match[1])
    .filter((path) => /assets\//.test(path));
  if (!bundlePaths.length)
    throw new Error(
      "Could not find the CarNova.com storefront bundle. The site layout may have changed.",
    );

  let discovered = null;
  for (const bundlePath of bundlePaths.slice(0, 3)) {
    const bundleUrl = bundlePath.startsWith("http")
      ? bundlePath
      : new URL(bundlePath, siteUrl).toString();
    const bundleResponse = await fetchImpl(bundleUrl);
    if (!bundleResponse.ok) continue;
    const bundle = await bundleResponse.text();
    const host = bundle.match(/https:\/\/[a-z0-9-]+\.supabase\.co/i)?.[0];
    const key = bundle.match(
      /eyJhbGciOiJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
    )?.[0];
    if (host && key) {
      discovered = { baseUrl: `${host}/rest/v1`, apiKey: key };
      break;
    }
  }

  if (!discovered)
    throw new Error(
      "Could not read the CarNova.com inventory endpoint from the published site.",
    );

  discoveryCache = { at: now(), value: discovered };
  return discovered;
};

/** Clears the cached endpoint discovery. Used by tests. */
export const resetCarnovaFeedCache = () => {
  discoveryCache = null;
};

/** Read every currently published listing, following pagination. */
export const fetchCarnovaListings = async ({
  fetchImpl = fetch,
  siteUrl = CARNOVA_SITE_URL,
} = {}) => {
  const { baseUrl, apiKey } = await discoverCarnovaFeed({ fetchImpl, siteUrl });
  const listings = [];
  for (let offset = 0; offset < MAX_LISTINGS; offset += PAGE_SIZE) {
    const url = `${baseUrl}/${LISTING_COLLECTION}?select=*&order=id.asc&limit=${PAGE_SIZE}&offset=${offset}`;
    const response = await fetchImpl(url, {
      headers: {
        apikey: apiKey,
        authorization: `Bearer ${apiKey}`,
        accept: "application/json",
      },
    });
    if (!response.ok)
      throw new Error(
        `CarNova.com inventory request failed with status ${response.status}.`,
      );
    const page = await response.json();
    if (!Array.isArray(page) || !page.length) break;
    listings.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return listings;
};

const CONDITION_FROM_FEED = {
  new: "new",
  used: "used",
  preowned: "used",
  "pre-owned": "used",
  certified: "certified",
  cpo: "certified",
};

/** New / used / certified, with certification flags taking precedence. */
export const mapCondition = (listing) => {
  const certified =
    text(listing?.factory_certified) === "1" ||
    text(listing?.dealer_certified) === "1" ||
    listing?.factory_certified === true ||
    listing?.dealer_certified === true;
  if (certified) return "certified";
  const raw = text(listing?.is_new).toLowerCase();
  return CONDITION_FROM_FEED[raw] ?? "used";
};

const FUEL_LABELS = {
  gas: "Gasoline",
  gasoline: "Gasoline",
  diesel: "Diesel",
  electric: "Electric",
  hybrid: "Hybrid",
  plugin_hybrid: "Plug-in Hybrid",
  "plug-in_hybrid": "Plug-in Hybrid",
  flex_fuel: "Flex Fuel",
  flexfuel: "Flex Fuel",
  cng: "CNG",
  hydrogen: "Hydrogen",
};

export const mapFuelType = (value) => {
  const raw = text(value).toLowerCase();
  if (!raw) return null;
  return FUEL_LABELS[raw] ?? titleCase(raw);
};

const DRIVETRAIN_LABELS = {
  fwd: "FWD",
  rwd: "RWD",
  awd: "AWD",
  "4wd": "4WD",
  "4x4": "4WD",
  "2wd": "2WD",
};

export const mapDrivetrain = (value) => {
  const raw = text(value).toLowerCase().replace(/\s+/g, "");
  if (!raw) return null;
  return DRIVETRAIN_LABELS[raw] ?? titleCase(value);
};

/**
 * The feed carries a coarse category (Car, Truck, SUV) and a specific body
 * type (Sedan, Coupe, Pickup). Inventory search matches body-style words
 * against this column, so prefer the specific value and fall back to the
 * category.
 */
export const mapBodyStyle = (listing) => {
  const specific = text(listing?.body_type);
  const category = text(listing?.body_style);
  if (specific && specific.toLowerCase() !== "standard") return specific;
  return category || specific || null;
};

/** Photo URLs are published as one comma-separated list per vehicle. */
export const mapPhotos = (listing) => {
  const raw = listing?.photourl;
  const values = Array.isArray(raw) ? raw : text(raw).split(",");
  const seen = new Set();
  const photos = [];
  for (const value of values) {
    const url = text(value);
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    photos.push(url);
  }
  return photos;
};

// Feature phrases customers actually search for. These are matched only
// against the dealer's own highlight line and the plain option names, never
// against the listing's specification descriptors: descriptors such as
// "third-row windows: fixed third-row windows" or "4wd type: full-time awd"
// contain the words without the vehicle having the equipment, and inventory
// must never claim a feature the vehicle does not have.
const CANONICAL_FEATURES = {
  "Third row": ["third row", "3rd row", "third-row", "7 passenger"],
  Sunroof: ["sunroof", "moonroof", "panoramic roof"],
  Leather: ["leather"],
  Navigation: ["navigation", "nav system"],
  "Heated seats": ["heated seat", "heated front seat"],
  "Cooled seats": ["cooled seat", "ventilated seat", "air conditioned seat"],
  "Backup camera": [
    "backup camera",
    "back up camera",
    "rear camera",
    "rearview camera",
  ],
  "Apple CarPlay": ["carplay", "apple carplay"],
  "Android Auto": ["android auto"],
  "Adaptive cruise": ["adaptive cruise"],
  "Cruise control": ["cruise control"],
  "Tow package": [
    "tow package",
    "towing package",
    "tow hitch",
    "trailer hitch",
  ],
  Bluetooth: ["bluetooth"],
  "Blind spot": ["blind spot", "blind-spot"],
  "Remote start": ["remote start"],
  "Lane departure": ["lane departure", "lane keep"],
  "Parking sensors": ["parking sensor", "park assist"],
  "Keyless entry": ["keyless entry", "keyless start", "push button start"],
  "Premium audio": ["premium audio", "bose", "alpine", "harman", "jbl audio"],
  "Power liftgate": ["power liftgate", "power tailgate"],
  "Heated steering wheel": ["heated steering"],
  "Wireless charging": ["wireless charging", "wireless charger"],
  "Clean Carfax": ["clean carfax"],
  "One owner": ["one owner", "1 owner"],
};

/**
 * Build a short feature list from the published listing: the dealer's own
 * highlight line, the plain option names, and canonical phrases detected in
 * the full option text.
 */
export const mapFeatures = (listing) => {
  const highlights = text(listing?.extrafield1)
    .split(/\s+-\s+|\s*\|\s*/)
    .map((part) => text(part))
    .filter((part) => part.length > 1 && part.length <= 60)
    .map((part) => (part === part.toUpperCase() ? titleCase(part) : part));

  const optionText = text(listing?.optiondescription);
  const plainOptions = optionText
    .split(",")
    .map((part) => text(part))
    .filter(
      (part) =>
        part &&
        part.length <= 48 &&
        // Descriptor pairs ("Front head restraints: Height adjustable ...")
        // are specification prose, not the features customers ask for.
        !part.includes(":") &&
        // A descriptor value can itself contain commas, so splitting leaves
        // lowercase sentence fragments ("washer fluid and brake fluid"). Real
        // option names are capitalised and short.
        /^[A-Z0-9]/.test(part) &&
        part.split(/\s+/).length <= 5,
    );

  const haystack = [...highlights, ...plainOptions].join(" | ").toLowerCase();

  const canonical = Object.entries(CANONICAL_FEATURES)
    .filter(([name, phrases]) =>
      [name.toLowerCase(), ...phrases].some(
        (phrase) => phrase && haystack.includes(phrase),
      ),
    )
    .map(([name]) => name);

  // Drivetrain is a first-class column, so the drivetrain feature words come
  // from the mapped value rather than from prose.
  const drivetrain = mapDrivetrain(listing?.drivetrain);
  const drivetrainFeatures =
    drivetrain === "AWD"
      ? ["AWD", "All wheel drive"]
      : drivetrain === "4WD"
        ? ["4WD", "Four wheel drive"]
        : [];

  const seen = new Set();
  const features = [];
  for (const feature of [
    ...highlights,
    ...canonical,
    ...drivetrainFeatures,
    ...plainOptions,
  ]) {
    const key = feature.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    features.push(feature);
  }
  return features.slice(0, 100);
};

/** Engine text, preferring the published description over raw specs. */
export const mapEngine = (listing) => {
  const described = text(listing?.engine_description);
  if (described) return described;
  const displacement = number(listing?.engine_displacement);
  const cylinders = positive(listing?.cylinders);
  const parts = [];
  if (displacement) parts.push(`${displacement}L`);
  if (cylinders) parts.push(`${cylinders}cyl`);
  return parts.length ? parts.join(" ") : null;
};

/**
 * Vehicle description for the CRM and for TITAN: the dealer's highlight line,
 * their published comments, and the economy figures the listing carries.
 */
export const mapDescription = (listing) => {
  const parts = [];
  const highlight = text(listing?.extrafield1);
  if (highlight) parts.push(highlight);

  const city = positive(listing?.citympg);
  const highway = positive(listing?.hwympg);
  if (city || highway) {
    const economy = [
      city ? `${city} city` : null,
      highway ? `${highway} highway` : null,
    ]
      .filter(Boolean)
      .join(" / ");
    parts.push(`EPA estimated MPG: ${economy}.`);
  }

  const comments = stripHtml(listing?.dealercomments);
  if (comments) parts.push(comments);

  const description = parts.join("\n\n").trim();
  return description ? description.slice(0, 5000) : null;
};

/** Stable identifier the dealership uses for the vehicle. */
export const mapStockNumber = (listing) => {
  const stock = text(listing?.stock);
  if (stock) return stock.slice(0, 100);
  const vin = text(listing?.vin).toUpperCase();
  // Without a stock number, the VIN tail is the dealership's usual stand-in.
  if (vin.length >= 8) return vin.slice(-8);
  const vehicleId = text(listing?.vehicleid) || text(listing?.id);
  return vehicleId ? `CN-${vehicleId}`.slice(0, 100) : "";
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

const mapDateAdded = (listing) => {
  const inStock = text(listing?.instockdate);
  if (ISO_DATE.test(inStock)) return new Date(inStock).toISOString();
  const created = text(listing?.created_at);
  if (created && !Number.isNaN(Date.parse(created)))
    return new Date(created).toISOString();
  return null;
};

/**
 * Map one published CarNova listing onto the NOVACARAI vehicle payload.
 *
 * Only fields the published listing actually controls are returned. Anything
 * NOVACARAI owns — availability status, MSRP, lot location, and every CRM
 * relationship — is deliberately absent so a sync never overwrites it.
 */
export const mapCarnovaListing = (listing) => {
  const stockNumber = mapStockNumber(listing);
  const vin = text(listing?.vin).toUpperCase();
  const year = positive(listing?.year);
  const make = text(listing?.make);
  const model = text(listing?.model);
  const listPrice = positive(listing?.list_price);
  const specialPrice = positive(listing?.special_price);
  const doors = positive(listing?.doorcount);

  return {
    stockNumber,
    vin: vin || null,
    year,
    make,
    model,
    trim: text(listing?.trim).slice(0, 100) || null,
    mileage: number(listing?.mileage),
    price: listPrice,
    // The advertised figure customers see, when the listing publishes one.
    internetPrice: specialPrice ?? listPrice,
    vehicleType: mapBodyStyle(listing),
    condition: mapCondition(listing),
    exteriorColor: text(listing?.exteriorcolor).slice(0, 100) || null,
    interiorColor: text(listing?.interiorcolor).slice(0, 100) || null,
    fuelType: mapFuelType(listing?.fuel_type),
    drivetrain: mapDrivetrain(listing?.drivetrain),
    transmission: text(listing?.transmission).slice(0, 80) || null,
    engine: mapEngine(listing),
    doors: doors && doors <= 8 ? doors : null,
    images: mapPhotos(listing),
    features: mapFeatures(listing),
    description: mapDescription(listing),
    dateAdded: mapDateAdded(listing),
    listingUrl: text(listing?.website_url) || null,
  };
};

/**
 * True when a mapped listing carries the identity NOVACARAI requires. Rows
 * that fail this are reported as skipped rather than written, so one bad
 * published row never fails an entire sync.
 */
export const isMappableListing = (vehicle) =>
  Boolean(
    vehicle &&
    vehicle.stockNumber &&
    vehicle.year &&
    vehicle.make &&
    vehicle.model,
  );

/**
 * Map every published listing, dropping rows without a usable identity and
 * collapsing duplicates so one sync can never write the same vehicle twice.
 * VIN identifies a vehicle when present; stock number is the fallback.
 */
export const mapCarnovaListings = (listings) => {
  const vehicles = [];
  const skipped = [];
  const seen = new Map();

  for (const listing of Array.isArray(listings) ? listings : []) {
    const vehicle = mapCarnovaListing(listing);
    if (!isMappableListing(vehicle)) {
      skipped.push({
        reason:
          "Listing is missing the stock number, year, make, or model needed to identify a vehicle.",
        stockNumber: vehicle?.stockNumber || null,
        vin: vehicle?.vin || null,
      });
      continue;
    }
    const key = vehicle.vin
      ? `vin:${vehicle.vin}`
      : `stock:${vehicle.stockNumber.toLowerCase()}`;
    const existingIndex = seen.get(key);
    if (existingIndex !== undefined) {
      // The published feed listed the same vehicle twice. Keep the richer row.
      const current = vehicles[existingIndex];
      if (vehicle.images.length > current.images.length)
        vehicles[existingIndex] = vehicle;
      continue;
    }
    seen.set(key, vehicles.length);
    vehicles.push(vehicle);
  }

  return { vehicles, skipped };
};
