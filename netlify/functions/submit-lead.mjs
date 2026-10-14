import {
  cleanText,
  createAlert,
  createEvent,
  getDb,
  getSession,
  json,
  localDateTimeToIso,
} from "../lib/crm.mjs";

const normalizeConversation = (conversation) =>
  Array.isArray(conversation)
    ? conversation
        .slice(-100)
        .map((message) => ({
          role: message?.role === "assistant" ? "assistant" : "user",
          content: cleanText(message?.content ?? message?.text, 4000),
          timestamp:
            cleanText(message?.timestamp, 80) || new Date().toISOString(),
        }))
        .filter((message) => message.content)
    : [];

export default async (request) => {
  if (request.method !== "POST")
    return json({ error: "Method not allowed" }, 405);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }

  const session = await getSession(request);
  let dealershipId = session.dealership?.id;
  const actorUserId = session.member?.id ?? null;
  if (!dealershipId) {
    const suppliedToken = request.headers.get("x-carnova-lead-token");
    if (
      !process.env.CARNOVA_LEAD_CAPTURE_TOKEN ||
      suppliedToken !== process.env.CARNOVA_LEAD_CAPTURE_TOKEN
    ) {
      return json(
        { error: "Authorized dealership lead capture is required." },
        401,
      );
    }
    dealershipId = cleanText(body?.dealershipId, 100);
    if (!dealershipId)
      return json(
        { error: "dealershipId is required for external lead capture." },
        400,
      );
  }

  const lead = body?.lead && typeof body.lead === "object" ? body.lead : body;
  const name = cleanText(lead?.name, 160);
  const phone = cleanText(lead?.phone, 80) || null;
  const email = cleanText(lead?.email, 320) || null;
  if (!name || (!phone && !email))
    return json(
      { error: "Name and a phone number or email are required." },
      400,
    );

  const db = getDb();
  const id = cleanText(lead?.id, 100) || crypto.randomUUID();
  const conversation = normalizeConversation(
    body?.conversation ?? lead?.conversation,
  );
  const humanAlert = body?.humanAlert ?? lead?.humanAlert;
  const humanHandoffRequired = Boolean(humanAlert?.required ?? humanAlert);
  const humanHandoffReason = cleanText(humanAlert?.reason, 1000) || null;
  const [savedLead] = await db.sql`
    INSERT INTO carnova_crm_leads (
      id, dealership_id, name, phone, email, source, vehicle_interest, trade_in, budget,
      temperature, status, human_handoff_required, human_handoff_reason,
      human_handoff_requested_at, notes, last_contact_at
    ) VALUES (
      ${id}, ${dealershipId}, ${name}, ${phone}, ${email},
      ${cleanText(lead?.source, 120) || "external_capture"},
      ${cleanText(lead?.vehicleInterest ?? lead?.vehicle_interest ?? lead?.vehicle, 300) || null},
      ${cleanText(lead?.tradeIn ?? lead?.trade_in, 500) || null},
      ${cleanText(lead?.budget, 100) || null},
      ${["hot", "warm", "cold"].includes(lead?.temperature) ? lead.temperature : "warm"},
      ${humanHandoffRequired ? "engaged" : "new"}, ${humanHandoffRequired},
      ${humanHandoffReason}, ${humanHandoffRequired ? new Date().toISOString() : null},
      ${cleanText(lead?.notes, 5000) || null}, ${conversation.length ? new Date().toISOString() : null}
    ) ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name, phone = EXCLUDED.phone, email = EXCLUDED.email,
      vehicle_interest = EXCLUDED.vehicle_interest, trade_in = EXCLUDED.trade_in,
      budget = EXCLUDED.budget, human_handoff_required = EXCLUDED.human_handoff_required,
      human_handoff_reason = EXCLUDED.human_handoff_reason,
      human_handoff_requested_at = COALESCE(EXCLUDED.human_handoff_requested_at, carnova_crm_leads.human_handoff_requested_at),
      notes = EXCLUDED.notes, updated_at = NOW()
    WHERE carnova_crm_leads.dealership_id = ${dealershipId}
    RETURNING *
  `;
  if (!savedLead)
    return json({ error: "Lead ID belongs to another dealership." }, 409);

  for (const message of conversation) {
    await db.sql`
      INSERT INTO carnova_messages (id, dealership_id, lead_id, direction, sender_type, content, created_at)
      VALUES (
        ${crypto.randomUUID()}, ${dealershipId}, ${id},
        ${message.role === "assistant" ? "outbound" : "inbound"},
        ${message.role === "assistant" ? "ai" : "customer"},
        ${message.content}, ${message.timestamp}
      )
    `;
  }

  let appointment = null;
  if (body?.appointment?.date && body?.appointment?.time) {
    const startsAt = localDateTimeToIso(
      body.appointment.date,
      body.appointment.time,
      body.appointment.offsetMinutes || 0,
    );
    const endsAt = startsAt
      ? new Date(new Date(startsAt).getTime() + 30 * 60000).toISOString()
      : null;
    if (startsAt && endsAt) {
      [appointment] = await db.sql`
        INSERT INTO carnova_appointments (
          id, dealership_id, lead_id, appointment_type, starts_at, ends_at, status
        ) VALUES (
          ${crypto.randomUUID()}, ${dealershipId}, ${id},
          ${["showroom", "test_drive", "trade_appraisal", "delivery", "finance"].includes(body.appointment.type) ? body.appointment.type : "showroom"},
          ${startsAt}, ${endsAt}, 'requested'
        ) RETURNING *
      `;
      await db.sql`
        UPDATE carnova_crm_leads SET status = 'appointment_set', updated_at = NOW()
        WHERE id = ${id} AND dealership_id = ${dealershipId}
      `;
    }
  }

  await Promise.all([
    createEvent({
      dealershipId,
      leadId: id,
      type: "lead.captured",
      actorUserId,
      payload: { source: savedLead.source },
    }),
    createAlert({
      dealershipId,
      leadId: id,
      type: humanHandoffRequired ? "human_handoff" : "new_lead",
      severity: humanHandoffRequired ? "critical" : "info",
      title: humanHandoffRequired
        ? "HUMAN HANDOFF REQUIRED"
        : "New lead captured",
      message: humanHandoffRequired
        ? `${name}: ${humanHandoffReason || "Customer requested a person."}`
        : `${name} entered the CRM from ${savedLead.source}.`,
    }),
  ]);

  return json({ success: true, leadId: id, appointment }, 201);
};
