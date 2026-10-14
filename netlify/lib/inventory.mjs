// NOVACARAI inventory core.
//
// Inventory is the source of truth for TITAN AI. Every query in this module is
// dealership scoped: a dealership can only ever read its own vehicles. The
// module has no side effects on import and takes the database connection as an
// argument so the retrieval logic can be exercised directly by tests.

export const INVENTORY_STATUSES = [
  "available",
  "reserved",
  "in_transit",
  "sold",
  "transferred",
  "removed",
  "unavailable",
];

// Statuses TITAN may present to a customer as something they can come see.
export const PRESENTABLE_STATUSES = ["available", "in_transit"];

// Statuses TITAN must never present as available.
export const UNAVAILABLE_STATUSES = INVENTORY_STATUSES.filter(
  (status) => !PRESENTABLE_STATUSES.includes(status),
);

export const INVENTORY_CONDITIONS = ["new", "used", "certified"];

export const INVENTORY_SOURCE_TYPES = ["manual", "csv", "api", "dms"];

export const SYNC_SCHEDULES = ["manual", "hourly", "daily", "twice_daily"];

export const DEFAULT_STALE_AFTER_HOURS = 24;

export const STATUS_PRESENTATION = {
  available: "on the lot and available",
  in_transit: "in transit and not on the lot yet",
  reserved: "reserved for another customer",
  sold: "sold",
  transferred: "transferred to another store",
  removed: "removed from inventory",
  unavailable: "not available",
};

// Body styles the dealership may store in vehicle_type, plus the phrases
// customers actually use for them.
export const BODY_STYLE_SYNONYMS = {
  suv: ["suv", "suvs", "crossover", "crossovers", "cuv"],
  truck: ["truck", "trucks", "pickup", "pickups"],
  sedan: ["sedan", "sedans"],
  coupe: ["coupe", "coupes"],
  convertible: ["convertible", "convertibles", "cabriolet", "roadster"],
  hatchback: ["hatchback", "hatchbacks", "hatch"],
  wagon: ["wagon", "wagons", "estate"],
  van: ["van", "vans", "minivan", "minivans"],
};

export const COLOR_SYNONYMS = {
  black: ["black"],
  white: ["white", "pearl white", "ivory"],
  silver: ["silver"],
  gray: ["gray", "grey", "graphite", "charcoal"],
  blue: ["blue", "navy"],
  red: ["red", "crimson", "burgundy", "maroon"],
  green: ["green"],
  brown: ["brown", "bronze"],
  beige: ["beige", "tan", "sand", "cream"],
  gold: ["gold"],
  orange: ["orange", "copper"],
  yellow: ["yellow"],
  purple: ["purple"],
};

// Feature phrases customers ask for, mapped to the substring matched against
// the stored feature list.
export const FEATURE_SYNONYMS = {
  "third row": ["third row", "3rd row", "third-row", "7 seater", "7-seater"],
  sunroof: ["sunroof", "moonroof", "panoramic roof"],
  leather: ["leather", "leather seats"],
  navigation: ["navigation", "nav system", "gps"],
  "heated seats": ["heated seats", "heated seat"],
  "cooled seats": ["cooled seats", "ventilated seats"],
  "backup camera": ["backup camera", "back up camera", "rear camera"],
  "apple carplay": ["apple carplay", "carplay"],
  "android auto": ["android auto"],
  "adaptive cruise": ["adaptive cruise", "cruise control"],
  "tow package": ["tow package", "towing package", "tow hitch", "towing"],
  awd: ["awd", "all wheel drive", "all-wheel drive"],
  "4wd": ["4wd", "4x4", "four wheel drive", "four-wheel drive"],
  bluetooth: ["bluetooth"],
  "blind spot": ["blind spot", "blind-spot"],
  "remote start": ["remote start"],
};

// Marque vocabulary lets TITAN recognise a vehicle request even when the
// dealership does not stock it, so it can say so instead of improvising.
export const KNOWN_MAKES = [
  "acura",
  "alfa romeo",
  "audi",
  "bmw",
  "buick",
  "cadillac",
  "chevrolet",
  "chevy",
  "chrysler",
  "dodge",
  "fiat",
  "ford",
  "genesis",
  "gmc",
  "honda",
  "hyundai",
  "infiniti",
  "jaguar",
  "jeep",
  "kia",
  "land rover",
  "lexus",
  "lincoln",
  "mazda",
  "mercedes",
  "mercedes-benz",
  "mini",
  "mitsubishi",
  "nissan",
  "polestar",
  "porsche",
  "ram",
  "rivian",
  "subaru",
  "tesla",
  "toyota",
  "volkswagen",
  "volvo",
  "vw",
];

export const KNOWN_MODELS = [
  "1500",
  "2500",
  "3 series",
  "4runner",
  "5 series",
  "accord",
  "altima",
  "atlas",
  "blazer",
  "bronco",
  "camaro",
  "camry",
  "canyon",
  "charger",
  "cherokee",
  "civic",
  "colorado",
  "corolla",
  "corvette",
  "cr-v",
  "crv",
  "durango",
  "edge",
  "elantra",
  "equinox",
  "escalade",
  "escape",
  "expedition",
  "explorer",
  "f-150",
  "f150",
  "forester",
  "frontier",
  "grand cherokee",
  "highlander",
  "hrv",
  "jetta",
  "malibu",
  "maverick",
  "mustang",
  "outback",
  "palisade",
  "pathfinder",
  "pilot",
  "q5",
  "ram 1500",
  "ranger",
  "rav4",
  "rogue",
  "santa fe",
  "sentra",
  "sienna",
  "sierra",
  "silverado",
  "sorento",
  "sportage",
  "suburban",
  "tacoma",
  "tahoe",
  "telluride",
  "terrain",
  "tucson",
  "tundra",
  "wrangler",
  "x3",
  "x5",
  "x7",
  "yukon",
];

const MAKE_ALIASES = {
  chevy: "chevrolet",
  vw: "volkswagen",
  mercedes: "mercedes-benz",
  "land-rover": "land rover",
};

const QUERY_STOP_WORDS = new Set([
  "about",
  "any",
  "anything",
  "are",
  "available",
  "car",
  "cars",
  "come",
  "cost",
  "could",
  "deal",
  "did",
  "does",
  "dollars",
  "family",
  "find",
  "for",
  "get",
  "got",
  "have",
  "hello",
  "help",
  "how",
  "interested",
  "into",
  "just",
  "know",
  "like",
  "look",
  "looking",
  "much",
  "need",
  "new",
  "number",
  "one",
  "please",
  "price",
  "priced",
  "pricing",
  "really",
  "see",
  "show",
  "some",
  "something",
  "stock",
  "still",
  "tell",
  "that",
  "the",
  "there",
  "these",
  "they",
  "this",
  "thinking",
  "under",
  "used",
  "vehicle",
  "vehicles",
  "want",
  "wanted",
  "was",
  "what",
  "whats",
  "which",
  "with",
  "would",
  "you",
  "your",
]);

const VEHICLE_COLUMNS = `id, dealership_id, stock_number, vin, year, make, model, trim, mileage,
  price, internet_price, msrp, vehicle_type, condition, exterior_color, interior_color,
  fuel_type, drivetrain, transmission, engine, doors, images, features, description,
  status, status_changed_at, status_reason, sold_at, location, source, source_reference,
  date_added, last_seen_at, updated_at`;

const lower = (value) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const uniq = (values) => [...new Set(values.filter(Boolean))];

const toNumber = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(number) ? number : null;
};

const asArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim())
    return value.split(",").map((item) => item.trim());
  return [];
};

export const normalizeMake = (value) => {
  const text = lower(value);
  return MAKE_ALIASES[text] ?? text;
};

export const normalizeBodyStyle = (value) => {
  const text = lower(value);
  if (!text) return "";
  const entry = Object.entries(BODY_STYLE_SYNONYMS).find(
    ([canonical, terms]) => (canonical === text ? true : terms.includes(text)),
  );
  return entry ? entry[0] : text;
};

export const normalizeColor = (value) => {
  const text = lower(value);
  if (!text) return "";
  const entry = Object.entries(COLOR_SYNONYMS).find(([canonical, terms]) =>
    canonical === text ? true : terms.some((term) => text.includes(term)),
  );
  return entry ? entry[0] : text;
};

/**
 * Parse a customer's natural-language vehicle request into structured
 * inventory filters. `vocabulary` carries the dealership's own makes, models,
 * trims, body styles and colors so tenant-specific words are recognised.
 */
export const parseInventoryQuery = (text, vocabulary = {}) => {
  const source = typeof text === "string" ? text : "";
  const haystack = ` ${source.toLowerCase().replace(/\s+/g, " ")} `;
  const filters = {
    stockNumbers: [],
    vins: [],
    makes: [],
    models: [],
    trims: [],
    bodyStyles: [],
    exteriorColors: [],
    features: [],
    conditions: [],
    keywords: [],
    yearMin: null,
    yearMax: null,
    priceMin: null,
    priceMax: null,
    mileageMax: null,
  };

  // Explicit identifiers win: "stock #12345", "VIN 1GNSK...".
  const identifiers = [];
  for (const match of source.matchAll(
    /\b(?:stock|stk|stock\s*number|stock\s*#)\s*#?\s*([a-z0-9-]{3,20})\b/gi,
  )) {
    identifiers.push(match[1]);
  }
  for (const match of source.matchAll(/#\s*([a-z0-9-]{3,20})\b/gi)) {
    identifiers.push(match[1]);
  }
  // "stock #12345" matches both patterns above, so identifiers are deduplicated
  // and lower-cased to match how they are compared in SQL.
  filters.stockNumbers = uniq(identifiers.map(lower));
  filters.vins = uniq(
    [...source.matchAll(/\b([a-hj-npr-z0-9]{17})\b/gi)].map((match) =>
      lower(match[1]),
    ),
  );

  // Price intent.
  const priceCeiling = haystack.match(
    /(?:under|below|less than|no more than|max(?:imum)?(?: of)?|up to|budget of|around|about)\s*\$?\s*([\d,.]+)\s*(k\b)?/i,
  );
  if (priceCeiling) {
    const raw = toNumber(priceCeiling[1]);
    filters.priceMax = priceCeiling[2] && raw !== null ? raw * 1000 : raw;
  }
  const priceFloor = haystack.match(
    /(?:over|above|more than|at least|starting at)\s*\$?\s*([\d,.]+)\s*(k\b)?/i,
  );
  if (priceFloor) {
    const raw = toNumber(priceFloor[1]);
    filters.priceMin = priceFloor[2] && raw !== null ? raw * 1000 : raw;
  }
  const bareDollar = haystack.match(/\$\s*([\d,]{4,})/);
  if (filters.priceMax === null && filters.priceMin === null && bareDollar) {
    filters.priceMax = toNumber(bareDollar[1]);
  }

  // Mileage intent.
  const mileage = haystack.match(
    /(?:under|below|less than|fewer than|max(?:imum)?(?: of)?|up to)\s*([\d,.]+)\s*(k\s*)?(?:miles|mi|mileage)/i,
  );
  if (mileage) {
    const raw = toNumber(mileage[1]);
    filters.mileageMax = mileage[2] && raw !== null ? raw * 1000 : raw;
  }

  // Year intent, including ranges and "newer than".
  const yearRange = haystack.match(
    /\b(19\d{2}|20\d{2})\s*(?:-|to|through)\s*(19\d{2}|20\d{2})\b/,
  );
  if (yearRange) {
    filters.yearMin = Number(yearRange[1]);
    filters.yearMax = Number(yearRange[2]);
  } else {
    const newerThan = haystack.match(
      /\b(?:newer than|after|since|20\d{2}\s*or newer)\s*(19\d{2}|20\d{2})\b/,
    );
    const olderThan = haystack.match(
      /\b(?:older than|before)\s*(19\d{2}|20\d{2})\b/,
    );
    if (newerThan) filters.yearMin = Number(newerThan[1]);
    else if (olderThan) filters.yearMax = Number(olderThan[1]);
    else {
      const exactYear = haystack.match(/\b(19[89]\d|20[0-4]\d)\b/);
      if (exactYear) {
        filters.yearMin = Number(exactYear[1]);
        filters.yearMax = Number(exactYear[1]);
      }
    }
  }

  // Condition intent.
  if (/\b(brand new|new car|new truck|new suv|brand-new)\b/.test(haystack))
    filters.conditions.push("new");
  if (/\b(certified|cpo|certified pre-owned)\b/.test(haystack))
    filters.conditions.push("certified");
  if (/\b(used|pre-owned|preowned|second hand)\b/.test(haystack))
    filters.conditions.push("used");

  const containsPhrase = (phrase) =>
    new RegExp(`(^|[^a-z0-9])${escapeRegExp(phrase)}([^a-z0-9]|$)`, "i").test(
      haystack,
    );

  // Makes and models: dealership vocabulary first, then general knowledge.
  const dealershipMakes = uniq(asArray(vocabulary.makes).map(lower));
  const dealershipModels = uniq(asArray(vocabulary.models).map(lower));
  const dealershipTrims = uniq(asArray(vocabulary.trims).map(lower));

  for (const make of uniq([...dealershipMakes, ...KNOWN_MAKES])) {
    if (containsPhrase(make)) filters.makes.push(normalizeMake(make));
  }
  for (const model of uniq([...dealershipModels, ...KNOWN_MODELS])) {
    if (model.length > 1 && containsPhrase(model)) filters.models.push(model);
  }
  for (const trimName of dealershipTrims) {
    if (trimName.length > 2 && containsPhrase(trimName))
      filters.trims.push(trimName);
  }

  // Body styles.
  for (const [canonical, terms] of Object.entries(BODY_STYLE_SYNONYMS)) {
    if ([canonical, ...terms].some(containsPhrase))
      filters.bodyStyles.push(canonical);
  }
  for (const bodyStyle of uniq(asArray(vocabulary.bodyStyles).map(lower))) {
    if (containsPhrase(bodyStyle))
      filters.bodyStyles.push(normalizeBodyStyle(bodyStyle));
  }

  // Colors.
  for (const [canonical, terms] of Object.entries(COLOR_SYNONYMS)) {
    if ([canonical, ...terms].some(containsPhrase))
      filters.exteriorColors.push(canonical);
  }

  // Features.
  for (const [canonical, terms] of Object.entries(FEATURE_SYNONYMS)) {
    if ([canonical, ...terms].some(containsPhrase))
      filters.features.push(canonical);
  }

  // Remaining meaningful words become loose keywords so trims like "Denali"
  // or "Limited" still narrow the result set.
  const matched = new Set(
    [
      ...filters.makes,
      ...filters.models,
      ...filters.trims,
      ...filters.bodyStyles,
      ...filters.exteriorColors,
    ].flatMap((value) => value.split(/[^a-z0-9]+/)),
  );
  filters.keywords = uniq(
    haystack
      .replace(/\$?[\d,.]+k?\b/g, " ")
      .split(/[^a-z0-9-]+/)
      .filter(
        (word) =>
          word.length > 2 &&
          !QUERY_STOP_WORDS.has(word) &&
          !matched.has(word) &&
          !filters.stockNumbers.some((stock) => lower(stock) === word),
      ),
  ).slice(0, 6);

  filters.makes = uniq(filters.makes);
  filters.models = uniq(filters.models);
  filters.trims = uniq(filters.trims);
  filters.bodyStyles = uniq(filters.bodyStyles);
  filters.exteriorColors = uniq(filters.exteriorColors);
  filters.features = uniq(filters.features);
  filters.conditions = uniq(filters.conditions);
  return filters;
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * True when the parsed request actually names something about a vehicle, as
 * opposed to a greeting or a scheduling reply.
 */
export const hasVehicleIntent = (filters) =>
  Boolean(
    filters.stockNumbers.length ||
    filters.vins.length ||
    filters.makes.length ||
    filters.models.length ||
    filters.trims.length ||
    filters.bodyStyles.length ||
    filters.exteriorColors.length ||
    filters.features.length ||
    filters.conditions.length ||
    filters.yearMin ||
    filters.yearMax ||
    filters.priceMax ||
    filters.priceMin ||
    filters.mileageMax,
  );

export const INVENTORY_SORTS = {
  relevance: null,
  price_asc: "COALESCE(internet_price, price, msrp) ASC NULLS LAST",
  price_desc: "COALESCE(internet_price, price, msrp) DESC NULLS LAST",
  mileage_asc: "mileage ASC NULLS LAST",
  year_desc: "year DESC",
  year_asc: "year ASC",
  newest: "date_added DESC",
  oldest: "date_added ASC",
};

/**
 * Build a parameterized, dealership-scoped inventory query. Only column names
 * defined in this module are ever interpolated into the SQL text; every value
 * supplied by a caller is bound as a parameter.
 */
export const buildInventorySearchSql = ({
  dealershipId,
  filters = {},
  statuses = null,
  presentableOnly = false,
  limit = 60,
  offset = 0,
  sort = "relevance",
} = {}) => {
  const params = [dealershipId];
  const conditions = ["dealership_id = $1"];
  const bind = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  const statusList = presentableOnly
    ? PRESENTABLE_STATUSES
    : asArray(statuses).filter((status) => INVENTORY_STATUSES.includes(status));
  if (statusList.length)
    conditions.push(`status = ANY(${bind(statusList)}::text[])`);

  const stockNumbers = asArray(filters.stockNumbers).map(lower).filter(Boolean);
  const vins = asArray(filters.vins).map(lower).filter(Boolean);
  if (stockNumbers.length && vins.length) {
    conditions.push(
      `(LOWER(stock_number) = ANY(${bind(stockNumbers)}::text[]) OR LOWER(COALESCE(vin, '')) = ANY(${bind(vins)}::text[]))`,
    );
  } else if (stockNumbers.length) {
    conditions.push(`LOWER(stock_number) = ANY(${bind(stockNumbers)}::text[])`);
  } else if (vins.length) {
    conditions.push(`LOWER(COALESCE(vin, '')) = ANY(${bind(vins)}::text[])`);
  }

  const makes = uniq(asArray(filters.makes).map(normalizeMake));
  if (makes.length)
    conditions.push(`LOWER(make) = ANY(${bind(makes)}::text[])`);

  const models = uniq(asArray(filters.models).map(lower));
  if (models.length) {
    conditions.push(
      `(LOWER(model) = ANY(${bind(models)}::text[]) OR ${models
        .map(
          (model) =>
            `LOWER(model) LIKE ${bind(`%${model}%`)} OR LOWER(COALESCE(trim, '')) LIKE ${bind(`%${model}%`)}`,
        )
        .join(" OR ")})`,
    );
  }

  const trims = uniq(asArray(filters.trims).map(lower));
  if (trims.length) {
    conditions.push(
      `(${trims
        .map(
          (trimName) =>
            `LOWER(COALESCE(trim, '')) LIKE ${bind(`%${trimName}%`)}`,
        )
        .join(" OR ")})`,
    );
  }

  const bodyStyles = uniq(asArray(filters.bodyStyles).map(normalizeBodyStyle));
  if (bodyStyles.length) {
    const terms = uniq(
      bodyStyles.flatMap((style) => [
        style,
        ...(BODY_STYLE_SYNONYMS[style] ?? []),
      ]),
    );
    conditions.push(
      `(${terms
        .map(
          (term) =>
            `LOWER(COALESCE(vehicle_type, '')) LIKE ${bind(`%${term}%`)}`,
        )
        .join(" OR ")})`,
    );
  }

  const exteriorColors = uniq(
    asArray(filters.exteriorColors).map(normalizeColor),
  );
  if (exteriorColors.length) {
    const terms = uniq(
      exteriorColors.flatMap((color) => [
        color,
        ...(COLOR_SYNONYMS[color] ?? []),
      ]),
    );
    conditions.push(
      `(${terms
        .map(
          (term) =>
            `LOWER(COALESCE(exterior_color, '')) LIKE ${bind(`%${term}%`)}`,
        )
        .join(" OR ")})`,
    );
  }

  const interiorColors = uniq(
    asArray(filters.interiorColors).map(normalizeColor),
  );
  if (interiorColors.length) {
    const terms = uniq(
      interiorColors.flatMap((color) => [
        color,
        ...(COLOR_SYNONYMS[color] ?? []),
      ]),
    );
    conditions.push(
      `(${terms
        .map(
          (term) =>
            `LOWER(COALESCE(interior_color, '')) LIKE ${bind(`%${term}%`)}`,
        )
        .join(" OR ")})`,
    );
  }

  const conditionsFilter = uniq(asArray(filters.conditions).map(lower)).filter(
    (value) => INVENTORY_CONDITIONS.includes(value),
  );
  if (conditionsFilter.length)
    conditions.push(`condition = ANY(${bind(conditionsFilter)}::text[])`);

  const features = uniq(asArray(filters.features).map(lower));
  if (features.length) {
    conditions.push(
      `(${features
        .map(
          (feature) =>
            `LOWER(features::text) LIKE ${bind(`%${feature}%`)} OR LOWER(COALESCE(description, '')) LIKE ${bind(`%${feature}%`)}`,
        )
        .join(" OR ")})`,
    );
  }

  const yearMin = toNumber(filters.yearMin);
  const yearMax = toNumber(filters.yearMax);
  if (yearMin !== null) conditions.push(`year >= ${bind(yearMin)}`);
  if (yearMax !== null) conditions.push(`year <= ${bind(yearMax)}`);

  const priceMin = toNumber(filters.priceMin);
  const priceMax = toNumber(filters.priceMax);
  if (priceMin !== null)
    conditions.push(
      `COALESCE(internet_price, price, msrp) >= ${bind(priceMin)}`,
    );
  if (priceMax !== null)
    conditions.push(
      `COALESCE(internet_price, price, msrp) IS NOT NULL AND COALESCE(internet_price, price, msrp) <= ${bind(priceMax)}`,
    );

  const mileageMin = toNumber(filters.mileageMin);
  const mileageMax = toNumber(filters.mileageMax);
  if (mileageMin !== null)
    conditions.push(`COALESCE(mileage, 0) >= ${bind(mileageMin)}`);
  if (mileageMax !== null)
    conditions.push(`COALESCE(mileage, 0) <= ${bind(mileageMax)}`);

  const keywords = uniq(asArray(filters.keywords).map(lower)).slice(0, 6);
  for (const keyword of keywords) {
    const pattern = bind(`%${keyword}%`);
    conditions.push(
      `(LOWER(stock_number) LIKE ${pattern}
        OR LOWER(COALESCE(vin, '')) LIKE ${pattern}
        OR LOWER(make) LIKE ${pattern}
        OR LOWER(model) LIKE ${pattern}
        OR LOWER(COALESCE(trim, '')) LIKE ${pattern}
        OR LOWER(COALESCE(vehicle_type, '')) LIKE ${pattern}
        OR LOWER(COALESCE(exterior_color, '')) LIKE ${pattern}
        OR LOWER(COALESCE(interior_color, '')) LIKE ${pattern}
        OR LOWER(COALESCE(fuel_type, '')) LIKE ${pattern}
        OR LOWER(COALESCE(drivetrain, '')) LIKE ${pattern}
        OR LOWER(COALESCE(location, '')) LIKE ${pattern}
        OR LOWER(features::text) LIKE ${pattern}
        OR LOWER(COALESCE(description, '')) LIKE ${pattern}
        OR year::text LIKE ${pattern})`,
    );
  }

  // Free-text search box: any single field may match.
  const freeText = lower(filters.q);
  if (freeText) {
    const pattern = bind(`%${freeText}%`);
    conditions.push(
      `(LOWER(stock_number) LIKE ${pattern}
        OR LOWER(COALESCE(vin, '')) LIKE ${pattern}
        OR LOWER(make) LIKE ${pattern}
        OR LOWER(model) LIKE ${pattern}
        OR LOWER(COALESCE(trim, '')) LIKE ${pattern}
        OR LOWER(COALESCE(vehicle_type, '')) LIKE ${pattern}
        OR LOWER(COALESCE(exterior_color, '')) LIKE ${pattern}
        OR LOWER(COALESCE(interior_color, '')) LIKE ${pattern}
        OR LOWER(features::text) LIKE ${pattern}
        OR LOWER(COALESCE(description, '')) LIKE ${pattern}
        OR year::text LIKE ${pattern})`,
    );
  }

  const statusRank = `CASE status
      WHEN 'available' THEN 0
      WHEN 'in_transit' THEN 1
      WHEN 'reserved' THEN 2
      WHEN 'transferred' THEN 3
      WHEN 'unavailable' THEN 4
      WHEN 'sold' THEN 5
      ELSE 6 END`;
  const sortClause = INVENTORY_SORTS[sort] ?? null;
  const orderBy = [statusRank, sortClause, "date_added DESC", "id"]
    .filter(Boolean)
    .join(", ");

  const where = conditions.join("\n      AND ");
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 60));
  const safeOffset = Math.max(0, Math.min(5000, Number(offset) || 0));

  return {
    text: `SELECT ${VEHICLE_COLUMNS},
        COALESCE(internet_price, price, msrp) AS effective_price,
        COUNT(*) OVER ()::int AS total_matches
      FROM carnova_inventory
      WHERE ${where}
      ORDER BY ${orderBy}
      LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params,
  };
};

export const searchInventory = async (db, options) => {
  const { text, params } = buildInventorySearchSql(options);
  const rows = await db.sql.unsafe(text, params);
  return {
    vehicles: rows.map(({ total_matches: _ignored, ...vehicle }) => vehicle),
    total: rows.length ? Number(rows[0].total_matches) : 0,
  };
};

export const getVehicleById = async (db, dealershipId, vehicleId) => {
  const [vehicle] = await db.sql.unsafe(
    `SELECT ${VEHICLE_COLUMNS}, COALESCE(internet_price, price, msrp) AS effective_price
     FROM carnova_inventory WHERE id = $1 AND dealership_id = $2`,
    [vehicleId, dealershipId],
  );
  return vehicle ?? null;
};

export const getVehiclesByIds = async (db, dealershipId, vehicleIds) => {
  const ids = uniq(asArray(vehicleIds));
  if (!ids.length) return [];
  return db.sql.unsafe(
    `SELECT ${VEHICLE_COLUMNS}, COALESCE(internet_price, price, msrp) AS effective_price
     FROM carnova_inventory WHERE dealership_id = $1 AND id = ANY($2::text[])`,
    [dealershipId, ids],
  );
};

/**
 * Distinct values with counts, used both for CRM filter dropdowns and as the
 * dealership-specific vocabulary for natural-language parsing.
 */
export const getInventoryFacets = async (db, dealershipId) => {
  const [row] = await db.sql.unsafe(
    `WITH scoped AS (
      SELECT * FROM carnova_inventory WHERE dealership_id = $1
    )
    SELECT
      (SELECT COUNT(*)::int FROM scoped) AS total,
      (SELECT COUNT(*)::int FROM scoped WHERE status = ANY($2::text[])) AS presentable,
      (SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM (
        SELECT make AS value, COUNT(*)::int AS count FROM scoped
        WHERE COALESCE(make, '') <> '' GROUP BY make ORDER BY make
      ) t) AS makes,
      (SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM (
        SELECT make, model AS value, COUNT(*)::int AS count FROM scoped
        WHERE COALESCE(model, '') <> '' GROUP BY make, model ORDER BY make, model
      ) t) AS models,
      (SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM (
        SELECT trim AS value, COUNT(*)::int AS count FROM scoped
        WHERE COALESCE(trim, '') <> '' GROUP BY trim ORDER BY trim
      ) t) AS trims,
      (SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM (
        SELECT vehicle_type AS value, COUNT(*)::int AS count FROM scoped
        WHERE COALESCE(vehicle_type, '') <> '' GROUP BY vehicle_type ORDER BY vehicle_type
      ) t) AS body_styles,
      (SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM (
        SELECT exterior_color AS value, COUNT(*)::int AS count FROM scoped
        WHERE COALESCE(exterior_color, '') <> '' GROUP BY exterior_color ORDER BY exterior_color
      ) t) AS exterior_colors,
      (SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM (
        SELECT interior_color AS value, COUNT(*)::int AS count FROM scoped
        WHERE COALESCE(interior_color, '') <> '' GROUP BY interior_color ORDER BY interior_color
      ) t) AS interior_colors,
      (SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM (
        SELECT status AS value, COUNT(*)::int AS count FROM scoped GROUP BY status ORDER BY status
      ) t) AS statuses,
      (SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) FROM (
        SELECT condition AS value, COUNT(*)::int AS count FROM scoped GROUP BY condition ORDER BY condition
      ) t) AS conditions,
      (SELECT COALESCE(json_agg(DISTINCT feature), '[]'::json) FROM (
        SELECT LOWER(jsonb_array_elements_text(features)) AS feature FROM scoped
      ) f WHERE feature <> '') AS features,
      (SELECT MIN(year)::int FROM scoped) AS year_min,
      (SELECT MAX(year)::int FROM scoped) AS year_max,
      (SELECT MIN(COALESCE(internet_price, price, msrp))::numeric FROM scoped) AS price_min,
      (SELECT MAX(COALESCE(internet_price, price, msrp))::numeric FROM scoped) AS price_max,
      (SELECT MAX(mileage)::int FROM scoped) AS mileage_max`,
    [dealershipId, PRESENTABLE_STATUSES],
  );

  const facets = row ?? {};
  return {
    total: Number(facets.total ?? 0),
    presentable: Number(facets.presentable ?? 0),
    makes: facets.makes ?? [],
    models: facets.models ?? [],
    trims: facets.trims ?? [],
    bodyStyles: facets.body_styles ?? [],
    exteriorColors: facets.exterior_colors ?? [],
    interiorColors: facets.interior_colors ?? [],
    statuses: facets.statuses ?? [],
    conditions: facets.conditions ?? [],
    features: (facets.features ?? []).slice(0, 80),
    yearMin: facets.year_min ?? null,
    yearMax: facets.year_max ?? null,
    priceMin: facets.price_min === null ? null : Number(facets.price_min),
    priceMax: facets.price_max === null ? null : Number(facets.price_max),
    mileageMax: facets.mileage_max ?? null,
  };
};

export const facetsToVocabulary = (facets) => ({
  makes: (facets.makes ?? []).map((item) => item.value),
  models: (facets.models ?? []).map((item) => item.value),
  trims: (facets.trims ?? []).map((item) => item.value),
  bodyStyles: (facets.bodyStyles ?? []).map((item) => item.value),
});

/**
 * When was this dealership's inventory last synchronized, and can TITAN speak
 * confidently about current availability?
 */
export const getInventoryFreshness = async (db, dealershipId) => {
  const [row] = await db.sql.unsafe(
    `SELECT
      (SELECT MAX(updated_at) FROM carnova_inventory WHERE dealership_id = $1) AS last_record_update,
      (SELECT COUNT(*)::int FROM carnova_inventory WHERE dealership_id = $1) AS vehicle_count,
      (SELECT COUNT(*)::int FROM carnova_inventory WHERE dealership_id = $1 AND status = ANY($2::text[])) AS presentable_count,
      (SELECT MAX(finished_at) FROM carnova_inventory_syncs WHERE dealership_id = $1 AND status <> 'failed') AS last_sync_at,
      (SELECT status FROM carnova_inventory_syncs WHERE dealership_id = $1 ORDER BY started_at DESC LIMIT 1) AS last_sync_status,
      (SELECT source_type FROM carnova_inventory_syncs WHERE dealership_id = $1 ORDER BY started_at DESC LIMIT 1) AS last_sync_source_type,
      (SELECT message FROM carnova_inventory_syncs WHERE dealership_id = $1 ORDER BY started_at DESC LIMIT 1) AS last_sync_message,
      (SELECT MIN(stale_after_hours)::int FROM carnova_inventory_sources WHERE dealership_id = $1 AND enabled = TRUE) AS stale_after_hours,
      (SELECT COUNT(*)::int FROM carnova_inventory_sources WHERE dealership_id = $1 AND enabled = TRUE) AS enabled_source_count`,
    [dealershipId, PRESENTABLE_STATUSES],
  );

  const data = row ?? {};
  const staleAfterHours =
    Number(data.stale_after_hours) || DEFAULT_STALE_AFTER_HOURS;
  const lastSyncAt = data.last_sync_at ?? null;
  const lastRecordUpdate = data.last_record_update ?? null;
  const reference = lastSyncAt ?? lastRecordUpdate;
  const ageHours = reference
    ? (Date.now() - new Date(reference).getTime()) / 3600000
    : null;
  const vehicleCount = Number(data.vehicle_count ?? 0);

  return {
    vehicleCount,
    presentableCount: Number(data.presentable_count ?? 0),
    lastSyncedAt: lastSyncAt,
    lastRecordUpdatedAt: lastRecordUpdate,
    lastSyncStatus:
      data.last_sync_status ?? (vehicleCount ? "manual" : "never"),
    lastSyncSourceType: data.last_sync_source_type ?? null,
    lastSyncMessage: data.last_sync_message ?? null,
    staleAfterHours,
    enabledSourceCount: Number(data.enabled_source_count ?? 0),
    ageHours: ageHours === null ? null : Math.round(ageHours * 10) / 10,
    // Empty or old inventory means TITAN must not assert current availability.
    stale:
      vehicleCount === 0 || ageHours === null || ageHours > staleAfterHours,
  };
};

/** Compact, AI-safe projection of a real inventory record. */
export const summarizeVehicleForAi = (vehicle) => {
  if (!vehicle) return null;
  const price =
    vehicle.effective_price ??
    vehicle.internet_price ??
    vehicle.price ??
    vehicle.msrp;
  const features = Array.isArray(vehicle.features) ? vehicle.features : [];
  return {
    vehicleId: vehicle.id,
    stockNumber: vehicle.stock_number,
    vin: vehicle.vin ?? null,
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    trim: vehicle.trim ?? null,
    bodyStyle: vehicle.vehicle_type ?? null,
    condition: vehicle.condition,
    mileage: vehicle.mileage ?? null,
    price: price === null || price === undefined ? null : Number(price),
    msrp:
      vehicle.msrp === null || vehicle.msrp === undefined
        ? null
        : Number(vehicle.msrp),
    exteriorColor: vehicle.exterior_color ?? null,
    interiorColor: vehicle.interior_color ?? null,
    drivetrain: vehicle.drivetrain ?? null,
    fuelType: vehicle.fuel_type ?? null,
    features: features.slice(0, 12),
    status: vehicle.status,
    availability: STATUS_PRESENTATION[vehicle.status] ?? vehicle.status,
    presentable: PRESENTABLE_STATUSES.includes(vehicle.status),
    location: vehicle.location ?? null,
  };
};

export const describeVehicle = (vehicle) =>
  [vehicle?.year, vehicle?.make, vehicle?.model, vehicle?.trim]
    .filter(Boolean)
    .join(" ") || "vehicle";

/** Identifying vehicle data recorded at the moment of association. */
export const vehicleSnapshot = (vehicle) =>
  vehicle
    ? {
        inventoryId: vehicle.id,
        stockNumber: vehicle.stock_number ?? null,
        vin: vehicle.vin ?? null,
        year: vehicle.year ?? null,
        make: vehicle.make ?? null,
        model: vehicle.model ?? null,
        trim: vehicle.trim ?? null,
        bodyStyle: vehicle.vehicle_type ?? null,
        capturedAt: new Date().toISOString(),
      }
    : {};

export const getLeadVehicles = async (db, dealershipId, leadId) =>
  db.sql.unsafe(
    `SELECT lv.*, i.status AS current_status, i.stock_number AS current_stock_number,
       i.exterior_color, i.mileage, i.vehicle_type,
       COALESCE(i.internet_price, i.price, i.msrp) AS effective_price
     FROM carnova_lead_vehicles lv
     LEFT JOIN carnova_inventory i ON i.id = lv.inventory_id AND i.dealership_id = lv.dealership_id
     WHERE lv.dealership_id = $1 AND lv.lead_id = $2
     ORDER BY lv.interest_level = 'primary' DESC, lv.last_interest_at DESC`,
    [dealershipId, leadId],
  );

/**
 * Record that a lead is interested in a real inventory vehicle. Tenant scoped:
 * the vehicle must already have been read from this dealership's inventory.
 */
export const recordVehicleInterest = async (
  db,
  {
    dealershipId,
    leadId,
    vehicle,
    interestLevel = "interested",
    capturedBy = "ai",
    notes = null,
  },
) => {
  if (!dealershipId || !leadId || !vehicle?.id) return null;
  const [row] = await db.sql.unsafe(
    `INSERT INTO carnova_lead_vehicles (
      id, dealership_id, lead_id, inventory_id, stock_number, vin, year, make, model, trim,
      interest_level, captured_by, notes
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    ON CONFLICT (lead_id, inventory_id) DO UPDATE SET
      last_interest_at = NOW(),
      interest_level = CASE
        WHEN carnova_lead_vehicles.interest_level = 'primary' THEN 'primary'
        ELSE EXCLUDED.interest_level END,
      notes = COALESCE(EXCLUDED.notes, carnova_lead_vehicles.notes)
    RETURNING *`,
    [
      crypto.randomUUID(),
      dealershipId,
      leadId,
      vehicle.id,
      vehicle.stock_number ?? null,
      vehicle.vin ?? null,
      vehicle.year ?? null,
      vehicle.make ?? null,
      vehicle.model ?? null,
      vehicle.trim ?? null,
      interestLevel,
      capturedBy,
      notes,
    ],
  );
  return row ?? null;
};

export const removeVehicleInterest = async (
  db,
  dealershipId,
  leadId,
  inventoryId,
) =>
  db.sql.unsafe(
    `DELETE FROM carnova_lead_vehicles
     WHERE dealership_id = $1 AND lead_id = $2 AND inventory_id = $3`,
    [dealershipId, leadId, inventoryId],
  );

/**
 * Alternatives from current inventory for a vehicle that is no longer
 * available, so TITAN can pivot instead of dead-ending the customer.
 */
export const findAlternatives = async (
  db,
  { dealershipId, vehicle, filters = {}, excludeIds = [], limit = 3 },
) => {
  const price =
    vehicle?.effective_price ??
    vehicle?.internet_price ??
    vehicle?.price ??
    null;
  const attempts = [];

  if (vehicle) {
    attempts.push({
      makes: [vehicle.make],
      models: [vehicle.model],
      priceMax: price ? Math.round(Number(price) * 1.15) : null,
    });
    attempts.push({
      bodyStyles: vehicle.vehicle_type ? [vehicle.vehicle_type] : [],
      makes: [vehicle.make],
      priceMax: price ? Math.round(Number(price) * 1.15) : null,
    });
    attempts.push({
      bodyStyles: vehicle.vehicle_type ? [vehicle.vehicle_type] : [],
      priceMax: price ? Math.round(Number(price) * 1.15) : null,
    });
  }
  if (Object.keys(filters).length) {
    attempts.push({
      makes: filters.makes ?? [],
      bodyStyles: filters.bodyStyles ?? [],
      priceMax: filters.priceMax ?? null,
    });
    attempts.push({ bodyStyles: filters.bodyStyles ?? [] });
  }

  const collected = [];
  const seen = new Set(asArray(excludeIds));
  for (const attempt of attempts) {
    if (collected.length >= limit) break;
    const meaningful = Object.values(attempt).some((value) =>
      Array.isArray(value) ? value.filter(Boolean).length : value,
    );
    if (!meaningful) continue;
    const { vehicles } = await searchInventory(db, {
      dealershipId,
      filters: attempt,
      presentableOnly: true,
      limit: limit + seen.size,
      sort: "price_asc",
    });
    for (const candidate of vehicles) {
      if (seen.has(candidate.id) || collected.length >= limit) continue;
      seen.add(candidate.id);
      collected.push(candidate);
    }
  }
  return collected;
};

/**
 * Build the inventory slice TITAN needs for one customer turn.
 *
 * Only relevant vehicles are retrieved — never the whole inventory — and each
 * one is trimmed to the fields the AI is allowed to talk about.
 */
export const buildAiInventoryContext = async (
  db,
  {
    dealershipId,
    message = "",
    conversationText = "",
    lead = null,
    leadVehicles = [],
    maxMatches = 6,
  },
) => {
  const facets = await getInventoryFacets(db, dealershipId);
  const vocabulary = facetsToVocabulary(facets);

  // The current message drives retrieval; recent conversation and the lead's
  // stated interest fill in context the customer is not repeating.
  const currentFilters = parseInventoryQuery(message, vocabulary);
  const currentIntent = hasVehicleIntent(currentFilters);
  const contextText = [conversationText, lead?.vehicle_interest]
    .filter(Boolean)
    .join(" \n ");
  const contextFilters = parseInventoryQuery(contextText, vocabulary);
  const filters = currentIntent ? currentFilters : contextFilters;
  const searchIntent = hasVehicleIntent(filters);

  const freshness = await getInventoryFreshness(db, dealershipId);

  // Vehicles already attached to this lead, with their live status.
  const trackedIds = uniq([
    lead?.inventory_id,
    ...asArray(leadVehicles).map((item) => item.inventory_id),
  ]);
  const trackedVehicles = await getVehiclesByIds(db, dealershipId, trackedIds);

  let matches = [];
  let total = 0;
  if (searchIntent) {
    const presentable = await searchInventory(db, {
      dealershipId,
      filters,
      presentableOnly: true,
      limit: maxMatches,
      sort: "price_asc",
    });
    matches = presentable.vehicles;
    total = presentable.total;
  }

  // A vehicle the customer named by stock number or VIN must be reported even
  // when it is no longer available, so TITAN can say so honestly.
  let identifiedUnavailable = [];
  if ((filters.stockNumbers.length || filters.vins.length) && !matches.length) {
    const exact = await searchInventory(db, {
      dealershipId,
      filters: {
        stockNumbers: filters.stockNumbers,
        vins: filters.vins,
      },
      limit: 3,
    });
    identifiedUnavailable = exact.vehicles.filter(
      (vehicle) => !PRESENTABLE_STATUSES.includes(vehicle.status),
    );
  }

  const unavailableTracked = trackedVehicles.filter(
    (vehicle) => !PRESENTABLE_STATUSES.includes(vehicle.status),
  );
  const unavailable = uniqueById([
    ...identifiedUnavailable,
    ...unavailableTracked,
  ]);

  // Offer alternatives whenever a discussed vehicle is gone or a search that
  // clearly asked for a vehicle produced nothing.
  const needsAlternatives = Boolean(
    unavailable.length || (searchIntent && !matches.length),
  );
  const alternatives = needsAlternatives
    ? await findAlternatives(db, {
        dealershipId,
        vehicle: unavailable[0] ?? null,
        filters: searchIntent ? filters : {},
        excludeIds: [
          ...matches.map((vehicle) => vehicle.id),
          ...unavailable.map((vehicle) => vehicle.id),
        ],
        limit: 3,
      })
    : [];

  return {
    searched: searchIntent,
    criteria: summarizeCriteria(filters),
    inventoryTotals: {
      vehiclesInInventory: facets.total,
      availableToPresent: facets.presentable,
      matchCount: total,
    },
    matches: matches.map(summarizeVehicleForAi),
    noMatchesFound: searchIntent && matches.length === 0,
    unavailableDiscussedVehicles: unavailable.map(summarizeVehicleForAi),
    alternatives: alternatives.map(summarizeVehicleForAi),
    trackedVehicles: trackedVehicles.map(summarizeVehicleForAi),
    freshness: {
      lastInventorySync:
        freshness.lastSyncedAt ?? freshness.lastRecordUpdatedAt,
      ageHours: freshness.ageHours,
      stale: freshness.stale,
      vehiclesInInventory: freshness.vehicleCount,
    },
    rawMatches: matches,
    rawUnavailable: unavailable,
    rawAlternatives: alternatives,
    filters,
  };
};

const uniqueById = (rows) => {
  const seen = new Set();
  return rows.filter((row) => {
    if (!row?.id || seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
};

const summarizeCriteria = (filters) =>
  Object.fromEntries(
    Object.entries({
      stockNumber: filters.stockNumbers?.[0] ?? null,
      vin: filters.vins?.[0] ?? null,
      makes: filters.makes,
      models: filters.models,
      trims: filters.trims,
      bodyStyles: filters.bodyStyles,
      exteriorColors: filters.exteriorColors,
      features: filters.features,
      conditions: filters.conditions,
      yearMin: filters.yearMin,
      yearMax: filters.yearMax,
      priceMax: filters.priceMax,
      priceMin: filters.priceMin,
      mileageMax: filters.mileageMax,
      keywords: filters.keywords,
    }).filter(([, value]) =>
      Array.isArray(value)
        ? value.length
        : value !== null && value !== undefined,
    ),
  );

/** The AI-facing instruction block that keeps TITAN inside real inventory. */
export const buildInventoryInstructions = (context) => {
  if (!context) return "";
  const lines = [
    "INVENTORY RULES (ABSOLUTE)",
    "- The supplied inventory records are the only vehicles that exist. Never invent a vehicle, VIN, stock number, price, mileage, trim, feature, color, or availability.",
    "- Only vehicles listed with presentable=true may be offered as something the customer can come see.",
    "- Quote prices, mileage, colors, and trims exactly as supplied, and never add a vehicle that is not in the list.",
  ];

  if (context.noMatchesFound) {
    lines.push(
      "- Nothing in current inventory matches this request. Say so plainly, do not improvise a vehicle, and offer the supplied alternatives or a human follow-up before asking for the visit.",
    );
  }
  if (context.unavailableDiscussedVehicles?.length) {
    const gone = context.unavailableDiscussedVehicles
      .map(
        (vehicle) =>
          `${vehicle.year} ${vehicle.make} ${vehicle.model} (stock ${vehicle.stockNumber}) is ${vehicle.availability}`,
      )
      .join("; ");
    lines.push(
      `- A vehicle already discussed is no longer available: ${gone}. Tell the customer gracefully, then offer the supplied alternatives and move toward an appointment.`,
    );
  }
  if (context.alternatives?.length) {
    lines.push(
      "- Alternatives supplied below are real, currently available vehicles. Offer at most two by year, make, model, and price.",
    );
  }
  if (context.freshness?.stale) {
    lines.push(
      '- Inventory data is stale or unavailable, so do NOT claim current availability. Say "Let me have the dealership confirm that vehicle\'s availability." and promise a human follow-up.',
    );
  }
  if (!context.freshness?.vehiclesInInventory) {
    lines.push(
      "- This dealership has no inventory loaded. Do not describe any vehicle. Offer a human follow-up instead.",
    );
  }
  return lines.join("\n");
};

/** Record a synchronization run so freshness is always attributable. */
export const recordInventorySync = async (
  db,
  {
    dealershipId,
    sourceId = null,
    sourceType = "csv",
    status = "success",
    vehiclesReceived = 0,
    createdCount = 0,
    updatedCount = 0,
    failedCount = 0,
    message = null,
    startedAt = null,
  },
) => {
  const [sync] = await db.sql.unsafe(
    `INSERT INTO carnova_inventory_syncs (
      id, dealership_id, source_id, source_type, status, vehicles_received,
      created_count, updated_count, failed_count, message, started_at, finished_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11::timestamptz, NOW()), NOW())
    RETURNING *`,
    [
      crypto.randomUUID(),
      dealershipId,
      sourceId,
      sourceType,
      status,
      vehiclesReceived,
      createdCount,
      updatedCount,
      failedCount,
      message,
      startedAt,
    ],
  );
  if (sourceId) {
    await db.sql.unsafe(
      `UPDATE carnova_inventory_sources SET
        last_synced_at = NOW(), last_sync_status = $3, last_sync_message = $4,
        last_sync_vehicle_count = $5, updated_at = NOW()
      WHERE id = $1 AND dealership_id = $2`,
      [sourceId, dealershipId, status, message, vehiclesReceived],
    );
  }
  return sync ?? null;
};

export const listInventorySources = async (db, dealershipId) =>
  db.sql.unsafe(
    `SELECT s.*, (
       SELECT COUNT(*)::int FROM carnova_inventory i
       WHERE i.dealership_id = s.dealership_id AND i.source_reference = s.id
     ) AS vehicle_count
     FROM carnova_inventory_sources s
     WHERE s.dealership_id = $1
     ORDER BY s.enabled DESC, s.name`,
    [dealershipId],
  );

export const listInventorySyncs = async (db, dealershipId, limit = 10) =>
  db.sql.unsafe(
    `SELECT * FROM carnova_inventory_syncs
     WHERE dealership_id = $1 ORDER BY started_at DESC LIMIT $2`,
    [dealershipId, Math.max(1, Math.min(50, Number(limit) || 10))],
  );
