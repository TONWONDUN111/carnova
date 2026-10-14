// Inventory feed endpoint for dealer systems that export inventory to a
// third-party destination (dealr.cloud, vAuto Provision, ProMax, or any feed
// provider). The URL identifies the dealership; HTTP Basic credentials are
// ones NovaCar generated for that connection (never the dealer's own
// CRM/DMS login). Accepts CSV or XML, or JSON { vehicles: [...] }.

import { getDb, json, sha256Hex } from "../lib/crm.mjs";
import { getConnector } from "../lib/connectors/index.mjs";
import { parseInventoryFeed } from "../lib/connectors/feed-parse.mjs";
import { loadDealership } from "../lib/notify.mjs";
import { basicAuth, constantTimeEqual, dealershipByInboundToken, markConnections } from "../lib/webhooks.mjs";
import { importInventory } from "./crm.mjs";

const FEED_TYPES = ["inventory_export", "inventory_feed"];
const MAX_BYTES = 5 * 1024 * 1024;

export default async (request) => {
  try {
    if (request.method !== "POST" && request.method !== "PUT") return json({ error: "Method not allowed" }, 405);
    const token = new URL(request.url).searchParams.get("d");
    const dealershipRow = await dealershipByInboundToken(token);
    const credentials = basicAuth(request);
    if (!dealershipRow || !credentials) return json({ error: "Unauthorized" }, 401);

    const db = getDb();
    const connections = await db.sql`
      SELECT * FROM carnova_connections
      WHERE dealership_id = ${dealershipRow.id} AND type = ANY(${FEED_TYPES}::text[]) AND status IN ('active', 'error', 'pending')
    `;
    const passwordHash = await sha256Hex(credentials.password);
    const connection = connections.find(
      (candidate) =>
        constantTimeEqual(candidate.config?.feedUsername, credentials.username) &&
        constantTimeEqual(candidate.config?.feedPasswordHash, passwordHash),
    );
    if (!connection) return json({ error: "Unauthorized" }, 401);

    const text = await request.text();
    if (text.length > MAX_BYTES) return json({ error: "Feed is larger than 5 MB. Split it into smaller files." }, 413);
    const contentType = request.headers.get("content-type") || "";
    let vehicles;
    let errors = [];
    if (/json/i.test(contentType)) {
      try {
        const body = JSON.parse(text);
        vehicles = Array.isArray(body) ? body : body?.vehicles;
      } catch {
        errors = ["Body is not valid JSON."];
      }
    } else ({ vehicles, errors } = parseInventoryFeed(text, contentType));

    if (!Array.isArray(vehicles) || !vehicles.length) {
      const message = errors.join(" ") || "No vehicles found in the feed.";
      await markConnections(dealershipRow.id, [connection.type], { ok: false, error: message });
      return json({ error: message }, 400);
    }

    const dealership = await loadDealership(db, dealershipRow.id);
    const session = { identityUser: null, member: { id: null, role: "admin" }, dealership, platformAdmin: false };
    const response = await importInventory(session, {
      vehicles,
      sourceType: "dms",
      sourceName: `${getConnector(connection.system)?.name ?? "Inventory"} feed`,
    });
    const result = await response.json();
    if (response.status >= 400 || !result.imported) {
      await markConnections(dealershipRow.id, [connection.type], { ok: false, error: result.error || "No rows were imported." });
      return json({ error: result.error || "No rows were imported.", failed: result.failed ?? vehicles.length }, 400);
    }
    await markConnections(dealershipRow.id, [connection.type], { ok: true });
    return json({ imported: result.imported, created: result.created, updated: result.updated, failed: result.failed });
  } catch (error) {
    console.error("Inventory feed failed", error.message);
    return json({ error: "Inventory feed could not be processed." }, 500);
  }
};
