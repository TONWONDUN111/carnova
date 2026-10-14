// Follow-up sequence (consented leads only): Day 1 three texts at 1 minute,
// 2 hours and 3 hours after the lead arrives, Day 2 two, Day 3 one, a
// thank-you, a one week pause, then one text a week until the lead books or
// opts out. Every delay is editable per dealership in Settings. Texts hold
// outside the lead-local window (9 PM - 8 AM by default) and stop on booking,
// customer reply, opt-out, escalation, or the per-lead toggle.

import { localDatePlusDays, zonedTimeToUtc } from "./timezone.mjs";
import { leadTimezone, nextOutboundWindow } from "./texting-window.mjs";

const MINUTE = 60000;
// Never let two automated texts land closer together than this.
const MIN_GAP_MINUTES = 60;

export const DEFAULT_SEQUENCE_SETTINGS = {
  text1_minutes: 1,
  text2_minutes: 120,
  text3_minutes: 180,
  day2_times: ["10:00", "16:00"],
  day3_time: "11:00",
  thank_you_time: "11:00",
  weekly_pause_days: 7,
  weekly_time: "11:00",
};

const time = (value, fallback) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value ?? "")) ? value : fallback);
const wholeMinutes = (value, fallback, max) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= max ? Math.round(number) : fallback;
};

export const sequenceSettings = (dealership) => {
  const saved = dealership?.settings?.sequence ?? {};
  const defaults = DEFAULT_SEQUENCE_SETTINGS;
  const day2 = Array.isArray(saved.day2_times) ? saved.day2_times : defaults.day2_times;
  return {
    text1_minutes: wholeMinutes(saved.text1_minutes, defaults.text1_minutes, 1440),
    text2_minutes: wholeMinutes(saved.text2_minutes, defaults.text2_minutes, 1440),
    text3_minutes: wholeMinutes(saved.text3_minutes, defaults.text3_minutes, 1440),
    day2_times: [time(day2[0], defaults.day2_times[0]), time(day2[1], defaults.day2_times[1])],
    day3_time: time(saved.day3_time, defaults.day3_time),
    thank_you_time: time(saved.thank_you_time, defaults.thank_you_time),
    weekly_pause_days: wholeMinutes(saved.weekly_pause_days, defaults.weekly_pause_days, 60),
    weekly_time: time(saved.weekly_time, defaults.weekly_time),
  };
};

// The fixed part of the sequence. Steps after the thank-you are weekly.
export const SEQUENCE_STEPS = [
  { step: 1, dayOffset: 0, kind: "first_touch" },
  { step: 2, dayOffset: 0, kind: "day1_second" },
  { step: 3, dayOffset: 0, kind: "day1_third" },
  { step: 4, dayOffset: 1, kind: "day2_morning" },
  { step: 5, dayOffset: 1, kind: "day2_afternoon" },
  { step: 6, dayOffset: 2, kind: "day3" },
  { step: 7, dayOffset: 3, kind: "thank_you" },
];
const THANK_YOU_STEP = 7;

// Weekly texts continue until booking or STOP; this only bounds the counter.
export const LAST_STEP = 1000;

export const sequenceEntry = (step) =>
  SEQUENCE_STEPS.find((entry) => entry.step === step) ??
  (step > THANK_YOU_STEP && step <= LAST_STEP ? { step, kind: "weekly", week: step - THANK_YOU_STEP } : null);

/** The ideal send time for a step before the texting window is applied. */
const scheduledAt = (entry, startedAt, timezone, settings) => {
  const start = new Date(startedAt).getTime();
  const local = (dayOffset, at) => zonedTimeToUtc(localDatePlusDays(startedAt, dayOffset, timezone), at, timezone).getTime();
  switch (entry.kind) {
    case "first_touch":
      return start + settings.text1_minutes * MINUTE;
    case "day1_second":
      return start + settings.text2_minutes * MINUTE;
    case "day1_third":
      return start + settings.text3_minutes * MINUTE;
    case "day2_morning":
      return local(1, settings.day2_times[0]);
    case "day2_afternoon":
      return local(1, settings.day2_times[1]);
    case "day3":
      return local(2, settings.day3_time);
    case "thank_you":
      return local(3, settings.thank_you_time);
    default:
      return local(3 + settings.weekly_pause_days + (entry.week - 1) * 7, settings.weekly_time);
  }
};

/** When the very first text is due for a lead that just arrived. */
export const firstTextAt = ({ startedAt, dealership }) =>
  new Date(new Date(startedAt).getTime() + sequenceSettings(dealership).text1_minutes * MINUTE);

/**
 * When the step after `completedStep` is due, or null when there is no next
 * step. `startedAt` is when the lead arrived; `lastSentAt` is the last
 * sequence text. The result is pushed into the lead-local texting window, so
 * a Day 1 text that falls after the cutoff goes out at opening time and the
 * next one an hour later.
 */
export const nextSequenceAt = ({ completedStep, startedAt, lastSentAt, lead = {}, dealership }) => {
  const entry = sequenceEntry(completedStep + 1);
  if (!entry) return null;
  const settings = sequenceSettings(dealership);
  const timezone = leadTimezone(lead, dealership);
  const previous = new Date(lastSentAt ?? startedAt).getTime();
  const candidate = Math.max(scheduledAt(entry, startedAt, timezone, settings), previous + MIN_GAP_MINUTES * MINUTE);
  return nextOutboundWindow(new Date(candidate), lead, dealership);
};

const vehicleLabel = (lead) =>
  lead.inventory_id && lead.vehicle_snapshot?.make
    ? [lead.vehicle_snapshot.year, lead.vehicle_snapshot.make, lead.vehicle_snapshot.model].filter(Boolean).join(" ")
    : null;

const firstName = (lead) => String(lead.name || "").trim().split(/\s+/)[0] || "there";

/**
 * Follow-up copy. It only names a vehicle when the lead is linked to a real
 * inventory record, so no vehicle fact is ever invented. The opt-out footer is
 * appended by the SMS layer.
 */
export const sequenceMessage = (entry, lead, dealership) => {
  const name = firstName(lead);
  const vehicle = vehicleLabel(lead);
  const car = vehicle ? `the ${vehicle}` : "the vehicle you asked about";
  switch (entry.kind) {
    case "day1_second":
      return `Hi ${name}, Andy at ${dealership.name} again. Want to come see ${car} today or tomorrow?`;
    case "day1_third":
      return `${name}, I can hold a time for you to check out ${car}. Morning or afternoon work better?`;
    case "day2_morning":
      return `Morning ${name}! Still thinking about ${car}? I have openings today. Want me to book one?`;
    case "day2_afternoon":
      return `Hi ${name}, quick check-in from ${dealership.name}. Would a quick visit this week help?`;
    case "day3":
      return `${name}, I don't want you to miss out on ${car}. What day works to stop by?`;
    case "thank_you":
      return `Thanks for considering ${dealership.name}, ${name}. If anything changes, just text me here.`;
    case "weekly":
      return `Hi ${name}, Andy at ${dealership.name}. Still shopping? New arrivals come in weekly. Want to set a time to visit?`;
    default:
      return `Hi ${name}, Andy at ${dealership.name}. When is a good time to come in?`;
  }
};
