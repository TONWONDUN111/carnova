// Urgent keyword alerts: a customer message containing buying or escalation
// language emails the owner right away and flags the conversation in the
// dashboard. Runs for every inbound customer message, with or without
// consent, because it only notifies staff.

import { createAlert, createEvent, getDb } from "./crm.mjs";
import { ownerAlertEmail, sendEmail } from "./email.mjs";

export const URGENT_KEYWORDS = ["buy", "ready", "appointment", "manager", "owner", "human", "speak to someone"];

const URGENT_PATTERN = new RegExp(`\\b(${URGENT_KEYWORDS.map((word) => word.replace(/ /g, "\\s+")).join("|")})\\b`, "i");

/** The first urgent keyword in a message, lowercased, or null. */
export const detectUrgentKeyword = (text) => {
  const match = String(text || "").match(URGENT_PATTERN);
  return match ? match[1].toLowerCase().replace(/\s+/g, " ") : null;
};

export const handleUrgentMessage = async ({ dealership, lead, text, channel }) => {
  const keyword = detectUrgentKeyword(text);
  if (!keyword) return null;
  const db = getDb();
  const message = String(text).slice(0, 1000);
  await db.sql`
    UPDATE carnova_crm_leads SET urgent_flagged_at = NOW(), urgent_keyword = ${keyword},
      urgent_message = ${message}, temperature = 'hot', updated_at = NOW()
    WHERE id = ${lead.id} AND dealership_id = ${dealership.id}
  `;
  await createAlert({
    dealershipId: dealership.id,
    leadId: lead.id,
    type: "urgent_keyword",
    severity: "critical",
    title: `Urgent: "${keyword}"`,
    message: `${lead.name || "Customer"} (${lead.phone || "no phone"}): "${message.slice(0, 300)}"`,
  });
  const email = await sendEmail({
    to: ownerAlertEmail(),
    subject: `Urgent lead at ${dealership.name}: ${lead.name || lead.phone || "customer"} said "${keyword}"`,
    text: [
      `Dealership: ${dealership.name}`,
      `Lead: ${lead.name || "Unknown"}`,
      `Phone: ${lead.phone || lead.phone_e164 || "Not provided"}`,
      `Channel: ${channel}`,
      `Keyword: ${keyword}`,
      "",
      `Message: ${message}`,
    ].join("\n"),
  });
  await createEvent({
    dealershipId: dealership.id,
    leadId: lead.id,
    type: "lead.urgent_keyword",
    payload: { keyword, channel, emailed: email.sent },
  });
  return { keyword, emailed: email.sent };
};
