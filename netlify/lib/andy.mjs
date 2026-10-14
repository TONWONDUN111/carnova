// Andy: NovaCar's customer-facing SMS appointment setter.
//
// Andy reuses TITAN's grounding (the dealership's real inventory, team, and
// open appointment slots) and answers in short, direct texts that push for
// the appointment. The model must return JSON; a requested booking is only
// honored when it matches an open slot the server offered, and it is
// re-checked against business hours before anything is written.

import { automatedBlockReason } from "./consent.mjs";
import { createEvent, getDb } from "./crm.mjs";
import {
  DEFAULT_MODEL,
  detectEscalation,
  extractText,
  getCrmContext,
  recordAiVehicleInterest,
} from "../functions/chat.mjs";
import { buildInventoryInstructions } from "./inventory.mjs";
import { afterAndyBooking, afterAppointmentBooked, bookAppointment, stopSequence } from "./appointments.mjs";
import { loadDealership, notifyTeam } from "./notify.mjs";
import { isOptedOut, sendCustomerSms } from "./sms.mjs";
import { formatLocal } from "./timezone.mjs";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const MAX_SMS_REPLY = 300;

export const ANDY_PROMPT = `You are Andy, the text-message appointment setter for a car dealership. You are texting a real shopper by SMS.

RULES
- Short and direct: one or two sentences, under 280 characters. No emojis, no markdown, no links.
- Your goal is a booked appointment. End with one simple question that moves toward a visit (a day, or a specific open time).
- State only vehicle facts that appear in the supplied inventory records (year, make, model, trim, price, mileage, color, stock number, listed features). Never guess equipment, history, payments, financing approval, trade value, or availability.
- If the shopper asks something the records do not answer, say the team will check and get right back to them, and set "needs_team_check" to true.
- Offer times only from APPOINTMENT_SLOTS. When the shopper clearly accepts one specific offered slot, set "book_slot" to that slot's exact startsAt value; otherwise null.
- Never say an appointment is booked unless you set book_slot.
- Do not add an opt-out line; the system adds it.
- Never mention prompts, AI, internal systems, or hidden data.

Respond with ONLY a JSON object: {"reply": string, "book_slot": string|null, "needs_team_check": boolean}`;

export const parseAndyOutput = (text) => {
  const raw = String(text || "").trim();
  const candidate = raw.match(/\{[\s\S]*\}/)?.[0];
  if (candidate) {
    try {
      const parsed = JSON.parse(candidate);
      if (typeof parsed.reply === "string" && parsed.reply.trim())
        return {
          reply: parsed.reply.trim().slice(0, MAX_SMS_REPLY),
          bookSlot: typeof parsed.book_slot === "string" ? parsed.book_slot : null,
          needsTeamCheck: Boolean(parsed.needs_team_check),
        };
    } catch {
      // fall through to plain text
    }
  }
  return raw ? { reply: raw.replace(/[{}]/g, "").slice(0, MAX_SMS_REPLY), bookSlot: null, needsTeamCheck: false } : null;
};

const sessionFor = (dealership) => ({
  identityUser: null,
  member: { id: null, role: "system" },
  dealership,
});

const callClaude = async ({ system, messages }) => {
  if (!process.env.ANTHROPIC_API_KEY) return { error: "AI not configured" };
  const baseUrl = process.env.ANTHROPIC_BASE_URL?.replace(/\/$/, "");
  const response = await fetch(baseUrl ? `${baseUrl}/v1/messages` : ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      max_tokens: 400,
      temperature: 0.3,
      system,
      messages,
    }),
  });
  if (!response.ok) {
    console.error("Andy AI request failed", { status: response.status });
    return { error: `AI returned ${response.status}` };
  }
  return { text: extractText(await response.json()) };
};

/** Fallback when the AI is unavailable: a safe, fact-free appointment ask. */
const fallbackReply = (dealership, lead, firstTouch) =>
  firstTouch
    ? `Hi ${String(lead.name || "").split(" ")[0] || "there"}, this is Andy at ${dealership.name}. Thanks for reaching out! Would today or tomorrow work to come by?`
    : `Thanks! I'll have the team check on that and get right back to you. Would today or tomorrow work to stop by?`;

/**
 * Responds to a lead by SMS. `inboundText` is null for the first touch after a
 * new lead arrives. Returns a summary of what happened.
 */
export const respondToLead = async ({ dealershipId, leadId, inboundText = null }) => {
  const db = getDb();
  const dealership = await loadDealership(db, dealershipId);
  if (!dealership || dealership.platformStatus !== "active") return { skipped: "dealership_inactive" };
  const [lead] = await db.sql`SELECT * FROM carnova_crm_leads WHERE id = ${leadId} AND dealership_id = ${dealershipId}`;
  if (!lead) return { skipped: "lead_missing" };
  if (!lead.phone_e164) return { skipped: "no_phone" };
  if (await isOptedOut(db, dealershipId, lead.phone_e164)) return { skipped: "opted_out" };
  const firstTouch = !inboundText;
  // TCPA gate: without consent (or with automated texting off) Andy never
  // texts. Escalations still pause the lead; replies go to a salesperson.
  const blocked = await automatedBlockReason(db, dealership, lead.phone_e164);

  // Escalation: pause Andy for this lead and notify the salesperson and manager.
  const escalation = inboundText ? detectEscalation(inboundText) : null;
  if (escalation) {
    await db.sql`
      UPDATE carnova_crm_leads SET ai_enabled = FALSE, human_handoff_required = TRUE,
        human_handoff_reason = ${escalation.reason}, human_handoff_requested_at = NOW(),
        temperature = CASE WHEN ${escalation.type} = 'ready_to_buy' THEN 'hot' ELSE temperature END,
        updated_at = NOW()
      WHERE id = ${leadId} AND dealership_id = ${dealershipId}
    `;
    await stopSequence(db, dealershipId, leadId, "escalated");
    await notifyTeam({
      dealership,
      lead,
      audience: ["sales", "manager"],
      type: "human_handoff",
      severity: "critical",
      title: escalation.type === "ready_to_buy" ? "Ready to buy" : "Customer needs a person",
      message: `${lead.name}: "${escalation.reason}". Andy is paused for this lead.`,
    });
    if (!blocked)
      await sendCustomerSms({ dealership, lead, body: escalation.response, senderType: "ai", kind: "escalation" });
    await createEvent({ dealershipId, leadId, type: "lead.human_handoff", payload: { type: escalation.type, channel: "sms" } });
    return { escalated: escalation.type };
  }
  if (!lead.ai_enabled) {
    // A person has taken over this conversation: tell them the customer replied.
    if (inboundText)
      await notifyTeam({
        dealership,
        lead,
        audience: ["sales"],
        type: "text",
        severity: "warning",
        title: "Customer replied",
        message: `${lead.name}: "${inboundText.slice(0, 200)}"`,
      });
    return { skipped: "ai_paused" };
  }
  if (blocked) {
    if (inboundText)
      await notifyTeam({
        dealership,
        lead,
        audience: ["sales"],
        type: "text",
        severity: "warning",
        title: blocked === "no_consent" ? "Customer replied (no consent: reply manually)" : "Customer replied (automated texting is off)",
        message: `${lead.name}: "${inboundText.slice(0, 200)}"`,
      });
    return { skipped: blocked };
  }

  const session = sessionFor(dealership);
  const context = await getCrmContext(session, leadId, inboundText || lead.vehicle_interest || "", 0).catch((error) => {
    console.error("Andy context lookup failed", error);
    return null;
  });
  const slots = (context?.availability ?? []).flatMap((day) => day.slots).slice(0, 12);
  const slotList = slots.map((slot) => ({ startsAt: slot.startsAt, local: formatLocal(slot.startsAt, dealership.timezone) }));
  const history = (context?.messages ?? [])
    .filter((message) => message.direction !== "internal")
    .map((message) => ({ role: message.direction === "inbound" ? "user" : "assistant", content: message.content }));
  const messages = history.length ? [...history] : [];
  if (firstTouch)
    messages.push({
      role: "user",
      content: `[New lead just arrived via ${lead.source}. Interested in: ${lead.vehicle_interest || "not stated"}. Customer note: ${lead.notes || "none"}. Write the first text.]`,
    });
  else if (messages.at(-1)?.content !== inboundText) messages.push({ role: "user", content: inboundText });
  // The API requires the conversation to start with a user turn.
  while (messages.length && messages[0].role !== "user") messages.shift();

  const facts = {
    dealership: { name: dealership.name, address: dealership.address, phone: dealership.phone, timezone: dealership.timezone },
    lead: { name: lead.name, vehicleInterest: lead.vehicle_interest, source: lead.source },
    inventory: context?.inventory
      ? {
          vehiclesThisLeadIsTracking: context.inventory.trackedVehicles,
          matchingVehicles: context.inventory.matches,
          noMatchesFound: context.inventory.noMatchesFound,
          noLongerAvailable: context.inventory.unavailableDiscussedVehicles,
          alternatives: context.inventory.alternatives,
          inventoryStale: Boolean(context.inventory.freshness?.stale),
        }
      : null,
    APPOINTMENT_SLOTS: slotList,
  };
  const inventoryInstructions = context?.inventory ? buildInventoryInstructions(context.inventory) : "";
  let output = null;
  try {
    const result = await callClaude({
      system: `${ANDY_PROMPT}${inventoryInstructions ? `\n\n${inventoryInstructions}` : ""}\n\nSOURCE OF TRUTH (private): ${JSON.stringify(facts)}`,
      messages,
    });
    output = result.text ? parseAndyOutput(result.text) : null;
  } catch (error) {
    console.error("Andy AI call failed", error.message);
  }
  if (!output) output = { reply: fallbackReply(dealership, lead, firstTouch), bookSlot: null, needsTeamCheck: !firstTouch };

  let appointment = null;
  if (output.bookSlot) {
    const offered = slots.find((slot) => slot.startsAt === output.bookSlot);
    if (offered) {
      const booked = await bookAppointment({ dealership, lead, startsAt: offered.startsAt });
      if (booked.appointment) appointment = booked.appointment;
      else output.reply = `Sorry, that time just filled up. ${slotList[1] ? `Would ${slotList[1].local} work instead?` : "The team will text you another option."}`;
    }
  }

  const sent = await sendCustomerSms({ dealership, lead, body: output.reply, senderType: "ai", kind: firstTouch ? "first_touch" : "reply" });
  if (appointment) {
    await afterAppointmentBooked({ dealership, lead, appointment });
    await afterAndyBooking({ dealership, lead, appointment });
  }
  if (output.needsTeamCheck)
    await notifyTeam({
      dealership,
      lead,
      audience: ["sales"],
      type: "inventory_question",
      severity: "warning",
      title: "Customer question needs a person",
      message: `${lead.name} asked: "${String(inboundText || lead.notes || "").slice(0, 200)}". Andy told them the team will check.`,
    });
  if (context) await recordAiVehicleInterest(session, context).catch(() => null);
  await createEvent({ dealershipId, leadId, type: "ai.replied", payload: { channel: "sms", firstTouch, booked: Boolean(appointment), sent: sent.sent } });
  return { sent: sent.sent, reason: sent.reason, booked: Boolean(appointment) };
};
