// Behavior shared by every connector: the ADF lead address, the inventory
// feed endpoint, and the tests that exercise them without faking a connection.

import { getDb } from "../crm.mjs";
import { parseAdf, SAMPLE_ADF } from "../adf.mjs";
import { parseInventoryFeed, SAMPLE_INVENTORY_CSV } from "./feed-parse.mjs";

export const leadEmailAddress = (dealership) => {
  const base = process.env.POSTMARK_INBOUND_ADDRESS;
  if (!base || !(dealership?.inbound_token || dealership?.inboundToken)) return null;
  const token = dealership.inbound_token || dealership.inboundToken;
  const [local, domain] = base.split("@");
  return domain ? `${local}+${token}@${domain}` : null;
};

export const inventoryFeedUrl = (baseUrl, dealership) =>
  `${baseUrl}/api/inventory-feed?d=${encodeURIComponent(dealership.inbound_token || dealership.inboundToken)}`;

export const leadFormUrl = (baseUrl, dealership) =>
  `${baseUrl}/api/lead-form?d=${encodeURIComponent(dealership.inbound_token || dealership.inboundToken)}`;

export const leadEmailSetup = ({ dealership, connection }) => {
  const address = leadEmailAddress(dealership);
  return {
    address,
    ready: Boolean(address && process.env.INBOUND_WEBHOOK_SECRET),
    lastReceivedAt: connection?.last_sync_at ?? null,
    note: address
      ? "Add this address as an ADF/XML lead recipient. Real leads mark this connection as receiving."
      : "Inbound email is not configured yet (POSTMARK_INBOUND_ADDRESS is missing).",
  };
};

export const inventoryFeedSetup = ({ dealership, connection, baseUrl }) => ({
  url: inventoryFeedUrl(baseUrl, dealership),
  username: connection?.config?.feedUsername ?? null,
  // The password is shown once at creation; only its hash is stored.
  passwordSet: Boolean(connection?.config?.feedPasswordHash),
  formats: ["CSV", "XML"],
  lastReceivedAt: connection?.last_sync_at ?? null,
});

/**
 * Lead test: runs the sample ADF document through the real parser and
 * reports what it saw, plus whether a real lead email has ever arrived. It
 * does not create a lead or text anyone.
 */
export const testLeadEmail = async ({ dealership, connection }) => {
  const { leads, errors } = parseAdf(SAMPLE_ADF);
  if (!leads.length) return { ok: false, detail: `ADF parser failed: ${errors.join(" ")}` };
  const address = leadEmailAddress(dealership);
  if (!address) return { ok: false, detail: "Parser OK, but inbound email is not configured (POSTMARK_INBOUND_ADDRESS)." };
  if (!process.env.INBOUND_WEBHOOK_SECRET)
    return { ok: false, detail: "Parser OK, but INBOUND_WEBHOOK_SECRET is not set, so inbound email would be rejected." };
  const received = connection?.last_sync_at
    ? `Last real lead received ${new Date(connection.last_sync_at).toISOString()}.`
    : `No real lead has arrived yet. Send a test lead from your system to ${address}.`;
  return { ok: true, detail: `Parsed sample ADF lead "${leads[0].name}". ${received}` };
};

export const testInventoryFeed = async ({ connection }) => {
  const { vehicles, errors } = parseInventoryFeed(SAMPLE_INVENTORY_CSV, "text/csv");
  if (!vehicles.length) return { ok: false, detail: `Feed parser failed: ${errors.join(" ")}` };
  if (!connection?.config?.feedPasswordHash) return { ok: false, detail: "Feed credentials have not been generated." };
  const received = connection?.last_sync_at
    ? `Last feed received ${new Date(connection.last_sync_at).toISOString()}.`
    : "No feed has been delivered yet.";
  return { ok: true, detail: `Parsed ${vehicles.length} sample vehicle(s). ${received}` };
};

export const countRecentLeads = async (dealershipId, sourcePrefix) => {
  const [row] = await getDb().sql`
    SELECT COUNT(*)::int AS count FROM carnova_crm_leads
    WHERE dealership_id = ${dealershipId} AND source ILIKE ${`${sourcePrefix}%`}
      AND created_at > NOW() - INTERVAL '30 days'
  `;
  return row?.count ?? 0;
};
