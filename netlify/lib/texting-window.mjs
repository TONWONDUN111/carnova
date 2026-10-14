// Outbound texting window for automated customer texts, evaluated in the
// lead's local time (ZIP code timezone, else the dealership's timezone).
//
// Closed from the dealership's cutoff (default 9 PM) until the opening time
// (default 8 AM). The window reopens at the opening time or the dealership's
// business-hours opening for that day, whichever is later. Customer-initiated
// replies are not held by this window; only outbound automated texts are.

import { businessHoursFor, localDatePlusDays, safeTimezone, zonedParts, zonedTimeToUtc } from "./timezone.mjs";
import { timezoneForZip } from "./zip-timezone.mjs";

export const DEFAULT_CUTOFF = "21:00";
export const DEFAULT_OPEN = "08:00";

const validTime = (value, fallback) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value ?? "")) ? value : fallback);
const minutes = (time) => {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
};

export const afterHoursSettings = (dealership) => {
  const settings = dealership?.settings?.after_hours ?? {};
  return {
    cutoff: validTime(settings.cutoff, DEFAULT_CUTOFF),
    open: validTime(settings.open, DEFAULT_OPEN),
  };
};

export const leadTimezone = (lead, dealership) =>
  safeTimezone(lead?.lead_timezone || timezoneForZip(lead?.postal_code) || dealership?.timezone);

/** When automated texts may start on a lead-local calendar date. */
const openingOn = (localDate, timezone, dealership) => {
  const { open } = afterHoursSettings(dealership);
  const base = zonedTimeToUtc(localDate, open, timezone);
  if (!dealership?.timezone) return base;
  const dealerDay = zonedParts(base, dealership.timezone);
  const hours = businessHoursFor(dealership.settings, dealerDay.weekday);
  if (!hours) return base;
  const dealerOpen = zonedTimeToUtc(dealerDay.date, hours[0], dealership.timezone);
  return dealerOpen && dealerOpen > base ? dealerOpen : base;
};

/** True when an automated text may go out to this lead at `date`. */
export const isOutboundAllowed = (date, lead, dealership) => {
  const timezone = leadTimezone(lead, dealership);
  const local = zonedParts(date, timezone);
  if (local.minutesOfDay >= minutes(afterHoursSettings(dealership).cutoff)) return false;
  return new Date(date) >= openingOn(local.date, timezone, dealership);
};

/** True when the sales department is closed for this lead right now. */
export const isAfterHours = (date, lead, dealership) => !isOutboundAllowed(date, lead, dealership);

/** The earliest instant at or after `date` when an automated text may go out. */
export const nextOutboundWindow = (date, lead, dealership) => {
  const instant = new Date(date);
  if (isOutboundAllowed(instant, lead, dealership)) return instant;
  const timezone = leadTimezone(lead, dealership);
  const local = zonedParts(instant, timezone);
  const pastCutoff = local.minutesOfDay >= minutes(afterHoursSettings(dealership).cutoff);
  const date_ = pastCutoff ? localDatePlusDays(instant, 1, timezone) : local.date;
  return openingOn(date_, timezone, dealership);
};

export const afterHoursMessage = (dealership) =>
  `Thanks for reaching out to ${dealership.name}! Our sales department is closed right now, but someone will get back to you first thing.`;
