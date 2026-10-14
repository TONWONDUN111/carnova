import { getDatabase } from "@netlify/database";
import { getUser } from "@netlify/identity";
import { zonedParts, zonedTimeToUtc } from "./timezone.mjs";

export const LEAD_STATUSES = [
  "new",
  "contacted",
  "engaged",
  "qualified",
  "appointment_set",
  "appointment_confirmed",
  "showed",
  "sold",
  "lost",
  "nurture",
];

export const LEAD_TEMPERATURES = ["hot", "warm", "cold"];
export const APPOINTMENT_STATUSES = [
  "requested",
  "scheduled",
  "confirmed",
  "rescheduled",
  "cancelled",
  "showed",
  "no_show",
];
export const USER_ROLES = [
  "owner",
  "admin",
  "manager",
  "bdc",
  "sales",
  "salesperson",
];
/** Roles limited to the leads assigned to them (or not yet assigned). */
export const SALES_ROLES = ["sales", "salesperson"];

export const IMPERSONATION_HEADER = "x-novacar-impersonate";

export const sha256Hex = async (value) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

export const getDb = () => getDatabase();

export const json = (data, status = 200) =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } });

export const cleanText = (value, maxLength = 1000) =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";

export const cleanNumber = (value) => {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export const cleanStringArray = (value, maxItems = 50) => {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  return values
    .map((item) => cleanText(item, 500))
    .filter(Boolean)
    .slice(0, maxItems);
};

/**
 * Employees added on the Team screen have no Identity account yet. The first
 * time someone signs in with a confirmed email that matches exactly one
 * unlinked, active employee record, that record becomes their membership, so
 * they join the existing dealership instead of being sent to onboarding.
 */
const linkInvitedMember = async (db, identityUser) => {
  const email = String(identityUser.email || "").toLowerCase();
  if (!email || !identityUser.confirmedAt) return;
  const [existing] = await db.sql`
    SELECT id FROM carnova_users WHERE identity_user_id = ${identityUser.id} LIMIT 1
  `;
  if (existing) return;
  const candidates = await db.sql`
    SELECT id FROM carnova_users
    WHERE identity_user_id IS NULL AND active = TRUE AND LOWER(email) = ${email}
    LIMIT 2
  `;
  // Ambiguous matches (same email invited by two dealerships) stay unlinked
  // rather than guessing which dealership this person belongs to.
  if (candidates.length !== 1) return;
  await db.sql`
    UPDATE carnova_users SET identity_user_id = ${identityUser.id}, updated_at = NOW()
    WHERE id = ${candidates[0].id} AND identity_user_id IS NULL
  `;
};

const MEMBERSHIP_COLUMNS = `
      u.id, u.dealership_id, u.identity_user_id, u.name, u.email, u.phone, u.role, u.active,
      d.name AS dealership_name, d.slug AS dealership_slug, d.phone AS dealership_phone,
      d.email AS dealership_email, d.website, d.address, d.timezone, d.settings, d.ai_configuration,
      d.platform_status, d.subscription_status, d.subscription_ends_at, d.trim_color,
      d.carnova_feed_enabled, d.logo_key, d.brand_primary, d.brand_accent, d.plan,
      d.inbound_token, d.sms_from_number, d.onboarding_completed_at`;

/**
 * "Log in as": a platform owner holding a live impersonation token acts as the
 * dealership's senior member. Tokens are stored hashed, expire, and are only
 * honored for the platform owner who started them.
 */
const loadImpersonatedMembership = async (db, identityUser, token) => {
  const tokenHash = await sha256Hex(token);
  const [impersonation] = await db.sql`
    SELECT id, dealership_id FROM carnova_impersonations
    WHERE token_hash = ${tokenHash} AND actor_identity_user_id = ${identityUser.id}
      AND ended_at IS NULL AND expires_at > NOW()
    LIMIT 1
  `;
  if (!impersonation) return null;
  const {
    rows: [membership],
  } = await db.pool.query(
    `SELECT ${MEMBERSHIP_COLUMNS}
     FROM carnova_users u JOIN carnova_dealerships d ON d.id = u.dealership_id
     WHERE u.dealership_id = $1 AND u.active = TRUE
     ORDER BY CASE u.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'manager' THEN 2 ELSE 3 END, u.created_at
     LIMIT 1`,
    [impersonation.dealership_id],
  );
  return membership
    ? { ...membership, impersonation_id: impersonation.id }
    : null;
};

export const getSession = async (request = null) => {
  const identityUser = await getUser();
  if (!identityUser)
    return {
      identityUser: null,
      member: null,
      dealership: null,
      platformAdmin: false,
    };

  const platformAdminEmails = String(
    process.env.NOVACARAI_PLATFORM_ADMIN_EMAILS ||
      process.env.PLATFORM_ADMIN_EMAILS ||
      "",
  )
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const platformAdmin = platformAdminEmails.includes(
    String(identityUser.email || "").toLowerCase(),
  );

  const db = getDb();
  await linkInvitedMember(db, identityUser);
  const impersonationToken = request?.headers?.get?.(IMPERSONATION_HEADER);
  let membership =
    platformAdmin && impersonationToken
      ? await loadImpersonatedMembership(db, identityUser, impersonationToken)
      : null;
  if (!membership)
    [membership] = (
      await db.pool.query(
      `SELECT ${MEMBERSHIP_COLUMNS}
       FROM carnova_users u
       JOIN carnova_dealerships d ON d.id = u.dealership_id
       WHERE u.identity_user_id = $1 AND u.active = TRUE
       ORDER BY u.created_at
       LIMIT 1`,
        [identityUser.id],
      )
    ).rows;

  if (!membership)
    return { identityUser, member: null, dealership: null, platformAdmin };

  return {
    identityUser,
    platformAdmin,
    impersonationId: membership.impersonation_id ?? null,
    member: {
      id: membership.id,
      dealershipId: membership.dealership_id,
      identityUserId: membership.identity_user_id,
      name: membership.name,
      email: membership.email,
      phone: membership.phone,
      role: membership.role,
      active: membership.active,
    },
    dealership: {
      id: membership.dealership_id,
      name: membership.dealership_name,
      slug: membership.dealership_slug,
      phone: membership.dealership_phone,
      email: membership.dealership_email,
      website: membership.website,
      address: membership.address,
      timezone: membership.timezone,
      settings: membership.settings ?? {},
      aiConfiguration: membership.ai_configuration ?? {},
      platformStatus: membership.platform_status,
      subscriptionStatus: membership.subscription_status,
      subscriptionEndsAt: membership.subscription_ends_at,
      trimColor: membership.trim_color || "dark_blue",
      carnovaFeedEnabled: Boolean(membership.carnova_feed_enabled),
      logoKey: membership.logo_key ?? null,
      brandPrimary: membership.brand_primary ?? null,
      brandAccent: membership.brand_accent ?? null,
      plan: membership.plan ?? "starter",
      inboundToken: membership.inbound_token ?? null,
      smsFromNumber: membership.sms_from_number ?? null,
      onboardingCompletedAt: membership.onboarding_completed_at ?? null,
    },
  };
};

/**
 * Server-side role check. Owners hold every admin permission, and the new
 * "sales" role holds every "salesperson" permission, so existing checks keep
 * working as the role list grows.
 */
export const hasRole = (member, roles) => {
  if (!member) return false;
  if (roles.includes(member.role)) return true;
  if (member.role === "owner" && roles.includes("admin")) return true;
  if (member.role === "sales" && roles.includes("salesperson")) return true;
  return false;
};

export const createEvent = async ({
  dealershipId,
  leadId = null,
  type,
  actorUserId = null,
  payload = {},
}) => {
  const db = getDb();
  await db.sql`
    INSERT INTO carnova_events (id, dealership_id, lead_id, event_type, actor_user_id, payload)
    VALUES (${crypto.randomUUID()}, ${dealershipId}, ${leadId}, ${type}, ${actorUserId}, ${JSON.stringify(payload)}::jsonb)
  `;
};

export const createAlert = async ({
  dealershipId,
  leadId = null,
  appointmentId = null,
  type,
  severity = "info",
  title,
  message,
}) => {
  const db = getDb();
  await db.sql`
    INSERT INTO carnova_alerts (
      id, dealership_id, lead_id, appointment_id, type, severity, title, message
    ) VALUES (
      ${crypto.randomUUID()}, ${dealershipId}, ${leadId}, ${appointmentId},
      ${type}, ${severity}, ${title}, ${message}
    )
  `;
};

export const localDateTimeToIso = (date, time, offsetMinutes = 0) => {
  const [year, month, day] = String(date).split("-").map(Number);
  const [hour, minute] = String(time).split(":").map(Number);
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
  return new Date(
    Date.UTC(year, month - 1, day, hour, minute) +
      Number(offsetMinutes) * 60000,
  ).toISOString();
};

export const getAvailability = async ({
  dealership,
  date,
  salespersonId = null,
  offsetMinutes = 0,
}) => {
  const db = getDb();
  const settings = dealership.settings ?? {};
  // Slots are generated in the dealership's own timezone. The browser offset
  // is only a fallback for a dealership without a valid timezone.
  const timezone = dealership.timezone;
  const dayOfWeek = new Date(`${date}T12:00:00Z`).getUTCDay();
  const hours =
    settings.business_hours?.[String(dayOfWeek)] ??
    settings.business_hours?.[dayOfWeek];
  if (!Array.isArray(hours) || hours.length !== 2) return [];

  const interval = Math.max(
    15,
    Math.min(120, Number(settings.slot_interval_minutes) || 30),
  );
  const startIso = timezone
    ? zonedTimeToUtc(date, hours[0], timezone)?.toISOString()
    : localDateTimeToIso(date, hours[0], offsetMinutes);
  const endIso = timezone
    ? zonedTimeToUtc(date, hours[1], timezone)?.toISOString()
    : localDateTimeToIso(date, hours[1], offsetMinutes);
  if (!startIso || !endIso) return [];

  const appointments = salespersonId
    ? await db.sql`
        SELECT starts_at, ends_at
        FROM carnova_appointments
        WHERE dealership_id = ${dealership.id}
          AND salesperson_id = ${salespersonId}
          AND status NOT IN ('cancelled', 'no_show')
          AND starts_at < ${endIso}::timestamptz
          AND ends_at > ${startIso}::timestamptz
      `
    : await db.sql`
        SELECT starts_at, ends_at
        FROM carnova_appointments
        WHERE dealership_id = ${dealership.id}
          AND status NOT IN ('cancelled', 'no_show')
          AND starts_at < ${endIso}::timestamptz
          AND ends_at > ${startIso}::timestamptz
      `;
  const [capacityRow] = salespersonId
    ? [{ capacity: 1 }]
    : await db.sql`
        SELECT GREATEST(COUNT(*) FILTER (WHERE role IN ('sales','salesperson','manager','admin','owner') AND active = TRUE), 1)::int AS capacity
        FROM carnova_users WHERE dealership_id = ${dealership.id}
      `;
  const capacity = Number(capacityRow?.capacity) || 1;

  const slots = [];
  for (
    let cursor = new Date(startIso);
    cursor < new Date(endIso);
    cursor = new Date(cursor.getTime() + interval * 60000)
  ) {
    const slotEnd = new Date(cursor.getTime() + interval * 60000);
    if (slotEnd > new Date(endIso)) break;
    const occupiedCount = appointments.filter(
      (appointment) =>
        cursor < new Date(appointment.ends_at) &&
        slotEnd > new Date(appointment.starts_at),
    ).length;
    const occupied = occupiedCount >= capacity;
    if (!occupied && cursor > new Date()) {
      slots.push({
        startsAt: cursor.toISOString(),
        endsAt: slotEnd.toISOString(),
      });
    }
  }
  return slots;
};

/** Today's date in the dealership's timezone, plus `days`. */
export const dealershipLocalDate = (dealership, days = 0) =>
  zonedParts(Date.now() + days * 86400000, dealership?.timezone).date;
