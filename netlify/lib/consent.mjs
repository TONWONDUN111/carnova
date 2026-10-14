// TCPA consent: the gate for every automated customer text.
//
// A lead may receive automated or AI texts only when all of these hold:
//   1. the dealership has automated texting switched on (off by default),
//   2. an unrevoked consent record exists for that phone at that dealership,
//   3. the phone is not on the opt-out list.
// Manual texts typed by a salesperson are not automated and skip 1 and 2,
// but never skip the opt-out list.

export const DISCLOSURE_VERSION = "2026-10-14.v1";

export const disclosureText = (dealershipName) =>
  `By checking this box, I agree to receive calls and text messages, including automated and AI-generated messages, from ${String(dealershipName || "the dealership").trim()} at the number provided, about vehicles, appointments, and offers. Consent is not a condition of purchase. Msg & data rates may apply. Msg frequency varies. Reply STOP to opt out, HELP for help.`;

export const CONSENT_SOURCES = ["form", "chat", "manual"];

/** Automated texting is opt-in per dealership. */
export const automatedTextingEnabled = (dealership) =>
  dealership?.settings?.automated_texting?.enabled === true;

/** The client IP and user agent of a public request, for the consent record. */
export const requestFingerprint = (request, context) => ({
  ipAddress:
    context?.ip ||
    request.headers.get("x-nf-client-connection-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    null,
  userAgent: request.headers.get("user-agent")?.slice(0, 500) || null,
});

export const recordConsent = async (
  db,
  { dealershipId, leadId = null, phone, source, dealershipName, ipAddress = null, userAgent = null, recordedByUserId = null },
) => {
  if (!phone || !CONSENT_SOURCES.includes(source)) return null;
  const [row] = await db.sql`
    INSERT INTO carnova_consents (
      id, dealership_id, lead_id, phone, source, disclosure_version, disclosure_text,
      ip_address, user_agent, recorded_by_user_id
    ) VALUES (
      ${crypto.randomUUID()}, ${dealershipId}, ${leadId}, ${phone}, ${source}, ${DISCLOSURE_VERSION},
      ${disclosureText(dealershipName)}, ${ipAddress}, ${userAgent}, ${recordedByUserId}
    ) RETURNING *
  `;
  return row;
};

/** Links consent rows captured before the lead existed (by phone). */
export const attachConsentToLead = async (db, { dealershipId, leadId, phone }) => {
  if (!phone) return;
  await db.sql`
    UPDATE carnova_consents SET lead_id = ${leadId}
    WHERE dealership_id = ${dealershipId} AND phone = ${phone} AND lead_id IS NULL
  `;
};

export const hasConsent = async (db, dealershipId, phone) => {
  if (!phone) return false;
  const [row] = await db.sql`
    SELECT 1 FROM carnova_consents
    WHERE dealership_id = ${dealershipId} AND phone = ${phone} AND revoked_at IS NULL
    LIMIT 1
  `;
  return Boolean(row);
};

export const revokeConsent = async (db, { dealershipId, phone, reason }) => {
  await db.sql`
    UPDATE carnova_consents SET revoked_at = NOW(), revoked_reason = ${reason}
    WHERE dealership_id = ${dealershipId} AND phone = ${phone} AND revoked_at IS NULL
  `;
};

/**
 * Why an automated text to this lead is blocked, or null when it may go out.
 * Opt-outs are checked separately by the SMS layer for every text.
 */
export const automatedBlockReason = async (db, dealership, phone) => {
  if (!automatedTextingEnabled(dealership)) return "automated_texting_off";
  if (!(await hasConsent(db, dealership.id, phone))) return "no_consent";
  return null;
};
