// US ZIP code -> IANA timezone, from the 3-digit ZIP prefix. This is an
// approximation: a few prefixes straddle a timezone line, and those resolve to
// the zone most of the prefix sits in. Unknown ZIPs return null so callers
// fall back to the dealership's timezone.

// [first prefix, last prefix, timezone], checked in order.
const RANGES = [
  [6, 9, "America/Puerto_Rico"],
  [5, 5, "America/New_York"],
  [10, 323, "America/New_York"],
  [324, 325, "America/Chicago"],
  [326, 349, "America/New_York"],
  [350, 372, "America/Chicago"],
  [373, 374, "America/New_York"],
  [375, 375, "America/Chicago"],
  [376, 379, "America/New_York"],
  [380, 397, "America/Chicago"],
  [398, 418, "America/New_York"],
  [420, 427, "America/Chicago"],
  [430, 462, "America/New_York"],
  [463, 464, "America/Chicago"],
  [465, 475, "America/New_York"],
  [476, 477, "America/Chicago"],
  [478, 497, "America/New_York"],
  [498, 499, "America/Detroit"],
  [500, 575, "America/Chicago"],
  [576, 577, "America/Denver"],
  [580, 588, "America/Chicago"],
  [590, 599, "America/Denver"],
  [600, 689, "America/Chicago"],
  [690, 693, "America/Denver"],
  [700, 797, "America/Chicago"],
  [798, 799, "America/Denver"],
  [800, 834, "America/Denver"],
  [835, 838, "America/Los_Angeles"],
  [840, 847, "America/Denver"],
  [850, 865, "America/Phoenix"],
  [870, 885, "America/Denver"],
  [889, 961, "America/Los_Angeles"],
  [967, 968, "Pacific/Honolulu"],
  [969, 969, "Pacific/Guam"],
  [970, 994, "America/Los_Angeles"],
  [995, 999, "America/Anchorage"],
];

export const cleanPostalCode = (value) => {
  const match = String(value ?? "").trim().match(/^(\d{5})(?:-?\d{4})?$/);
  return match ? match[1] : null;
};

export const timezoneForZip = (value) => {
  const zip = cleanPostalCode(value);
  if (!zip) return null;
  const prefix = Number(zip.slice(0, 3));
  const range = RANGES.find(([first, last]) => prefix >= first && prefix <= last);
  return range ? range[2] : null;
};
