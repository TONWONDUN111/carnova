// Every minute: the customer-texting heartbeat.
//
// 1. Safety net for Andy's first text (new leads the inline reply missed).
// 2. Customer texts that never got an answer (the inline reply failed).
// 3. The follow-up sequence, only 9am-8pm dealership-local time.
// 4. Appointment reminders: day-before, morning-of, no-show at +30 minutes,
//    and post-visit.
//
// Every send is claimed with a conditional UPDATE first, so overlapping runs
// can never text a customer twice.

import { createEvent, getDb } from "../lib/crm.mjs";
import { respondToLead } from "../lib/andy.mjs";
import { notifyTeam, loadDealership } from "../lib/notify.mjs";
import { LAST_STEP, SEQUENCE_STEPS, nextSequenceAt, sequenceMessage } from "../lib/sequence.mjs";
import { isOptedOut, sendCustomerSms } from "../lib/sms.mjs";
import { formatLocal, isTextingWindow, nextTextingWindow, zonedParts } from "../lib/timezone.mjs";

export const config = { schedule: "* * * * *" };

const BOOKED_STATUSES = ["appointment_set", "appointment_confirmed", "showed", "sold", "lost"];

const dealershipCache = new Map();
const dealershipFor = async (db, id) => {
  if (!dealershipCache.has(id)) dealershipCache.set(id, await loadDealership(db, id));
  return dealershipCache.get(id);
};

const firstResponseSweep = async (db) => {
  const leads = await db.sql`
    SELECT l.id, l.dealership_id FROM carnova_crm_leads l
    JOIN carnova_dealerships d ON d.id = l.dealership_id AND d.platform_status = 'active'
    WHERE l.phone_e164 IS NOT NULL AND l.ai_enabled = TRUE AND l.first_response_at IS NULL
      AND l.created_at BETWEEN NOW() - INTERVAL '1 hour' AND NOW() - INTERVAL '45 seconds'
      AND NOT EXISTS (SELECT 1 FROM carnova_messages m WHERE m.lead_id = l.id AND m.direction = 'outbound')
    ORDER BY l.created_at LIMIT 10
  `;
  for (const lead of leads) {
    const result = await respondToLead({ dealershipId: lead.dealership_id, leadId: lead.id });
    if (result.sent) {
      const dealership = await dealershipFor(db, lead.dealership_id);
      const [row] = await db.sql`SELECT sequence_started_at, created_at FROM carnova_crm_leads WHERE id = ${lead.id}`;
      const nextAt = nextSequenceAt({
        completedStep: 1,
        startedAt: row.sequence_started_at ?? row.created_at,
        lastSentAt: new Date(),
        timezone: dealership.timezone,
      });
      await db.sql`
        UPDATE carnova_crm_leads SET sequence_step = 1, sequence_next_at = ${nextAt?.toISOString() ?? null}
        WHERE id = ${lead.id} AND sequence_stopped_at IS NULL AND sequence_step = 0
      `;
    }
  }
  return leads.length;
};

const unansweredReplySweep = async (db) => {
  const leads = await db.sql`
    SELECT l.id, l.dealership_id,
      (SELECT content FROM carnova_messages m WHERE m.lead_id = l.id AND m.direction = 'inbound'
        ORDER BY m.created_at DESC LIMIT 1) AS last_text
    FROM carnova_crm_leads l
    JOIN carnova_dealerships d ON d.id = l.dealership_id AND d.platform_status = 'active'
    WHERE l.ai_enabled = TRUE AND l.phone_e164 IS NOT NULL
      AND l.last_inbound_at BETWEEN NOW() - INTERVAL '2 hours' AND NOW() - INTERVAL '90 seconds'
      AND NOT EXISTS (
        SELECT 1 FROM carnova_messages m WHERE m.lead_id = l.id AND m.direction = 'outbound'
          AND m.created_at >= l.last_inbound_at
      )
    LIMIT 10
  `;
  for (const lead of leads)
    if (lead.last_text) await respondToLead({ dealershipId: lead.dealership_id, leadId: lead.id, inboundText: lead.last_text });
  return leads.length;
};

const sequenceSweep = async (db) => {
  const due = await db.sql`
    SELECT l.* FROM carnova_crm_leads l
    JOIN carnova_dealerships d ON d.id = l.dealership_id AND d.platform_status = 'active'
    WHERE l.follow_up_enabled = TRUE AND l.ai_enabled = TRUE AND l.sequence_stopped_at IS NULL
      AND l.sequence_next_at IS NOT NULL AND l.sequence_next_at <= NOW()
      AND l.sequence_step BETWEEN 1 AND ${LAST_STEP - 1}
      AND l.phone_e164 IS NOT NULL
    ORDER BY l.sequence_next_at LIMIT 50
  `;
  let sent = 0;
  for (const lead of due) {
    const dealership = await dealershipFor(db, lead.dealership_id);
    if (BOOKED_STATUSES.includes(lead.status)) {
      await db.sql`
        UPDATE carnova_crm_leads SET sequence_stopped_at = NOW(), sequence_stop_reason = 'booked', sequence_next_at = NULL
        WHERE id = ${lead.id}
      `;
      continue;
    }
    if (await isOptedOut(db, lead.dealership_id, lead.phone_e164)) {
      await db.sql`
        UPDATE carnova_crm_leads SET sequence_stopped_at = NOW(), sequence_stop_reason = 'opted_out', sequence_next_at = NULL
        WHERE id = ${lead.id}
      `;
      continue;
    }
    if (!isTextingWindow(new Date(), dealership.timezone)) {
      await db.sql`
        UPDATE carnova_crm_leads SET sequence_next_at = ${nextTextingWindow(new Date(), dealership.timezone).toISOString()}
        WHERE id = ${lead.id} AND sequence_next_at = ${lead.sequence_next_at}
      `;
      continue;
    }
    const step = lead.sequence_step + 1;
    const [claimed] = await db.sql`
      UPDATE carnova_crm_leads SET sequence_step = ${step}, sequence_next_at = NULL
      WHERE id = ${lead.id} AND sequence_step = ${lead.sequence_step} AND sequence_stopped_at IS NULL
      RETURNING id
    `;
    if (!claimed) continue;
    const entry = SEQUENCE_STEPS.find((candidate) => candidate.step === step);
    const result = await sendCustomerSms({
      dealership,
      lead,
      body: sequenceMessage(entry, lead, dealership),
      senderType: "system",
      kind: `sequence_${entry.kind}`,
    });
    if (result.sent) sent += 1;
    const nextAt = nextSequenceAt({
      completedStep: step,
      startedAt: lead.sequence_started_at ?? lead.created_at,
      lastSentAt: new Date(),
      timezone: dealership.timezone,
    });
    await db.sql`
      UPDATE carnova_crm_leads SET
        sequence_next_at = ${nextAt?.toISOString() ?? null},
        sequence_stopped_at = CASE WHEN ${nextAt === null} THEN NOW() ELSE sequence_stopped_at END,
        sequence_stop_reason = CASE WHEN ${nextAt === null} THEN 'completed' ELSE sequence_stop_reason END
      WHERE id = ${lead.id} AND sequence_stopped_at IS NULL
    `;
    await createEvent({
      dealershipId: lead.dealership_id,
      leadId: lead.id,
      type: "sequence.sent",
      payload: { step, kind: entry.kind, sent: result.sent, reason: result.reason ?? null },
    });
  }
  return sent;
};

// Reminder column names come only from this fixed list.
const REMINDERS = {
  day_before: "reminder_day_before_sent_at",
  morning_of: "reminder_morning_sent_at",
  no_show: "no_show_sent_at",
  post_visit: "post_visit_sent_at",
};

/** Which reminder (if any) is due for an appointment right now. Exported for tests. */
export const dueReminder = (appointment, timezone, now = new Date()) => {
  const start = new Date(appointment.starts_at);
  const created = new Date(appointment.created_at);
  const local = zonedParts(now, timezone);
  const startLocal = zonedParts(start, timezone);
  const tomorrow = zonedParts(new Date(now.getTime() + 86400000), timezone).date;
  const bookedHoursAgo = (now - created) / 3600000;
  const active = ["scheduled", "confirmed", "rescheduled"].includes(appointment.status);
  if (!isTextingWindow(now, timezone)) return null;
  if (active && !appointment.reminder_day_before_sent_at && startLocal.date === tomorrow && local.hour >= 10 && bookedHoursAgo >= 3)
    return "day_before";
  if (
    active &&
    !appointment.reminder_morning_sent_at &&
    startLocal.date === local.date &&
    start - now > 60 * 60000 &&
    bookedHoursAgo >= 3
  )
    return "morning_of";
  if (active && !appointment.no_show_sent_at && now - start >= 30 * 60000 && now - start < 12 * 3600000) return "no_show";
  if (
    appointment.status === "showed" &&
    !appointment.post_visit_sent_at &&
    now - start >= 2 * 3600000 &&
    now - start < 3 * 86400000
  )
    return "post_visit";
  return null;
};

const reminderText = (kind, lead, dealership, when) => {
  const name = String(lead.name || "").trim().split(/\s+/)[0] || "there";
  switch (kind) {
    case "day_before":
      return `Hi ${name}, a reminder from ${dealership.name}: we'll see you tomorrow, ${when}. Reply here if you need to change it.`;
    case "morning_of":
      return `Good morning ${name}! See you today at ${when} at ${dealership.name}.${dealership.address ? ` ${dealership.address}.` : ""}`;
    case "no_show":
      return `Hi ${name}, we missed you at ${dealership.name} today. Want to pick a new time that works better?`;
    case "post_visit":
      return `Thanks for visiting ${dealership.name}, ${name}! Any questions after your visit? Just text me here.`;
    default:
      return null;
  }
};

const reminderSweep = async (db) => {
  const appointments = await db.sql`
    SELECT a.*, l.name AS lead_name, l.phone, l.phone_e164, l.assigned_salesperson_id, l.assigned_manager_id
    FROM carnova_appointments a
    JOIN carnova_crm_leads l ON l.id = a.lead_id AND l.dealership_id = a.dealership_id
    JOIN carnova_dealerships d ON d.id = a.dealership_id AND d.platform_status = 'active'
    WHERE l.phone_e164 IS NOT NULL
      AND a.starts_at BETWEEN NOW() - INTERVAL '3 days' AND NOW() + INTERVAL '2 days'
      AND (
        (a.status IN ('scheduled', 'confirmed', 'rescheduled')
          AND (a.reminder_day_before_sent_at IS NULL OR a.reminder_morning_sent_at IS NULL OR a.no_show_sent_at IS NULL))
        OR (a.status = 'showed' AND a.post_visit_sent_at IS NULL)
      )
    LIMIT 200
  `;
  let sent = 0;
  for (const appointment of appointments) {
    const dealership = await dealershipFor(db, appointment.dealership_id);
    const kind = dueReminder(appointment, dealership.timezone);
    if (!kind) continue;
    const column = REMINDERS[kind];
    const [claimed] = await db.pool.query(
      `UPDATE carnova_appointments SET ${column} = NOW(), updated_at = NOW() WHERE id = $1 AND ${column} IS NULL RETURNING id`,
      [appointment.id],
    ).then((result) => result.rows);
    if (!claimed) continue;
    const lead = {
      id: appointment.lead_id,
      dealership_id: appointment.dealership_id,
      name: appointment.lead_name,
      phone: appointment.phone,
      phone_e164: appointment.phone_e164,
      assigned_salesperson_id: appointment.salesperson_id || appointment.assigned_salesperson_id,
      assigned_manager_id: appointment.assigned_manager_id,
    };
    const when = formatLocal(appointment.starts_at, dealership.timezone);
    const result = await sendCustomerSms({
      dealership,
      lead,
      body: reminderText(kind, lead, dealership, when),
      senderType: "system",
      kind: `reminder_${kind}`,
    });
    if (result.sent) sent += 1;
    if (kind === "no_show")
      await notifyTeam({
        dealership,
        lead,
        audience: ["sales"],
        type: "no_show",
        severity: "warning",
        appointmentId: appointment.id,
        title: "Possible no-show",
        message: `${lead.name} was due at ${when} and the appointment is not marked showed. We texted them to reschedule.`,
      });
    await createEvent({
      dealershipId: appointment.dealership_id,
      leadId: appointment.lead_id,
      type: `appointment.reminder_${kind}`,
      payload: { appointmentId: appointment.id, sent: result.sent },
    });
  }
  return sent;
};

export default async () => {
  const db = getDb();
  dealershipCache.clear();
  const client = await db.pool.connect();
  let locked = false;
  try {
    const { rows } = await client.query("SELECT pg_try_advisory_lock(hashtext('novacar-messaging')) AS locked");
    locked = Boolean(rows[0]?.locked);
    if (!locked) return new Response("Previous run still active.");
    const summary = {};
    for (const [name, job] of Object.entries({
      firstResponses: firstResponseSweep,
      unansweredReplies: unansweredReplySweep,
      sequence: sequenceSweep,
      reminders: reminderSweep,
    })) {
      try {
        summary[name] = await job(db);
      } catch (error) {
        console.error(`Messaging job ${name} failed`, error.message);
        summary[name] = "failed";
      }
    }
    return Response.json(summary);
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(hashtext('novacar-messaging'))").catch(() => null);
    client.release();
  }
};
