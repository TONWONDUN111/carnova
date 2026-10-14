import { describe, expect, it } from "vitest";
import { parseAdf, SAMPLE_ADF } from "./adf.mjs";
import {
  isTextingWindow,
  isWithinBusinessHours,
  nextTextingWindow,
  zonedParts,
  zonedTimeToUtc,
} from "./timezone.mjs";
import { LAST_STEP, nextSequenceAt, SEQUENCE_STEPS, sequenceMessage } from "./sequence.mjs";
import {
  computeTwilioSignature,
  isOptOutMessage,
  normalizePhone,
  OPT_OUT_FOOTER,
  validateTwilioRequest,
  withOptOutFooter,
} from "./sms.mjs";
import { businessHoursError } from "./appointments.mjs";
import { parseAndyOutput } from "./andy.mjs";
import { detectEscalation } from "../functions/chat.mjs";
import { dueReminder } from "../functions/messaging-scheduler.mjs";
import { inboundTokenFrom } from "../functions/inbound-email.mjs";
import { AVAILABILITY, connectorCatalog, testConnection } from "./connectors/index.mjs";
import { parseInventoryFeed, SAMPLE_INVENTORY_CSV } from "./connectors/feed-parse.mjs";
import { normalizeBusinessHours } from "./crm-routes.mjs";

const TZ = "America/Chicago";
const WEEKDAY_HOURS = { 1: ["09:00", "18:00"], 2: ["09:00", "18:00"], 3: ["09:00", "18:00"], 4: ["09:00", "18:00"], 5: ["09:00", "18:00"], 6: ["10:00", "16:00"] };
const dealership = { id: "d1", name: "Ridgeway Motors", timezone: TZ, settings: { business_hours: WEEKDAY_HOURS } };
const at = (date, time) => zonedTimeToUtc(date, time, TZ);

describe("ADF parsing", () => {
  it("parses the sample prospect", () => {
    const { leads, errors } = parseAdf(SAMPLE_ADF);
    expect(errors).toEqual([]);
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({
      name: "Test Lead",
      email: "test.lead@example.com",
      phone: "5555550100",
      vehicleInterest: "2022 Toyota Tacoma TRD Off-Road",
    });
  });

  it("finds HTML-escaped ADF in an email body and rejects empty prospects", () => {
    const escaped = SAMPLE_ADF.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    expect(parseAdf(`<p>${escaped}</p>`).leads).toHaveLength(1);
    expect(parseAdf("<adf><prospect><customer></customer></prospect></adf>").errors[0]).toMatch(/no customer/);
    expect(parseAdf("hello").errors[0]).toMatch(/No ADF/);
  });
});

describe("dealership timezone rules", () => {
  it("converts local wall time to UTC across DST", () => {
    expect(at("2026-07-15", "09:00").toISOString()).toBe("2026-07-15T14:00:00.000Z");
    expect(at("2026-12-15", "09:00").toISOString()).toBe("2026-12-15T15:00:00.000Z");
    expect(zonedParts(at("2026-07-15", "09:00"), TZ).hour).toBe(9);
  });

  it("only allows appointments inside business hours", () => {
    // 2026-09-28 is a Monday, 2026-09-27 a Sunday (closed).
    const ok = at("2026-09-28", "10:00");
    expect(isWithinBusinessHours(dealership, ok, new Date(ok.getTime() + 30 * 60000))).toBe(true);
    const late = at("2026-09-28", "17:45");
    expect(businessHoursError(dealership, late, new Date(late.getTime() + 30 * 60000))).toMatch(/business hours/);
    const sunday = at("2026-09-27", "12:00");
    expect(isWithinBusinessHours(dealership, sunday, new Date(sunday.getTime() + 30 * 60000))).toBe(false);
  });

  it("keeps customer texts inside 9am-8pm local", () => {
    expect(isTextingWindow(at("2026-09-28", "08:59"), TZ)).toBe(false);
    expect(isTextingWindow(at("2026-09-28", "09:00"), TZ)).toBe(true);
    expect(isTextingWindow(at("2026-09-28", "20:00"), TZ)).toBe(false);
    expect(nextTextingWindow(at("2026-09-28", "21:30"), TZ).toISOString()).toBe(at("2026-09-29", "09:00").toISOString());
    expect(nextTextingWindow(at("2026-09-28", "06:00"), TZ).toISOString()).toBe(at("2026-09-28", "09:00").toISOString());
  });
});

describe("follow-up sequence", () => {
  it("has 3 day-one texts, 2 on day two, 1 on day three, a thank-you and 8 weekly texts", () => {
    expect(SEQUENCE_STEPS.filter((s) => s.dayOffset === 0)).toHaveLength(3);
    expect(SEQUENCE_STEPS.filter((s) => s.dayOffset === 1)).toHaveLength(2);
    expect(SEQUENCE_STEPS.filter((s) => s.dayOffset === 2)).toHaveLength(1);
    expect(SEQUENCE_STEPS.filter((s) => s.kind === "weekly")).toHaveLength(8);
    expect(LAST_STEP).toBe(15);
  });

  it("schedules every step inside the texting window and stops after the last", () => {
    const startedAt = at("2026-09-28", "19:30");
    let lastSentAt = startedAt;
    for (let step = 1; step < LAST_STEP; step += 1) {
      const next = nextSequenceAt({ completedStep: step, startedAt, lastSentAt, timezone: TZ });
      expect(isTextingWindow(next, TZ)).toBe(true);
      expect(next.getTime()).toBeGreaterThan(lastSentAt.getTime());
      lastSentAt = next;
    }
    expect(nextSequenceAt({ completedStep: LAST_STEP, startedAt, lastSentAt, timezone: TZ })).toBeNull();
  });

  it("names a vehicle only when the lead is linked to inventory", () => {
    const step = SEQUENCE_STEPS[1];
    expect(sequenceMessage(step, { name: "Nia Harper" }, dealership)).toContain("the vehicle you asked about");
    expect(
      sequenceMessage(step, { name: "Nia", inventory_id: "v1", vehicle_snapshot: { year: 2022, make: "Toyota", model: "Tacoma" } }, dealership),
    ).toContain("2022 Toyota Tacoma");
  });
});

describe("SMS helpers", () => {
  it("normalizes US numbers to E.164", () => {
    expect(normalizePhone("(704) 555-0184")).toBe("+17045550184");
    expect(normalizePhone("1-704-555-0184")).toBe("+17045550184");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("555")).toBeNull();
  });

  it("detects STOP keywords and appends the opt-out footer once", () => {
    expect(isOptOutMessage(" stop ")).toBe(true);
    expect(isOptOutMessage("Unsubscribe.")).toBe(true);
    expect(isOptOutMessage("don't stop texting me")).toBe(false);
    expect(withOptOutFooter("See you soon!")).toBe(`See you soon! ${OPT_OUT_FOOTER}`);
    expect(withOptOutFooter(`Hi ${OPT_OUT_FOOTER}`)).toBe(`Hi ${OPT_OUT_FOOTER}`);
  });

  it("validates Twilio signatures", async () => {
    const previous = process.env.TWILIO_AUTH_TOKEN;
    process.env.TWILIO_AUTH_TOKEN = "unit-test-token";
    try {
      const url = "https://example.netlify.app/api/twilio-sms";
      const params = { From: "+17045550184", Body: "Hi" };
      const signature = await computeTwilioSignature("unit-test-token", url, params);
      expect(await validateTwilioRequest(url, params, signature)).toBe(true);
      expect(await validateTwilioRequest(url, { ...params, Body: "x" }, signature)).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.TWILIO_AUTH_TOKEN;
      else process.env.TWILIO_AUTH_TOKEN = previous;
    }
  });
});

describe("Andy", () => {
  it("parses JSON output and falls back to plain text", () => {
    expect(parseAndyOutput('{"reply":"Would 10am work?","book_slot":"2026-09-28T15:00:00.000Z","needs_team_check":false}')).toEqual({
      reply: "Would 10am work?",
      bookSlot: "2026-09-28T15:00:00.000Z",
      needsTeamCheck: false,
    });
    expect(parseAndyOutput("Sure, come by today?")).toMatchObject({ reply: "Sure, come by today?", bookSlot: null });
    expect(parseAndyOutput("")).toBeNull();
  });

  it("escalates on manager, human, legal and ready-to-buy keywords", () => {
    expect(detectEscalation("Can I talk to your manager")?.type).toBe("manager");
    expect(detectEscalation("I want a real person")?.type).toBe("human");
    expect(detectEscalation("my lawyer will call")?.type).toBe("legal");
    expect(detectEscalation("I'm ready to buy")?.type).toBe("ready_to_buy");
    expect(detectEscalation("Is the Tacoma still there?")).toBeNull();
  });
});

describe("appointment reminders", () => {
  const appointment = (startsAt, extra = {}) => ({
    starts_at: startsAt.toISOString(),
    created_at: at("2026-09-20", "10:00").toISOString(),
    status: "scheduled",
    ...extra,
  });
  const start = at("2026-09-29", "14:00");

  it("sends day-before, morning-of, no-show and post-visit at the right times", () => {
    expect(dueReminder(appointment(start), TZ, at("2026-09-28", "11:00"))).toBe("day_before");
    expect(dueReminder(appointment(start, { reminder_day_before_sent_at: "x" }), TZ, at("2026-09-29", "09:15"))).toBe("morning_of");
    expect(dueReminder(appointment(start, { reminder_day_before_sent_at: "x", reminder_morning_sent_at: "x" }), TZ, at("2026-09-29", "14:31"))).toBe("no_show");
    expect(dueReminder(appointment(start, { status: "showed" }), TZ, at("2026-09-29", "16:30"))).toBe("post_visit");
  });

  it("never texts outside the window", () => {
    expect(dueReminder(appointment(start), TZ, at("2026-09-28", "21:00"))).toBeNull();
  });
});

describe("inbound email routing", () => {
  it("reads the dealership token from MailboxHash or plus-addressing", () => {
    expect(inboundTokenFrom({ MailboxHash: "abc123def" })).toBe("abc123def");
    expect(inboundTokenFrom({ ToFull: [{ Email: "leads+abcdef1234@inbound.example.com" }] })).toBe("abcdef1234");
    expect(inboundTokenFrom({ To: "leads@inbound.example.com" })).toBeNull();
  });
});

describe("connectors", () => {
  it("offers the four systems with lead types first and honest availability", () => {
    const catalog = connectorCatalog();
    expect(catalog.map((entry) => entry.system)).toEqual(["dealr_cloud", "vauto_provision", "promax", "manual"]);
    for (const system of catalog) {
      const order = system.types.map((type) => ({ lead: 0, inventory: 1, api: 2 })[type.category]);
      expect(order).toEqual([...order].sort());
      for (const type of system.types) {
        expect(Object.values(AVAILABILITY)).toContain(type.availability);
        expect(type.explanation).toBeTruthy();
        if (type.type === "direct_api") expect(type.availability).not.toBe(AVAILABILITY.AVAILABLE);
      }
    }
  });

  it("never reports a direct API connection as working", async () => {
    const result = await testConnection({ connection: { system: "promax", type: "direct_api" }, dealership });
    expect(result.ok).toBe(false);
  });

  it("parses inventory CSV feeds", () => {
    const { vehicles, format } = parseInventoryFeed(SAMPLE_INVENTORY_CSV, "text/csv");
    expect(format).toBe("csv");
    expect(vehicles[0]).toMatchObject({ VIN: "1HGCM82633A004352", Make: "Toyota" });
    expect(parseInventoryFeed("", "text/csv").errors).toHaveLength(1);
  });
});

describe("business hours input", () => {
  it("accepts HH:MM ranges and rejects bad ones", () => {
    expect(normalizeBusinessHours({ 1: ["09:00", "18:00"], 0: null })).toEqual({ 1: ["09:00", "18:00"] });
    expect(normalizeBusinessHours({ 1: ["18:00", "09:00"] })).toBeNull();
    expect(normalizeBusinessHours({ 1: ["9am", "6pm"] })).toBeNull();
    expect(normalizeBusinessHours("nope")).toBeNull();
  });
});
