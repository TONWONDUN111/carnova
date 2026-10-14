// CRM routes added for Add Dealership, Connect Dealership System, team
// invites, "Log in as" impersonation, and NovaCar analytics. Mounted by the
// router in netlify/functions/crm.mjs; every handler is tenant scoped to
// session.dealership and enforces roles on the server.

import { getStore } from "@netlify/blobs";
import { getIdentityConfig } from "@netlify/identity";
import { USER_ROLES, cleanText, createEvent, getDb, hasRole, json, sha256Hex } from "./crm.mjs";
import {
  AVAILABILITY,
  TYPE_CATEGORY,
  connectorCatalog,
  getConnector,
  getTypeDefinition,
  testConnection,
} from "./connectors/index.mjs";
import { leadEmailAddress } from "./connectors/shared.mjs";
import { twilioConfigured } from "./sms.mjs";
import { safeTimezone } from "./timezone.mjs";

export const LOGO_STORE = "dealership-logos";
const LOGO_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const MAX_LOGO_BYTES = 1024 * 1024;
const IMPERSONATION_HOURS = 2;
export const PLANS = ["starter", "growth", "pro", "enterprise"];

const forbidden = () => json({ error: "You do not have permission to perform this action." }, 403);
const canManage = (session) => hasRole(session.member, ["admin", "manager"]);
const canAdmin = (session) => hasRole(session.member, ["admin"]);

const randomToken = (bytes = 24) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");

export const baseUrlFor = (request) => process.env.URL || new URL(request.url).origin;

/* ---------------------------- Connections ---------------------------- */

const publicConnection = (connection, session, baseUrl) => {
  const connector = getConnector(connection.system);
  const { feedPasswordHash, ...config } = connection.config ?? {};
  return {
    ...connection,
    config,
    systemName: connector?.name ?? connection.system,
    category: TYPE_CATEGORY[connection.type],
    definition: getTypeDefinition(connection.system, connection.type),
    setup:
      connection.status === "disconnected" || connection.type === "direct_api"
        ? null
        : connector?.setupInstructions({
            dealership: { ...session.dealership, inbound_token: session.dealership.inboundToken },
            connection,
            baseUrl,
          }),
  };
};

export const listConnections = async (session, baseUrl) => {
  if (!canManage(session)) return forbidden();
  const db = getDb();
  const [connections, requests] = await Promise.all([
    db.sql`SELECT * FROM carnova_connections WHERE dealership_id = ${session.dealership.id} ORDER BY created_at`,
    db.sql`SELECT system, created_at FROM carnova_partner_access_requests WHERE dealership_id = ${session.dealership.id} ORDER BY created_at DESC`,
  ]);
  return json({
    catalog: connectorCatalog(),
    connections: connections.map((connection) => publicConnection(connection, session, baseUrl)),
    accessRequests: requests,
    inbound: {
      leadEmailAddress: leadEmailAddress({ inboundToken: session.dealership.inboundToken }),
      emailConfigured: Boolean(process.env.POSTMARK_INBOUND_ADDRESS && process.env.INBOUND_WEBHOOK_SECRET),
      smsConfigured: twilioConfigured(),
    },
  });
};

const recordAccessRequest = async (session, system, notes) => {
  const db = getDb();
  await db.sql`
    INSERT INTO carnova_partner_access_requests (id, dealership_id, system, requested_by_identity_user_id, requested_by_email, notes)
    VALUES (${crypto.randomUUID()}, ${session.dealership.id}, ${system}, ${session.identityUser?.id ?? null},
      ${session.identityUser?.email ?? null}, ${cleanText(notes, 1000) || null})
  `;
  await createEvent({
    dealershipId: session.dealership.id,
    type: "connection.access_requested",
    actorUserId: session.member.id,
    payload: { system },
  });
};

export const createConnection = async (session, body, baseUrl) => {
  if (!canManage(session)) return forbidden();
  const system = cleanText(body?.system, 40);
  const type = cleanText(body?.type, 40);
  const definition = getTypeDefinition(system, type);
  if (!definition) return json({ error: "Choose a supported system and connection type." }, 400);
  if (definition.availability === AVAILABILITY.NOT_APPLICABLE)
    return json({ error: `${definition.label} is not applicable to ${getConnector(system).name}.` }, 400);

  const db = getDb();
  if (definition.availability === AVAILABILITY.PENDING) {
    // Direct API access only logs a request; it is never shown as connected.
    await recordAccessRequest(session, system, body?.notes);
    const [connection] = await db.sql`
      INSERT INTO carnova_connections (id, dealership_id, system, type, status, config)
      VALUES (${crypto.randomUUID()}, ${session.dealership.id}, ${system}, ${type}, 'pending', '{"partnerAccess":"requested"}'::jsonb)
      ON CONFLICT (dealership_id, system, type) DO UPDATE SET status = 'pending', updated_at = NOW()
      RETURNING *
    `;
    return json({ connection: publicConnection(connection, session, baseUrl), accessRequested: true }, 201);
  }

  const config = {};
  let feedPassword = null;
  if (["inventory_export", "inventory_feed"].includes(type)) {
    feedPassword = randomToken(18);
    config.feedUsername = `nc-${session.dealership.inboundToken?.slice(0, 8)}-${randomToken(3)}`;
    config.feedPasswordHash = await sha256Hex(feedPassword);
  }
  // Lead email and inventory feeds stay "pending" until real data arrives;
  // the lead form and CSV upload are live on NovaCar's side immediately.
  const status = ["lead_form", "inventory_upload"].includes(type) ? "active" : "pending";
  const [connection] = await db.sql`
    INSERT INTO carnova_connections (id, dealership_id, system, type, status, config)
    VALUES (${crypto.randomUUID()}, ${session.dealership.id}, ${system}, ${type}, ${status}, ${JSON.stringify(config)}::jsonb)
    ON CONFLICT (dealership_id, system, type) DO UPDATE SET
      status = EXCLUDED.status, config = EXCLUDED.config, last_error = NULL, updated_at = NOW()
    RETURNING *
  `;
  await createEvent({
    dealershipId: session.dealership.id,
    type: "connection.created",
    actorUserId: session.member.id,
    payload: { system, type },
  });
  // The generated feed password is shown exactly once.
  return json({ connection: publicConnection(connection, session, baseUrl), feedPassword }, 201);
};

const loadConnection = async (session, id) => {
  const [connection] = await getDb().sql`
    SELECT * FROM carnova_connections WHERE id = ${id} AND dealership_id = ${session.dealership.id}
  `;
  return connection ?? null;
};

export const testConnectionRoute = async (session, id, baseUrl) => {
  if (!canManage(session)) return forbidden();
  const connection = await loadConnection(session, id);
  if (!connection) return json({ error: "Connection not found." }, 404);
  if (connection.status === "disconnected") return json({ error: "This connection is disconnected." }, 409);
  const result = await testConnection({
    dealership: { ...session.dealership, inbound_token: session.dealership.inboundToken },
    connection,
    baseUrl,
  });
  await getDb().sql`
    UPDATE carnova_connections SET last_error = ${result.ok ? null : result.detail}, updated_at = NOW()
    WHERE id = ${id} AND dealership_id = ${session.dealership.id}
  `;
  return json({ result });
};

export const disconnectConnection = async (session, id) => {
  if (!canManage(session)) return forbidden();
  const connection = await loadConnection(session, id);
  if (!connection) return json({ error: "Connection not found." }, 404);
  const { feedPasswordHash, ...config } = connection.config ?? {};
  const [updated] = await getDb().sql`
    UPDATE carnova_connections SET status = 'disconnected', config = ${JSON.stringify(config)}::jsonb, updated_at = NOW()
    WHERE id = ${id} AND dealership_id = ${session.dealership.id}
    RETURNING *
  `;
  await createEvent({
    dealershipId: session.dealership.id,
    type: "connection.disconnected",
    actorUserId: session.member.id,
    payload: { system: connection.system, type: connection.type },
  });
  return json({ connection: updated });
};

export const requestPartnerAccess = async (session, body) => {
  if (!canManage(session)) return forbidden();
  const system = cleanText(body?.system, 40);
  if (!getConnector(system)) return json({ error: "Unknown system." }, 400);
  await recordAccessRequest(session, system, body?.notes);
  return json({ requested: true }, 201);
};

/* ------------------------------ Setup -------------------------------- */

const validHours = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value || "");
const safeColor = (value) => (/^#[0-9a-f]{6}$/i.test(value || "") ? value.toLowerCase() : null);

export const normalizeBusinessHours = (input) => {
  if (!input || typeof input !== "object") return null;
  const result = {};
  for (let day = 0; day <= 6; day += 1) {
    const hours = input[String(day)] ?? input[day];
    if (!Array.isArray(hours) || hours.length !== 2) continue;
    if (!validHours(hours[0]) || !validHours(hours[1]) || hours[0] >= hours[1]) return null;
    result[String(day)] = [hours[0], hours[1]];
  }
  return result;
};

/** Wizard step saves: profile, hours, branding, SMS number, completion. */
export const saveSetup = async (session, body) => {
  if (!canAdmin(session)) return forbidden();
  const db = getDb();
  const current = session.dealership;
  const settings = { ...(current.settings ?? {}) };
  if (body?.businessHours !== undefined) {
    const hours = normalizeBusinessHours(body.businessHours);
    if (!hours) return json({ error: "Business hours must be HH:MM with opening before closing." }, 400);
    settings.business_hours = hours;
  }
  if (body?.timezone !== undefined && safeTimezone(body.timezone) !== body.timezone)
    return json({ error: "Choose a valid timezone." }, 400);
  if (body?.plan !== undefined && (!session.platformAdmin || !PLANS.includes(body.plan)))
    return json({ error: "Only the platform owner can change the plan." }, 403);
  // The texting number is provisioned by NovaCar (Twilio), so only the platform owner sets it.
  if (body?.smsFromNumber !== undefined && !session.platformAdmin)
    return json({ error: "Only the platform owner can change the texting number." }, 403);
  const smsFrom =
    body?.smsFromNumber === undefined ? current.smsFromNumber : cleanText(body.smsFromNumber, 20) || null;
  if (smsFrom && !/^\+[1-9]\d{9,14}$/.test(smsFrom))
    return json({ error: "The texting number must be in +15551234567 format." }, 400);
  const [dealership] = await db.sql`
    UPDATE carnova_dealerships SET
      name = ${cleanText(body?.name, 200) || current.name},
      address = ${body?.address === undefined ? current.address : cleanText(body.address, 500) || null},
      phone = ${body?.phone === undefined ? current.phone : cleanText(body.phone, 80) || null},
      timezone = ${body?.timezone ?? current.timezone},
      settings = ${JSON.stringify(settings)}::jsonb,
      brand_primary = ${body?.brandPrimary === undefined ? current.brandPrimary : safeColor(body.brandPrimary)},
      brand_accent = ${body?.brandAccent === undefined ? current.brandAccent : safeColor(body.brandAccent)},
      sms_from_number = ${smsFrom},
      plan = ${body?.plan ?? current.plan ?? "starter"},
      onboarding_completed_at = CASE WHEN ${body?.complete === true} THEN COALESCE(onboarding_completed_at, NOW()) ELSE onboarding_completed_at END,
      updated_at = NOW()
    WHERE id = ${current.id}
    RETURNING id, name, address, phone, timezone, settings, brand_primary, brand_accent, sms_from_number, plan, onboarding_completed_at
  `;
  await createEvent({
    dealershipId: current.id,
    type: "dealership.setup_saved",
    actorUserId: session.member.id,
    payload: { fields: Object.keys(body ?? {}) },
  });
  return json({ dealership });
};

/** Logo upload as a data URL; PNG, JPEG, or WebP up to 1 MB, stored in Netlify Blobs. */
export const uploadLogo = async (session, body) => {
  if (!canAdmin(session)) return forbidden();
  const match = String(body?.dataUrl || "").match(/^data:(image\/(?:png|jpeg|webp));base64,([a-z0-9+/=]+)$/i);
  if (!match) return json({ error: "Upload a PNG, JPEG, or WebP image." }, 400);
  const contentType = match[1].toLowerCase();
  const bytes = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0));
  if (bytes.byteLength > MAX_LOGO_BYTES) return json({ error: "Logos must be 1 MB or smaller." }, 413);
  const key = `${session.dealership.id}/${Date.now()}.${LOGO_TYPES[contentType]}`;
  await getStore(LOGO_STORE).set(key, bytes, { metadata: { contentType } });
  await getDb().sql`UPDATE carnova_dealerships SET logo_key = ${key}, updated_at = NOW() WHERE id = ${session.dealership.id}`;
  return json({ logoUrl: `/api/logo?d=${encodeURIComponent(session.dealership.id)}&v=${Date.now()}` });
};

/* ------------------------------ Invites ------------------------------ */

export const sendIdentityInvite = async (email, name) => {
  const config = getIdentityConfig();
  if (!config?.url || !config?.token) return { sent: false, reason: "Identity invites are unavailable in this environment." };
  try {
    const response = await fetch(`${config.url}/invite`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
      body: JSON.stringify({ email, data: { full_name: name } }),
    });
    if (response.ok) return { sent: true };
    const payload = await response.json().catch(() => ({}));
    // An existing Identity account can simply sign in; its team record links on login.
    if (response.status === 422) return { sent: false, reason: "Already has an account; they can sign in now." };
    return { sent: false, reason: payload?.msg || `Identity returned ${response.status}.` };
  } catch (error) {
    return { sent: false, reason: `Identity unreachable: ${error.message}` };
  }
};

export const inviteTeam = async (session, body) => {
  if (!canManage(session)) return forbidden();
  const invites = Array.isArray(body?.invites) ? body.invites.slice(0, 25) : [];
  if (!invites.length) return json({ error: "Add at least one person to invite." }, 400);
  const db = getDb();
  const isAdmin = canAdmin(session);
  const results = [];
  for (const invite of invites) {
    const email = cleanText(invite?.email, 320).toLowerCase();
    const role = USER_ROLES.includes(invite?.role) ? invite.role : "sales";
    const name = cleanText(invite?.name, 160) || email.split("@")[0];
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      results.push({ email, ok: false, error: "Invalid email." });
      continue;
    }
    if (!isAdmin && ["owner", "admin"].includes(role)) {
      results.push({ email, ok: false, error: "Only an owner or administrator can invite that role." });
      continue;
    }
    if (role === "owner" && !hasRole(session.member, ["owner"]) && !session.platformAdmin) {
      results.push({ email, ok: false, error: "Only an owner can invite another owner." });
      continue;
    }
    const [elsewhere] = await db.sql`
      SELECT id FROM carnova_users WHERE LOWER(email) = ${email} AND dealership_id <> ${session.dealership.id} LIMIT 1
    `;
    if (elsewhere) {
      results.push({ email, ok: false, error: "That email belongs to another dealership." });
      continue;
    }
    const [member] = await db.sql`
      INSERT INTO carnova_users (id, dealership_id, name, email, phone, role, active, invited_at)
      VALUES (${crypto.randomUUID()}, ${session.dealership.id}, ${name}, ${email}, ${cleanText(invite?.phone, 80) || null}, ${role}, TRUE, NOW())
      ON CONFLICT (dealership_id, email) DO UPDATE SET role = EXCLUDED.role, active = TRUE, invited_at = NOW(), updated_at = NOW()
      RETURNING id, identity_user_id
    `;
    const delivery = member.identity_user_id ? { sent: false, reason: "Already joined." } : await sendIdentityInvite(email, name);
    results.push({ email, role, ok: true, emailSent: delivery.sent, note: delivery.reason ?? null });
  }
  await createEvent({
    dealershipId: session.dealership.id,
    type: "team.invited",
    actorUserId: session.member.id,
    payload: { count: results.filter((result) => result.ok).length },
  });
  return json({ results });
};

/* --------------------------- Setup status ---------------------------- */

/** What still needs configuring; drives the wizard's Finish step. */
export const setupStatus = async (session) => {
  const db = getDb();
  const id = session.dealership.id;
  const [[counts], connections] = await Promise.all([
    db.sql`
      SELECT
        (SELECT COUNT(*)::int FROM carnova_users WHERE dealership_id = ${id} AND active = TRUE) AS team,
        (SELECT COUNT(*)::int FROM carnova_inventory WHERE dealership_id = ${id}) AS inventory,
        (SELECT logo_key FROM carnova_dealerships WHERE id = ${id}) AS logo_key
    `,
    db.sql`SELECT type, status FROM carnova_connections WHERE dealership_id = ${id} AND status <> 'disconnected'`,
  ]);
  const hasLeadSource = connections.some((connection) => TYPE_CATEGORY[connection.type] === "lead" && connection.status !== "pending") ||
    connections.some((connection) => connection.type === "lead_email");
  const hasInventorySource = counts.inventory > 0 || connections.some((connection) => TYPE_CATEGORY[connection.type] === "inventory");
  const items = [
    { key: "profile", label: "Dealership address and phone", done: Boolean(session.dealership.address && session.dealership.phone) },
    { key: "hours", label: "Business hours", done: Boolean(Object.keys(session.dealership.settings?.business_hours ?? {}).length) },
    { key: "logo", label: "Logo", done: Boolean(counts.logo_key) },
    { key: "team", label: "Team members invited", done: counts.team > 1 },
    { key: "leads", label: "A lead source connected", done: hasLeadSource },
    { key: "inventory", label: "Inventory connected or imported", done: hasInventorySource },
    { key: "sms_number", label: "Texting number assigned", done: Boolean(session.dealership.smsFromNumber || process.env.TWILIO_MESSAGING_SERVICE_SID || process.env.TWILIO_FROM_NUMBER) },
    { key: "sms_provider", label: "SMS provider (Twilio) configured by NovaCar", done: twilioConfigured(), platform: true },
    { key: "email_provider", label: "Inbound lead email configured by NovaCar", done: Boolean(process.env.POSTMARK_INBOUND_ADDRESS && process.env.INBOUND_WEBHOOK_SECRET), platform: true },
    { key: "ai", label: "AI service available", done: Boolean(process.env.ANTHROPIC_API_KEY), platform: true },
  ];
  return json({ items, remaining: items.filter((item) => !item.done).length, onboardingCompletedAt: session.dealership.onboardingCompletedAt });
};

/* --------------------------- Impersonation --------------------------- */

const recordOperation = async (session, dealershipId, operationType, details) => {
  await getDb().sql`
    INSERT INTO carnova_platform_operations (id, dealership_id, actor_identity_user_id, operation_type, details)
    VALUES (${crypto.randomUUID()}, ${dealershipId}, ${session.identityUser.id}, ${operationType}, ${JSON.stringify(details)}::jsonb)
  `;
};

export const startImpersonation = async (session, body) => {
  if (!session.platformAdmin) return json({ error: "Platform owner access is required." }, 403);
  const dealershipId = cleanText(body?.dealershipId, 100);
  const db = getDb();
  const [dealership] = await db.sql`SELECT id, name FROM carnova_dealerships WHERE id = ${dealershipId}`;
  if (!dealership) return json({ error: "Dealership not found." }, 404);
  const [member] = await db.sql`SELECT id FROM carnova_users WHERE dealership_id = ${dealershipId} AND active = TRUE LIMIT 1`;
  if (!member) return json({ error: "That dealership has no active users to log in as." }, 409);
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + IMPERSONATION_HOURS * 3600000).toISOString();
  const id = crypto.randomUUID();
  await db.sql`
    INSERT INTO carnova_impersonations (id, dealership_id, actor_identity_user_id, actor_email, token_hash, expires_at)
    VALUES (${id}, ${dealershipId}, ${session.identityUser.id}, ${session.identityUser.email ?? null}, ${await sha256Hex(token)}, ${expiresAt})
  `;
  await recordOperation(session, dealershipId, "impersonate_start", {
    impersonationId: id,
    actorEmail: session.identityUser.email ?? null,
    reason: cleanText(body?.reason, 500) || null,
    expiresAt,
  });
  return json({ token, expiresAt, dealership }, 201);
};

export const endImpersonation = async (session, request, impersonationHeader) => {
  if (!session.platformAdmin) return json({ error: "Platform owner access is required." }, 403);
  const token = request.headers.get(impersonationHeader);
  if (!token) return json({ ended: false });
  const [ended] = await getDb().sql`
    UPDATE carnova_impersonations SET ended_at = NOW()
    WHERE token_hash = ${await sha256Hex(token)} AND actor_identity_user_id = ${session.identityUser.id} AND ended_at IS NULL
    RETURNING id, dealership_id
  `;
  if (ended) await recordOperation(session, ended.dealership_id, "impersonate_end", { impersonationId: ended.id });
  return json({ ended: Boolean(ended) });
};

/* ----------------------------- Analytics ----------------------------- */

export const analytics = async (session, url) => {
  if (!canManage(session)) return forbidden();
  const days = Math.max(1, Math.min(365, Number(url.searchParams.get("days")) || 30));
  const db = getDb();
  const id = session.dealership.id;
  const [[response], [appointments], sources, daily] = await Promise.all([
    db.sql`
      SELECT
        COUNT(*)::int AS leads,
        COUNT(first_response_at)::int AS responded,
        ROUND(AVG(EXTRACT(EPOCH FROM (first_response_at - created_at))))::int AS avg_seconds,
        ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (first_response_at - created_at))))::int AS median_seconds,
        COUNT(*) FILTER (WHERE first_response_at - created_at <= INTERVAL '60 seconds')::int AS within_60s
      FROM carnova_crm_leads
      WHERE dealership_id = ${id} AND created_at >= NOW() - make_interval(days => ${days})
    `,
    db.sql`
      SELECT
        COUNT(*)::int AS set,
        COUNT(*) FILTER (WHERE status = 'showed')::int AS showed,
        COUNT(*) FILTER (WHERE status = 'no_show' OR (starts_at < NOW() - INTERVAL '30 minutes' AND status IN ('scheduled', 'confirmed', 'rescheduled')))::int AS missed,
        COUNT(*) FILTER (WHERE confirmation_notes = 'Booked by Andy over SMS.')::int AS booked_by_andy
      FROM carnova_appointments
      WHERE dealership_id = ${id} AND created_at >= NOW() - make_interval(days => ${days}) AND status <> 'cancelled'
    `,
    db.sql`
      SELECT COALESCE(NULLIF(l.source, ''), 'unknown') AS source, COUNT(*)::int AS leads,
        COUNT(DISTINCT a.lead_id)::int AS appointments,
        COUNT(*) FILTER (WHERE l.status = 'sold')::int AS sold
      FROM carnova_crm_leads l
      LEFT JOIN carnova_appointments a ON a.lead_id = l.id AND a.dealership_id = l.dealership_id AND a.status <> 'cancelled'
      WHERE l.dealership_id = ${id} AND l.created_at >= NOW() - make_interval(days => ${days})
      GROUP BY 1 ORDER BY leads DESC LIMIT 20
    `,
    db.sql`
      SELECT TO_CHAR(DATE_TRUNC('day', created_at AT TIME ZONE ${session.dealership.timezone || "UTC"}), 'YYYY-MM-DD') AS day,
        COUNT(*)::int AS leads
      FROM carnova_crm_leads
      WHERE dealership_id = ${id} AND created_at >= NOW() - make_interval(days => ${days})
      GROUP BY 1 ORDER BY 1
    `,
  ]);
  const completed = appointments.showed + appointments.missed;
  return json({
    days,
    responseTime: response,
    appointments: { ...appointments, showRate: completed ? Math.round((appointments.showed / completed) * 1000) / 10 : null },
    sources,
    daily,
  });
};
