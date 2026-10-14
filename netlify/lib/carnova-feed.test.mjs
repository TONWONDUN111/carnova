import { beforeEach, describe, expect, it } from "vitest";

import {
  CARNOVA_SOURCE_NAME,
  fetchCarnovaListings,
  isMappableListing,
  mapBodyStyle,
  mapCarnovaListing,
  mapCarnovaListings,
  mapCondition,
  mapDrivetrain,
  mapFeatures,
  mapFuelType,
  mapPhotos,
  mapStockNumber,
  resetCarnovaFeedCache,
  stripHtml,
} from "./carnova-feed.mjs";

/**
 * A published CarNova.com listing, shaped exactly like the live storefront
 * publishes them: coarse plus specific body style, comma-joined photo list,
 * option prose mixing plain feature names with "key: value" descriptors.
 */
const LISTING = {
  id: 699383,
  vin: "1gcuyged5mz100577",
  stock: "100577",
  year: 2021,
  make: "Chevrolet",
  model: "Silverado 1500",
  trim: "4WD Crew Cab Short Bed LTZ",
  is_new: "Used",
  body_style: "Truck",
  body_type: "Pickup",
  factory_certified: "0",
  dealer_certified: "0",
  list_price: 23999,
  special_price: null,
  mileage: 169104,
  fuel_type: "gas",
  exteriorcolor: "Gray",
  interiorcolor: "Tan",
  doorcount: "4",
  drivetrain: "4wd",
  transmission: "8-speed automatic",
  engine_description: "EcoTec3 5.3L 8cyl 355hp",
  engine_displacement: "5.3",
  cylinders: "8",
  optiondescription:
    "Remote Start,Bluetooth,Seating capacity: 5,Free maintenance: oil, fuel, washer fluid and brake fluid",
  photourl:
    "https://cdn.example.com/a.jpg?h=800,https://cdn.example.com/b.jpg?h=800,https://cdn.example.com/a.jpg?h=800",
  extrafield1: "CLEAN CARFAX - FULLY LOADED - NAVIGATION",
  dealercomments: "Welcome To CarNova!<br>Call us at (720) 828-8889.",
  citympg: 16,
  hwympg: 22,
  instockdate: "2026-08-01",
  created_at: "2026-09-01T10:08:02+00:00",
  website_url: "https://www.CarNova.com/viewInventory/1155272/",
};

/** Minimal fetch double returning queued responses in order. */
const fakeFetch = (responses) => {
  const calls = [];
  const queue = [...responses];
  const impl = async (url, options) => {
    calls.push({ url: String(url), options });
    const next = queue.shift();
    if (!next) throw new Error(`Unexpected request: ${url}`);
    return {
      ok: next.ok !== false,
      status: next.status ?? 200,
      text: async () => next.body ?? "",
      json: async () => next.json ?? [],
    };
  };
  impl.calls = calls;
  return impl;
};

describe("mapCarnovaListing", () => {
  it("maps the identifying and descriptive fields of a published listing", () => {
    const vehicle = mapCarnovaListing(LISTING);
    expect(vehicle).toMatchObject({
      stockNumber: "100577",
      // VIN is normalized so matching is case insensitive.
      vin: "1GCUYGED5MZ100577",
      year: 2021,
      make: "Chevrolet",
      model: "Silverado 1500",
      trim: "4WD Crew Cab Short Bed LTZ",
      mileage: 169104,
      price: 23999,
      internetPrice: 23999,
      condition: "used",
      exteriorColor: "Gray",
      interiorColor: "Tan",
      fuelType: "Gasoline",
      drivetrain: "4WD",
      transmission: "8-speed automatic",
      engine: "EcoTec3 5.3L 8cyl 355hp",
      doors: 4,
    });
  });

  it("never returns the fields NOVACARAI owns", () => {
    const vehicle = mapCarnovaListing(LISTING);
    // Availability, MSRP and lot location are dealership facts. A sync that
    // carried them would overwrite the dealership's own record.
    expect(vehicle).not.toHaveProperty("status");
    expect(vehicle).not.toHaveProperty("msrp");
    expect(vehicle).not.toHaveProperty("location");
    expect(vehicle).not.toHaveProperty("statusReason");
  });

  it("prefers the advertised special price when the listing publishes one", () => {
    expect(
      mapCarnovaListing({ ...LISTING, special_price: 21999 }).internetPrice,
    ).toBe(21999);
  });

  it("records the published in-stock date", () => {
    expect(mapCarnovaListing(LISTING).dateAdded).toBe(
      "2026-08-01T00:00:00.000Z",
    );
  });

  it("treats a zero door count as unknown rather than zero doors", () => {
    expect(mapCarnovaListing({ ...LISTING, doorcount: "0" }).doors).toBeNull();
  });
});

describe("mapPhotos", () => {
  it("splits the published photo list and drops duplicates", () => {
    expect(mapPhotos(LISTING)).toEqual([
      "https://cdn.example.com/a.jpg?h=800",
      "https://cdn.example.com/b.jpg?h=800",
    ]);
  });

  it("ignores values that are not URLs", () => {
    expect(
      mapPhotos({ photourl: "not-a-url,https://cdn.example.com/c.jpg" }),
    ).toEqual(["https://cdn.example.com/c.jpg"]);
  });

  it("returns an empty list when the listing has no photos", () => {
    expect(mapPhotos({ photourl: null })).toEqual([]);
  });
});

describe("mapCondition", () => {
  it("reads new and used from the published listing", () => {
    expect(mapCondition({ is_new: "Used" })).toBe("used");
    expect(mapCondition({ is_new: "New" })).toBe("new");
  });

  it("treats either certification flag as certified", () => {
    expect(mapCondition({ is_new: "Used", factory_certified: "1" })).toBe(
      "certified",
    );
    expect(mapCondition({ is_new: "Used", dealer_certified: "1" })).toBe(
      "certified",
    );
  });

  it("falls back to used when the listing says nothing", () => {
    expect(mapCondition({})).toBe("used");
  });
});

describe("mapBodyStyle", () => {
  it("prefers the specific body type so body-style search works", () => {
    // "Car" cannot be searched for; "Sedan" can.
    expect(mapBodyStyle({ body_style: "Car", body_type: "Sedan" })).toBe(
      "Sedan",
    );
  });

  it("falls back to the category when the body type is not a body style", () => {
    expect(
      mapBodyStyle({ body_style: "Motorcycle", body_type: "Standard" }),
    ).toBe("Motorcycle");
  });
});

describe("mapFuelType and mapDrivetrain", () => {
  it("gives published codes readable labels", () => {
    expect(mapFuelType("gas")).toBe("Gasoline");
    expect(mapFuelType("flex_fuel")).toBe("Flex Fuel");
    expect(mapFuelType("electric")).toBe("Electric");
    expect(mapDrivetrain("awd")).toBe("AWD");
    expect(mapDrivetrain("4wd")).toBe("4WD");
  });

  it("returns null when the listing does not publish the value", () => {
    expect(mapFuelType(null)).toBeNull();
    expect(mapDrivetrain("")).toBeNull();
  });
});

describe("mapFeatures", () => {
  it("keeps the dealer's highlights and the plain option names", () => {
    const features = mapFeatures(LISTING);
    expect(features).toContain("Clean Carfax");
    expect(features).toContain("Navigation");
    expect(features).toContain("Bluetooth");
    // Options that match a canonical feature are stored under the canonical
    // label ("Remote Start" -> "Remote start") so the feature filter and its
    // facet list stay consistent across listings.
    expect(features).toContain("Remote start");
  });

  it("derives drivetrain features from the published drivetrain", () => {
    expect(mapFeatures(LISTING)).toContain("4WD");
    expect(mapFeatures({ ...LISTING, drivetrain: "awd" })).toContain("AWD");
  });

  it("drops descriptor pairs and the sentence fragments they leave behind", () => {
    const features = mapFeatures(LISTING);
    expect(features).not.toContain("Seating capacity: 5");
    // "Free maintenance: oil, fuel, washer fluid and brake fluid" splits on its
    // own commas; the fragments are not features.
    expect(features).not.toContain("fuel");
    expect(features).not.toContain("washer fluid and brake fluid");
  });

  it("does not claim equipment that only appears in specification metadata", () => {
    // A regression guard: an AWD crossover whose window and drivetrain specs
    // mention "third-row" and "4wd" has neither a third row nor four-wheel
    // drive, and inventory must not tell a customer otherwise.
    const features = mapFeatures({
      drivetrain: "awd",
      extrafield1: "ONE OWNER - CLEAN CARFAX",
      optiondescription:
        "third-row windows: fixed third-row windows,4wd type: full-time awd,drive type: 4matic all-wheel drive",
      largedescription:
        "2021 Mercedes-Benz GLA 250 third-row windows 4wd type full-time awd",
    });
    expect(features).not.toContain("Third row");
    expect(features).not.toContain("4WD");
    expect(features).toContain("AWD");
    expect(features).toContain("Clean Carfax");
  });

  it("caps the list so one verbose listing cannot dominate", () => {
    const options = Array.from(
      { length: 400 },
      (_, index) => `Option ${index}`,
    );
    expect(
      mapFeatures({ optiondescription: options.join(",") }).length,
    ).toBeLessThanOrEqual(100);
  });
});

describe("stripHtml", () => {
  it("turns published dealer comments into plain text", () => {
    expect(stripHtml("Welcome!<br>Call <b>today</b> &amp; save")).toBe(
      "Welcome!\nCall today & save",
    );
  });
});

describe("mapStockNumber", () => {
  it("uses the published stock number", () => {
    expect(mapStockNumber(LISTING)).toBe("100577");
  });

  it("falls back to the VIN tail when no stock number is published", () => {
    expect(mapStockNumber({ vin: "1GCUYGED5MZ100577" })).toBe("MZ100577");
  });

  it("falls back to the listing id when there is neither", () => {
    expect(mapStockNumber({ vehicleid: "1155272" })).toBe("CN-1155272");
  });

  it("returns nothing when the listing cannot be identified at all", () => {
    expect(mapStockNumber({})).toBe("");
  });
});

describe("mapCarnovaListings", () => {
  it("maps every usable listing", () => {
    const { vehicles, skipped } = mapCarnovaListings([
      LISTING,
      { ...LISTING, vin: "2T3W1RFV8MW123456", stock: "123456" },
    ]);
    expect(vehicles).toHaveLength(2);
    expect(skipped).toHaveLength(0);
  });

  it("collapses a vehicle published twice, keeping the richer listing", () => {
    const sparse = { ...LISTING, photourl: "https://cdn.example.com/a.jpg" };
    const { vehicles } = mapCarnovaListings([sparse, LISTING]);
    // Same VIN, so one vehicle — and the one with more photos wins.
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].images).toHaveLength(2);
  });

  it("matches on stock number when a listing has no VIN", () => {
    const noVin = { ...LISTING, vin: null };
    const { vehicles } = mapCarnovaListings([noVin, { ...noVin }]);
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].vin).toBeNull();
  });

  it("treats a VIN change as a different vehicle", () => {
    const { vehicles } = mapCarnovaListings([
      LISTING,
      { ...LISTING, vin: "3FA6P0H73HR123456" },
    ]);
    expect(vehicles).toHaveLength(2);
  });

  it("skips listings that cannot be identified instead of failing the run", () => {
    const { vehicles, skipped } = mapCarnovaListings([
      LISTING,
      { make: "Ford", model: "Explorer" },
    ]);
    expect(vehicles).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].reason).toMatch(/missing the stock number/i);
  });

  it("handles a feed that returns nothing", () => {
    expect(mapCarnovaListings(null).vehicles).toEqual([]);
    expect(mapCarnovaListings([]).vehicles).toEqual([]);
  });
});

describe("isMappableListing", () => {
  it("requires an identity and the vehicle basics", () => {
    expect(isMappableListing(mapCarnovaListing(LISTING))).toBe(true);
    expect(
      isMappableListing(mapCarnovaListing({ ...LISTING, year: null })),
    ).toBe(false);
    expect(isMappableListing(mapCarnovaListing({ ...LISTING, make: "" }))).toBe(
      false,
    );
  });
});

describe("fetchCarnovaListings", () => {
  beforeEach(() => {
    resetCarnovaFeedCache();
  });

  const STOREFRONT =
    '<html><body><script src="/assets/index-abc.js"></script></body></html>';
  const BUNDLE =
    'const u="https://project.supabase.co";const k="eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.signature";';

  it("reads the published listings from the endpoint the storefront uses", async () => {
    const impl = fakeFetch([
      { body: STOREFRONT },
      { body: BUNDLE },
      { json: [LISTING] },
    ]);
    const listings = await fetchCarnovaListings({ fetchImpl: impl });
    expect(listings).toHaveLength(1);
    expect(impl.calls[2].url).toContain(
      "https://project.supabase.co/rest/v1/vehicles",
    );
    expect(impl.calls[2].options.headers.apikey).toBeTruthy();
  });

  it("fails loudly when the storefront cannot be read", async () => {
    await expect(
      fetchCarnovaListings({
        fetchImpl: fakeFetch([{ ok: false, status: 503 }]),
      }),
    ).rejects.toThrow(/503/);
  });

  it("fails loudly when the listing endpoint cannot be found", async () => {
    await expect(
      fetchCarnovaListings({
        fetchImpl: fakeFetch([
          { body: "<html><body>no bundle here</body></html>" },
        ]),
      }),
    ).rejects.toThrow(/storefront bundle/i);
  });

  it("reports a failing listing request rather than returning nothing", async () => {
    await expect(
      fetchCarnovaListings({
        fetchImpl: fakeFetch([
          { body: STOREFRONT },
          { body: BUNDLE },
          { ok: false, status: 500 },
        ]),
      }),
    ).rejects.toThrow(/status 500/);
  });
});

describe("feed identity", () => {
  it("names one stable source record per dealership", () => {
    expect(CARNOVA_SOURCE_NAME).toBe("CarNova.com published inventory");
  });
});
