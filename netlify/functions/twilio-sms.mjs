// Twilio webhook for inbound customer texts and delivery status callbacks.
// Requests must carry a valid X-Twilio-Signature. STOP/UNSUBSCRIBE/CANCEL/
// END/QUIT record an opt-out, revoke consent, and get one confirmation. HELP
// gets the dealership's name and phone. Any other reply stops the follow-up
// sequence, raises urgent-keyword alerts, and goes to escalation handling or
// Andy (who only texts back when the consent gate passes).

import { createEvent, getDb } from "../lib/crm.mjs";
import { stopSequence } from "../lib/appointments.mjs";
import { upsertInboundLead } from "../lib/lead-intake.mjs";
import { loadDealership } from "../lib/notify.mjs";
import { isHelpMessage, isOptOutMessage, normalizePhone, recordOptOut, validateTwilioRequest } from "../lib/sms.mjs";
import { handleUrgentMessage } from "../lib/urgent.mjs";
import { runAfterResponse } from "../lib/webhooks.mjs";

const OPT_IN_KEYWORDS = ["START", "UNSTOP", "YES"];

const escapeXml = (value) =>
  String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);

const twiml = (message = null) =>
  new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${message ? `<Message>${escapeXml(message)}</Message>` : ""}</Response>`,
    { headers: { "content-type": "text/xml" } },
  );

const candidateUrls = (request) => {
  const actual = new URL(request.url);
  const urls = new Set([request.url]);
  if (process.env.URL) {
    urls.add(`${process.env.URL}/api/twilio-sms${actual.search}`);
    urls.add(`${process.env.URL}/.netlify/functions/twilio-sms${actual.search}`);
  }
  return [...urls];
};

const isSigned = async (request, params) => {
  const signature = request.headers.get("x-twilio-signature");
  for (const url of candidateUrls(request)) if (await validateTwilioRequest(url, params, signature)) return true;
  return false;
};

/** Dealerships this text belongs to: the one that owns the number, else those that texted this phone. */
const resolveDealerships = async (db, to, from) => {
  if (to) {
    const owned = await db.sql`SELECT id FROM carnova_dealerships WHERE sms_from_number = ${to} AND platform_status = 'active'`;
    if (owned.length) return owned.map((row) => row.id);
  }
  const rows = await db.sql`
    SELECT l.dealership_id, MAX(COALESCE(l.last_contact_at, l.created_at)) AS last_at
    FROM carnova_crm_leads l
    JOIN carnova_dealerships d ON d.id = l.dealership_id AND d.platform_status = 'active'
    WHERE l.phone_e164 = ${from}
    GROUP BY l.dealership_id ORDER BY last_at DESC
  `;
  return rows.map((row) => row.dealership_id);
};

const handleStatus = async (db, params) => {
  if (!params.MessageSid) return;
  await db.sql`
    UPDATE carnova_messages SET delivery_status = ${params.MessageStatus || null},
      delivery_error = ${params.ErrorCode ? `Twilio error ${params.ErrorCode}` : null}
    WHERE external_id = ${params.MessageSid}
  `;
};

const handleReply = async ({ db, dealershipId, from, body }) => {
  let [lead] = await db.sql`
    SELECT * FROM carnova_crm_leads WHERE dealership_id = ${dealershipId} AND phone_e164 = ${from}
    ORDER BY created_at DESC LIMIT 1
  `;
  if (!lead) ({ lead } = await upsertInboundLead({ dealershipId, input: { phone: from, source: "sms" }, channel: "sms" }));
  await db.sql`
    INSERT INTO carnova_messages (id, dealership_id, lead_id, direction, sender_type, content, channel)
    VALUES (${crypto.randomUUID()}, ${dealershipId}, ${lead.id}, 'inbound', 'customer', ${body}, 'sms')
  `;
  await db.sql`
    UPDATE carnova_crm_leads SET last_inbound_at = NOW(),
      status = CASE WHEN status IN ('new', 'contacted', 'nurture') THEN 'engaged' ELSE status END,
      updated_at = NOW()
    WHERE id = ${lead.id} AND dealership_id = ${dealershipId}
  `;
  await stopSequence(db, dealershipId, lead.id, "replied");
  await createEvent({ dealershipId, leadId: lead.id, type: "message.received", payload: { channel: "sms" } });
  return lead;
};

export default async (request, context) => {
  try {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (!process.env.TWILIO_AUTH_TOKEN) return new Response("SMS is not configured.", { status: 503 });
    const params = Object.fromEntries(new URLSearchParams(await request.text()));
    if (!(await isSigned(request, params))) return new Response("Invalid signature", { status: 403 });

    const db = getDb();
    const url = new URL(request.url);
    if (url.searchParams.get("event") === "status" || (params.MessageStatus && !params.Body)) {
      await handleStatus(db, params);
      return new Response(null, { status: 204 });
    }

    const from = normalizePhone(params.From);
    const to = normalizePhone(params.To);
    const body = String(params.Body || "").trim().slice(0, 2000);
    if (!from || !body) return twiml();
    const dealershipIds = await resolveDealerships(db, to, from);
    if (!dealershipIds.length) return twiml();

    const keyword = body.replace(/[.!\s]+$/g, "").toUpperCase();
    if (isOptOutMessage(body)) {
      // With a shared number, opting out applies to every dealership that texted this phone.
      let isNew = false;
      for (const dealershipId of dealershipIds) {
        const [lead] = await db.sql`SELECT id FROM carnova_crm_leads WHERE dealership_id = ${dealershipId} AND phone_e164 = ${from} LIMIT 1`;
        if (await recordOptOut(db, { dealershipId, phone: from, keyword, leadId: lead?.id ?? null })) isNew = true;
        if (lead) await createEvent({ dealershipId, leadId: lead.id, type: "lead.opted_out", payload: { keyword } });
      }
      if (!isNew) return twiml();
      // Exactly one confirmation per opt-out.
      const dealership = await loadDealership(db, dealershipIds[0]);
      await db.sql`
        UPDATE carnova_opt_outs SET confirmation_sent_at = NOW()
        WHERE phone = ${from} AND dealership_id = ANY(${dealershipIds}::text[]) AND confirmation_sent_at IS NULL
      `;
      return twiml(
        `You're unsubscribed from ${dealership?.name ?? "our"} texts and will get no more messages. Reply START to resubscribe.`,
      );
    }
    if (isHelpMessage(body)) {
      const dealership = await loadDealership(db, dealershipIds[0]);
      await createEvent({ dealershipId: dealershipIds[0], type: "sms.help_requested", payload: {} });
      return twiml(
        `${dealership?.name ?? "Dealership"}: ${dealership?.phone ? `call or text us at ${dealership.phone}` : "reply here and our team will help"}. Msg & data rates may apply. Reply STOP to opt out.`,
      );
    }
    if (OPT_IN_KEYWORDS.includes(keyword)) {
      const [optOut] = await db.sql`
        DELETE FROM carnova_opt_outs WHERE dealership_id = ${dealershipIds[0]} AND phone = ${from} RETURNING id
      `;
      if (optOut) return twiml();
    }

    const dealershipId = dealershipIds[0];
    const lead = await handleReply({ db, dealershipId, from, body });
    await runAfterResponse(
      context,
      (async () => {
        const dealership = await loadDealership(db, dealershipId);
        await handleUrgentMessage({ dealership, lead, text: body, channel: "sms" }).catch((error) =>
          console.error("Urgent alert failed", error.message),
        );
        const { respondToLead } = await import("../lib/andy.mjs");
        await respondToLead({ dealershipId, leadId: lead.id, inboundText: body });
      })(),
    );
    return twiml();
  } catch (error) {
    console.error("Twilio webhook failed", error.message);
    return twiml();
  }
};
