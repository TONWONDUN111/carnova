// Staff notifications: every notification is an in-app alert, and assigned
// staff with a mobile number on their team record also get a text.

import { createAlert, getDb } from "./crm.mjs";
import { sendStaffSms } from "./sms.mjs";

export const loadDealership = async (db, dealershipId) => {
  const [row] = await db.sql`SELECT * FROM carnova_dealerships WHERE id = ${dealershipId}`;
  if (!row) return null;
  return {
    ...row,
    settings: row.settings ?? {},
    aiConfiguration: row.ai_configuration ?? {},
    platformStatus: row.platform_status,
    smsFromNumber: row.sms_from_number,
    inboundToken: row.inbound_token,
  };
};

/**
 * Who hears about a lead: the assigned salesperson (or, when nobody is
 * assigned, the active sales staff) and/or the assigned manager (or, when
 * nobody is assigned, the active managers and owners).
 */
export const resolveRecipients = async (db, lead, audience) => {
  const recipients = new Map();
  const add = (rows) => rows.forEach((row) => recipients.set(row.id, row));
  if (audience.includes("sales")) {
    const assigned = lead.assigned_salesperson_id
      ? await db.sql`SELECT id, name, phone, notify_sms FROM carnova_users WHERE id = ${lead.assigned_salesperson_id} AND dealership_id = ${lead.dealership_id} AND active = TRUE`
      : [];
    add(
      assigned.length
        ? assigned
        : await db.sql`SELECT id, name, phone, notify_sms FROM carnova_users WHERE dealership_id = ${lead.dealership_id} AND active = TRUE AND role IN ('sales','salesperson','bdc') ORDER BY created_at LIMIT 5`,
    );
  }
  if (audience.includes("manager")) {
    const assigned = lead.assigned_manager_id
      ? await db.sql`SELECT id, name, phone, notify_sms FROM carnova_users WHERE id = ${lead.assigned_manager_id} AND dealership_id = ${lead.dealership_id} AND active = TRUE`
      : [];
    add(
      assigned.length
        ? assigned
        : await db.sql`SELECT id, name, phone, notify_sms FROM carnova_users WHERE dealership_id = ${lead.dealership_id} AND active = TRUE AND role IN ('manager','owner') ORDER BY created_at LIMIT 5`,
    );
  }
  return [...recipients.values()];
};

export const notifyTeam = async ({
  dealership,
  lead,
  audience = ["sales"],
  type,
  severity = "warning",
  title,
  message,
  appointmentId = null,
}) => {
  const db = getDb();
  await createAlert({
    dealershipId: dealership.id,
    leadId: lead.id,
    appointmentId,
    type,
    severity,
    title,
    message,
  });
  const recipients = await resolveRecipients(db, lead, audience);
  const text = `${dealership.name} NovaCar: ${title}. ${message}`.slice(0, 480);
  await Promise.all(
    recipients
      .filter((recipient) => recipient.phone && recipient.notify_sms !== false)
      .map((recipient) => sendStaffSms({ dealership, to: recipient.phone, body: text })),
  );
  return recipients.length;
};
