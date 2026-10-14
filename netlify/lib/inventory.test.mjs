import { describe, expect, it } from "vitest";

import {
  INVENTORY_STATUSES,
  PRESENTABLE_STATUSES,
  buildAiInventoryContext,
  buildInventoryInstructions,
  buildInventorySearchSql,
  describeVehicle,
  facetsToVocabulary,
  findAlternatives,
  getInventoryFreshness,
  hasVehicleIntent,
  normalizeColor,
  normalizeMake,
  parseInventoryQuery,
  searchInventory,
  summarizeVehicleForAi,
  vehicleSnapshot,
} from "./inventory.mjs";
import { TEST_INVENTORY } from "./test-inventory.mjs";

const DEALERSHIP_A = "dealership-a";
const DEALERSHIP_B = "dealership-b";

/** Turn a TEST_INVENTORY entry into the row shape Postgres would return. */
const asRow = (vehicle, overrides = {}) => ({
  id: `veh-${vehicle.stockNumber}`,
  dealership_id: DEALERSHIP_A,
  stock_number: vehicle.stockNumber,
  vin: vehicle.vin,
  year: vehicle.year,
  make: vehicle.make,
  model: vehicle.model,
  trim: vehicle.trim,
  mileage: vehicle.mileage,
  price: vehicle.price,
  internet_price: vehicle.internetPrice,
  msrp: vehicle.msrp,
  effective_price: vehicle.internetPrice ?? vehicle.price ?? vehicle.msrp,
  vehicle_type: vehicle.vehicleType,
  condition: vehicle.condition,
  exterior_color: vehicle.exteriorColor,
  interior_color: vehicle.interiorColor,
  fuel_type: vehicle.fuelType,
  drivetrain: vehicle.drivetrain,
  features: vehicle.features ?? [],
  description: vehicle.description,
  status: vehicle.status,
  location: vehicle.location,
  ...overrides,
});

const byStock = (stockNumber) =>
  asRow(TEST_INVENTORY.find((item) => item.stockNumber === stockNumber));

const NEW_TAHOE = byStock("12345");
const CPO_TAHOE = byStock("TST-2001");
const SOLD_TAHOE = byStock("TST-2002");
const BMW_X5 = byStock("TST-3001");
const BLACK_X3 = byStock("TST-3002");

/**
 * Fake Netlify database.
 *
 * Every query the inventory module issues goes through db.sql.unsafe with a
 * distinctive shape, so the fake routes on that shape, records the exact SQL
 * and bound parameters, and hands vehicle searches to a per-test responder.
 * That lets the tests assert both what was retrieved and how it was scoped.
 */
const createDb = ({
  facets = {},
  freshness = {},
  leadVehicles = [],
  vehiclesById = [],
  search = () => [],
} = {}) => {
  const calls = { searches: [], all: [] };

  const respond = ({ text, params }) => {
    calls.all.push({ text, params });
    if (text.includes("WITH scoped AS")) {
      return [
        {
          total: 0,
          presentable: 0,
          makes: [],
          models: [],
          trims: [],
          body_styles: [],
          exterior_colors: [],
          interior_colors: [],
          statuses: [],
          conditions: [],
          features: [],
          year_min: null,
          year_max: null,
          price_min: null,
          price_max: null,
          mileage_max: null,
          ...facets,
        },
      ];
    }
    if (text.includes("AS last_record_update")) {
      return [
        {
          last_record_update: new Date().toISOString(),
          vehicle_count: 12,
          presentable_count: 9,
          last_sync_at: new Date().toISOString(),
          last_sync_status: "success",
          last_sync_source_type: "csv",
          last_sync_message: null,
          stale_after_hours: 24,
          enabled_source_count: 1,
          ...freshness,
        },
      ];
    }
    if (text.includes("FROM carnova_lead_vehicles lv")) return leadVehicles;
    if (text.includes("id = ANY($2::text[])")) {
      const ids = params[1] ?? [];
      return vehiclesById.filter((vehicle) => ids.includes(vehicle.id));
    }
    if (text.includes("total_matches")) {
      const index = calls.searches.length;
      calls.searches.push({ text, params });
      const rows = search({ text, params, index }) ?? [];
      return rows.map((row) => ({ ...row, total_matches: rows.length }));
    }
    return [];
  };

  const sql = (strings, ...values) =>
    Promise.resolve(respond({ text: strings.join(" ? "), params: values }));
  sql.unsafe = (text, params = []) =>
    Promise.resolve(respond({ text, params }));

  return { db: { sql }, calls };
};

/** Params bound as arrays, ignoring the status list the builder always adds. */
const filterArrays = (params) =>
  params
    .filter(Array.isArray)
    .filter(
      (value) => !value.every((entry) => INVENTORY_STATUSES.includes(entry)),
    );

describe("parseInventoryQuery", () => {
  it("finds the model a customer asks for by name", () => {
    const filters = parseInventoryQuery("Do you have a Tahoe?");
    expect(filters.models).toContain("tahoe");
    expect(hasVehicleIntent(filters)).toBe(true);
  });

  it("reads body style, color, and a price ceiling from one sentence", () => {
    const filters = parseInventoryQuery(
      "I'm looking for a black SUV under $40,000.",
    );
    expect(filters.bodyStyles).toEqual(["suv"]);
    expect(filters.exteriorColors).toEqual(["black"]);
    expect(filters.priceMax).toBe(40000);
  });

  it("reads year, make, and model from an availability question", () => {
    const filters = parseInventoryQuery("Is the 2024 BMW X5 still available?");
    expect(filters.yearMin).toBe(2024);
    expect(filters.yearMax).toBe(2024);
    expect(filters.makes).toContain("bmw");
    expect(filters.models).toContain("x5");
  });

  it("extracts an exact stock number", () => {
    expect(
      parseInventoryQuery("Tell me about stock #12345.").stockNumbers,
    ).toEqual(["12345"]);
  });

  it("extracts a VIN", () => {
    const filters = parseInventoryQuery("Any info on VIN 1GNSKBKC5PR123450?");
    expect(filters.vins).toEqual(["1gnskbkc5pr123450"]);
  });

  it("understands shorthand prices and mileage limits", () => {
    expect(parseInventoryQuery("something under 40k").priceMax).toBe(40000);
    expect(parseInventoryQuery("under 50,000 miles please").mileageMax).toBe(
      50000,
    );
  });

  it("understands new, used, and certified", () => {
    expect(parseInventoryQuery("looking for a new truck").conditions).toContain(
      "new",
    );
    expect(
      parseInventoryQuery("do you have certified pre-owned SUVs").conditions,
    ).toContain("certified");
  });

  it("recognises features customers name in plain language", () => {
    const filters = parseInventoryQuery("need third row and a sunroof");
    expect(filters.features).toContain("third row");
    expect(filters.features).toContain("sunroof");
  });

  it("normalises make nicknames", () => {
    expect(normalizeMake("chevy")).toBe("chevrolet");
    expect(parseInventoryQuery("looking at a chevy").makes).toContain(
      "chevrolet",
    );
    expect(normalizeColor("grey")).toBe("gray");
  });

  it("uses the dealership's own inventory as vocabulary", () => {
    const vocabulary = facetsToVocabulary({
      makes: [{ value: "Rivian" }],
      models: [{ value: "R1T" }],
      trims: [{ value: "Adventure" }],
      bodyStyles: [{ value: "Truck" }],
    });
    const filters = parseInventoryQuery("is the R1T Adventure in?", vocabulary);
    expect(filters.models).toContain("r1t");
    expect(filters.trims).toContain("adventure");
  });

  it("does not claim vehicle intent for a non-vehicle question", () => {
    expect(hasVehicleIntent(parseInventoryQuery("what are your hours?"))).toBe(
      false,
    );
  });
});

describe("buildInventorySearchSql", () => {
  it("always scopes to the requesting dealership as the first bound parameter", () => {
    const { text, params } = buildInventorySearchSql({
      dealershipId: DEALERSHIP_A,
      filters: { models: ["tahoe"] },
    });
    expect(text).toContain("dealership_id = $1");
    expect(params[0]).toBe(DEALERSHIP_A);
    expect(text).not.toContain(DEALERSHIP_A);
    expect(params).not.toContain(DEALERSHIP_B);
  });

  it("cannot be steered at another dealership through filter values", () => {
    const { params } = buildInventorySearchSql({
      dealershipId: DEALERSHIP_A,
      filters: { q: DEALERSHIP_B, keywords: [DEALERSHIP_B] },
    });
    expect(params[0]).toBe(DEALERSHIP_A);
    expect(params.filter((value) => value === DEALERSHIP_A)).toHaveLength(1);
  });

  it("restricts to presentable statuses when asked", () => {
    const { text, params } = buildInventorySearchSql({
      dealershipId: DEALERSHIP_A,
      presentableOnly: true,
    });
    expect(text).toContain("status = ANY($2::text[])");
    expect(params[1]).toEqual(PRESENTABLE_STATUSES);
  });

  it("filters by new, used, or certified", () => {
    const { text, params } = buildInventorySearchSql({
      dealershipId: DEALERSHIP_A,
      filters: { conditions: ["certified", "bogus"] },
    });
    expect(text).toContain("condition = ANY($2::text[])");
    expect(params[1]).toEqual(["certified"]);
  });

  it("filters by make and model", () => {
    const { text, params } = buildInventorySearchSql({
      dealershipId: DEALERSHIP_A,
      filters: { makes: ["Chevy"], models: ["Tahoe"] },
    });
    expect(text).toContain("LOWER(make) = ANY($2::text[])");
    expect(params[1]).toEqual(["chevrolet"]);
    expect(text).toContain("LOWER(model) = ANY($3::text[])");
    expect(params[2]).toEqual(["tahoe"]);
    expect(params).toContain("%tahoe%");
  });

  it("filters by year range", () => {
    const { text, params } = buildInventorySearchSql({
      dealershipId: DEALERSHIP_A,
      filters: { yearMin: 2022, yearMax: 2024 },
    });
    expect(text).toContain("year >= $2");
    expect(text).toContain("year <= $3");
    expect(params.slice(1)).toEqual([2022, 2024]);
  });

  it("filters by price, ignoring vehicles with no price at all", () => {
    const { text, params } = buildInventorySearchSql({
      dealershipId: DEALERSHIP_A,
      filters: { priceMax: 40000 },
    });
    expect(text).toContain(
      "COALESCE(internet_price, price, msrp) IS NOT NULL AND COALESCE(internet_price, price, msrp) <= $2",
    );
    expect(params[1]).toBe(40000);
  });

  it("filters by mileage", () => {
    const { text, params } = buildInventorySearchSql({
      dealershipId: DEALERSHIP_A,
      filters: { mileageMax: 50000 },
    });
    expect(text).toContain("COALESCE(mileage, 0) <= $2");
    expect(params[1]).toBe(50000);
  });

  it("expands body style and color synonyms", () => {
    const suv = buildInventorySearchSql({
      dealershipId: DEALERSHIP_A,
      filters: { bodyStyles: ["SUV"] },
    });
    expect(suv.params).toContain("%suv%");
    expect(suv.params).toContain("%crossover%");

    const gray = buildInventorySearchSql({
      dealershipId: DEALERSHIP_A,
      filters: { exteriorColors: ["grey"] },
    });
    expect(gray.text).toContain("LOWER(COALESCE(exterior_color, '')) LIKE");
    expect(gray.params).toContain("%gray%");
  });

  it("filters by interior color, trim, and features", () => {
    const { text, params } = buildInventorySearchSql({
      dealershipId: DEALERSHIP_A,
      filters: {
        interiorColors: ["black"],
        trims: ["Premier"],
        features: ["third row"],
      },
    });
    expect(text).toContain("LOWER(COALESCE(interior_color, '')) LIKE");
    expect(text).toContain("LOWER(COALESCE(trim, '')) LIKE");
    expect(text).toContain("LOWER(features::text) LIKE");
    expect(params).toContain("%premier%");
    expect(params).toContain("%third row%");
  });

  it("looks up an exact stock number or VIN", () => {
    const stock = buildInventorySearchSql({
      dealershipId: DEALERSHIP_A,
      filters: { stockNumbers: ["12345"] },
    });
    expect(stock.text).toContain("LOWER(stock_number) = ANY($2::text[])");
    expect(stock.params[1]).toEqual(["12345"]);

    const both = buildInventorySearchSql({
      dealershipId: DEALERSHIP_A,
      filters: { stockNumbers: ["12345"], vins: ["ABC"] },
    });
    expect(both.text).toContain(
      "(LOWER(stock_number) = ANY($2::text[]) OR LOWER(COALESCE(vin, '')) = ANY($3::text[]))",
    );
  });

  it("searches every displayed field from the free-text box", () => {
    const { text, params } = buildInventorySearchSql({
      dealershipId: DEALERSHIP_A,
      filters: { q: "Tahoe" },
    });
    expect(params[1]).toBe("%tahoe%");
    for (const column of [
      "stock_number",
      "vin",
      "make",
      "model",
      "trim",
      "vehicle_type",
      "exterior_color",
      "interior_color",
      "features",
      "description",
    ])
      expect(text).toContain(column);
  });

  it("sorts unavailable vehicles last and honours the requested sort", () => {
    const { text } = buildInventorySearchSql({
      dealershipId: DEALERSHIP_A,
      sort: "price_asc",
    });
    expect(text).toContain("WHEN 'available' THEN 0");
    expect(text).toContain("WHEN 'sold' THEN 5");
    expect(text.indexOf("ORDER BY")).toBeLessThan(text.indexOf("LIMIT"));
  });

  it("clamps paging so one request can never read the whole database", () => {
    const { text } = buildInventorySearchSql({
      dealershipId: DEALERSHIP_A,
      limit: 100000,
      offset: -5,
    });
    expect(text).toContain("LIMIT 500 OFFSET 0");
  });
});

describe("searchInventory", () => {
  it("returns rows without the internal paging column and a total", async () => {
    const { db, calls } = createDb({ search: () => [NEW_TAHOE, CPO_TAHOE] });
    const result = await searchInventory(db, {
      dealershipId: DEALERSHIP_A,
      filters: { models: ["tahoe"] },
    });
    expect(result.total).toBe(2);
    expect(result.vehicles[0]).not.toHaveProperty("total_matches");
    expect(calls.searches[0].params[0]).toBe(DEALERSHIP_A);
  });
});

describe("getInventoryFreshness", () => {
  it("reports fresh inventory when a sync just finished", async () => {
    const { db } = createDb();
    const freshness = await getInventoryFreshness(db, DEALERSHIP_A);
    expect(freshness.stale).toBe(false);
    expect(freshness.lastSyncedAt).toBeTruthy();
    expect(freshness.vehicleCount).toBe(12);
  });

  it("marks inventory stale once it is older than the source allows", async () => {
    const { db } = createDb({
      freshness: {
        last_sync_at: new Date(Date.now() - 40 * 3600000).toISOString(),
        stale_after_hours: 24,
      },
    });
    const freshness = await getInventoryFreshness(db, DEALERSHIP_A);
    expect(freshness.stale).toBe(true);
    expect(freshness.ageHours).toBeGreaterThan(24);
  });

  it("treats an empty inventory as stale", async () => {
    const { db } = createDb({
      freshness: {
        vehicle_count: 0,
        presentable_count: 0,
        last_sync_at: null,
        last_record_update: null,
        last_sync_status: null,
      },
    });
    const freshness = await getInventoryFreshness(db, DEALERSHIP_A);
    expect(freshness.stale).toBe(true);
    expect(freshness.lastSyncStatus).toBe("never");
  });
});

describe("summarizeVehicleForAi", () => {
  it("passes through real vehicle data and withholds internal columns", () => {
    const summary = summarizeVehicleForAi(NEW_TAHOE);
    expect(summary).toMatchObject({
      stockNumber: "12345",
      year: 2024,
      make: "Chevrolet",
      model: "Tahoe",
      trim: "LT",
      bodyStyle: "SUV",
      exteriorColor: "Black",
      mileage: 12,
      price: 66500,
      status: "available",
      presentable: true,
    });
    expect(summary).not.toHaveProperty("dealership_id");
    expect(summary).not.toHaveProperty("description");
    expect(summary.features.length).toBeLessThanOrEqual(12);
  });

  it("describes an unavailable vehicle as not presentable", () => {
    const summary = summarizeVehicleForAi(SOLD_TAHOE);
    expect(summary.presentable).toBe(false);
    expect(summary.availability).toBe("sold");
  });
});

describe("vehicleSnapshot", () => {
  it("captures the identifying vehicle data a lead must keep", () => {
    const snapshot = vehicleSnapshot(NEW_TAHOE);
    expect(snapshot).toMatchObject({
      inventoryId: NEW_TAHOE.id,
      stockNumber: "12345",
      vin: NEW_TAHOE.vin,
      year: 2024,
      make: "Chevrolet",
      model: "Tahoe",
    });
    expect(snapshot.capturedAt).toBeTruthy();
    expect(describeVehicle(NEW_TAHOE)).toBe("2024 Chevrolet Tahoe LT");
  });
});

describe("findAlternatives", () => {
  it("widens the search until it has real presentable options", async () => {
    const { db, calls } = createDb({
      search: ({ index }) => (index === 0 ? [] : [CPO_TAHOE, BLACK_X3]),
    });
    const alternatives = await findAlternatives(db, {
      dealershipId: DEALERSHIP_A,
      vehicle: SOLD_TAHOE,
      excludeIds: [SOLD_TAHOE.id],
      limit: 2,
    });
    expect(alternatives.map((item) => item.stock_number)).toEqual([
      "TST-2001",
      "TST-3002",
    ]);
    for (const call of calls.searches) {
      expect(call.params[0]).toBe(DEALERSHIP_A);
      expect(call.params[1]).toEqual(PRESENTABLE_STATUSES);
    }
  });

  it("never offers the vehicle it is replacing", async () => {
    const { db } = createDb({ search: () => [SOLD_TAHOE, CPO_TAHOE] });
    const alternatives = await findAlternatives(db, {
      dealershipId: DEALERSHIP_A,
      vehicle: SOLD_TAHOE,
      excludeIds: [SOLD_TAHOE.id],
      limit: 3,
    });
    expect(alternatives.map((item) => item.id)).not.toContain(SOLD_TAHOE.id);
  });
});

describe("buildAiInventoryContext", () => {
  it('answers "Do you have a Tahoe?" from real records only', async () => {
    const { db, calls } = createDb({
      facets: { total: 12, presentable: 9 },
      search: () => [NEW_TAHOE, CPO_TAHOE],
    });
    const context = await buildAiInventoryContext(db, {
      dealershipId: DEALERSHIP_A,
      message: "Do you have a Tahoe?",
    });

    expect(context.searched).toBe(true);
    expect(context.criteria.models).toContain("tahoe");
    expect(context.matches).toHaveLength(2);
    expect(context.matches.every((match) => match.presentable)).toBe(true);
    expect(context.noMatchesFound).toBe(false);
    expect(context.unavailableDiscussedVehicles).toEqual([]);
    // Retrieval, not a dump: only a handful of records were requested.
    expect(calls.searches[0].text).toContain("LIMIT 6");
    expect(calls.searches[0].params[1]).toEqual(PRESENTABLE_STATUSES);
  });

  it("filters a black SUV under $40,000 by body style, color, and price", async () => {
    const { db, calls } = createDb({ search: () => [BLACK_X3] });
    const context = await buildAiInventoryContext(db, {
      dealershipId: DEALERSHIP_A,
      message: "I'm looking for a black SUV under $40,000.",
    });
    expect(context.criteria).toMatchObject({
      bodyStyles: ["suv"],
      exteriorColors: ["black"],
      priceMax: 40000,
    });
    const [search] = calls.searches;
    expect(search.params).toContain("%suv%");
    expect(search.params).toContain("%black%");
    expect(search.params).toContain(40000);
    expect(context.matches[0].stockNumber).toBe("TST-3002");
  });

  it("checks the current record for a named year, make, and model", async () => {
    const { db } = createDb({ search: () => [BMW_X5] });
    const context = await buildAiInventoryContext(db, {
      dealershipId: DEALERSHIP_A,
      message: "Is the 2024 BMW X5 still available?",
    });
    expect(context.matches[0]).toMatchObject({
      year: 2024,
      make: "BMW",
      model: "X5",
      status: "available",
      presentable: true,
      price: 72900,
    });
  });

  it("retrieves the exact vehicle for a stock number", async () => {
    const { db, calls } = createDb({ search: () => [NEW_TAHOE] });
    const context = await buildAiInventoryContext(db, {
      dealershipId: DEALERSHIP_A,
      message: "Tell me about stock #12345.",
    });
    expect(context.criteria.stockNumber).toBe("12345");
    expect(calls.searches[0].params).toContainEqual(["12345"]);
    expect(context.matches[0].stockNumber).toBe("12345");
  });

  it("reports a sold vehicle as gone and supplies real alternatives", async () => {
    const { db } = createDb({
      // 1: presentable search finds nothing. 2: exact stock lookup finds the
      // sold car. 3+: alternative searches.
      search: ({ index }) =>
        index === 0 ? [] : index === 1 ? [SOLD_TAHOE] : [CPO_TAHOE],
    });
    const context = await buildAiInventoryContext(db, {
      dealershipId: DEALERSHIP_A,
      message: "Is stock TST-2002 still available?",
    });

    expect(context.matches).toEqual([]);
    expect(context.unavailableDiscussedVehicles).toHaveLength(1);
    expect(context.unavailableDiscussedVehicles[0]).toMatchObject({
      stockNumber: "TST-2002",
      status: "sold",
      presentable: false,
    });
    expect(context.alternatives[0].stockNumber).toBe("TST-2001");
    expect(context.alternatives.every((item) => item.presentable)).toBe(true);
  });

  it("flags a previously discussed vehicle that has since sold", async () => {
    const { db } = createDb({
      vehiclesById: [SOLD_TAHOE],
      search: ({ index }) => (index === 0 ? [CPO_TAHOE] : [BLACK_X3]),
    });
    const context = await buildAiInventoryContext(db, {
      dealershipId: DEALERSHIP_A,
      message: "Any update for me?",
      lead: { inventory_id: SOLD_TAHOE.id, vehicle_interest: "2021 Tahoe LS" },
      leadVehicles: [{ inventory_id: SOLD_TAHOE.id }],
    });
    expect(context.trackedVehicles[0].stockNumber).toBe("TST-2002");
    expect(context.unavailableDiscussedVehicles[0].status).toBe("sold");
    expect(context.alternatives.length).toBeGreaterThan(0);
  });

  it("reports no match instead of inventing a vehicle", async () => {
    const { db } = createDb({ search: () => [] });
    const context = await buildAiInventoryContext(db, {
      dealershipId: DEALERSHIP_A,
      message: "Do you have a Porsche 911?",
    });
    expect(context.noMatchesFound).toBe(true);
    expect(context.matches).toEqual([]);
    expect(context.unavailableDiscussedVehicles).toEqual([]);
  });

  it("skips inventory retrieval when the customer is not asking about a vehicle", async () => {
    const { db, calls } = createDb();
    const context = await buildAiInventoryContext(db, {
      dealershipId: DEALERSHIP_A,
      message: "What time do you close today?",
    });
    expect(context.searched).toBe(false);
    expect(calls.searches).toHaveLength(0);
  });

  it("falls back to the vehicle the conversation was already about", async () => {
    const { db, calls } = createDb({ search: () => [NEW_TAHOE] });
    const context = await buildAiInventoryContext(db, {
      dealershipId: DEALERSHIP_A,
      message: "Sounds good, what else can you tell me?",
      conversationText: "I was asking about the Tahoe earlier",
    });
    expect(context.searched).toBe(true);
    expect(calls.searches[0].params).toContain("%tahoe%");
  });

  it("scopes every retrieval query to the requesting dealership", async () => {
    const { db, calls } = createDb({ search: () => [NEW_TAHOE] });
    await buildAiInventoryContext(db, {
      dealershipId: DEALERSHIP_B,
      message: "Do you have a Tahoe under $70,000?",
      lead: { inventory_id: "some-vehicle" },
    });
    expect(calls.all.length).toBeGreaterThan(0);
    for (const call of calls.all) {
      expect(call.params[0]).toBe(DEALERSHIP_B);
      expect(call.params).not.toContain(DEALERSHIP_A);
      expect(call.text).toContain("dealership_id = $1");
    }
  });
});

describe("buildInventoryInstructions", () => {
  const context = async (options) => {
    const { db } = createDb(options.db ?? {});
    return buildAiInventoryContext(db, {
      dealershipId: DEALERSHIP_A,
      ...options.request,
    });
  };

  it("forbids inventing any vehicle detail", async () => {
    const instructions = buildInventoryInstructions(
      await context({
        db: { search: () => [NEW_TAHOE] },
        request: { message: "Do you have a Tahoe?" },
      }),
    );
    expect(instructions).toContain("INVENTORY RULES (ABSOLUTE)");
    expect(instructions).toMatch(/Never invent a vehicle, VIN, stock number/);
    expect(instructions).toContain("presentable=true");
  });

  it("tells TITAN to say so when nothing matches", async () => {
    const instructions = buildInventoryInstructions(
      await context({
        db: { search: () => [] },
        request: { message: "Do you have a Porsche 911?" },
      }),
    );
    expect(instructions).toContain("Nothing in current inventory matches");
  });

  it("tells TITAN to offer alternatives for a vehicle that is gone", async () => {
    const instructions = buildInventoryInstructions(
      await context({
        db: {
          search: ({ index }) =>
            index === 0 ? [] : index === 1 ? [SOLD_TAHOE] : [CPO_TAHOE],
        },
        request: { message: "Is stock TST-2002 still available?" },
      }),
    );
    expect(instructions).toContain("no longer available");
    expect(instructions).toContain("stock TST-2002");
    expect(instructions).toContain("offer the supplied alternatives");
  });

  it("refuses to claim availability when inventory is stale", async () => {
    const instructions = buildInventoryInstructions(
      await context({
        db: {
          freshness: {
            last_sync_at: new Date(Date.now() - 90 * 3600000).toISOString(),
          },
          search: () => [NEW_TAHOE],
        },
        request: { message: "Do you have a Tahoe?" },
      }),
    );
    expect(instructions).toContain(
      "Let me have the dealership confirm that vehicle's availability.",
    );
  });

  it("stops TITAN describing vehicles when no inventory is loaded", async () => {
    const instructions = buildInventoryInstructions(
      await context({
        db: {
          freshness: {
            vehicle_count: 0,
            last_sync_at: null,
            last_record_update: null,
          },
          search: () => [],
        },
        request: { message: "Do you have a Tahoe?" },
      }),
    );
    expect(instructions).toContain("no inventory loaded");
  });

  it("returns nothing when there is no inventory context at all", () => {
    expect(buildInventoryInstructions(null)).toBe("");
  });
});

describe("TEST_INVENTORY", () => {
  it("covers every acceptance example a dealership needs to verify", () => {
    const stockNumbers = TEST_INVENTORY.map((item) => item.stockNumber);
    expect(stockNumbers).toContain("12345");
    expect(new Set(stockNumbers).size).toBe(TEST_INVENTORY.length);

    const tahoes = TEST_INVENTORY.filter((item) => item.model === "Tahoe");
    expect(tahoes.length).toBeGreaterThanOrEqual(2);
    expect(
      tahoes.some((item) => PRESENTABLE_STATUSES.includes(item.status)),
    ).toBe(true);
    expect(tahoes.some((item) => item.status === "sold")).toBe(true);

    expect(
      TEST_INVENTORY.some(
        (item) =>
          item.year === 2024 && item.make === "BMW" && item.model === "X5",
      ),
    ).toBe(true);
    expect(
      TEST_INVENTORY.filter(
        (item) =>
          item.vehicleType === "SUV" &&
          /black/i.test(item.exteriorColor) &&
          (item.internetPrice ?? item.price) < 40000,
      ).length,
    ).toBeGreaterThanOrEqual(1);
    expect(TEST_INVENTORY.some((item) => item.status === "reserved")).toBe(
      true,
    );
    expect(TEST_INVENTORY.some((item) => item.status === "in_transit")).toBe(
      true,
    );
  });

  it("uses only statuses the database accepts", () => {
    for (const vehicle of TEST_INVENTORY) {
      expect(INVENTORY_STATUSES).toContain(vehicle.status);
      expect(vehicle.stockNumber).toBeTruthy();
      expect(vehicle.year).toBeGreaterThan(1990);
      expect(vehicle.make).toBeTruthy();
      expect(vehicle.model).toBeTruthy();
    }
  });
});
