// Website chat widget backend.
//
// GET  /api/widget-chat?d=<inbound token>  -> public widget config
// POST /api/widget-chat                    -> { d, sessionId, message, history }
//                                             or { d, sessionId, contact }
//
// Andy answers website visitors with his existing prompt; the dealership's
// tone setting and website-chat context are appended after it, never edited
// into it. A phone number is only collected through the contact form, which
// shows the TCPA consent checkbox (optional, unchecked) before the phone field.
// The widget must be switched on in Settings.

import { ANDY_PROMPT, parseAndyOutput } from "../lib/andy.mjs";
import { stopSequence } from "../lib/appointments.mjs";
import { disclosureText, requestFingerprint } from "../lib/consent.mjs";
import { cleanText, createEvent, getDb } from "../lib/crm.mjs";
import { ingestLead } from "../lib/lead-intake.mjs";
import { loadDealership, notifyTeam } from "../lib/notify.mjs";
import { normalizePhone } from "../lib/sms.mjs";
import { handleUrgentMessage } from "../lib/urgent.mjs";
import { dealershipByInboundToken } from "../lib/webhooks.mjs";
import { DEFAULT_MODEL, detectEscalation, extractText } from "./chat.mjs";

export const config = {
  path: "/api/widget-chat",
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
};

export const WIDGET_TONES = {
  friendly: "TONE: warm, upbeat and casual, like a helpful neighbor.",
  professional: "TONE: polished and courteous, no slang.",
  direct: "TONE: brief and to the point, no small talk.",
};

const MAX_TURNS = 20;
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

export const widgetSettings = (dealership) => {
  const saved = dealership?.settings?.widget ?? {};
  return {
    enabled: saved.enabled === true,
    tone: WIDGET_TONES[saved.tone] ? saved.tone : "friendly",
    chime: saved.chime !== false,
    greeting:
      cleanText(saved.greeting, 300) ||
      `Hi! I'm Andy with ${dealership?.name ?? "the dealership"}. Looking for a specific vehicle?`,
  };
};

const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "GET, POST, OPTIONS" };
const reply = (data, status = 200) =>
  Response.json(data, { status, headers: { "cache-control": "no-store", ...cors } });

const sha256 = async (value) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const cleanHistory = (history) =>
  (Array.isArray(history) ? history : [])
    .slice(-MAX_TURNS)
    .map((turn) => ({ role: turn?.role === "assistant" ? "assistant" : "user", content: cleanText(turn?.content, 1000) }))
    .filter((turn) => turn.content);

const widgetSystemPrompt = (dealership, settings) => {
  const facts = {
    dealership: { name: dealership.name, address: dealership.address, phone: dealership.phone, timezone: dealership.timezone },
    businessHours: dealership.settings?.business_hours ?? null,
    APPOINTMENT_SLOTS: [],
  };
  return `${ANDY_PROMPT}

${WIDGET_TONES[settings.tone]}

CHANNEL: this is the chat window on the dealership's website, not SMS. No inventory records are attached here, so do not state vehicle facts; say the team will check. To set a time, ask the visitor to tap "Text me" and leave their name and mobile number so the team can confirm. Always set book_slot to null.

SOURCE OF TRUTH (private): ${JSON.stringify(facts)}`;
};

const askAndy = async (dealership, settings, messages) => {
  if (!process.env.ANTHROPIC_API_KEY) return null;
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
      system: widgetSystemPrompt(dealership, settings),
      messages,
    }),
  });
  if (!response.ok) {
    console.error("Widget AI request failed", { status: response.status });
    return null;
  }
  return parseAndyOutput(extractText(await response.json()))?.reply ?? null;
};

const leadForSession = async (db, dealershipId, sessionId) => {
  if (!sessionId) return null;
  const [lead] = await db.sql`
    SELECT * FROM carnova_crm_leads
    WHERE dealership_id = ${dealershipId} AND widget_session_hash = ${await sha256(sessionId)}
    ORDER BY created_at DESC LIMIT 1
  `;
  return lead ?? null;
};

const saveMessage = (db, dealershipId, leadId, direction, content) =>
  db.sql`
    INSERT INTO carnova_messages (id, dealership_id, lead_id, direction, sender_type, content, channel)
    VALUES (${crypto.randomUUID()}, ${dealershipId}, ${leadId}, ${direction},
      ${direction === "inbound" ? "customer" : "ai"}, ${content}, 'chat')
  `;

const handleContact = async ({ request, context, db, dealership, sessionId, contact, history }) => {
  const name = cleanText(contact?.name, 160);
  const phone = normalizePhone(cleanText(contact?.phone, 40));
  if (!name) return reply({ error: "Please enter your name." }, 400);
  if (!phone) return reply({ error: "Please enter a valid mobile number." }, 400);
  const consented = contact?.consent === true;
  const visitorLines = history.filter((turn) => turn.role === "user").map((turn) => turn.content);
  const { leadId } = await ingestLead({
    dealershipId: dealership.id,
    channel: "chat",
    input: {
      name,
      phone,
      email: cleanText(contact?.email, 254),
      postalCode: cleanText(contact?.zip, 10),
      comments: visitorLines.join("\n").slice(0, 4000) || null,
      source: "website_chat",
      consent: consented ? { source: "chat", ...requestFingerprint(request, context) } : null,
    },
  });
  await db.sql`
    UPDATE carnova_crm_leads SET widget_session_hash = ${await sha256(sessionId)}, updated_at = NOW()
    WHERE id = ${leadId} AND dealership_id = ${dealership.id}
  `;
  const [lead] = await db.sql`SELECT * FROM carnova_crm_leads WHERE id = ${leadId}`;
  // Urgent words said before the visitor left their number still alert the owner.
  for (const line of visitorLines)
    if (await handleUrgentMessage({ dealership, lead, text: line, channel: "chat" })) break;
  return reply({
    ok: true,
    message: consented
      ? `Thanks ${name.split(" ")[0]}! Watch for a text from ${dealership.name} shortly.`
      : `Thanks ${name.split(" ")[0]}! Someone from ${dealership.name} will reach out soon.`,
  });
};

const handleMessage = async ({ db, dealership, settings, sessionId, message, history }) => {
  const lead = await leadForSession(db, dealership.id, sessionId);
  const escalation = detectEscalation(message);
  if (lead) {
    await saveMessage(db, dealership.id, lead.id, "inbound", message);
    // The customer replied: the follow-up sequence stops and Andy takes over.
    await stopSequence(db, dealership.id, lead.id, "replied");
    await db.sql`UPDATE carnova_crm_leads SET last_inbound_at = NOW(), updated_at = NOW() WHERE id = ${lead.id}`;
    await handleUrgentMessage({ dealership, lead, text: message, channel: "chat" });
    if (escalation) {
      await db.sql`
        UPDATE carnova_crm_leads SET ai_enabled = FALSE, human_handoff_required = TRUE,
          human_handoff_reason = ${escalation.reason}, human_handoff_requested_at = NOW(), updated_at = NOW()
        WHERE id = ${lead.id} AND dealership_id = ${dealership.id}
      `;
      await notifyTeam({
        dealership,
        lead,
        audience: ["sales", "manager"],
        type: "human_handoff",
        severity: "critical",
        title: "Customer needs a person",
        message: `${lead.name} (website chat): "${escalation.reason}". Auto-messages are paused for this lead.`,
      });
    } else if (!lead.ai_enabled) {
      return reply({ reply: "Thanks! A team member has your conversation and will reply shortly." });
    }
  }
  if (escalation) {
    const text = lead
      ? "Absolutely. A team member will follow up with you shortly."
      : "Absolutely. A team member will follow up. Tap \"Text me\" and leave your name and number so they can reach you.";
    if (lead) await saveMessage(db, dealership.id, lead.id, "outbound", text);
    return reply({ reply: text, askContact: !lead });
  }
  const messages = [...history, { role: "user", content: message }];
  while (messages.length && messages[0].role !== "user") messages.shift();
  const text =
    (await askAndy(dealership, settings, messages).catch(() => null)) ||
    "Thanks! Tap \"Text me\" and leave your number, and the team will get right back to you.";
  if (lead) await saveMessage(db, dealership.id, lead.id, "outbound", text);
  await createEvent({ dealershipId: dealership.id, leadId: lead?.id ?? null, type: "widget.replied", payload: {} });
  return reply({ reply: text, askContact: !lead && history.length >= 2 });
};

export default async (request, context) => {
  try {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    if (request.method === "GET") {
      const row = await dealershipByInboundToken(url.searchParams.get("d"));
      const dealership = row ? await loadDealership(getDb(), row.id) : null;
      const settings = widgetSettings(dealership);
      if (!dealership || !settings.enabled) return reply({ error: "Chat is not available." }, 404);
      return reply({
        name: dealership.name,
        greeting: settings.greeting,
        chime: settings.chime,
        color: /^#[0-9a-f]{6}$/i.test(dealership.brand_primary || "") ? dealership.brand_primary : "#244a68",
        disclosure: disclosureText(dealership.name),
      });
    }
    if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);
    const body = await request.json().catch(() => ({}));
    const row = await dealershipByInboundToken(body?.d);
    const db = getDb();
    const dealership = row ? await loadDealership(db, row.id) : null;
    const settings = widgetSettings(dealership);
    if (!dealership || !settings.enabled) return reply({ error: "Chat is not available." }, 404);
    const sessionId = cleanText(body?.sessionId, 100);
    if (!sessionId || sessionId.length < 16) return reply({ error: "Missing chat session." }, 400);
    const history = cleanHistory(body?.history);
    if (body?.contact) return handleContact({ request, context, db, dealership, sessionId, contact: body.contact, history });
    const message = cleanText(body?.message, 1000);
    if (!message) return reply({ error: "Type a message first." }, 400);
    if (history.length >= MAX_TURNS) return reply({ reply: "Tap \"Text me\" and the team will pick this up with you directly.", askContact: true });
    return handleMessage({ db, dealership, settings, sessionId, message, history });
  } catch (error) {
    console.error("Widget chat failed", error.message);
    return reply({ error: "Chat is unavailable right now. Please call the dealership." }, 500);
  }
};
