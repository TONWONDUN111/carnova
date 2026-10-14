// Inventory feed parsing for CSV and XML exports. Rows come back as plain
// objects keyed by the source's own headers; crm.mjs importInventory maps
// dealer-feed header variants (Stock #, Odometer, Ext Color, ...) onto columns.

export const SAMPLE_INVENTORY_CSV = `Stock,VIN,Year,Make,Model,Trim,Mileage,Price,Ext Color,New/Used
T1001,1HGCM82633A004352,2022,Toyota,Tacoma,TRD Off-Road,31000,34995,Silver,Used`;

/** RFC 4180-style CSV: quoted fields, escaped quotes, CRLF or LF. */
export const parseCsv = (text) => {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const input = String(text ?? "").replace(/^﻿/, "");
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => header.trim().replace(/#/g, "number"));
  return rows.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, column) => [header, (values[column] ?? "").trim()])),
  );
};

const decode = (value) =>
  String(value ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();

/** XML exports: one element per vehicle (<vehicle>, <item>, <car>, <unit>, <listing>) with child fields. */
export const parseInventoryXml = (text) => {
  const xml = String(text ?? "");
  const tag = ["vehicle", "item", "car", "unit", "listing"].find((name) => new RegExp(`<${name}[\\s>]`, "i").test(xml));
  if (!tag) return [];
  const records = [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi"))];
  return records.map((record) => {
    const fields = {};
    for (const match of record[1].matchAll(/<([a-z_][\w.-]*)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)) {
      const key = match[1];
      const value = /<[a-z]/i.test(match[2].replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, ""))
        ? [...match[2].matchAll(/<[^>]+>([^<]*)<\/[^>]+>/g)].map((inner) => decode(inner[1])).filter(Boolean)
        : decode(match[2]);
      if (fields[key] === undefined) fields[key] = value;
    }
    return fields;
  });
};

export const parseInventoryFeed = (body, contentType = "") => {
  const text = String(body ?? "").trim();
  if (!text) return { vehicles: [], errors: ["The feed was empty."] };
  const isXml = /xml/i.test(contentType) || text.startsWith("<");
  const vehicles = (isXml ? parseInventoryXml(text) : parseCsv(text)).filter((row) =>
    Object.values(row).some((value) => (Array.isArray(value) ? value.length : String(value).trim())),
  );
  return vehicles.length
    ? { vehicles, errors: [], format: isXml ? "xml" : "csv" }
    : { vehicles: [], errors: [isXml ? "No vehicle records found in the XML." : "The CSV needs a header row and at least one vehicle."] };
};
