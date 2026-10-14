// Follow-up sequence: Day 1 three texts (the first is Andy's instant reply),
// Day 2 two, Day 3 one, a thank-you, a one week pause, then weekly for up to
// eight weeks, then stop. Sends only inside the 9am-8pm dealership-local
// window. Stops on booking, inbound reply, opt-out, or the per-lead toggle.

import { localDatePlusDays, nextTextingWindow, zonedTimeToUtc } from "./timezone.mjs";

const HOUR = 3600000;

// dayOffset is the local calendar day relative to the day the lead arrived.
// Day-0 steps use a minimum gap after the previous text instead of a clock time.
export const SEQUENCE_STEPS = [
  { step: 1, dayOffset: 0, gapHours: 0, kind: "first_touch" },
  { step: 2, dayOffset: 0, gapHours: 2, kind: "day1_second" },
  { step: 3, dayOffset: 0, gapHours: 3, kind: "day1_third" },
  { step: 4, dayOffset: 1, time: "10:00", kind: "day2_morning" },
  { step: 5, dayOffset: 1, time: "16:00", kind: "day2_afternoon" },
  { step: 6, dayOffset: 2, time: "11:00", kind: "day3" },
  { step: 7, dayOffset: 3, time: "11:00", kind: "thank_you" },
  // One week pause after the thank-you, then weekly, eight times.
  ...Array.from({ length: 8 }, (_, index) => ({
    step: 8 + index,
    dayOffset: 10 + index * 7,
    time: "11:00",
    kind: "weekly",
    week: index + 1,
  })),
];

export const LAST_STEP = SEQUENCE_STEPS.at(-1).step;

/**
 * When the step after `completedStep` is due, or null when the sequence is
 * finished. `startedAt` is when the lead arrived; `lastSentAt` is the last
 * sequence text.
 */
export const nextSequenceAt = ({ completedStep, startedAt, lastSentAt, timezone }) => {
  const next = SEQUENCE_STEPS.find((entry) => entry.step === completedStep + 1);
  if (!next) return null;
  const previous = new Date(lastSentAt ?? startedAt).getTime();
  let candidate;
  if (next.time) {
    const date = localDatePlusDays(startedAt, next.dayOffset, timezone);
    candidate = zonedTimeToUtc(date, next.time, timezone).getTime();
    candidate = Math.max(candidate, previous + HOUR);
  } else {
    candidate = previous + next.gapHours * HOUR;
  }
  return nextTextingWindow(new Date(candidate), timezone);
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
