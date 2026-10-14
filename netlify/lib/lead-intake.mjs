// Shared lead intake for every inbound channel (ADF email, web lead form,
// token-gated JSON capture). Leads are deduplicated per dealership by
// normalized phone or lowercase email, the follow-up sequence starts, and Andy
// sends the first text inline so the customer hears back within seconds. The
// messaging scheduler re-checks every minute as a safety net.

import { cleanText, createEvent, getDb } from "./crm.mjs";
import { recordVehicleInterest, vehicleSnapshot } from "./inventory.mjs";
import { normalizePhone } from "./sms.mjs";

const HOUR = 3600000;

/** Links an ADF stock number or VIN to a real inventory record, if present. */
const findInventoryVehicle = async (db, dealershipId, vehicle) => {
  const stock = cleanText(vehicle?.stock, 80);
  const vin = cleanText(vehicle?.vin, 40);
  if (!stock && !vin) return null;
  const [row] = await db.sql`
    SELECT * FROM carnova_inventory
    WHERE dealership_id = ${dealershipId}
      AND ((${stock}::text IS NOT NULL AND ${stock}::text <> '' AND stock_number = ${stock})
        OR (${vin}::text IS NOT NULL AND ${vin}::text <> '' AND UPPER(vin) = UPPER(${vin})))
    LIMIT 1
  `;
  return row ?? null;
};

export const findDuplicateLead = async (db, dealershipId, { phoneE164, email }) => {
  if (!phoneE164 && !email) return null;
  const [row] = await db.sql`
    SELECT * FROM carnova_crm_leads
    WHERE dealership_id = ${dealershipId}
      AND ((${phoneE164}::text IS NOT NULL AND phone_e164 = ${phoneE164})
        OR (${email}::text IS NOT NULL AND LOWER(email) = ${email}))
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return row ?? null;
};

/**
 * Creates or updates a lead. `input` is { name, phone, email, vehicleInterest,
 * vehicle, tradeIn, comments, source }. Returns { lead, duplicate }.
 */
export const upsertInboundLead = async ({ dealershipId, input, channel = "email" }) => {
  const db = getDb();
  const phoneE164 = normalizePhone(input.phone);
  const email = cleanText(input.email, 254)?.toLowerCase() || null;
  const name = cleanText(input.name, 160) || email || input.phone || "New lead";
  const source = cleanText(input.source, 120) || "inbound";
  const vehicle = await findInventoryVehicle(db, dealershipId, input.vehicle);
  const vehicleInterest =
    cleanText(input.vehicleInterest, 300) ||
    (vehicle ? [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ") : null);
  const comments = cleanText(input.comments, 5000) || null;

  const existing = await findDuplicateLead(db, dealershipId, { phoneE164, email });
  let lead;
  if (existing) {
    [lead] = await db.sql`
      UPDATE carnova_crm_leads SET
        phone = COALESCE(phone, ${cleanText(input.phone, 40) || null}),
        phone_e164 = COALESCE(phone_e164, ${phoneE164}),
        email = COALESCE(email, ${email}),
        vehicle_interest = COALESCE(${vehicleInterest}, vehicle_interest),
        trade_in = COALESCE(${cleanText(input.tradeIn, 500) || null}, trade_in),
        status = CASE WHEN status IN ('lost', 'nurture') THEN 'new' ELSE status END,
        updated_at = NOW()
      WHERE id = ${existing.id} AND dealership_id = ${dealershipId}
      RETURNING *
    `;
  } else {
    [lead] = await db.sql`
      INSERT INTO carnova_crm_leads (
        id, dealership_id, name, phone, phone_e164, email, source, vehicle_interest, trade_in,
        temperature, status, notes, follow_up_enabled, sequence_started_at, sequence_step
      ) VALUES (
        ${crypto.randomUUID()}, ${dealershipId}, ${name}, ${cleanText(input.phone, 40) || null},
        ${phoneE164}, ${email}, ${source}, ${vehicleInterest}, ${cleanText(input.tradeIn, 500) || null},
        'warm', 'new', ${comments}, TRUE, NOW(), 0
      ) RETURNING *
    `;
  }

  if (vehicle) {
    await recordVehicleInterest(db, {
      dealershipId,
      leadId: lead.id,
      vehicle,
      interestLevel: lead.inventory_id ? "interested" : "primary",
      capturedBy: "import",
      notes: `From ${source}.`,
    });
    if (!lead.inventory_id)
      [lead] = await db.sql`
        UPDATE carnova_crm_leads SET inventory_id = ${vehicle.id},
          vehicle_snapshot = ${JSON.stringify(vehicleSnapshot(vehicle))}::jsonb, updated_at = NOW()
        WHERE id = ${lead.id} AND dealership_id = ${dealershipId}
        RETURNING *
      `;
  }

  if (comments)
    await db.sql`
      INSERT INTO carnova_messages (id, dealership_id, lead_id, direction, sender_type, content, channel)
      VALUES (${crypto.randomUUID()}, ${dealershipId}, ${lead.id}, 'inbound', 'customer', ${comments}, ${channel})
    `;

  await createEvent({
    dealershipId,
    leadId: lead.id,
    type: existing ? "lead.duplicate_received" : "lead.created",
    payload: { source, channel, dedupedBy: existing ? (phoneE164 && existing.phone_e164 === phoneE164 ? "phone" : "email") : null },
  });
  return { lead, duplicate: Boolean(existing) };
};

/** True when Andy should text this lead now. */
export const shouldAutoRespond = async (db, lead, duplicate) => {
  if (!lead.phone_e164 || !lead.ai_enabled) return false;
  if (!duplicate) return true;
  const [last] = await db.sql`
    SELECT created_at FROM carnova_messages
    WHERE dealership_id = ${lead.dealership_id} AND lead_id = ${lead.id} AND direction = 'outbound'
    ORDER BY created_at DESC LIMIT 1
  `;
  return !last || Date.now() - new Date(last.created_at).getTime() > HOUR;
};

/**
 * Full intake: upsert, then Andy's first touch. Andy is loaded lazily so
 * intake stays usable (and testable) without the AI module graph.
 */
export const ingestLead = async ({ dealershipId, input, channel = "email" }) => {
  const db = getDb();
  const { lead, duplicate } = await upsertInboundLead({ dealershipId, input, channel });
  let response = { skipped: "not_needed" };
  if (await shouldAutoRespond(db, lead, duplicate)) {
    const { respondToLead } = await import("./andy.mjs");
    response = await respondToLead({ dealershipId, leadId: lead.id }).catch((error) => {
      console.error("Andy first touch failed", { leadId: lead.id, message: error.message });
      return { error: "first_touch_failed" };
    });
    if (response.sent && !duplicate) {
      const { nextSequenceAt } = await import("./sequence.mjs");
      const [dealership] = await db.sql`SELECT timezone FROM carnova_dealerships WHERE id = ${dealershipId}`;
      const nextAt = nextSequenceAt({
        completedStep: 1,
        startedAt: lead.sequence_started_at ?? lead.created_at,
        lastSentAt: new Date(),
        timezone: dealership?.timezone,
      });
      await db.sql`
        UPDATE carnova_crm_leads SET sequence_step = 1, sequence_next_at = ${nextAt?.toISOString() ?? null}
        WHERE id = ${lead.id} AND dealership_id = ${dealershipId} AND sequence_stopped_at IS NULL
      `;
    }
  }
  return { leadId: lead.id, duplicate, response };
};
