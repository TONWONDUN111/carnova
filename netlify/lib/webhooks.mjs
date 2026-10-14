// Helpers shared by the public webhook and feed endpoints.

import { getDb } from "./crm.mjs";

export const constantTimeEqual = (a, b) => {
  const left = String(a ?? "");
  const right = String(b ?? "");
  if (!left || left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return diff === 0;
};

/** Reads HTTP Basic credentials. Returns { username, password } or null. */
export const basicAuth = (request) => {
  const header = request.headers.get("authorization") || "";
  if (!header.toLowerCase().startsWith("basic ")) return null;
  try {
    const decoded = atob(header.slice(6).trim());
    const split = decoded.indexOf(":");
    return split < 0 ? null : { username: decoded.slice(0, split), password: decoded.slice(split + 1) };
  } catch {
    return null;
  }
};

/** Runs work after the response when the platform supports it. */
export const runAfterResponse = async (context, promise) => {
  const guarded = promise.catch((error) => console.error("Background work failed", error.message));
  if (typeof context?.waitUntil === "function") context.waitUntil(guarded);
  else await guarded;
};

export const dealershipByInboundToken = async (token) => {
  const clean = String(token ?? "").trim().toLowerCase();
  if (!/^[a-z0-9]{8,64}$/.test(clean)) return null;
  const [row] = await getDb().sql`
    SELECT * FROM carnova_dealerships WHERE inbound_token = ${clean} AND platform_status = 'active'
  `;
  return row ?? null;
};

export const markConnections = async (dealershipId, types, { ok, error = null }) => {
  await getDb().sql`
    UPDATE carnova_connections SET
      last_sync_at = CASE WHEN ${ok} THEN NOW() ELSE last_sync_at END,
      last_error = ${ok ? null : error},
      status = CASE WHEN ${ok} AND status IN ('error', 'pending') THEN 'active' ELSE status END,
      updated_at = NOW()
    WHERE dealership_id = ${dealershipId} AND type = ANY(${types}::text[]) AND status IN ('active', 'error', 'pending')
  `;
};
