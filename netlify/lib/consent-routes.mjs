// CRM routes for TCPA consent and urgent flags.

import { automatedTextingEnabled, DISCLOSURE_VERSION, disclosureText, hasConsent, recordConsent } from "./consent.mjs";
import { createEvent, getDb, json } from "./crm.mjs";
import { emailConfigured } from "./email.mjs";
import { firstTextAt } from "./sequence.mjs";
import { isOptedOut, normalizePhone, twilioConfigured } from "./sms.mjs";

/** Consent history for one lead, newest first. */
export const listConsents = async (session, lead) => {
  const db = getDb();
  const phone = lead.phone_e164 || normalizePhone(lead.phone);
  const consents = await db.sql`
    SELECT c.id, c.source, c.disclosure_version, c.disclosure_text, c.ip_address, c.user_agent,
      c.created_at, c.revoked_at, c.revoked_reason, u.name AS recorded_by_name
    FROM carnova_consents c
    LEFT JOIN carnova_users u ON u.id = c.recorded_by_user_id AND u.dealership_id = c.dealership_id
    WHERE c.dealership_id = ${session.dealership.id}
      AND (c.lead_id = ${lead.id} OR (${phone}::text IS NOT NULL AND c.phone = ${phone}))
    ORDER BY c.created_at DESC
  `;
  return json({
    consents,
    disclosure: { version: DISCLOSURE_VERSION, text: disclosureText(session.dealership.name) },
    optedOut: await isOptedOut(db, session.dealership.id, phone),
  });
};

/**
 * A salesperson records consent the customer gave outside the website (in
 * person, on a signed form). The disclosure shown in the CRM is stored with it.
 */
export const recordManualConsent = async (session, lead, body) => {
  const db = getDb();
  const phone = lead.phone_e164 || normalizePhone(lead.phone);
  if (!phone) return json({ error: "Add a valid mobile number to this lead first." }, 400);
  if (body?.confirmed !== true)
    return json({ error: "Confirm the customer agreed to the disclosure." }, 400);
  if (await isOptedOut(db, session.dealership.id, phone))
    return json({ error: "This number replied STOP. The customer must text START before consent can be recorded." }, 409);
  if (await hasConsent(db, session.dealership.id, phone))
    return json({ error: "This lead already has consent on file." }, 409);
  const consent = await recordConsent(db, {
    dealershipId: session.dealership.id,
    leadId: lead.id,
    phone,
    source: "manual",
    dealershipName: session.dealership.name,
    recordedByUserId: session.member.id,
  });
  // A lead whose sequence never started (no consent at intake) starts now.
  await db.sql`
    UPDATE carnova_crm_leads SET phone_e164 = COALESCE(phone_e164, ${phone}),
      sequence_started_at = NOW(), sequence_step = 0, sequence_stopped_at = NULL, sequence_stop_reason = NULL,
      sequence_next_at = ${firstTextAt({ startedAt: new Date(), dealership: session.dealership }).toISOString()},
      updated_at = NOW()
    WHERE id = ${lead.id} AND dealership_id = ${session.dealership.id}
      AND sequence_step = 0 AND follow_up_enabled = TRUE
      AND (sequence_stopped_at IS NULL OR sequence_stop_reason IN ('no_consent', 'automated_texting_off'))
  `;
  await createEvent({
    dealershipId: session.dealership.id,
    leadId: lead.id,
    type: "lead.consent_recorded",
    actorUserId: session.member.id,
    payload: { source: "manual" },
  });
  return json({ consent }, 201);
};

export const resolveUrgent = async (session, lead) => {
  await getDb().sql`
    UPDATE carnova_crm_leads SET urgent_flagged_at = NULL, updated_at = NOW()
    WHERE id = ${lead.id} AND dealership_id = ${session.dealership.id}
  `;
  return json({ ok: true });
};

/** Which messaging pieces are live, for the Settings screen. No values. */
export const messagingStatus = (dealership) => ({
  automatedTexting: automatedTextingEnabled(dealership),
  twilioConfigured: twilioConfigured(),
  emailConfigured: emailConfigured(),
  dealrCalendarConfigured: Boolean(process.env.DEALR_CALENDAR_WEBHOOK_URL),
});
