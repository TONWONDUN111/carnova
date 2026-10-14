// Dealership-local time helpers. Every business rule (business hours, the
// 9am-8pm texting window, "morning of" reminders) is evaluated in the
// dealership's IANA timezone, never the browser's or the server's.

const DEFAULT_TIMEZONE = "America/New_York";

export const safeTimezone = (timezone) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
};

/** Wall-clock parts of an instant in a timezone. */
export const zonedParts = (date, timezone) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: safeTimezone(timezone),
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
    })
      .formatToParts(new Date(date))
      .map((part) => [part.type, part.value]),
  );
  const weekdays = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: weekdays[parts.weekday],
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutesOfDay: Number(parts.hour) * 60 + Number(parts.minute),
  };
};

/** Minutes the timezone is ahead of UTC at a given instant. */
export const timezoneOffsetMinutes = (date, timezone) => {
  const instant = new Date(date);
  const parts = zonedParts(instant, timezone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
};

/** Converts a local "YYYY-MM-DD" + "HH:MM" in a timezone to a UTC Date. */
export const zonedTimeToUtc = (date, time, timezone) => {
  const [year, month, day] = String(date).split("-").map(Number);
  const [hour, minute] = String(time).split(":").map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  // Two passes settle correctly across DST transitions.
  let result = guess - timezoneOffsetMinutes(guess, timezone) * 60000;
  result = guess - timezoneOffsetMinutes(result, timezone) * 60000;
  return new Date(result);
};

const toMinutes = (time) => {
  const [hour, minute] = String(time).split(":").map(Number);
  return Number.isFinite(hour) && Number.isFinite(minute)
    ? hour * 60 + minute
    : null;
};

/** Business hours ["09:00","18:00"] for the local weekday, or null if closed. */
export const businessHoursFor = (settings, weekday) => {
  const hours =
    settings?.business_hours?.[String(weekday)] ??
    settings?.business_hours?.[weekday];
  return Array.isArray(hours) && hours.length === 2 ? hours : null;
};

/** True when [startsAt, endsAt) falls entirely inside that day's hours. */
export const isWithinBusinessHours = (dealership, startsAt, endsAt) => {
  const timezone = dealership?.timezone;
  const start = zonedParts(startsAt, timezone);
  const end = zonedParts(new Date(new Date(endsAt).getTime() - 1), timezone);
  if (start.date !== end.date) return false;
  const hours = businessHoursFor(dealership?.settings, start.weekday);
  if (!hours) return false;
  const open = toMinutes(hours[0]);
  const close = toMinutes(hours[1]);
  if (open === null || close === null) return false;
  return start.minutesOfDay >= open && end.minutesOfDay + 1 <= close;
};

export const QUIET_START_HOUR = 20; // 8pm local: no customer texts after this
export const QUIET_END_HOUR = 9; // 9am local: no customer texts before this

/** Customer texts may only go out between 9am and 8pm dealership time. */
export const isTextingWindow = (date, timezone) => {
  const { hour } = zonedParts(date, timezone);
  return hour >= QUIET_END_HOUR && hour < QUIET_START_HOUR;
};

/** The earliest instant at or after `date` inside the texting window. */
export const nextTextingWindow = (date, timezone) => {
  const instant = new Date(date);
  if (isTextingWindow(instant, timezone)) return instant;
  const parts = zonedParts(instant, timezone);
  const targetDate =
    parts.hour >= QUIET_START_HOUR
      ? zonedParts(instant.getTime() + 12 * 3600000, timezone).date
      : parts.date;
  return zonedTimeToUtc(targetDate, "09:00", timezone);
};

/** Local calendar date "YYYY-MM-DD" `days` after the instant. */
export const localDatePlusDays = (date, days, timezone) =>
  zonedParts(new Date(date).getTime() + days * 86400000, timezone).date;

export const formatLocal = (date, timezone, options = {}) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimezone(timezone),
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...options,
  }).format(new Date(date));
