import {
  APPOINTMENT_STATUSES,
  LEAD_STATUSES,
  LEAD_TEMPERATURES,
  USER_ROLES,
  cleanNumber,
  cleanStringArray,
  cleanText,
  createAlert,
  createEvent,
  getAvailability,
  getDb,
  IMPERSONATION_HEADER,
  SALES_ROLES,
  getSession,
  hasRole,
  json,
  localDateTimeToIso,
} from "../lib/crm.mjs";
import {
  analytics,
  baseUrlFor,
  createConnection,
  disconnectConnection,
  endImpersonation,
  inviteTeam,
  listConnections,
  requestPartnerAccess,
  saveSetup,
  setupStatus,
  startImpersonation,
  testConnectionRoute,
  uploadLogo,
  PLANS,
  sendIdentityInvite,
} from "../lib/crm-routes.mjs";
import {
  afterAppointmentBooked,
  businessHoursError,
  stopSequence,
} from "../lib/appointments.mjs";
import { LAST_STEP } from "../lib/sequence.mjs";
import { sendCustomerSms } from "../lib/sms.mjs";
import { listConsents, messagingStatus, recordManualConsent, resolveUrgent } from "../lib/consent-routes.mjs";
import { zonedTimeToUtc } from "../lib/timezone.mjs";
import {
  INVENTORY_CONDITIONS,
  INVENTORY_SOURCE_TYPES,
  INVENTORY_STATUSES,
  PRESENTABLE_STATUSES,
  SYNC_SCHEDULES,
  describeVehicle,
  getInventoryFacets,
  getInventoryFreshness,
  getLeadVehicles,
  getVehicleById,
  listInventorySources,
  listInventorySyncs,
  recordInventorySync,
  recordVehicleInterest,
  removeVehicleInterest,
  searchInventory,
  vehicleSnapshot,
} from "../lib/inventory.mjs";
import {
  CARNOVA_RELISTED_REASON,
  CARNOVA_REMOVED_REASON,
  CARNOVA_SITE_URL,
  CARNOVA_SOURCE_NAME,
  CARNOVA_SOURCE_PROVIDER,
  CARNOVA_SOURCE_TYPE,
  fetchCarnovaListings,
  mapCarnovaListings,
} from "../lib/carnova-feed.mjs";
import { TEST_INVENTORY } from "../lib/test-inventory.mjs";

const parseBody = async (request) => {
  try {
    return await request.json();
  } catch {
    return null;
  }
};

const forbidden = () =>
  json({ error: "You do not have permission to perform this action." }, 403);

// Owners hold every administrator permission, so "last administrator"
// safeguards count both.
const ADMIN_TIER = ["owner", "admin"];

const requireMember = async (request) => {
  const session = await getSession(request);
  if (!session.identityUser)
    return { error: json({ error: "Sign in to access NOVACARAI CRM." }, 401) };
  if (!session.member) return { session, error: null };
  return { session, error: null };
};

const getLead = async (dealershipId, leadId) => {
  const db = getDb();
  const [lead] = await db.sql`
    SELECT l.*, i.stock_number, i.year AS inventory_year, i.make AS inventory_make,
      i.model AS inventory_model, i.trim AS inventory_trim, i.status AS inventory_status,
      sales.name AS assigned_salesperson_name, bdc.name AS assigned_bdc_agent_name,
      EXISTS (SELECT 1 FROM carnova_consents c WHERE c.dealership_id = l.dealership_id
        AND c.phone = l.phone_e164 AND c.revoked_at IS NULL) AS has_consent,
      EXISTS (SELECT 1 FROM carnova_opt_outs o WHERE o.dealership_id = l.dealership_id
        AND o.phone = l.phone_e164) AS opted_out,
      manager.name AS assigned_manager_name
    FROM carnova_crm_leads l
    LEFT JOIN carnova_inventory i ON i.id = l.inventory_id AND i.dealership_id = l.dealership_id
    LEFT JOIN carnova_users sales ON sales.id = l.assigned_salesperson_id AND sales.dealership_id = l.dealership_id
    LEFT JOIN carnova_users bdc ON bdc.id = l.assigned_bdc_agent_id AND bdc.dealership_id = l.dealership_id
    LEFT JOIN carnova_users manager ON manager.id = l.assigned_manager_id AND manager.dealership_id = l.dealership_id
    WHERE l.id = ${leadId} AND l.dealership_id = ${dealershipId}
  `;
  return lead;
};

// Sales roles only reach their own or unassigned leads, matching listLeads.
const getLeadFor = async (session, leadId) => {
  const lead = await getLead(session.dealership.id, leadId);
  if (!lead) return null;
  const salesOnly = SALES_ROLES.includes(session.member?.role);
  return salesOnly && lead.assigned_salesperson_id && lead.assigned_salesperson_id !== session.member.id ? null : lead;
};

const validateTenantReferences = async (
  dealershipId,
  { inventoryId = null, userIds = [] } = {},
) => {
  const db = getDb();
  if (inventoryId) {
    const [inventory] = await db.sql`
      SELECT id FROM carnova_inventory
      WHERE id = ${inventoryId} AND dealership_id = ${dealershipId}
    `;
    if (!inventory)
      return "Selected inventory does not belong to this dealership.";
  }
  for (const userId of userIds.filter(Boolean)) {
    const [user] = await db.sql`
      SELECT id FROM carnova_users
      WHERE id = ${userId} AND dealership_id = ${dealershipId} AND active = TRUE
    `;
    if (!user) return "Selected employee does not belong to this dealership.";
  }
  return null;
};

/**
 * Keep the CUSTOMER -> LEAD -> VEHICLE -> DEALERSHIP relationship real.
 *
 * Whenever a lead points at an inventory record we copy the identifying vehicle
 * data onto the lead (vehicle id, stock number, VIN, year, make, model) and
 * register the interest in carnova_lead_vehicles, so nothing downstream has to
 * fall back to a free-text vehicle name.
 */
const syncLeadVehicleLink = async (
  session,
  lead,
  { capturedBy = "user", interestLevel = "primary" } = {},
) => {
  const db = getDb();
  const dealershipId = session.dealership.id;
  if (!lead?.id) return null;
  if (!lead.inventory_id) {
    await db.sql`
      UPDATE carnova_crm_leads SET vehicle_snapshot = '{}'::jsonb
      WHERE id = ${lead.id} AND dealership_id = ${dealershipId}
        AND inventory_id IS NULL AND vehicle_snapshot <> '{}'::jsonb
    `;
    lead.vehicle_snapshot = {};
    return null;
  }
  const vehicle = await getVehicleById(db, dealershipId, lead.inventory_id);
  if (!vehicle) return null;
  const snapshot = vehicleSnapshot(vehicle);
  await db.sql`
    UPDATE carnova_crm_leads SET
      vehicle_snapshot = ${JSON.stringify(snapshot)}::jsonb,
      vehicle_interest = COALESCE(NULLIF(vehicle_interest, ''), ${describeVehicle(vehicle)}),
      updated_at = NOW()
    WHERE id = ${lead.id} AND dealership_id = ${dealershipId}
  `;
  await recordVehicleInterest(db, {
    dealershipId,
    leadId: lead.id,
    vehicle,
    interestLevel,
    capturedBy,
  });
  lead.vehicle_snapshot = snapshot;
  lead.vehicle_interest = lead.vehicle_interest || describeVehicle(vehicle);
  return { vehicle, snapshot };
};

/**
 * Appointments reference the actual inventory vehicle, not a description, so a
 * salesperson opening the appointment sees the exact car the customer expects.
 */
const syncAppointmentVehicle = async (session, appointment) => {
  const db = getDb();
  const dealershipId = session.dealership.id;
  if (!appointment?.id) return null;
  if (!appointment.inventory_id) {
    await db.sql`
      UPDATE carnova_appointments SET vehicle_snapshot = '{}'::jsonb
      WHERE id = ${appointment.id} AND dealership_id = ${dealershipId}
        AND inventory_id IS NULL AND vehicle_snapshot <> '{}'::jsonb
    `;
    appointment.vehicle_snapshot = {};
    return null;
  }
  const vehicle = await getVehicleById(
    db,
    dealershipId,
    appointment.inventory_id,
  );
  if (!vehicle) return null;
  const snapshot = vehicleSnapshot(vehicle);
  await db.sql`
    UPDATE carnova_appointments SET vehicle_snapshot = ${JSON.stringify(snapshot)}::jsonb
    WHERE id = ${appointment.id} AND dealership_id = ${dealershipId}
  `;
  await recordVehicleInterest(db, {
    dealershipId,
    leadId: appointment.lead_id,
    vehicle,
    interestLevel: "primary",
    capturedBy: "user",
  });
  appointment.vehicle_snapshot = snapshot;
  return { vehicle, snapshot };
};

const listLeads = async (session, url) => {
  const db = getDb();
  const query = cleanText(url.searchParams.get("q"), 200);
  const status = cleanText(url.searchParams.get("status"), 40);
  const temperature = cleanText(url.searchParams.get("temperature"), 20);
  const followUpOnly = url.searchParams.get("followUp") === "true";
  // Sales roles see their own leads plus unassigned ones.
  const salesOnly = SALES_ROLES.includes(session.member.role);
  const leads = await db.sql`
    SELECT l.*, i.stock_number, i.year AS inventory_year, i.make AS inventory_make,
      i.model AS inventory_model, i.trim AS inventory_trim, i.status AS inventory_status,
      COALESCE(vehicle_interests.total, 0)::int AS vehicle_interest_count,
      sales.name AS assigned_salesperson_name, bdc.name AS assigned_bdc_agent_name,
      EXISTS (SELECT 1 FROM carnova_consents c WHERE c.dealership_id = l.dealership_id
        AND c.phone = l.phone_e164 AND c.revoked_at IS NULL) AS has_consent,
      EXISTS (SELECT 1 FROM carnova_opt_outs o WHERE o.dealership_id = l.dealership_id
        AND o.phone = l.phone_e164) AS opted_out,
      manager.name AS assigned_manager_name,
      appointment.id AS appointment_id, appointment.starts_at AS appointment_starts_at,
      appointment.status AS appointment_status,
      latest.content AS latest_message, latest.created_at AS latest_message_at,
      COALESCE(message_count.total, 0)::int AS message_count
    FROM carnova_crm_leads l
    LEFT JOIN carnova_inventory i ON i.id = l.inventory_id AND i.dealership_id = l.dealership_id
    LEFT JOIN carnova_users sales ON sales.id = l.assigned_salesperson_id AND sales.dealership_id = l.dealership_id
    LEFT JOIN carnova_users bdc ON bdc.id = l.assigned_bdc_agent_id AND bdc.dealership_id = l.dealership_id
    LEFT JOIN carnova_users manager ON manager.id = l.assigned_manager_id AND manager.dealership_id = l.dealership_id
    LEFT JOIN LATERAL (
      SELECT id, starts_at, status FROM carnova_appointments
      WHERE lead_id = l.id AND dealership_id = l.dealership_id AND status NOT IN ('cancelled', 'no_show')
      ORDER BY starts_at DESC LIMIT 1
    ) appointment ON TRUE
    LEFT JOIN LATERAL (
      SELECT content, created_at FROM carnova_messages
      WHERE lead_id = l.id AND dealership_id = l.dealership_id
      ORDER BY created_at DESC LIMIT 1
    ) latest ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS total FROM carnova_messages
      WHERE lead_id = l.id AND dealership_id = l.dealership_id
    ) message_count ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS total FROM carnova_lead_vehicles
      WHERE lead_id = l.id AND dealership_id = l.dealership_id
    ) vehicle_interests ON TRUE
    WHERE l.dealership_id = ${session.dealership.id}
      AND (${!salesOnly} OR l.assigned_salesperson_id IS NULL OR l.assigned_salesperson_id = ${session.member.id})
      AND (${query} = '' OR l.name ILIKE ${`%${query}%`} OR COALESCE(l.phone, '') ILIKE ${`%${query}%`}
        OR COALESCE(l.email, '') ILIKE ${`%${query}%`} OR COALESCE(l.vehicle_interest, '') ILIKE ${`%${query}%`})
      AND (${status} = '' OR l.status = ${status})
      AND (${temperature} = '' OR l.temperature = ${temperature})
      AND (${followUpOnly} = FALSE OR (l.next_follow_up_at IS NOT NULL AND l.next_follow_up_at <= NOW()))
    ORDER BY l.human_handoff_required DESC, (l.urgent_flagged_at IS NOT NULL) DESC,
      COALESCE(latest.created_at, l.updated_at) DESC
    LIMIT 250
  `;
  return json({ leads });
};

const createLead = async (session, body) => {
  const db = getDb();
  const name = cleanText(body?.name, 160);
  const phone = cleanText(body?.phone, 80) || null;
  const email = cleanText(body?.email, 320) || null;
  if (!name || (!phone && !email))
    return json(
      { error: "Name and a phone number or email are required." },
      400,
    );
  const referenceError = await validateTenantReferences(session.dealership.id, {
    inventoryId: cleanText(body?.inventoryId, 100) || null,
    userIds: [
      cleanText(body?.assignedSalespersonId, 100),
      cleanText(body?.assignedBdcAgentId, 100),
      cleanText(body?.assignedManagerId, 100),
    ],
  });
  if (referenceError) return json({ error: referenceError }, 400);

  const id = crypto.randomUUID();
  const temperature = LEAD_TEMPERATURES.includes(body?.temperature)
    ? body.temperature
    : "warm";
  const status = LEAD_STATUSES.includes(body?.status) ? body.status : "new";
  const [lead] = await db.sql`
    INSERT INTO carnova_crm_leads (
      id, dealership_id, name, phone, email, source, vehicle_interest, inventory_id,
      trade_in, budget, financing_interest, assigned_salesperson_id, assigned_bdc_agent_id,
      assigned_manager_id,
      temperature, status, notes, next_follow_up_at
    ) VALUES (
      ${id}, ${session.dealership.id}, ${name}, ${phone}, ${email},
      ${cleanText(body?.source, 120) || "manual"}, ${cleanText(body?.vehicleInterest, 300) || null},
      ${cleanText(body?.inventoryId, 100) || null}, ${cleanText(body?.tradeIn, 500) || null},
      ${cleanText(body?.budget, 100) || null},
      ${typeof body?.financingInterest === "boolean" ? body.financingInterest : null},
      ${cleanText(body?.assignedSalespersonId, 100) || null},
      ${cleanText(body?.assignedBdcAgentId, 100) || session.member.id},
      ${cleanText(body?.assignedManagerId, 100) || null},
      ${temperature}, ${status}, ${cleanText(body?.notes, 3000) || null},
      ${body?.nextFollowUpAt || null}
    ) RETURNING *
  `;

  const leadVehicle = await syncLeadVehicleLink(session, lead);
  await Promise.all([
    createEvent({
      dealershipId: session.dealership.id,
      leadId: id,
      type: "lead.created",
      actorUserId: session.member.id,
      payload: {
        source: lead.source,
        inventoryId: leadVehicle?.vehicle?.id ?? null,
        stockNumber: leadVehicle?.vehicle?.stock_number ?? null,
      },
    }),
    createAlert({
      dealershipId: session.dealership.id,
      leadId: id,
      type: "new_lead",
      title: "New lead",
      message: `${name} was added from ${lead.source}.`,
    }),
  ]);
  return json({ lead }, 201);
};

const updateLead = async (session, leadId, body) => {
  const db = getDb();
  const existing = await getLeadFor(session, leadId);
  if (!existing) return json({ error: "Lead not found." }, 404);

  const status = body?.status === undefined ? existing.status : body.status;
  const temperature =
    body?.temperature === undefined ? existing.temperature : body.temperature;
  if (!LEAD_STATUSES.includes(status))
    return json({ error: "Invalid lead status." }, 400);
  if (!LEAD_TEMPERATURES.includes(temperature))
    return json({ error: "Invalid lead temperature." }, 400);
  const referenceError = await validateTenantReferences(session.dealership.id, {
    inventoryId:
      body?.inventoryId === undefined
        ? null
        : cleanText(body.inventoryId, 100) || null,
    userIds: [
      body?.assignedSalespersonId === undefined
        ? ""
        : cleanText(body.assignedSalespersonId, 100),
      body?.assignedBdcAgentId === undefined
        ? ""
        : cleanText(body.assignedBdcAgentId, 100),
      body?.assignedManagerId === undefined
        ? ""
        : cleanText(body.assignedManagerId, 100),
    ],
  });
  if (referenceError) return json({ error: referenceError }, 400);

  const humanHandoffRequired =
    body?.humanHandoffRequired === undefined
      ? existing.human_handoff_required
      : Boolean(body.humanHandoffRequired);
  const followUpEnabled =
    body?.followUpEnabled === undefined
      ? existing.follow_up_enabled
      : Boolean(body.followUpEnabled);
  const completedAt = ["sold", "lost"].includes(status)
    ? new Date().toISOString()
    : null;
  const [lead] = await db.sql`
    UPDATE carnova_crm_leads SET
      name = ${body?.name === undefined ? existing.name : cleanText(body.name, 160)},
      phone = ${body?.phone === undefined ? existing.phone : cleanText(body.phone, 80) || null},
      email = ${body?.email === undefined ? existing.email : cleanText(body.email, 320) || null},
      source = ${body?.source === undefined ? existing.source : cleanText(body.source, 120) || "manual"},
      vehicle_interest = ${body?.vehicleInterest === undefined ? existing.vehicle_interest : cleanText(body.vehicleInterest, 300) || null},
      inventory_id = ${body?.inventoryId === undefined ? existing.inventory_id : cleanText(body.inventoryId, 100) || null},
      trade_in = ${body?.tradeIn === undefined ? existing.trade_in : cleanText(body.tradeIn, 500) || null},
      budget = ${body?.budget === undefined ? existing.budget : cleanText(body.budget, 100) || null},
      financing_interest = ${body?.financingInterest === undefined ? existing.financing_interest : body.financingInterest},
      assigned_salesperson_id = ${body?.assignedSalespersonId === undefined ? existing.assigned_salesperson_id : cleanText(body.assignedSalespersonId, 100) || null},
      assigned_bdc_agent_id = ${body?.assignedBdcAgentId === undefined ? existing.assigned_bdc_agent_id : cleanText(body.assignedBdcAgentId, 100) || null},
      assigned_manager_id = ${body?.assignedManagerId === undefined ? existing.assigned_manager_id : cleanText(body.assignedManagerId, 100) || null},
      temperature = ${temperature}, status = ${status},
      ai_enabled = ${body?.aiEnabled === undefined ? existing.ai_enabled : Boolean(body.aiEnabled)},
      follow_up_enabled = ${followUpEnabled},
      human_handoff_required = ${humanHandoffRequired},
      human_handoff_reason = ${body?.humanHandoffReason === undefined ? existing.human_handoff_reason : cleanText(body.humanHandoffReason, 1000) || null},
      human_handoff_requested_at = ${humanHandoffRequired ? existing.human_handoff_requested_at || new Date().toISOString() : null},
      notes = ${body?.notes === undefined ? existing.notes : cleanText(body.notes, 5000) || null},
      next_follow_up_at = ${body?.nextFollowUpAt === undefined ? existing.next_follow_up_at : body.nextFollowUpAt || null},
      completed_at = ${completedAt}, updated_at = NOW()
    WHERE id = ${leadId} AND dealership_id = ${session.dealership.id}
    RETURNING *
  `;

  if (existing.inventory_id !== lead.inventory_id)
    await syncLeadVehicleLink(session, lead);

  // Per-lead follow-up toggle: off stops the SMS sequence; on resumes it where
  // it left off (the scheduler holds sends until the 9am-8pm texting window).
  if (existing.follow_up_enabled && !followUpEnabled)
    await stopSequence(db, session.dealership.id, leadId, "toggle");
  if (!existing.follow_up_enabled && followUpEnabled && lead.sequence_step < LAST_STEP)
    await db.sql`
      UPDATE carnova_crm_leads SET sequence_stopped_at = NULL, sequence_stop_reason = NULL,
        sequence_started_at = COALESCE(sequence_started_at, NOW()), sequence_next_at = NOW()
      WHERE id = ${leadId} AND dealership_id = ${session.dealership.id} AND sequence_stop_reason = 'toggle'
    `;

  const changedFields = Object.keys(body ?? {});
  await createEvent({
    dealershipId: session.dealership.id,
    leadId,
    type: "lead.updated",
    actorUserId: session.member.id,
    payload: { changedFields, status },
  });
  if (existing.status !== status) {
    await createEvent({
      dealershipId: session.dealership.id,
      leadId,
      type: "lead.status_changed",
      actorUserId: session.member.id,
      payload: { from: existing.status, to: status },
    });
  }
  if (existing.temperature !== "hot" && temperature === "hot") {
    await Promise.all([
      createEvent({
        dealershipId: session.dealership.id,
        leadId,
        type: "lead.temperature_hot",
        actorUserId: session.member.id,
        payload: {},
      }),
      createAlert({
        dealershipId: session.dealership.id,
        leadId,
        type: "hot_lead",
        severity: "warning",
        title: "Hot lead",
        message: `${lead.name} was marked hot and needs priority follow-up.`,
      }),
    ]);
  }
  if (!existing.human_handoff_required && humanHandoffRequired) {
    await createAlert({
      dealershipId: session.dealership.id,
      leadId,
      type: "human_handoff",
      severity: "critical",
      title: "HUMAN HANDOFF REQUIRED",
      message: `${lead.name}: ${lead.human_handoff_reason || "Customer requested a person."}`,
    });
  }
  return json({ lead });
};

const listMessages = async (session, leadId) => {
  const db = getDb();
  if (!(await getLeadFor(session, leadId)))
    return json({ error: "Lead not found." }, 404);
  const messages = await db.sql`
    SELECT m.*, u.name AS sender_name
    FROM carnova_messages m
    LEFT JOIN carnova_users u ON u.id = m.sender_user_id AND u.dealership_id = m.dealership_id
    WHERE m.dealership_id = ${session.dealership.id} AND m.lead_id = ${leadId}
    ORDER BY m.created_at
  `;
  return json({ messages });
};

const createMessage = async (session, body) => {
  const db = getDb();
  const leadId = cleanText(body?.leadId, 100);
  const content = cleanText(body?.content, 4000);
  const direction = body?.direction === "internal" ? "internal" : "outbound";
  if (!leadId || !content)
    return json({ error: "Lead and message are required." }, 400);
  const lead = await getLeadFor(session, leadId);
  if (!lead) return json({ error: "Lead not found." }, 404);

  if (direction === "outbound" && body?.channel === "sms") {
    // Staff texting from the inbox: send through Twilio and record the result.
    const sent = await sendCustomerSms({
      dealership: session.dealership,
      lead,
      body: content,
      senderType: "user",
      senderUserId: session.member.id,
      kind: "staff",
    });
    await createEvent({
      dealershipId: session.dealership.id,
      leadId,
      type: "message.sent",
      actorUserId: session.member.id,
      payload: { channel: "sms", delivered: sent.sent },
    });
    if (!sent.message)
      return json({ error: sent.reason === "opted_out" ? "This customer opted out of texts." : "This lead has no mobile number." }, 409);
    return json({ message: sent.message, delivery: { sent: sent.sent, reason: sent.reason } }, 201);
  }

  const [message] = await db.sql`
    INSERT INTO carnova_messages (
      id, dealership_id, lead_id, direction, sender_type, sender_user_id, content, channel
    ) VALUES (
      ${crypto.randomUUID()}, ${session.dealership.id}, ${leadId}, ${direction}, 'user',
      ${session.member.id}, ${content}, ${cleanText(body?.channel, 40) || "chat"}
    ) RETURNING *
  `;
  await db.sql`
    UPDATE carnova_crm_leads
    SET last_contact_at = NOW(), status = CASE WHEN status = 'new' THEN 'contacted' ELSE status END, updated_at = NOW()
    WHERE id = ${leadId} AND dealership_id = ${session.dealership.id}
  `;
  await createEvent({
    dealershipId: session.dealership.id,
    leadId,
    type: direction === "internal" ? "lead.note_added" : "message.sent",
    actorUserId: session.member.id,
    payload: { channel: message.channel },
  });
  return json({ message }, 201);
};

const parseListFilters = (url) => {
  const list = (key) =>
    cleanStringArray(url.searchParams.getAll(key).join(","), 25).map((value) =>
      value.toLowerCase(),
    );
  return {
    q: cleanText(url.searchParams.get("q"), 200),
    stockNumbers: list("stockNumber"),
    vins: list("vin"),
    makes: list("make"),
    models: list("model"),
    trims: list("trim"),
    bodyStyles: list("bodyStyle"),
    exteriorColors: list("exteriorColor"),
    interiorColors: list("interiorColor"),
    features: list("feature"),
    conditions: list("condition").filter((value) =>
      INVENTORY_CONDITIONS.includes(value),
    ),
    yearMin: cleanNumber(url.searchParams.get("yearMin")),
    yearMax: cleanNumber(url.searchParams.get("yearMax")),
    priceMin: cleanNumber(url.searchParams.get("minPrice")),
    priceMax: cleanNumber(url.searchParams.get("maxPrice")),
    mileageMin: cleanNumber(url.searchParams.get("minMileage")),
    mileageMax: cleanNumber(url.searchParams.get("maxMileage")),
  };
};

const listInventory = async (session, url) => {
  const db = getDb();
  const dealershipId = session.dealership.id;
  const statuses = cleanStringArray(
    url.searchParams.getAll("status").join(","),
    10,
  ).filter((status) => INVENTORY_STATUSES.includes(status));
  const presentableOnly = url.searchParams.get("availableOnly") === "true";
  const sort = cleanText(url.searchParams.get("sort"), 20) || "relevance";
  const limit = cleanNumber(url.searchParams.get("limit")) ?? 120;
  const offset = cleanNumber(url.searchParams.get("offset")) ?? 0;

  const [{ vehicles, total }, facets, freshness] = await Promise.all([
    searchInventory(db, {
      dealershipId,
      filters: parseListFilters(url),
      statuses,
      presentableOnly,
      sort,
      limit,
      offset,
    }),
    getInventoryFacets(db, dealershipId),
    getInventoryFreshness(db, dealershipId),
  ]);

  return json({ inventory: vehicles, total, facets, freshness });
};

const getInventoryVehicle = async (session, vehicleId) => {
  const db = getDb();
  const dealershipId = session.dealership.id;
  const vehicle = await getVehicleById(db, dealershipId, vehicleId);
  if (!vehicle) return json({ error: "Vehicle not found." }, 404);

  const [leads, appointments, interests] = await Promise.all([
    db.sql`
      SELECT id, name, phone, email, status, temperature, vehicle_interest,
        assigned_salesperson_id, updated_at
      FROM carnova_crm_leads
      WHERE dealership_id = ${dealershipId}
        AND (inventory_id = ${vehicleId} OR id IN (
          SELECT lead_id FROM carnova_lead_vehicles
          WHERE dealership_id = ${dealershipId} AND inventory_id = ${vehicleId}
        ))
      ORDER BY updated_at DESC LIMIT 50
    `,
    db.sql`
      SELECT a.id, a.starts_at, a.ends_at, a.status, a.appointment_type,
        l.name AS lead_name, u.name AS salesperson_name
      FROM carnova_appointments a
      JOIN carnova_crm_leads l ON l.id = a.lead_id AND l.dealership_id = a.dealership_id
      LEFT JOIN carnova_users u ON u.id = a.salesperson_id AND u.dealership_id = a.dealership_id
      WHERE a.dealership_id = ${dealershipId} AND a.inventory_id = ${vehicleId}
      ORDER BY a.starts_at DESC LIMIT 50
    `,
    db.sql`
      SELECT lv.*, l.name AS lead_name
      FROM carnova_lead_vehicles lv
      JOIN carnova_crm_leads l ON l.id = lv.lead_id AND l.dealership_id = lv.dealership_id
      WHERE lv.dealership_id = ${dealershipId} AND lv.inventory_id = ${vehicleId}
      ORDER BY lv.last_interest_at DESC LIMIT 50
    `,
  ]);

  return json({ vehicle, leads, appointments, interests });
};

// Accepts camelCase, snake_case, and the spaced headers common to DMS and
// dealer-feed CSV exports so an imported row lands in the right column.
const CSV_FIELD_ALIASES = {
  stocknumber: "stockNumber",
  stock: "stockNumber",
  stockno: "stockNumber",
  stocknum: "stockNumber",
  vinnumber: "vin",
  modelyear: "year",
  vehicleyear: "year",
  makename: "make",
  modelname: "model",
  trimlevel: "trim",
  odometer: "mileage",
  miles: "mileage",
  sellingprice: "price",
  askingprice: "price",
  listprice: "price",
  internetprice: "internetPrice",
  webprice: "internetPrice",
  retailprice: "msrp",
  bodystyle: "vehicleType",
  body: "vehicleType",
  vehicletype: "vehicleType",
  type: "vehicleType",
  newused: "condition",
  "new/used": "condition",
  vehiclecondition: "condition",
  exteriorcolor: "exteriorColor",
  extcolor: "exteriorColor",
  color: "exteriorColor",
  interiorcolor: "interiorColor",
  intcolor: "interiorColor",
  fueltype: "fuelType",
  fuel: "fuelType",
  drivetrain: "drivetrain",
  drive: "drivetrain",
  transmission: "transmission",
  engine: "engine",
  doors: "doors",
  photos: "images",
  imageurls: "images",
  options: "features",
  equipment: "features",
  comments: "description",
  vehiclestatus: "status",
  lot: "location",
  lotlocation: "location",
};

const CONDITION_ALIASES = {
  n: "new",
  u: "used",
  c: "certified",
  cpo: "certified",
  "certified pre-owned": "certified",
  "pre-owned": "used",
  preowned: "used",
};

const STATUS_ALIASES = {
  active: "available",
  instock: "available",
  "in stock": "available",
  onlot: "available",
  hold: "reserved",
  pending: "reserved",
  "in transit": "in_transit",
  intransit: "in_transit",
  incoming: "in_transit",
  wholesale: "removed",
  deleted: "removed",
  inactive: "unavailable",
};

const canonicalizeVehiclePayload = (body) => {
  if (!body || typeof body !== "object") return {};
  const result = {};
  for (const [key, value] of Object.entries(body)) {
    const normalizedKey = key
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, "");
    const canonicalKey = CSV_FIELD_ALIASES[normalizedKey] ?? key;
    if (result[canonicalKey] === undefined || result[canonicalKey] === "")
      result[canonicalKey] = value;
  }
  return result;
};

const normalizeVehicle = (rawBody, existing = {}) => {
  const body = canonicalizeVehiclePayload(rawBody);
  const conditionInput = cleanText(body?.condition, 40).toLowerCase();
  const mappedCondition = CONDITION_ALIASES[conditionInput] ?? conditionInput;
  const condition = INVENTORY_CONDITIONS.includes(mappedCondition)
    ? mappedCondition
    : existing.condition || "used";
  const statusInput = cleanText(body?.status, 40)
    .toLowerCase()
    .replace(/[\s-]+/g, " ")
    .trim();
  const mappedStatus =
    STATUS_ALIASES[statusInput] ?? statusInput.replace(/\s+/g, "_");
  const status = INVENTORY_STATUSES.includes(mappedStatus)
    ? mappedStatus
    : existing.status || "available";
  return {
    stockNumber: cleanText(
      body?.stockNumber ?? body?.stock_number ?? existing.stock_number,
      100,
    ),
    vin: cleanText(body?.vin ?? existing.vin, 100).toUpperCase() || null,
    year: cleanNumber(body?.year ?? existing.year),
    make: cleanText(body?.make ?? existing.make, 100),
    model: cleanText(body?.model ?? existing.model, 100),
    trim: cleanText(body?.trim ?? existing.trim, 100) || null,
    mileage: cleanNumber(body?.mileage ?? existing.mileage),
    price: cleanNumber(body?.price ?? existing.price),
    internetPrice: cleanNumber(
      body?.internetPrice ?? body?.internet_price ?? existing.internet_price,
    ),
    msrp: cleanNumber(body?.msrp ?? existing.msrp),
    vehicleType:
      cleanText(
        body?.vehicleType ?? body?.bodyStyle ?? existing.vehicle_type,
        100,
      ) || null,
    condition,
    exteriorColor:
      cleanText(body?.exteriorColor ?? existing.exterior_color, 100) || null,
    interiorColor:
      cleanText(body?.interiorColor ?? existing.interior_color, 100) || null,
    fuelType: cleanText(body?.fuelType ?? existing.fuel_type, 80) || null,
    drivetrain: cleanText(body?.drivetrain ?? existing.drivetrain, 80) || null,
    transmission:
      cleanText(body?.transmission ?? existing.transmission, 80) || null,
    engine: cleanText(body?.engine ?? existing.engine, 120) || null,
    doors: cleanNumber(body?.doors ?? existing.doors),
    // Published dealer listings routinely carry 40+ photos per vehicle.
    images: cleanStringArray(body?.images ?? existing.images, 60),
    features: cleanStringArray(body?.features ?? existing.features, 100),
    description:
      cleanText(body?.description ?? existing.description, 5000) || null,
    status,
    statusReason: cleanText(body?.statusReason, 300) || null,
    location: cleanText(body?.location ?? existing.location, 200) || null,
    source: cleanText(body?.source ?? existing.source, 40) || "manual",
    sourceReference:
      cleanText(body?.sourceReference ?? existing.source_reference, 100) ||
      null,
    dateAdded:
      body?.dateAdded ??
      body?.date_added ??
      existing.date_added ??
      new Date().toISOString(),
  };
};

/**
 * Upsert a single dealership vehicle. Returns the saved row plus whether it
 * was newly created and whether its availability changed, so callers can emit
 * one event per change instead of per import row.
 *
 * `options` carries feed-sync concerns that manual editing must not have:
 * `preserveDateAdded` keeps the date NOVACARAI first recorded the vehicle, and
 * `reactivateRemovedReason` lets a feed re-list a vehicle its own earlier run
 * had marked removed.
 */
const upsertVehicle = async (session, body, vehicleId = null, options = {}) => {
  const db = getDb();
  const dealershipId = session.dealership.id;
  let existing = vehicleId
    ? await getVehicleById(db, dealershipId, vehicleId)
    : null;
  if (vehicleId && !existing)
    return { error: "Vehicle not found.", status: 404 };

  if (!existing) {
    // Feed rows arrive without an id, so resolve the current record first:
    // without it an import could not tell that a vehicle just went from
    // available to sold, and it would insert a duplicate.
    //
    // VIN identifies a vehicle when the feed publishes one — it survives a
    // stock number being reassigned. Stock number is the fallback.
    const probe = normalizeVehicle(body, {});
    if (probe.vin) {
      const [match] = await db.sql`
        SELECT * FROM carnova_inventory
        WHERE dealership_id = ${dealershipId}
          AND LOWER(vin) = ${probe.vin.toLowerCase()}
        LIMIT 1
      `;
      existing = match ?? null;
    }
    if (!existing && probe.stockNumber) {
      const [match] = await db.sql`
        SELECT * FROM carnova_inventory
        WHERE dealership_id = ${dealershipId}
          AND LOWER(stock_number) = ${probe.stockNumber.toLowerCase()}
        LIMIT 1
      `;
      existing = match ?? null;
    }
  }

  const targetId = existing?.id ?? null;

  // Fields NOVACARAI owns are resolved before normalizing so a feed row can
  // never carry them in by accident.
  const payload = { ...body };
  if (existing && options.preserveDateAdded)
    payload.dateAdded = existing.date_added;
  if (
    existing &&
    options.reactivateRemovedReason &&
    existing.status === "removed"
  ) {
    payload.status = "available";
    payload.statusReason = options.reactivateRemovedReason;
  }

  const vehicle = normalizeVehicle(payload, existing ?? {});
  if (
    !vehicle.stockNumber ||
    !vehicle.year ||
    !vehicle.make ||
    !vehicle.model
  ) {
    return {
      error: "Stock number, year, make, and model are required.",
      status: 400,
    };
  }

  const priorStatus = existing?.status ?? null;
  const statusChanged = Boolean(priorStatus && priorStatus !== vehicle.status);
  const soldAt =
    vehicle.status === "sold"
      ? (existing?.sold_at ?? new Date().toISOString())
      : null;

  const [saved] = targetId
    ? await db.sql`
      UPDATE carnova_inventory SET
        stock_number = ${vehicle.stockNumber}, vin = ${vehicle.vin}, year = ${vehicle.year},
        make = ${vehicle.make}, model = ${vehicle.model}, trim = ${vehicle.trim}, mileage = ${vehicle.mileage},
        price = ${vehicle.price}, internet_price = ${vehicle.internetPrice}, msrp = ${vehicle.msrp},
        vehicle_type = ${vehicle.vehicleType}, condition = ${vehicle.condition},
        exterior_color = ${vehicle.exteriorColor}, interior_color = ${vehicle.interiorColor},
        fuel_type = ${vehicle.fuelType}, drivetrain = ${vehicle.drivetrain},
        transmission = ${vehicle.transmission}, engine = ${vehicle.engine}, doors = ${vehicle.doors},
        images = ${JSON.stringify(vehicle.images)}::jsonb, features = ${JSON.stringify(vehicle.features)}::jsonb,
        description = ${vehicle.description}, status = ${vehicle.status},
        status_changed_at = ${statusChanged ? new Date().toISOString() : (existing?.status_changed_at ?? new Date().toISOString())},
        status_reason = ${vehicle.statusReason ?? existing?.status_reason ?? null},
        sold_at = ${soldAt}, location = ${vehicle.location},
        source = ${vehicle.source}, source_reference = ${vehicle.sourceReference},
        last_seen_at = NOW(), updated_at = NOW()
      WHERE id = ${targetId} AND dealership_id = ${dealershipId}
      RETURNING *
    `
    : await db.sql`
      INSERT INTO carnova_inventory (
        id, dealership_id, stock_number, vin, year, make, model, trim, mileage, price,
        internet_price, msrp, vehicle_type, condition, exterior_color, interior_color,
        fuel_type, drivetrain, transmission, engine, doors,
        images, features, description, status, status_changed_at, status_reason, sold_at,
        location, source, source_reference, date_added, last_seen_at, updated_at
      ) VALUES (
        ${crypto.randomUUID()}, ${dealershipId}, ${vehicle.stockNumber}, ${vehicle.vin}, ${vehicle.year},
        ${vehicle.make}, ${vehicle.model}, ${vehicle.trim}, ${vehicle.mileage}, ${vehicle.price},
        ${vehicle.internetPrice}, ${vehicle.msrp}, ${vehicle.vehicleType}, ${vehicle.condition},
        ${vehicle.exteriorColor}, ${vehicle.interiorColor}, ${vehicle.fuelType}, ${vehicle.drivetrain},
        ${vehicle.transmission}, ${vehicle.engine}, ${vehicle.doors},
        ${JSON.stringify(vehicle.images)}::jsonb, ${JSON.stringify(vehicle.features)}::jsonb,
        ${vehicle.description}, ${vehicle.status}, NOW(), ${vehicle.statusReason}, ${soldAt},
        ${vehicle.location}, ${vehicle.source}, ${vehicle.sourceReference},
        ${vehicle.dateAdded}, NOW(), NOW()
      ) ON CONFLICT (dealership_id, stock_number) DO UPDATE SET
        vin = EXCLUDED.vin, year = EXCLUDED.year, make = EXCLUDED.make, model = EXCLUDED.model,
        trim = EXCLUDED.trim, mileage = EXCLUDED.mileage, price = EXCLUDED.price,
        internet_price = EXCLUDED.internet_price, msrp = EXCLUDED.msrp,
        vehicle_type = EXCLUDED.vehicle_type, condition = EXCLUDED.condition,
        exterior_color = EXCLUDED.exterior_color, interior_color = EXCLUDED.interior_color,
        fuel_type = EXCLUDED.fuel_type, drivetrain = EXCLUDED.drivetrain,
        transmission = EXCLUDED.transmission, engine = EXCLUDED.engine, doors = EXCLUDED.doors,
        images = EXCLUDED.images, features = EXCLUDED.features, description = EXCLUDED.description,
        status = EXCLUDED.status,
        status_changed_at = CASE WHEN carnova_inventory.status <> EXCLUDED.status
          THEN NOW() ELSE carnova_inventory.status_changed_at END,
        sold_at = CASE WHEN EXCLUDED.status = 'sold'
          THEN COALESCE(carnova_inventory.sold_at, NOW()) ELSE NULL END,
        location = EXCLUDED.location, source = EXCLUDED.source,
        source_reference = EXCLUDED.source_reference,
        last_seen_at = NOW(), updated_at = NOW()
      RETURNING *
    `;

  if (!saved) return { error: "Vehicle could not be saved.", status: 500 };
  return { vehicle: saved, created: !targetId, priorStatus, statusChanged };
};

/**
 * When a vehicle stops being presentable, every lead and appointment attached
 * to it needs a human to intervene: TITAN must not keep offering it.
 */
const handleVehicleUnavailable = async (session, vehicle, priorStatus) => {
  const db = getDb();
  const dealershipId = session.dealership.id;
  const description = describeVehicle(vehicle);
  const [impact] = await db.sql`
    SELECT
      (SELECT COUNT(*)::int FROM carnova_crm_leads
        WHERE dealership_id = ${dealershipId} AND status NOT IN ('sold', 'lost')
          AND (inventory_id = ${vehicle.id} OR id IN (
            SELECT lead_id FROM carnova_lead_vehicles
            WHERE dealership_id = ${dealershipId} AND inventory_id = ${vehicle.id}
          ))) AS open_leads,
      (SELECT COUNT(*)::int FROM carnova_appointments
        WHERE dealership_id = ${dealershipId} AND inventory_id = ${vehicle.id}
          AND starts_at >= NOW() AND status NOT IN ('cancelled', 'no_show')) AS upcoming_appointments
  `;

  if (impact?.open_leads) {
    // One follow-up per affected lead so a person confirms alternatives.
    await db.sql`
      INSERT INTO carnova_follow_ups (
        id, dealership_id, lead_id, assigned_user_id, due_at, type, notes
      )
      SELECT gen_random_uuid()::text, ${dealershipId}, l.id,
        COALESCE(l.assigned_salesperson_id, l.assigned_bdc_agent_id, l.assigned_manager_id),
        NOW(), 'unanswered',
        ${`${description} (stock ${vehicle.stock_number}) is now ${vehicle.status}. Offer alternatives from current inventory.`}
      FROM carnova_crm_leads l
      WHERE l.dealership_id = ${dealershipId} AND l.status NOT IN ('sold', 'lost')
        AND (l.inventory_id = ${vehicle.id} OR l.id IN (
          SELECT lead_id FROM carnova_lead_vehicles
          WHERE dealership_id = ${dealershipId} AND inventory_id = ${vehicle.id}
        ))
        AND NOT EXISTS (
          SELECT 1 FROM carnova_follow_ups f
          WHERE f.dealership_id = ${dealershipId} AND f.lead_id = l.id
            AND f.type = 'unanswered' AND f.status = 'pending'
            AND f.notes LIKE ${`%stock ${vehicle.stock_number}%`}
        )
    `;
    await createAlert({
      dealershipId,
      type: "inventory_unavailable",
      severity: impact.upcoming_appointments ? "critical" : "warning",
      title: "Vehicle no longer available",
      message: `${description} (stock ${vehicle.stock_number}) changed from ${priorStatus} to ${vehicle.status} with ${impact.open_leads} open lead(s) and ${impact.upcoming_appointments} upcoming appointment(s).`,
    });
  }
  return impact ?? { open_leads: 0, upcoming_appointments: 0 };
};

const afterVehicleSaved = async (session, result) => {
  const { vehicle, created, priorStatus, statusChanged } = result;
  await createEvent({
    dealershipId: session.dealership.id,
    type: created ? "inventory.created" : "inventory.updated",
    actorUserId: session.member.id,
    payload: {
      inventoryId: vehicle.id,
      stockNumber: vehicle.stock_number,
      status: vehicle.status,
    },
  });

  let impact = null;
  if (statusChanged && priorStatus) {
    await createEvent({
      dealershipId: session.dealership.id,
      type: "inventory.status_changed",
      actorUserId: session.member.id,
      payload: {
        inventoryId: vehicle.id,
        stockNumber: vehicle.stock_number,
        from: priorStatus,
        to: vehicle.status,
      },
    });
    const wasPresentable = PRESENTABLE_STATUSES.includes(priorStatus);
    const isPresentable = PRESENTABLE_STATUSES.includes(vehicle.status);
    if (wasPresentable && !isPresentable) {
      impact = await handleVehicleUnavailable(session, vehicle, priorStatus);
    }
  }
  return impact;
};

const saveVehicle = async (session, body, vehicleId = null) => {
  if (!hasRole(session.member, ["admin", "manager"])) return forbidden();
  const result = await upsertVehicle(session, body, vehicleId);
  if (result.error) return json({ error: result.error }, result.status);
  const impact = await afterVehicleSaved(session, result);
  return json(
    { vehicle: result.vehicle, impact },
    vehicleId || !result.created ? 200 : 201,
  );
};

const updateVehicleStatus = async (session, vehicleId, body) => {
  if (!hasRole(session.member, ["admin", "manager"])) return forbidden();
  const db = getDb();
  const status = cleanText(body?.status, 40);
  if (!INVENTORY_STATUSES.includes(status))
    return json({ error: "Invalid inventory status." }, 400);
  const existing = await getVehicleById(db, session.dealership.id, vehicleId);
  if (!existing) return json({ error: "Vehicle not found." }, 404);

  const result = await upsertVehicle(
    session,
    { status, statusReason: body?.statusReason },
    vehicleId,
  );
  if (result.error) return json({ error: result.error }, result.status);
  const impact = await afterVehicleSaved(session, result);
  return json({ vehicle: result.vehicle, impact });
};

const resolveImportSource = async (session, body) => {
  const db = getDb();
  const dealershipId = session.dealership.id;
  const requestedId = cleanText(body?.sourceId, 100);
  if (requestedId) {
    const [source] = await db.sql`
      SELECT * FROM carnova_inventory_sources
      WHERE id = ${requestedId} AND dealership_id = ${dealershipId}
    `;
    if (!source) return { error: "Inventory source not found." };
    return { source };
  }
  const sourceType = INVENTORY_SOURCE_TYPES.includes(body?.sourceType)
    ? body.sourceType
    : "csv";
  const name =
    cleanText(body?.sourceName, 120) ||
    (sourceType === "csv" ? "CSV upload" : `${sourceType.toUpperCase()} feed`);
  const [source] = await db.sql`
    INSERT INTO carnova_inventory_sources (id, dealership_id, name, source_type)
    VALUES (gen_random_uuid()::text, ${dealershipId}, ${name}, ${sourceType})
    ON CONFLICT (dealership_id, name) DO UPDATE SET updated_at = NOW()
    RETURNING *
  `;
  return { source };
};

export const importInventory = async (session, body) => {
  if (!hasRole(session.member, ["admin", "manager"])) return forbidden();
  const rawVehicles = Array.isArray(body?.vehicles) ? body.vehicles : [];
  if (!rawVehicles.length)
    return json({ error: "Provide at least one vehicle to import." }, 400);

  const startedAt = new Date().toISOString();
  const { source, error: sourceError } = await resolveImportSource(
    session,
    body,
  );
  if (sourceError) return json({ error: sourceError }, 400);

  const results = [];
  let created = 0;
  let updated = 0;
  const statusChanges = [];
  for (const rawVehicle of rawVehicles.slice(0, 1000)) {
    const result = await upsertVehicle(session, {
      ...rawVehicle,
      source: source?.source_type ?? "csv",
      sourceReference: source?.id ?? null,
    });
    if (result.error) {
      results.push({
        success: false,
        error: result.error,
        stockNumber:
          rawVehicle?.stockNumber ??
          rawVehicle?.stock_number ??
          rawVehicle?.Stock ??
          null,
      });
      continue;
    }
    if (result.created) created += 1;
    else updated += 1;
    if (
      result.statusChanged &&
      result.priorStatus &&
      PRESENTABLE_STATUSES.includes(result.priorStatus) &&
      !PRESENTABLE_STATUSES.includes(result.vehicle.status)
    ) {
      statusChanges.push(result);
    }
    results.push({ success: true, vehicle: result.vehicle });
  }

  // Feed-driven removals still need human follow-up on affected leads.
  for (const change of statusChanges) {
    await handleVehicleUnavailable(session, change.vehicle, change.priorStatus);
  }

  const failed = results.filter((result) => !result.success).length;
  const status =
    failed === 0 ? "success" : created + updated ? "partial" : "failed";
  const sync = await recordInventorySync(getDb(), {
    dealershipId: session.dealership.id,
    sourceId: source?.id ?? null,
    sourceType: source?.source_type ?? "csv",
    status,
    vehiclesReceived: rawVehicles.length,
    createdCount: created,
    updatedCount: updated,
    failedCount: failed,
    message: failed
      ? `${failed} row(s) rejected during import.`
      : `${created} created, ${updated} updated.`,
    startedAt,
  });
  await createEvent({
    dealershipId: session.dealership.id,
    type: "inventory.synchronized",
    actorUserId: session.member.id,
    payload: {
      sourceId: source?.id ?? null,
      created,
      updated,
      failed,
      unavailable: statusChanges.length,
    },
  });

  return json({
    imported: created + updated,
    created,
    updated,
    failed,
    sync,
    source,
    results,
  });
};

/**
 * Resolve — creating it on the first run — the single feed record that stands
 * for CarNova.com in this dealership. Every sync attributes itself to this
 * record, so inventory freshness and any failure are always traceable to the
 * published source.
 */
const resolveCarnovaSource = async (dealershipId) => {
  const db = getDb();
  const [source] = await db.sql`
    INSERT INTO carnova_inventory_sources (
      id, dealership_id, name, source_type, provider, endpoint_url, sync_schedule
    ) VALUES (
      gen_random_uuid()::text, ${dealershipId}, ${CARNOVA_SOURCE_NAME},
      ${CARNOVA_SOURCE_TYPE}, ${CARNOVA_SOURCE_PROVIDER}, ${CARNOVA_SITE_URL}, 'manual'
    ) ON CONFLICT (dealership_id, name) DO UPDATE SET
      source_type = EXCLUDED.source_type, provider = EXCLUDED.provider,
      endpoint_url = EXCLUDED.endpoint_url, updated_at = NOW()
    RETURNING *
  `;
  return source ?? null;
};

/**
 * Vehicles this source previously supplied that the current run did not see
 * are no longer published on CarNova.com. They are marked removed and kept:
 * the record, its leads, its appointments and its history all survive.
 *
 * Only presentable vehicles are touched. A vehicle the dealership has already
 * marked sold, reserved or transferred keeps that status, because those are
 * NOVACARAI's own facts and the published listing does not control them.
 */
const deactivateUnlistedCarnovaVehicles = async (
  dealershipId,
  sourceId,
  seenSince,
) => {
  const db = getDb();
  return db.sql`
    UPDATE carnova_inventory SET
      status = 'removed',
      status_changed_at = NOW(),
      status_reason = ${CARNOVA_REMOVED_REASON},
      updated_at = NOW()
    WHERE dealership_id = ${dealershipId}
      AND source_reference = ${sourceId}
      AND status = ANY(${PRESENTABLE_STATUSES}::text[])
      AND (last_seen_at IS NULL OR last_seen_at < ${seenSince})
    RETURNING *
  `;
};

/**
 * Import the inventory currently published on CarNova.com into this
 * dealership.
 *
 * The run is idempotent: vehicles are matched by VIN, or by stock number when
 * the listing has no VIN, so repeating it updates rather than duplicates.
 * Fields the published listing controls are refreshed, fields NOVACARAI owns
 * (availability, MSRP, lot location, and every lead, appointment and message
 * relationship) are left untouched, and vehicles that have dropped off the
 * site are marked removed rather than deleted.
 */
const syncCarnovaInventory = async (session) => {
  if (!hasRole(session.member, ["admin", "manager"])) return forbidden();
  if (!session.dealership.carnovaFeedEnabled)
    return json(
      {
        error:
          "The CarNova.com feed is available only to the CarNova dealership workspace.",
      },
      403,
    );
  const db = getDb();
  const dealershipId = session.dealership.id;
  const startedAt = new Date().toISOString();
  const source = await resolveCarnovaSource(dealershipId);
  if (!source)
    return json({ error: "Could not open the CarNova.com feed record." }, 500);

  // Read the published listings before writing anything. If CarNova.com cannot
  // be reached the failure is recorded and inventory is left exactly as it was.
  let listings;
  try {
    listings = await fetchCarnovaListings();
  } catch (caught) {
    const message = `CarNova.com inventory could not be read: ${caught.message}`;
    const sync = await recordInventorySync(db, {
      dealershipId,
      sourceId: source.id,
      sourceType: source.source_type,
      status: "failed",
      message: message.slice(0, 500),
      startedAt,
    });
    return json({ error: message, sync, source }, 502);
  }

  const { vehicles, skipped } = mapCarnovaListings(listings);
  if (!vehicles.length) {
    // An empty read is far more likely to be a broken feed than a dealership
    // with no cars, so nothing is deactivated on the strength of it.
    const message =
      "CarNova.com returned no usable vehicle listings, so inventory was left unchanged.";
    const sync = await recordInventorySync(db, {
      dealershipId,
      sourceId: source.id,
      sourceType: source.source_type,
      status: "failed",
      vehiclesReceived: listings.length,
      failedCount: skipped.length,
      message,
      startedAt,
    });
    return json({ error: message, sync, source, skipped }, 502);
  }

  const failures = skipped.map((entry) => ({
    stockNumber: entry.stockNumber,
    vin: entry.vin,
    error: entry.reason,
  }));
  let created = 0;
  let updated = 0;
  const statusChanges = [];

  for (const vehicle of vehicles) {
    // listingUrl is published information the inventory schema has no column
    // for, so it is not written; the rest of the mapped listing is.
    const { listingUrl, ...fields } = vehicle;
    const result = await upsertVehicle(
      session,
      {
        ...fields,
        source: source.source_type,
        sourceReference: source.id,
      },
      null,
      {
        preserveDateAdded: true,
        reactivateRemovedReason: CARNOVA_RELISTED_REASON,
      },
    );
    if (result.error) {
      failures.push({
        stockNumber: vehicle.stockNumber,
        vin: vehicle.vin,
        error: result.error,
      });
      continue;
    }
    if (result.created) created += 1;
    else updated += 1;
    if (
      result.statusChanged &&
      result.priorStatus &&
      PRESENTABLE_STATUSES.includes(result.priorStatus) &&
      !PRESENTABLE_STATUSES.includes(result.vehicle.status)
    ) {
      statusChanges.push(result);
    }
  }

  // Only deactivate once vehicles were actually written, so a run that failed
  // wholesale can never empty the lot.
  const removed =
    created + updated > 0
      ? await deactivateUnlistedCarnovaVehicles(
          dealershipId,
          source.id,
          startedAt,
        )
      : [];

  // A vehicle that stops being presentable needs a human on its open leads,
  // whether the feed changed its status or dropped it entirely.
  for (const change of statusChanges)
    await handleVehicleUnavailable(session, change.vehicle, change.priorStatus);
  for (const vehicle of removed)
    await handleVehicleUnavailable(session, vehicle, "available");

  const status = failures.length
    ? created + updated
      ? "partial"
      : "failed"
    : "success";
  const summary = [
    `${created} added`,
    `${updated} updated`,
    `${removed.length} no longer listed`,
  ];
  if (failures.length) summary.push(`${failures.length} could not be imported`);

  const sync = await recordInventorySync(db, {
    dealershipId,
    sourceId: source.id,
    sourceType: source.source_type,
    status,
    vehiclesReceived: vehicles.length,
    createdCount: created,
    updatedCount: updated,
    failedCount: failures.length,
    message: summary.join(", ").slice(0, 500),
    startedAt,
  });
  await createEvent({
    dealershipId,
    type: "inventory.synchronized",
    actorUserId: session.member.id,
    payload: {
      sourceId: source.id,
      provider: CARNOVA_SOURCE_PROVIDER,
      received: vehicles.length,
      created,
      updated,
      removed: removed.length,
      failed: failures.length,
    },
  });

  const [freshness, syncs] = await Promise.all([
    getInventoryFreshness(db, dealershipId),
    listInventorySyncs(db, dealershipId, 10),
  ]);

  return json({
    received: vehicles.length,
    imported: created + updated,
    created,
    updated,
    removed: removed.length,
    failed: failures.length,
    failures: failures.slice(0, 25),
    sync,
    syncs,
    source,
    freshness,
  });
};

const listInventorySourcesRoute = async (session) => {
  const db = getDb();
  const [sources, syncs, freshness] = await Promise.all([
    listInventorySources(db, session.dealership.id),
    listInventorySyncs(db, session.dealership.id, 10),
    getInventoryFreshness(db, session.dealership.id),
  ]);
  return json({ sources, syncs, freshness });
};

const saveInventorySource = async (session, body, sourceId = null) => {
  if (!hasRole(session.member, ["admin", "manager"])) return forbidden();
  const db = getDb();
  const dealershipId = session.dealership.id;
  const name = cleanText(body?.name, 120);
  const sourceType = INVENTORY_SOURCE_TYPES.includes(body?.sourceType)
    ? body.sourceType
    : "csv";
  const schedule = SYNC_SCHEDULES.includes(body?.syncSchedule)
    ? body.syncSchedule
    : "manual";
  const staleAfterHours = Math.max(
    1,
    Math.min(168, cleanNumber(body?.staleAfterHours) ?? 24),
  );

  if (sourceId) {
    const [existing] = await db.sql`
      SELECT * FROM carnova_inventory_sources
      WHERE id = ${sourceId} AND dealership_id = ${dealershipId}
    `;
    if (!existing) return json({ error: "Inventory source not found." }, 404);
    const [source] = await db.sql`
      UPDATE carnova_inventory_sources SET
        name = ${name || existing.name}, source_type = ${body?.sourceType === undefined ? existing.source_type : sourceType},
        provider = ${body?.provider === undefined ? existing.provider : cleanText(body.provider, 120) || null},
        endpoint_url = ${body?.endpointUrl === undefined ? existing.endpoint_url : cleanText(body.endpointUrl, 500) || null},
        sync_schedule = ${body?.syncSchedule === undefined ? existing.sync_schedule : schedule},
        enabled = ${body?.enabled === undefined ? existing.enabled : Boolean(body.enabled)},
        stale_after_hours = ${body?.staleAfterHours === undefined ? existing.stale_after_hours : staleAfterHours},
        updated_at = NOW()
      WHERE id = ${sourceId} AND dealership_id = ${dealershipId}
      RETURNING *
    `;
    return json({ source });
  }

  if (!name) return json({ error: "Source name is required." }, 400);
  const [source] = await db.sql`
    INSERT INTO carnova_inventory_sources (
      id, dealership_id, name, source_type, provider, endpoint_url, sync_schedule,
      enabled, stale_after_hours
    ) VALUES (
      gen_random_uuid()::text, ${dealershipId}, ${name}, ${sourceType},
      ${cleanText(body?.provider, 120) || null}, ${cleanText(body?.endpointUrl, 500) || null},
      ${schedule}, ${body?.enabled === false ? false : true}, ${staleAfterHours}
    ) ON CONFLICT (dealership_id, name) DO UPDATE SET
      source_type = EXCLUDED.source_type, provider = EXCLUDED.provider,
      endpoint_url = EXCLUDED.endpoint_url, sync_schedule = EXCLUDED.sync_schedule,
      enabled = EXCLUDED.enabled, stale_after_hours = EXCLUDED.stale_after_hours,
      updated_at = NOW()
    RETURNING *
  `;
  return json({ source }, 201);
};

// Seeds a realistic, clearly-labelled test set so a dealership workspace can
// be verified end to end before a real feed is connected.
const seedTestInventory = async (session) => {
  if (!hasRole(session.member, ["admin", "manager"])) return forbidden();
  const results = [];
  for (const vehicle of TEST_INVENTORY) {
    const result = await upsertVehicle(session, {
      ...vehicle,
      source: "manual",
    });
    if (!result.error) results.push(result.vehicle);
  }
  await recordInventorySync(getDb(), {
    dealershipId: session.dealership.id,
    sourceType: "manual",
    status: "success",
    vehiclesReceived: TEST_INVENTORY.length,
    createdCount: results.length,
    message: "Test inventory seeded.",
  });
  await createEvent({
    dealershipId: session.dealership.id,
    type: "inventory.synchronized",
    actorUserId: session.member.id,
    payload: { seeded: results.length, source: "test_inventory" },
  });
  return json({ seeded: results.length, inventory: results });
};

const listLeadVehicles = async (session, leadId) => {
  if (!(await getLeadFor(session, leadId)))
    return json({ error: "Lead not found." }, 404);
  const vehicles = await getLeadVehicles(
    getDb(),
    session.dealership.id,
    leadId,
  );
  return json({ vehicles });
};

const attachLeadVehicle = async (session, body) => {
  const db = getDb();
  const dealershipId = session.dealership.id;
  const leadId = cleanText(body?.leadId, 100);
  const inventoryId = cleanText(body?.inventoryId, 100);
  const lead = await getLeadFor(session, leadId);
  if (!lead) return json({ error: "Lead not found." }, 404);
  const vehicle = await getVehicleById(db, dealershipId, inventoryId);
  if (!vehicle)
    return json(
      { error: "Selected inventory does not belong to this dealership." },
      400,
    );

  const interestLevel = [
    "primary",
    "interested",
    "alternative",
    "declined",
  ].includes(body?.interestLevel)
    ? body.interestLevel
    : "interested";
  const record = await recordVehicleInterest(db, {
    dealershipId,
    leadId,
    vehicle,
    interestLevel,
    capturedBy: "user",
    notes: cleanText(body?.notes, 500) || null,
  });

  if (interestLevel === "primary") {
    await db.sql`
      UPDATE carnova_lead_vehicles SET interest_level = 'interested'
      WHERE dealership_id = ${dealershipId} AND lead_id = ${leadId}
        AND inventory_id <> ${inventoryId} AND interest_level = 'primary'
    `;
    await db.sql`
      UPDATE carnova_crm_leads SET
        inventory_id = ${inventoryId},
        vehicle_interest = COALESCE(NULLIF(${cleanText(body?.vehicleInterest, 300)}, ''), ${describeVehicle(vehicle)}),
        vehicle_snapshot = ${JSON.stringify(vehicleSnapshot(vehicle))}::jsonb,
        updated_at = NOW()
      WHERE id = ${leadId} AND dealership_id = ${dealershipId}
    `;
  }
  await createEvent({
    dealershipId,
    leadId,
    type: "lead.vehicle_attached",
    actorUserId: session.member.id,
    payload: {
      inventoryId,
      stockNumber: vehicle.stock_number,
      interestLevel,
    },
  });
  return json({ vehicle: record }, 201);
};

const detachLeadVehicle = async (session, url) => {
  const db = getDb();
  const dealershipId = session.dealership.id;
  const leadId = cleanText(url.searchParams.get("leadId"), 100);
  const inventoryId = cleanText(url.searchParams.get("inventoryId"), 100);
  if (!(await getLeadFor(session, leadId)))
    return json({ error: "Lead not found." }, 404);
  await removeVehicleInterest(db, dealershipId, leadId, inventoryId);
  await db.sql`
    UPDATE carnova_crm_leads SET inventory_id = NULL, vehicle_snapshot = '{}'::jsonb, updated_at = NOW()
    WHERE id = ${leadId} AND dealership_id = ${dealershipId} AND inventory_id = ${inventoryId}
  `;
  await createEvent({
    dealershipId,
    leadId,
    type: "lead.vehicle_detached",
    actorUserId: session.member.id,
    payload: { inventoryId },
  });
  return json({ success: true });
};

const listAppointments = async (session, url) => {
  const db = getDb();
  const from =
    url.searchParams.get("from") ||
    new Date(Date.now() - 86400000).toISOString();
  const to =
    url.searchParams.get("to") ||
    new Date(Date.now() + 30 * 86400000).toISOString();
  const appointments = await db.sql`
    SELECT a.*, l.name AS lead_name, l.phone AS lead_phone, l.email AS lead_email,
      l.vehicle_interest, u.name AS salesperson_name,
      i.stock_number, i.year AS inventory_year, i.make AS inventory_make, i.model AS inventory_model,
      i.trim AS inventory_trim, i.status AS inventory_status, i.exterior_color AS inventory_exterior_color
    FROM carnova_appointments a
    JOIN carnova_crm_leads l ON l.id = a.lead_id AND l.dealership_id = a.dealership_id
    LEFT JOIN carnova_users u ON u.id = a.salesperson_id AND u.dealership_id = a.dealership_id
    LEFT JOIN carnova_inventory i ON i.id = a.inventory_id AND i.dealership_id = a.dealership_id
    WHERE a.dealership_id = ${session.dealership.id}
      AND a.starts_at >= ${from}::timestamptz AND a.starts_at <= ${to}::timestamptz
    ORDER BY a.starts_at
  `;
  return json({ appointments });
};

// Staff enter appointment times in the dealership's local time, whatever the
// browser's timezone is.
const dealershipDateTimeToIso = (session, body) =>
  body?.date && body?.time
    ? zonedTimeToUtc(body.date, body.time, session.dealership.timezone)?.toISOString() ?? null
    : localDateTimeToIso(body?.date, body?.time, body?.offsetMinutes);

const createAppointment = async (session, body) => {
  const db = getDb();
  const leadId = cleanText(body?.leadId, 100);
  const lead = await getLeadFor(session, leadId);
  if (!lead) return json({ error: "Lead not found." }, 404);
  const startsAt = body?.startsAt || dealershipDateTimeToIso(session, body);
  const durationMinutes = Math.max(
    15,
    Math.min(180, Number(body?.durationMinutes) || 30),
  );
  if (!startsAt || Number.isNaN(new Date(startsAt).getTime()))
    return json(
      { error: "A valid appointment date and time are required." },
      400,
    );
  const endsAt = new Date(
    new Date(startsAt).getTime() + durationMinutes * 60000,
  ).toISOString();
  const hoursError = businessHoursError(session.dealership, startsAt, endsAt);
  if (hoursError) return json({ error: hoursError }, 400);
  const salespersonId =
    cleanText(body?.salespersonId, 100) || lead.assigned_salesperson_id || null;
  const inventoryId =
    cleanText(body?.inventoryId, 100) || lead.inventory_id || null;
  const referenceError = await validateTenantReferences(session.dealership.id, {
    inventoryId,
    userIds: [salespersonId],
  });
  if (referenceError) return json({ error: referenceError }, 400);
  const appointmentType = [
    "showroom",
    "test_drive",
    "trade_appraisal",
    "delivery",
    "finance",
  ].includes(body?.appointmentType)
    ? body.appointmentType
    : "showroom";

  const [conflict] = salespersonId
    ? await db.sql`
        SELECT id FROM carnova_appointments
        WHERE dealership_id = ${session.dealership.id} AND salesperson_id = ${salespersonId}
          AND status NOT IN ('cancelled', 'no_show')
          AND starts_at < ${endsAt}::timestamptz AND ends_at > ${startsAt}::timestamptz
        LIMIT 1
      `
    : [];
  if (conflict)
    return json(
      { error: "That salesperson is already booked during this time." },
      409,
    );

  const id = crypto.randomUUID();
  const status = APPOINTMENT_STATUSES.includes(body?.status)
    ? body.status
    : "scheduled";
  const [appointment] = await db.sql`
    INSERT INTO carnova_appointments (
      id, dealership_id, lead_id, inventory_id, salesperson_id, appointment_type,
      starts_at, ends_at, status, confirmation_notes
    ) VALUES (
      ${id}, ${session.dealership.id}, ${leadId}, ${inventoryId},
      ${salespersonId}, ${appointmentType}, ${startsAt}, ${endsAt}, ${status}, ${cleanText(body?.notes, 2000) || null}
    ) RETURNING *
  `;
  const appointmentVehicle = await syncAppointmentVehicle(session, appointment);
  await db.sql`
    UPDATE carnova_crm_leads
    SET status = ${status === "confirmed" ? "appointment_confirmed" : "appointment_set"},
      assigned_salesperson_id = COALESCE(${salespersonId}, assigned_salesperson_id), updated_at = NOW()
    WHERE id = ${leadId} AND dealership_id = ${session.dealership.id}
  `;
  await createEvent({
    dealershipId: session.dealership.id,
    leadId,
    type: "appointment.created",
    actorUserId: session.member.id,
    payload: { appointmentId: id, startsAt, status },
  });
  // Confirmation text to the customer, salesperson notification, and the
  // follow-up sequence stops now that the lead is booked.
  await afterAppointmentBooked({
    dealership: session.dealership,
    lead,
    appointment,
  });
  // A salesperson can still book a reserved or sold car deliberately, but the
  // booking must say so rather than imply the vehicle is available.
  const vehicleWarning =
    appointmentVehicle &&
    !PRESENTABLE_STATUSES.includes(appointmentVehicle.vehicle.status)
      ? `${describeVehicle(appointmentVehicle.vehicle)} (stock ${appointmentVehicle.vehicle.stock_number}) is currently ${appointmentVehicle.vehicle.status}.`
      : null;
  return json({ appointment, vehicleWarning }, 201);
};

const updateAppointment = async (session, appointmentId, body) => {
  const db = getDb();
  const [existing] =
    await db.sql`SELECT * FROM carnova_appointments WHERE id = ${appointmentId} AND dealership_id = ${session.dealership.id}`;
  if (!existing) return json({ error: "Appointment not found." }, 404);
  const status = body?.status ?? existing.status;
  if (!APPOINTMENT_STATUSES.includes(status))
    return json({ error: "Invalid appointment status." }, 400);
  const startsAt =
    body?.startsAt ||
    (body?.date && body?.time
      ? dealershipDateTimeToIso(session, body)
      : existing.starts_at);
  if (!startsAt || Number.isNaN(new Date(startsAt).getTime()))
    return json({ error: "A valid appointment date and time are required." }, 400);
  const duration =
    new Date(existing.ends_at).getTime() -
    new Date(existing.starts_at).getTime();
  const endsAt =
    body?.startsAt || (body?.date && body?.time)
      ? new Date(new Date(startsAt).getTime() + duration).toISOString()
      : existing.ends_at;
  const salespersonId =
    body?.salespersonId === undefined
      ? existing.salesperson_id
      : cleanText(body.salespersonId, 100) || null;
  const inventoryId =
    body?.inventoryId === undefined
      ? existing.inventory_id
      : cleanText(body.inventoryId, 100) || null;
  const referenceError = await validateTenantReferences(session.dealership.id, {
    inventoryId: inventoryId === existing.inventory_id ? null : inventoryId,
    userIds: [salespersonId],
  });
  if (referenceError) return json({ error: referenceError }, 400);

  const rescheduled =
    new Date(startsAt).getTime() !== new Date(existing.starts_at).getTime();
  if (rescheduled && !["cancelled", "no_show"].includes(status)) {
    const hoursError = businessHoursError(session.dealership, startsAt, endsAt);
    if (hoursError) return json({ error: hoursError }, 400);
  }

  if (!["cancelled", "no_show"].includes(status) && salespersonId) {
    const [conflict] = await db.sql`
      SELECT id FROM carnova_appointments
      WHERE dealership_id = ${session.dealership.id} AND salesperson_id = ${salespersonId}
        AND id <> ${appointmentId} AND status NOT IN ('cancelled', 'no_show')
        AND starts_at < ${endsAt}::timestamptz AND ends_at > ${startsAt}::timestamptz
      LIMIT 1
    `;
    if (conflict)
      return json(
        { error: "That salesperson is already booked during this time." },
        409,
      );
  }

  const [appointment] = await db.sql`
    UPDATE carnova_appointments SET
      starts_at = ${startsAt}, ends_at = ${endsAt}, salesperson_id = ${salespersonId},
      inventory_id = ${inventoryId},
      status = ${status}, appointment_type = ${body?.appointmentType ?? existing.appointment_type},
      confirmation_notes = ${body?.notes === undefined ? existing.confirmation_notes : cleanText(body.notes, 2000) || null},
      cancellation_reason = ${body?.cancellationReason === undefined ? existing.cancellation_reason : cleanText(body.cancellationReason, 1000) || null},
      reminder_day_before_sent_at = CASE WHEN ${rescheduled} THEN NULL ELSE reminder_day_before_sent_at END,
      reminder_morning_sent_at = CASE WHEN ${rescheduled} THEN NULL ELSE reminder_morning_sent_at END,
      no_show_sent_at = CASE WHEN ${rescheduled} THEN NULL ELSE no_show_sent_at END,
      confirmation_sent_at = CASE WHEN ${rescheduled} THEN NULL ELSE confirmation_sent_at END,
      updated_at = NOW()
    WHERE id = ${appointmentId} AND dealership_id = ${session.dealership.id}
    RETURNING *
  `;
  if (existing.inventory_id !== inventoryId)
    await syncAppointmentVehicle(session, appointment);
  if (rescheduled && !["cancelled", "no_show"].includes(status)) {
    const lead = await getLeadFor(session, existing.lead_id);
    if (lead)
      await afterAppointmentBooked({ dealership: session.dealership, lead, appointment });
  }
  const leadStatus =
    status === "confirmed"
      ? "appointment_confirmed"
      : status === "showed"
        ? "showed"
        : null;
  if (leadStatus)
    await db.sql`UPDATE carnova_crm_leads SET status = ${leadStatus}, updated_at = NOW() WHERE id = ${existing.lead_id} AND dealership_id = ${session.dealership.id}`;
  if (status === "no_show") {
    await db.sql`
      INSERT INTO carnova_follow_ups (id, dealership_id, lead_id, assigned_user_id, due_at, type, notes)
      SELECT ${crypto.randomUUID()}, ${session.dealership.id}, ${existing.lead_id},
        COALESCE(${salespersonId}, assigned_bdc_agent_id), NOW() + INTERVAL '15 minutes', 'no_show',
        'Follow up after missed appointment.'
      FROM carnova_crm_leads
      WHERE id = ${existing.lead_id} AND dealership_id = ${session.dealership.id}
        AND NOT EXISTS (
          SELECT 1 FROM carnova_follow_ups WHERE dealership_id = ${session.dealership.id}
            AND lead_id = ${existing.lead_id} AND type = 'no_show' AND status = 'pending'
        )
    `;
  }
  await createEvent({
    dealershipId: session.dealership.id,
    leadId: existing.lead_id,
    type: `appointment.${status}`,
    actorUserId: session.member.id,
    payload: { appointmentId, startsAt },
  });
  return json({ appointment });
};

const dashboard = async (session) => {
  const db = getDb();
  const [metrics] = await db.sql`
    SELECT
      COUNT(*) FILTER (WHERE created_at >= DATE_TRUNC('day', NOW()))::int AS new_leads,
      COUNT(*) FILTER (WHERE status IN ('new','contacted','engaged','qualified','appointment_set','appointment_confirmed'))::int AS active_conversations,
      COUNT(*) FILTER (WHERE status IN ('appointment_set','appointment_confirmed','showed','sold'))::int AS appointments_set,
      COUNT(*) FILTER (WHERE status = 'sold')::int AS sold_leads,
      COUNT(*) FILTER (WHERE temperature = 'hot' AND status NOT IN ('sold','lost'))::int AS hot_leads,
      COUNT(*) FILTER (WHERE next_follow_up_at IS NOT NULL AND next_follow_up_at <= NOW() AND status NOT IN ('sold','lost'))::int AS needs_follow_up,
      COUNT(*) FILTER (WHERE human_handoff_required = TRUE)::int AS handoffs,
      COUNT(*)::int AS total_leads
    FROM carnova_crm_leads WHERE dealership_id = ${session.dealership.id}
  `;
  const [appointmentMetrics] = await db.sql`
    SELECT
      COUNT(*) FILTER (WHERE starts_at >= DATE_TRUNC('day', NOW()) AND starts_at < DATE_TRUNC('day', NOW()) + INTERVAL '1 day' AND status NOT IN ('cancelled','no_show'))::int AS appointments_today,
      COUNT(*) FILTER (WHERE starts_at > NOW() AND status NOT IN ('cancelled','no_show'))::int AS appointments_upcoming,
      COUNT(*) FILTER (WHERE status = 'showed')::int AS showed,
      COUNT(*) FILTER (WHERE starts_at < NOW() AND status IN ('showed','no_show'))::int AS completed_appointments
    FROM carnova_appointments WHERE dealership_id = ${session.dealership.id}
  `;
  const [inventoryMetrics] = await db.sql`
    SELECT
      COUNT(*)::int AS inventory_total,
      COUNT(*) FILTER (WHERE status = ANY(${PRESENTABLE_STATUSES}::text[]))::int AS inventory_available,
      COUNT(*) FILTER (WHERE status = 'sold')::int AS inventory_sold,
      COUNT(*) FILTER (WHERE status = 'reserved')::int AS inventory_reserved
    FROM carnova_inventory WHERE dealership_id = ${session.dealership.id}
  `;
  const inventoryFreshness = await getInventoryFreshness(
    db,
    session.dealership.id,
  );
  const showRate = appointmentMetrics.completed_appointments
    ? Math.round(
        (appointmentMetrics.showed /
          appointmentMetrics.completed_appointments) *
          1000,
      ) / 10
    : 0;
  const conversionRate = metrics.total_leads
    ? Math.round((metrics.sold_leads / metrics.total_leads) * 1000) / 10
    : 0;
  return json({
    metrics: {
      ...metrics,
      ...appointmentMetrics,
      ...inventoryMetrics,
      show_rate: showRate,
      conversion_rate: conversionRate,
    },
    // "Last inventory sync" is a first-class dashboard signal: TITAN's answers
    // are only as trustworthy as the feed behind them.
    inventoryFreshness,
  });
};

const listTeam = async (session) => {
  const db = getDb();
  const team = await db.sql`
    SELECT id, name, email, phone, role, active, created_at, updated_at
    FROM carnova_users WHERE dealership_id = ${session.dealership.id}
    ORDER BY active DESC, role, name
  `;
  return json({ team });
};

const saveTeamMember = async (session, body, memberId = null) => {
  if (!hasRole(session.member, ["admin", "manager"])) return forbidden();
  const db = getDb();
  const role = USER_ROLES.includes(body?.role) ? body.role : "salesperson";
  const name = cleanText(body?.name, 160);
  const email = cleanText(body?.email, 320);
  if (!name || !email)
    return json({ error: "Name and email are required." }, 400);
  const id = memberId || crypto.randomUUID();
  // Only admins can create, edit, or promote to admin; otherwise a manager
  // could promote themselves or disable the dealership owner.
  const isAdmin = hasRole(session.member, ["admin"]);
  const [target] = memberId
    ? await db.sql`
        SELECT role, active FROM carnova_users
        WHERE id = ${memberId} AND dealership_id = ${session.dealership.id}
      `
    : await db.sql`
        SELECT role, active FROM carnova_users
        WHERE dealership_id = ${session.dealership.id} AND LOWER(email) = ${email.toLowerCase()}
      `;
  if (memberId && !target)
    return json({ error: "Team member not found." }, 404);
  if (!isAdmin && (ADMIN_TIER.includes(role) || ADMIN_TIER.includes(target?.role)))
    return json(
      { error: "Only an administrator can add or change administrators." },
      403,
    );
  if (
    (role === "owner" || target?.role === "owner") &&
    session.member.role !== "owner" &&
    !session.platformAdmin
  )
    return json({ error: "Only an owner can add or change owners." }, 403);
  if (
    ADMIN_TIER.includes(target?.role) &&
    target.active &&
    (!ADMIN_TIER.includes(role) || body?.active === false)
  ) {
    const [{ admins }] = await db.sql`
      SELECT COUNT(*)::int AS admins FROM carnova_users
      WHERE dealership_id = ${session.dealership.id} AND role IN ('owner', 'admin') AND active = TRUE
    `;
    if (admins <= 1)
      return json(
        { error: "A dealership must keep at least one active administrator." },
        409,
      );
  }
  const [member] = memberId
    ? await db.sql`
      UPDATE carnova_users SET name = ${name}, email = ${email}, phone = ${cleanText(body?.phone, 80) || null},
        role = ${role}, active = ${body?.active !== false}, updated_at = NOW()
      WHERE id = ${memberId} AND dealership_id = ${session.dealership.id}
      RETURNING id, name, email, phone, role, active, created_at, updated_at
    `
    : await db.sql`
    INSERT INTO carnova_users (id, dealership_id, name, email, phone, role, active)
    VALUES (${id}, ${session.dealership.id}, ${name}, ${email}, ${cleanText(body?.phone, 80) || null}, ${role}, ${body?.active !== false})
    ON CONFLICT (dealership_id, email) DO UPDATE SET
      name = EXCLUDED.name, phone = EXCLUDED.phone, role = EXCLUDED.role,
      active = EXCLUDED.active, updated_at = NOW()
    RETURNING id, name, email, phone, role, active, created_at, updated_at
  `;
  await createEvent({
    dealershipId: session.dealership.id,
    type: memberId ? "team.updated" : "team.created",
    actorUserId: session.member.id,
    payload: { memberId: member.id, role },
  });
  return json({ member }, memberId ? 200 : 201);
};

const deleteTeamMember = async (session, memberId) => {
  if (!hasRole(session.member, ["admin", "manager"])) return forbidden();
  const db = getDb();
  const [target] = await db.sql`
    SELECT id, name, role, active FROM carnova_users
    WHERE id = ${memberId} AND dealership_id = ${session.dealership.id}
  `;
  if (!target) return json({ error: "Team member not found." }, 404);
  if (target.id === session.member.id)
    return json({ error: "You cannot delete your own account." }, 409);
  if (ADMIN_TIER.includes(target.role) && !hasRole(session.member, ["admin"]))
    return json(
      { error: "Only an administrator can delete an administrator." },
      403,
    );
  if (ADMIN_TIER.includes(target.role) && target.active) {
    const [{ admins }] = await db.sql`
      SELECT COUNT(*)::int AS admins FROM carnova_users
      WHERE dealership_id = ${session.dealership.id} AND role IN ('owner', 'admin') AND active = TRUE
    `;
    if (admins <= 1)
      return json(
        { error: "A dealership must keep at least one active administrator." },
        409,
      );
  }
  await createEvent({
    dealershipId: session.dealership.id,
    type: "team.deleted",
    actorUserId: session.member.id,
    payload: { memberId: target.id, name: target.name, role: target.role },
  });
  await db.sql`DELETE FROM carnova_users WHERE id = ${memberId} AND dealership_id = ${session.dealership.id}`;
  return json({ deleted: true });
};

const listFollowUps = async (session) => {
  const db = getDb();
  const followUps = await db.sql`
    SELECT f.*, l.name AS lead_name, l.phone AS lead_phone, l.vehicle_interest, u.name AS assigned_user_name
    FROM carnova_follow_ups f
    JOIN carnova_crm_leads l ON l.id = f.lead_id AND l.dealership_id = f.dealership_id
    LEFT JOIN carnova_users u ON u.id = f.assigned_user_id AND u.dealership_id = f.dealership_id
    WHERE f.dealership_id = ${session.dealership.id}
    ORDER BY f.status = 'pending' DESC, f.due_at
    LIMIT 250
  `;
  return json({ followUps });
};

const saveFollowUp = async (session, body, followUpId = null) => {
  const db = getDb();
  if (followUpId) {
    const status = ["pending", "completed", "cancelled"].includes(body?.status)
      ? body.status
      : "completed";
    const [followUp] = await db.sql`
      UPDATE carnova_follow_ups SET status = ${status}, notes = COALESCE(${cleanText(body?.notes, 2000) || null}, notes),
        completed_at = ${status === "completed" ? new Date().toISOString() : null}, updated_at = NOW()
      WHERE id = ${followUpId} AND dealership_id = ${session.dealership.id}
      RETURNING *
    `;
    if (!followUp) return json({ error: "Follow-up not found." }, 404);
    await createEvent({
      dealershipId: session.dealership.id,
      leadId: followUp.lead_id,
      type: `follow_up.${status}`,
      actorUserId: session.member.id,
      payload: { followUpId },
    });
    return json({ followUp });
  }

  const leadId = cleanText(body?.leadId, 100);
  if (!(await getLeadFor(session, leadId)))
    return json({ error: "Lead not found." }, 404);
  const assignedUserId =
    cleanText(body?.assignedUserId, 100) || session.member.id;
  const referenceError = await validateTenantReferences(session.dealership.id, {
    userIds: [assignedUserId],
  });
  if (referenceError) return json({ error: referenceError }, 400);
  const type = [
    "call",
    "text",
    "email",
    "appointment_reminder",
    "no_show",
    "hot_lead",
    "human_handoff",
    "unanswered",
  ].includes(body?.type)
    ? body.type
    : "call";
  if (!body?.dueAt)
    return json({ error: "Follow-up due time is required." }, 400);
  const [followUp] = await db.sql`
    INSERT INTO carnova_follow_ups (id, dealership_id, lead_id, assigned_user_id, due_at, type, notes)
    VALUES (${crypto.randomUUID()}, ${session.dealership.id}, ${leadId}, ${assignedUserId}, ${body.dueAt}, ${type}, ${cleanText(body?.notes, 2000) || null})
    RETURNING *
  `;
  await db.sql`UPDATE carnova_crm_leads SET next_follow_up_at = ${body.dueAt}, updated_at = NOW() WHERE id = ${leadId} AND dealership_id = ${session.dealership.id}`;
  await createEvent({
    dealershipId: session.dealership.id,
    leadId,
    type: "follow_up.created",
    actorUserId: session.member.id,
    payload: { followUpId: followUp.id, dueAt: body.dueAt, type },
  });
  return json({ followUp }, 201);
};

const listAlerts = async (session) => {
  const db = getDb();
  const alerts = await db.sql`
    SELECT a.*, l.name AS lead_name, l.phone AS lead_phone, l.vehicle_interest
    FROM carnova_alerts a
    LEFT JOIN carnova_crm_leads l ON l.id = a.lead_id AND l.dealership_id = a.dealership_id
    WHERE a.dealership_id = ${session.dealership.id}
    ORDER BY a.acknowledged, a.created_at DESC LIMIT 250
  `;
  return json({ alerts });
};

const acknowledgeAlert = async (session, alertId) => {
  const db = getDb();
  const [alert] = await db.sql`
    UPDATE carnova_alerts SET acknowledged = TRUE, acknowledged_by = ${session.member.id}, acknowledged_at = NOW()
    WHERE id = ${alertId} AND dealership_id = ${session.dealership.id}
    RETURNING *
  `;
  return alert ? json({ alert }) : json({ error: "Alert not found." }, 404);
};

const listAutomations = async (session) => {
  const db = getDb();
  const rules =
    await db.sql`SELECT * FROM carnova_automation_rules WHERE dealership_id = ${session.dealership.id} ORDER BY event_type`;
  return json({
    rules,
    delivery: {
      inApp: true,
      webhook: Boolean(process.env.CRM_AUTOMATION_WEBHOOK_URL),
      sms: false,
      email: false,
    },
  });
};

const updateAutomation = async (session, ruleId, body) => {
  if (!hasRole(session.member, ["admin", "manager"])) return forbidden();
  const db = getDb();
  const [rule] = await db.sql`
    UPDATE carnova_automation_rules SET enabled = ${Boolean(body?.enabled)},
      delay_minutes = COALESCE(${cleanNumber(body?.delayMinutes)}, delay_minutes), updated_at = NOW()
    WHERE id = ${ruleId} AND dealership_id = ${session.dealership.id}
    RETURNING *
  `;
  return rule
    ? json({ rule })
    : json({ error: "Automation rule not found." }, 404);
};

const getSettings = (session) =>
  json({ dealership: session.dealership, messaging: messagingStatus(session.dealership) });

const updateSettings = async (session, body) => {
  if (!hasRole(session.member, ["admin"])) return forbidden();
  const db = getDb();
  const settings =
    body?.settings && typeof body.settings === "object"
      ? body.settings
      : session.dealership.settings;
  const aiConfiguration =
    body?.aiConfiguration && typeof body.aiConfiguration === "object"
      ? body.aiConfiguration
      : session.dealership.aiConfiguration;
  const trimColor =
    body?.trimColor ?? session.dealership.trimColor ?? "dark_blue";
  if (!TRIM_COLORS.includes(trimColor))
    return json({ error: "Invalid trim color." }, 400);
  const [dealership] = await db.sql`
    UPDATE carnova_dealerships SET
      name = ${cleanText(body?.name, 200) || session.dealership.name},
      phone = ${body?.phone === undefined ? session.dealership.phone : cleanText(body.phone, 80) || null},
      email = ${body?.email === undefined ? session.dealership.email : cleanText(body.email, 320) || null},
      website = ${body?.website === undefined ? session.dealership.website : cleanText(body.website, 500) || null},
      address = ${body?.address === undefined ? session.dealership.address : cleanText(body.address, 500) || null},
      timezone = ${cleanText(body?.timezone, 100) || session.dealership.timezone},
      trim_color = ${trimColor},
      settings = ${JSON.stringify(settings)}::jsonb,
      ai_configuration = ${JSON.stringify(aiConfiguration)}::jsonb,
      updated_at = NOW()
    WHERE id = ${session.dealership.id} RETURNING *
  `;
  return json({ dealership });
};

const requirePlatformAdmin = (session) =>
  session.platformAdmin
    ? null
    : json({ error: "Platform owner access is required." }, 403);

const TRIM_COLORS = [
  "dark_green",
  "light_green",
  "light_blue",
  "dark_blue",
  "slate",
  "burgundy",
  "charcoal",
];

const dealershipSlug = (name, id) => {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 50) || "dealership";
  return `${base}-${id.slice(0, 8)}`;
};

const createPlatformDealership = async (session, body) => {
  const accessError = requirePlatformAdmin(session);
  if (accessError) return accessError;
  const name = cleanText(body?.name, 200);
  const adminName = cleanText(body?.adminName, 160);
  const adminEmail = cleanText(body?.adminEmail, 320).toLowerCase();
  const trimColor = TRIM_COLORS.includes(body?.trimColor)
    ? body.trimColor
    : "dark_blue";
  if (!name || !adminName || !adminEmail)
    return json(
      {
        error:
          "Dealership name, administrator name, and administrator email are required.",
      },
      400,
    );
  const db = getDb();
  const [existingAdminEmail] =
    await db.sql`SELECT id FROM carnova_users WHERE LOWER(email) = ${adminEmail} LIMIT 1`;
  if (existingAdminEmail)
    return json(
      {
        error:
          "That administrator email already belongs to another team record.",
      },
      409,
    );
  const dealershipId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const client = await db.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO carnova_dealerships (id, name, slug, phone, email, address, timezone, trim_color, carnova_feed_enabled, plan)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        dealershipId,
        name,
        dealershipSlug(name, dealershipId),
        cleanText(body?.phone, 80) || null,
        cleanText(body?.email, 320) || null,
        cleanText(body?.address, 500) || null,
        cleanText(body?.timezone, 100) || "America/New_York",
        trimColor,
        Boolean(body?.carnovaFeedEnabled),
        PLANS.includes(body?.plan) ? body.plan : "starter",
      ],
    );
    await client.query(
      `INSERT INTO carnova_users (id, dealership_id, name, email, phone, role, invited_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
      [
        memberId,
        dealershipId,
        adminName,
        adminEmail,
        cleanText(body?.adminPhone, 80) || null,
        body?.adminRole === "admin" ? "admin" : "owner",
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if (error?.code === "23505")
      return json(
        { error: "That dealership or administrator email already exists." },
        409,
      );
    throw error;
  } finally {
    client.release();
  }
  await recordPlatformOperation(session, dealershipId, "create", { name });
  // Email the owner a NovaCar sign-up link; they finish the setup wizard on first login.
  const invite =
    body?.sendInvite === false
      ? { sent: false }
      : await sendIdentityInvite(adminEmail, adminName);
  return json(
    {
      dealership: { id: dealershipId, name, trim_color: trimColor },
      administrator: { id: memberId, name: adminName, email: adminEmail },
      inviteSent: invite.sent,
      inviteNote: invite.reason ?? null,
    },
    201,
  );
};

const deletePlatformDealership = async (session, dealershipId) => {
  const accessError = requirePlatformAdmin(session);
  if (accessError) return accessError;
  if (session.dealership?.id === dealershipId)
    return json(
      {
        error:
          "You cannot delete the dealership workspace you are currently using.",
      },
      409,
    );
  const db = getDb();
  const [deleted] =
    await db.sql`DELETE FROM carnova_dealerships WHERE id = ${dealershipId} RETURNING id, name`;
  return deleted
    ? json({ deleted: true, dealership: deleted })
    : json({ error: "Dealership not found." }, 404);
};

const createPlatformUser = async (session, body) => {
  const accessError = requirePlatformAdmin(session);
  if (accessError) return accessError;
  const dealershipId = cleanText(body?.dealershipId, 100);
  const name = cleanText(body?.name, 160);
  const email = cleanText(body?.email, 320).toLowerCase();
  const role = USER_ROLES.includes(body?.role) ? body.role : "salesperson";
  if (!dealershipId || !name || !email)
    return json({ error: "Dealership, name, and email are required." }, 400);
  const db = getDb();
  const [existingEmail] =
    await db.sql`SELECT id, dealership_id FROM carnova_users WHERE LOWER(email) = ${email} LIMIT 1`;
  if (existingEmail && existingEmail.dealership_id !== dealershipId)
    return json(
      { error: "That email already belongs to another dealership." },
      409,
    );
  const [dealership] =
    await db.sql`SELECT id FROM carnova_dealerships WHERE id = ${dealershipId}`;
  if (!dealership) return json({ error: "Dealership not found." }, 404);
  const [user] = await db.sql`
    INSERT INTO carnova_users (id, dealership_id, name, email, phone, role)
    VALUES (${crypto.randomUUID()}, ${dealershipId}, ${name}, ${email}, ${cleanText(body?.phone, 80) || null}, ${role})
    ON CONFLICT (dealership_id, email) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone,
      role = EXCLUDED.role, active = TRUE, updated_at = NOW()
    RETURNING *
  `;
  return json({ user }, 201);
};

const deletePlatformUser = async (session, userId) => {
  const accessError = requirePlatformAdmin(session);
  if (accessError) return accessError;
  const db = getDb();
  const [target] =
    await db.sql`SELECT id, dealership_id, role, active, identity_user_id FROM carnova_users WHERE id = ${userId}`;
  if (!target) return json({ error: "User not found." }, 404);
  if (target.identity_user_id === session.identityUser.id)
    return json({ error: "You cannot delete your own account." }, 409);
  if (ADMIN_TIER.includes(target.role) && target.active) {
    const [{ admins }] =
      await db.sql`SELECT COUNT(*)::int AS admins FROM carnova_users WHERE dealership_id = ${target.dealership_id} AND role IN ('owner', 'admin') AND active = TRUE`;
    if (admins <= 1)
      return json(
        {
          error:
            "Appoint another active dealership administrator before deleting this one.",
        },
        409,
      );
  }
  await db.sql`DELETE FROM carnova_users WHERE id = ${userId}`;
  return json({ deleted: true });
};

const recordPlatformOperation = async (
  session,
  dealershipId,
  operationType,
  details = {},
) => {
  const db = getDb();
  await db.sql`
    INSERT INTO carnova_platform_operations (
      id, dealership_id, actor_identity_user_id, operation_type, details
    ) VALUES (
      ${crypto.randomUUID()}, ${dealershipId}, ${session.identityUser.id},
      ${operationType}, ${JSON.stringify(details)}::jsonb
    )
  `;
};

const exportDealership = async (session, requestedDealershipId) => {
  const dealershipId = session.platformAdmin
    ? cleanText(requestedDealershipId, 100) || session.dealership?.id
    : session.dealership?.id;
  if (!dealershipId)
    return json({ error: "A dealership is required for export." }, 400);
  if (!session.platformAdmin && !hasRole(session.member, ["admin"]))
    return forbidden();
  if (!session.platformAdmin && session.dealership.platformStatus !== "active")
    return json(
      {
        error: `This dealership workspace is ${session.dealership.platformStatus}. Contact the NOVACARAI platform owner.`,
        platformStatus: session.dealership.platformStatus,
      },
      423,
    );

  const db = getDb();
  const [dealership] =
    await db.sql`SELECT * FROM carnova_dealerships WHERE id = ${dealershipId}`;
  if (!dealership) return json({ error: "Dealership not found." }, 404);
  const [
    users,
    inventory,
    leads,
    messages,
    appointments,
    followUps,
    alerts,
    events,
    automations,
  ] = await Promise.all([
    db.sql`SELECT * FROM carnova_users WHERE dealership_id = ${dealershipId} ORDER BY created_at`,
    db.sql`SELECT * FROM carnova_inventory WHERE dealership_id = ${dealershipId} ORDER BY date_added`,
    db.sql`SELECT * FROM carnova_crm_leads WHERE dealership_id = ${dealershipId} ORDER BY created_at`,
    db.sql`SELECT * FROM carnova_messages WHERE dealership_id = ${dealershipId} ORDER BY created_at`,
    db.sql`SELECT * FROM carnova_appointments WHERE dealership_id = ${dealershipId} ORDER BY starts_at`,
    db.sql`SELECT * FROM carnova_follow_ups WHERE dealership_id = ${dealershipId} ORDER BY due_at`,
    db.sql`SELECT * FROM carnova_alerts WHERE dealership_id = ${dealershipId} ORDER BY created_at`,
    db.sql`SELECT * FROM carnova_events WHERE dealership_id = ${dealershipId} ORDER BY created_at`,
    db.sql`SELECT * FROM carnova_automation_rules WHERE dealership_id = ${dealershipId} ORDER BY created_at`,
  ]);
  await recordPlatformOperation(session, dealershipId, "export", {
    requestedByRole: session.platformAdmin
      ? "platform_admin"
      : session.member.role,
  });
  return json({
    exportedAt: new Date().toISOString(),
    formatVersion: 1,
    dealership,
    users,
    inventory,
    leads,
    messages,
    appointments,
    followUps,
    alerts,
    events,
    automations,
  });
};

const platformOverview = async (session) => {
  const accessError = requirePlatformAdmin(session);
  if (accessError) return accessError;
  const db = getDb();
  const dealerships = await db.sql`
    SELECT d.*,
      COUNT(DISTINCT u.id)::int AS user_count,
      COUNT(DISTINCT l.id)::int AS lead_count,
      COUNT(DISTINCT i.id)::int AS inventory_count,
      COUNT(DISTINCT a.id)::int AS appointment_count,
      COALESCE((
        SELECT JSONB_AGG(JSONB_BUILD_OBJECT('system', c.system, 'type', c.type, 'status', c.status, 'lastSyncAt', c.last_sync_at) ORDER BY c.created_at)
        FROM carnova_connections c WHERE c.dealership_id = d.id AND c.status <> 'disconnected'
      ), '[]'::jsonb) AS connections
    FROM carnova_dealerships d
    LEFT JOIN carnova_users u ON u.dealership_id = d.id
    LEFT JOIN carnova_crm_leads l ON l.dealership_id = d.id
    LEFT JOIN carnova_inventory i ON i.dealership_id = d.id
    LEFT JOIN carnova_appointments a ON a.dealership_id = d.id
    GROUP BY d.id
    ORDER BY d.created_at DESC
  `;
  const users = await db.sql`
    SELECT u.*, d.name AS dealership_name
    FROM carnova_users u
    JOIN carnova_dealerships d ON d.id = u.dealership_id
    ORDER BY d.name, u.name
  `;
  const operations = await db.sql`
    SELECT o.*, d.name AS dealership_name
    FROM carnova_platform_operations o
    JOIN carnova_dealerships d ON d.id = o.dealership_id
    ORDER BY o.created_at DESC LIMIT 100
  `;
  return json({ dealerships, users, operations, environment: environmentStatus() });
};

// Configuration the platform owner still needs to add. Names only: values are
// never read into the response or logged.
const ENVIRONMENT = [
  { name: "ANTHROPIC_API_KEY", purpose: "Andy and TITAN replies", required: true },
  { name: "TWILIO_ACCOUNT_SID", purpose: "Customer and staff texting", required: true },
  { name: "TWILIO_AUTH_TOKEN", purpose: "Customer and staff texting", required: true },
  { name: "TWILIO_MESSAGING_SERVICE_SID", purpose: "Sending number (or TWILIO_FROM_NUMBER)", required: false },
  { name: "TWILIO_FROM_NUMBER", purpose: "Sending number (or TWILIO_MESSAGING_SERVICE_SID)", required: false },
  { name: "POSTMARK_INBOUND_ADDRESS", purpose: "ADF lead email addresses", required: true },
  { name: "INBOUND_WEBHOOK_SECRET", purpose: "Inbound lead email webhook", required: true },
  { name: "NOVACARAI_PLATFORM_ADMIN_EMAILS", purpose: "Platform owner access", required: true },
  { name: "CARNOVA_LEAD_CAPTURE_TOKEN", purpose: "Token-gated JSON lead capture", required: false },
  { name: "CRM_AUTOMATION_WEBHOOK_URL", purpose: "Outbound automation webhook", required: false },
  { name: "CARNOVA_INVENTORY_URL", purpose: "Legacy inventory feed", required: false },
];

const environmentStatus = () => {
  const items = ENVIRONMENT.map((entry) => ({ ...entry, set: Boolean(process.env[entry.name]) }));
  const senderSet = items.some((item) => item.set && /^TWILIO_(MESSAGING_SERVICE_SID|FROM_NUMBER)$/.test(item.name));
  return items.map((item) => ({
    ...item,
    required: item.required || (!senderSet && item.name === "TWILIO_MESSAGING_SERVICE_SID"),
  }));
};

const updatePlatformDealership = async (session, dealershipId, body) => {
  const accessError = requirePlatformAdmin(session);
  if (accessError) return accessError;
  const allowedPlatformStatuses = [
    "active",
    "suspended",
    "closed",
    "transferring",
  ];
  const allowedSubscriptionStatuses = [
    "trial",
    "active",
    "past_due",
    "cancelled",
  ];
  const db = getDb();
  const [existing] =
    await db.sql`SELECT * FROM carnova_dealerships WHERE id = ${dealershipId}`;
  if (!existing) return json({ error: "Dealership not found." }, 404);
  const platformStatus = body?.platformStatus ?? existing.platform_status;
  const subscriptionStatus =
    body?.subscriptionStatus ?? existing.subscription_status;
  const trimColor = body?.trimColor ?? existing.trim_color ?? "dark_blue";
  const carnovaFeedEnabled =
    body?.carnovaFeedEnabled === undefined
      ? existing.carnova_feed_enabled
      : Boolean(body.carnovaFeedEnabled);
  if (!allowedPlatformStatuses.includes(platformStatus))
    return json({ error: "Invalid platform status." }, 400);
  if (!allowedSubscriptionStatuses.includes(subscriptionStatus))
    return json({ error: "Invalid subscription status." }, 400);
  if (!TRIM_COLORS.includes(trimColor))
    return json({ error: "Invalid trim color." }, 400);
  const plan = body?.plan ?? existing.plan ?? "starter";
  if (!PLANS.includes(plan)) return json({ error: "Invalid plan." }, 400);
  const smsFromNumber =
    body?.smsFromNumber === undefined
      ? existing.sms_from_number
      : cleanText(body.smsFromNumber, 20) || null;
  if (smsFromNumber && !/^\+[1-9]\d{9,14}$/.test(smsFromNumber))
    return json({ error: "The texting number must be in +15551234567 format." }, 400);
  const [dealership] = await db.sql`
    UPDATE carnova_dealerships SET
      plan = ${plan},
      sms_from_number = ${smsFromNumber},
      platform_status = ${platformStatus},
      subscription_status = ${subscriptionStatus},
      trim_color = ${trimColor},
      carnova_feed_enabled = ${carnovaFeedEnabled},
      subscription_ends_at = ${body?.subscriptionEndsAt === undefined ? existing.subscription_ends_at : body.subscriptionEndsAt || null},
      updated_at = NOW()
    WHERE id = ${dealershipId}
    RETURNING *
  `;
  await recordPlatformOperation(session, dealershipId, "status_change", {
    platformStatus,
    subscriptionStatus,
    plan,
  });
  return json({ dealership });
};

const updatePlatformUser = async (session, userId, body) => {
  const accessError = requirePlatformAdmin(session);
  if (accessError) return accessError;
  const db = getDb();
  const [existing] =
    await db.sql`SELECT * FROM carnova_users WHERE id = ${userId}`;
  if (!existing) return json({ error: "User not found." }, 404);
  const dealershipId =
    cleanText(body?.dealershipId, 100) || existing.dealership_id;
  const role = body?.role ?? existing.role;
  if (!USER_ROLES.includes(role)) return json({ error: "Invalid role." }, 400);
  const [targetDealership] =
    await db.sql`SELECT id FROM carnova_dealerships WHERE id = ${dealershipId}`;
  if (!targetDealership)
    return json({ error: "Target dealership not found." }, 404);
  const nextActive =
    body?.active === undefined ? existing.active : Boolean(body.active);
  if (
    ADMIN_TIER.includes(existing.role) &&
    existing.active &&
    (!ADMIN_TIER.includes(role) || !nextActive || dealershipId !== existing.dealership_id)
  ) {
    const [{ admins }] = await db.sql`
      SELECT COUNT(*)::int AS admins FROM carnova_users
      WHERE dealership_id = ${existing.dealership_id} AND role IN ('owner', 'admin') AND active = TRUE
    `;
    if (admins <= 1)
      return json(
        {
          error:
            "Appoint another active dealership administrator before changing this one.",
        },
        409,
      );
  }
  if (dealershipId !== existing.dealership_id) {
    await Promise.all([
      db.sql`UPDATE carnova_crm_leads SET assigned_salesperson_id = NULL, updated_at = NOW() WHERE dealership_id = ${existing.dealership_id} AND assigned_salesperson_id = ${userId}`,
      db.sql`UPDATE carnova_crm_leads SET assigned_bdc_agent_id = NULL, updated_at = NOW() WHERE dealership_id = ${existing.dealership_id} AND assigned_bdc_agent_id = ${userId}`,
      db.sql`UPDATE carnova_crm_leads SET assigned_manager_id = NULL, updated_at = NOW() WHERE dealership_id = ${existing.dealership_id} AND assigned_manager_id = ${userId}`,
      db.sql`UPDATE carnova_appointments SET salesperson_id = NULL, updated_at = NOW() WHERE dealership_id = ${existing.dealership_id} AND salesperson_id = ${userId}`,
      db.sql`UPDATE carnova_follow_ups SET assigned_user_id = NULL, updated_at = NOW() WHERE dealership_id = ${existing.dealership_id} AND assigned_user_id = ${userId}`,
    ]);
  }
  const [user] = await db.sql`
    UPDATE carnova_users SET dealership_id = ${dealershipId}, role = ${role},
      active = ${nextActive}, updated_at = NOW()
    WHERE id = ${userId} RETURNING *
  `;
  if (dealershipId !== existing.dealership_id) {
    await recordPlatformOperation(session, existing.dealership_id, "transfer", {
      userId,
      targetDealershipId: dealershipId,
    });
    await recordPlatformOperation(session, dealershipId, "transfer", {
      userId,
      sourceDealershipId: existing.dealership_id,
    });
  }
  return json({ user });
};

const bootstrap = async (session, body) => {
  if (session.member)
    return json(
      { error: "Your account already belongs to a dealership." },
      409,
    );
  const db = getDb();
  const dealershipName = cleanText(body?.dealershipName, 200);
  const name =
    cleanText(body?.name, 160) ||
    session.identityUser.name ||
    session.identityUser.email?.split("@")[0] ||
    "Administrator";
  if (!dealershipName)
    return json({ error: "Dealership name is required." }, 400);
  const dealershipId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const slugBase =
    dealershipName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 50) || "dealership";
  const slug = `${slugBase}-${dealershipId.slice(0, 8)}`;
  const [created] = await db.sql`
    WITH dealership AS (
      INSERT INTO carnova_dealerships (id, name, slug, phone, email, address, timezone)
      VALUES (${dealershipId}, ${dealershipName}, ${slug}, ${cleanText(body?.phone, 80) || null},
        ${cleanText(body?.email, 320) || session.identityUser.email || null}, ${cleanText(body?.address, 500) || null},
        ${cleanText(body?.timezone, 100) || "America/New_York"})
      RETURNING *
    ), member AS (
      INSERT INTO carnova_users (id, dealership_id, identity_user_id, name, email, phone, role)
      VALUES (${memberId}, ${dealershipId}, ${session.identityUser.id}, ${name}, ${session.identityUser.email}, ${cleanText(body?.phone, 80) || null}, 'owner')
      RETURNING *
    )
    SELECT dealership.id, dealership.name, dealership.slug, member.id AS member_id, member.role
    FROM dealership, member
  `;
  const ruleDefinitions = [
    ["lead.created", "new_lead_alert", 0],
    ["lead.unanswered", "missed_lead_alert", 15],
    ["appointment.created", "appointment_reminder", 1440],
    ["appointment.no_show", "no_show_follow_up", 15],
    ["lead.temperature_hot", "hot_lead_alert", 0],
    ["lead.human_handoff", "human_handoff_alert", 0],
    ["follow_up.due", "follow_up_reminder", 0],
  ];
  for (const [eventType, actionType, delayMinutes] of ruleDefinitions) {
    await db.sql`
      INSERT INTO carnova_automation_rules (id, dealership_id, event_type, action_type, delay_minutes)
      VALUES (${crypto.randomUUID()}, ${dealershipId}, ${eventType}, ${actionType}, ${delayMinutes})
    `;
  }
  return json({ created }, 201);
};

export default async (request) => {
  try {
    return await route(request);
  } catch (error) {
    // Never surface an unhandled 500 or internal details to the browser.
    console.error("CRM request failed", error?.message);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
};

const route = async (request) => {
  const url = new URL(request.url);
  const resource = cleanText(url.searchParams.get("resource"), 80) || "session";
  const id = cleanText(url.searchParams.get("id"), 100);
  const action = cleanText(url.searchParams.get("action"), 80);
  const { session, error } = await requireMember(request);
  if (error) return error;

  if (resource === "session" && request.method === "GET") {
    return json({
      user: session.identityUser
        ? {
            id: session.identityUser.id,
            email: session.identityUser.email,
            name: session.identityUser.name,
          }
        : null,
      member: session.member,
      dealership: session.dealership,
      platformAdmin: session.platformAdmin,
      impersonating: Boolean(session.impersonationId),
      needsOnboarding: Boolean(session.identityUser && !session.member),
    });
  }
  if (resource === "platform" && request.method === "GET")
    return platformOverview(session);
  if (resource === "platform_dealerships" && request.method === "POST")
    return createPlatformDealership(session, await parseBody(request));
  if (resource === "platform_dealerships" && request.method === "PATCH" && id)
    return updatePlatformDealership(session, id, await parseBody(request));
  if (resource === "platform_dealerships" && request.method === "DELETE" && id)
    return deletePlatformDealership(session, id);
  if (resource === "platform_users" && request.method === "POST")
    return createPlatformUser(session, await parseBody(request));
  if (resource === "platform_users" && request.method === "PATCH" && id)
    return updatePlatformUser(session, id, await parseBody(request));
  if (resource === "platform_users" && request.method === "DELETE" && id)
    return deletePlatformUser(session, id);
  if (resource === "export" && request.method === "GET")
    return exportDealership(session, url.searchParams.get("dealershipId"));
  if (resource === "bootstrap" && request.method === "POST")
    return bootstrap(session, await parseBody(request));
  if (resource === "impersonate" && request.method === "POST" && action === "end")
    return endImpersonation(session, request, IMPERSONATION_HEADER);
  if (resource === "impersonate" && request.method === "POST")
    return startImpersonation(session, await parseBody(request));
  if (!session.member)
    return json(
      {
        error: "Complete dealership setup before using the CRM.",
        needsOnboarding: true,
      },
      409,
    );
  if (session.dealership.platformStatus !== "active")
    return json(
      {
        error: `This dealership workspace is ${session.dealership.platformStatus}. Contact the NOVACARAI platform owner.`,
        platformStatus: session.dealership.platformStatus,
      },
      423,
    );

  if (resource === "dashboard" && request.method === "GET")
    return dashboard(session);
  if (resource === "leads" && request.method === "GET")
    return listLeads(session, url);
  if (resource === "leads" && request.method === "POST" && id && action === "resolve_urgent") {
    const lead = await getLeadFor(session, id);
    return lead ? resolveUrgent(session, lead) : json({ error: "Lead not found." }, 404);
  }
  if (resource === "leads" && request.method === "POST")
    return createLead(session, await parseBody(request));
  if (resource === "leads" && request.method === "PATCH" && id)
    return updateLead(session, id, await parseBody(request));
  if (resource === "messages" && request.method === "GET")
    return listMessages(
      session,
      cleanText(url.searchParams.get("leadId"), 100),
    );
  if (resource === "messages" && request.method === "POST")
    return createMessage(session, await parseBody(request));
  if (resource === "inventory" && request.method === "GET" && id)
    return getInventoryVehicle(session, id);
  if (resource === "inventory" && request.method === "GET")
    return listInventory(session, url);
  if (
    resource === "inventory" &&
    request.method === "POST" &&
    action === "import"
  )
    return importInventory(session, await parseBody(request));
  if (
    resource === "inventory" &&
    request.method === "POST" &&
    action === "sync_carnova"
  )
    return syncCarnovaInventory(session);
  if (
    resource === "inventory" &&
    request.method === "POST" &&
    action === "seed_test"
  )
    return seedTestInventory(session);
  if (resource === "inventory" && request.method === "POST")
    return saveVehicle(session, await parseBody(request));
  if (
    resource === "inventory" &&
    request.method === "PATCH" &&
    id &&
    action === "status"
  )
    return updateVehicleStatus(session, id, await parseBody(request));
  if (resource === "inventory" && request.method === "PATCH" && id)
    return saveVehicle(session, await parseBody(request), id);
  if (resource === "inventory_sources" && request.method === "GET")
    return listInventorySourcesRoute(session);
  if (resource === "inventory_sources" && request.method === "POST")
    return saveInventorySource(session, await parseBody(request));
  if (resource === "inventory_sources" && request.method === "PATCH" && id)
    return saveInventorySource(session, await parseBody(request), id);
  if (resource === "lead_vehicles" && request.method === "GET")
    return listLeadVehicles(
      session,
      cleanText(url.searchParams.get("leadId"), 100),
    );
  if (resource === "lead_vehicles" && request.method === "POST")
    return attachLeadVehicle(session, await parseBody(request));
  if (resource === "lead_vehicles" && request.method === "DELETE")
    return detachLeadVehicle(session, url);
  if (resource === "appointments" && request.method === "GET")
    return listAppointments(session, url);
  if (resource === "appointments" && request.method === "POST")
    return createAppointment(session, await parseBody(request));
  if (resource === "appointments" && request.method === "PATCH" && id)
    return updateAppointment(session, id, await parseBody(request));
  if (resource === "availability" && request.method === "GET") {
    const date = cleanText(url.searchParams.get("date"), 20);
    const slots = await getAvailability({
      dealership: session.dealership,
      date,
      salespersonId:
        cleanText(url.searchParams.get("salespersonId"), 100) || null,
      offsetMinutes: cleanNumber(url.searchParams.get("offsetMinutes")) || 0,
    });
    return json({ slots, timezone: session.dealership.timezone });
  }
  if (resource === "team" && request.method === "GET") return listTeam(session);
  if (resource === "team" && request.method === "POST")
    return saveTeamMember(session, await parseBody(request));
  if (resource === "team" && request.method === "PATCH" && id)
    return saveTeamMember(session, await parseBody(request), id);
  if (resource === "team" && request.method === "DELETE" && id)
    return deleteTeamMember(session, id);
  if (resource === "followups" && request.method === "GET")
    return listFollowUps(session);
  if (resource === "followups" && request.method === "POST")
    return saveFollowUp(session, await parseBody(request));
  if (resource === "followups" && request.method === "PATCH" && id)
    return saveFollowUp(session, await parseBody(request), id);
  if (resource === "alerts" && request.method === "GET")
    return listAlerts(session);
  if (resource === "alerts" && request.method === "PATCH" && id)
    return acknowledgeAlert(session, id);
  if (resource === "automations" && request.method === "GET")
    return listAutomations(session);
  if (resource === "automations" && request.method === "PATCH" && id)
    return updateAutomation(session, id, await parseBody(request));
  if (resource === "settings" && request.method === "GET")
    return getSettings(session);
  if (resource === "settings" && request.method === "PATCH")
    return updateSettings(session, await parseBody(request));

  if (resource === "consents") {
    const leadId =
      request.method === "GET"
        ? cleanText(url.searchParams.get("leadId"), 100)
        : id;
    const lead = leadId ? await getLeadFor(session, leadId) : null;
    if (!lead) return json({ error: "Lead not found." }, 404);
    if (request.method === "GET") return listConsents(session, lead);
    if (request.method === "POST") return recordManualConsent(session, lead, await parseBody(request));
  }
  if (resource === "connections" && request.method === "GET")
    return listConnections(session, baseUrlFor(request));
  if (resource === "connections" && request.method === "POST" && id && action === "test")
    return testConnectionRoute(session, id, baseUrlFor(request));
  if (resource === "connections" && request.method === "POST" && id && action === "disconnect")
    return disconnectConnection(session, id);
  if (resource === "connections" && request.method === "POST" && action === "request_access")
    return requestPartnerAccess(session, await parseBody(request));
  if (resource === "connections" && request.method === "POST")
    return createConnection(session, await parseBody(request), baseUrlFor(request));
  if (resource === "setup" && request.method === "GET")
    return setupStatus(session);
  if (resource === "setup" && request.method === "POST" && action === "logo")
    return uploadLogo(session, await parseBody(request));
  if (resource === "setup" && request.method === "PATCH")
    return saveSetup(session, await parseBody(request));
  if (resource === "invites" && request.method === "POST")
    return inviteTeam(session, await parseBody(request));
  if (resource === "analytics" && request.method === "GET")
    return analytics(session, url);

  return json({ error: "CRM route not found." }, 404);
};
