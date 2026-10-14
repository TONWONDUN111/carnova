// Twilio SMS delivery for customer and staff texts.
//
// Credentials come only from Netlify environment variables and are never
// logged. Every customer text is checked against carnova_opt_outs first and
// ends with the opt-out footer.

import { getDb } from "./crm.mjs";

export const OPT_OUT_FOOTER = "Reply STOP to opt out";
export const OPT_OUT_KEYWORDS = ["STOP", "UNSUBSCRIBE", "CANCEL", "STOPALL", "END", "QUIT"];

export const normalizePhone = (value) => {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+") && digits.length >= 10 && digits.length <= 15)
    return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
};

export const isOptOutMessage = (text) =>
  OPT_OUT_KEYWORDS.includes(
    String(text || "")
      .trim()
      .replace(/[.!\s]+$/g, "")
      .toUpperCase(),
  );

export const withOptOutFooter = (text) => {
  const body = String(text || "").trim();
  return body.endsWith(OPT_OUT_FOOTER) ? body : `${body} ${OPT_OUT_FOOTER}`;
};

export const twilioConfigured = () =>
  Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      (process.env.TWILIO_MESSAGING_SERVICE_SID || process.env.TWILIO_FROM_NUMBER),
  );

export const isOptedOut = async (db, dealershipId, phone) => {
  if (!phone) return false;
  const [row] = await db.sql`
    SELECT 1 FROM carnova_opt_outs WHERE dealership_id = ${dealershipId} AND phone = ${phone} LIMIT 1
  `;
  return Boolean(row);
};

export const recordOptOut = async (db, { dealershipId, phone, keyword, leadId = null }) => {
  await db.sql`
    INSERT INTO carnova_opt_outs (id, dealership_id, phone, keyword, lead_id)
    VALUES (${crypto.randomUUID()}, ${dealershipId}, ${phone}, ${keyword}, ${leadId})
    ON CONFLICT (dealership_id, phone) DO NOTHING
  `;
  await db.sql`
    UPDATE carnova_crm_leads SET
      follow_up_enabled = FALSE,
      sequence_stopped_at = COALESCE(sequence_stopped_at, NOW()),
      sequence_stop_reason = COALESCE(sequence_stop_reason, 'opted_out'),
      sequence_next_at = NULL, updated_at = NOW()
    WHERE dealership_id = ${dealershipId} AND phone_e164 = ${phone}
  `;
};

/** Low-level Twilio send. Returns { ok, sid, status, error }. */
export const twilioSend = async ({ to, body, from = null, fetchImpl = fetch }) => {
  if (!twilioConfigured())
    return { ok: false, status: "not_configured", error: "Twilio is not configured." };
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const params = new URLSearchParams({ To: to, Body: body });
  if (from) params.set("From", from);
  else if (process.env.TWILIO_MESSAGING_SERVICE_SID)
    params.set("MessagingServiceSid", process.env.TWILIO_MESSAGING_SERVICE_SID);
  else params.set("From", process.env.TWILIO_FROM_NUMBER);
  const statusCallback = process.env.URL
    ? `${process.env.URL}/api/twilio-sms?event=status`
    : null;
  if (statusCallback) params.set("StatusCallback", statusCallback);
  try {
    const response = await fetchImpl(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          authorization: `Basic ${btoa(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`)}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: params,
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
      return {
        ok: false,
        status: "failed",
        error: payload?.message || `Twilio returned ${response.status}.`,
      };
    return { ok: true, sid: payload.sid, status: payload.status || "queued" };
  } catch (error) {
    return { ok: false, status: "failed", error: `Twilio unreachable: ${error.message}` };
  }
};

/**
 * Text a customer on behalf of a dealership and record it on the lead's
 * conversation. Refuses opted-out numbers.
 */
export const sendCustomerSms = async ({
  dealership,
  lead,
  body,
  senderType = "ai",
  senderUserId = null,
  kind = "reply",
}) => {
  const db = getDb();
  const to = lead.phone_e164 || normalizePhone(lead.phone);
  if (!to) return { sent: false, reason: "no_phone" };
  if (await isOptedOut(db, dealership.id, to)) return { sent: false, reason: "opted_out" };
  const text = withOptOutFooter(body);
  const result = await twilioSend({ to, body: text, from: dealership.sms_from_number || dealership.smsFromNumber || null });
  const [message] = await db.sql`
    INSERT INTO carnova_messages (
      id, dealership_id, lead_id, direction, sender_type, sender_user_id, content, channel,
      external_id, delivery_status, delivery_error
    ) VALUES (
      ${crypto.randomUUID()}, ${dealership.id}, ${lead.id}, 'outbound', ${senderType},
      ${senderUserId}, ${text}, 'sms', ${result.sid ?? null}, ${result.status}, ${result.error ?? null}
    ) RETURNING *
  `;
  await db.sql`
    UPDATE carnova_crm_leads SET
      last_contact_at = NOW(),
      first_response_at = COALESCE(first_response_at, CASE WHEN ${result.ok} THEN NOW() ELSE NULL END),
      status = CASE WHEN status = 'new' THEN 'contacted' ELSE status END,
      updated_at = NOW()
    WHERE id = ${lead.id} AND dealership_id = ${dealership.id}
  `;
  if (!result.ok)
    console.error("Customer SMS not delivered", { leadId: lead.id, kind, status: result.status });
  return { sent: result.ok, reason: result.ok ? null : result.status, error: result.error, message };
};

/** Internal staff notification text. Staff numbers are not marketing recipients. */
export const sendStaffSms = async ({ dealership, to, body }) => {
  const phone = normalizePhone(to);
  if (!phone) return { sent: false, reason: "no_phone" };
  const result = await twilioSend({ to: phone, body, from: dealership.sms_from_number || dealership.smsFromNumber || null });
  if (!result.ok) console.error("Staff SMS not delivered", { status: result.status });
  return { sent: result.ok, reason: result.status };
};

/**
 * Twilio request validation: HMAC-SHA1 over the full URL followed by every
 * POST parameter name and value sorted by name, base64 encoded.
 */
export const computeTwilioSignature = async (authToken, url, params) => {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((key) => `${key}${params[key]}`)
      .join("");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
};

export const validateTwilioRequest = async (url, params, signature) => {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token || !signature) return false;
  const expected = await computeTwilioSignature(token, url, params);
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let index = 0; index < expected.length; index += 1)
    diff |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  return diff === 0;
};
