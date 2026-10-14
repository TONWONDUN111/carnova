import { createAlert, createEvent, getDb } from "../lib/crm.mjs";

const postWebhook = async (payload) => {
  if (!process.env.CRM_AUTOMATION_WEBHOOK_URL) return;
  try {
    await fetch(process.env.CRM_AUTOMATION_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error("Automation webhook delivery failed", error);
  }
};

export default async () => {
  const db = getDb();
  // Each job only runs for active dealerships whose matching rule is switched
  // on in Automations, so the toggles in the CRM actually take effect.
  const dueFollowUps = await db.sql`
    SELECT f.id, f.dealership_id, f.lead_id, f.type, f.due_at, l.name
    FROM carnova_follow_ups f
    JOIN carnova_crm_leads l ON l.id = f.lead_id AND l.dealership_id = f.dealership_id
    WHERE f.status = 'pending' AND f.due_at <= NOW()
      AND EXISTS (
        SELECT 1 FROM carnova_dealerships d
        WHERE d.id = f.dealership_id AND d.platform_status = 'active'
      )
      AND EXISTS (
        SELECT 1 FROM carnova_automation_rules r
        WHERE r.dealership_id = f.dealership_id AND r.event_type = 'follow_up.due' AND r.enabled = TRUE
      )
      AND NOT EXISTS (
        SELECT 1 FROM carnova_alerts a WHERE a.dealership_id = f.dealership_id
          AND a.lead_id = f.lead_id AND a.type = 'follow_up_due'
          AND a.created_at >= f.due_at - INTERVAL '1 minute'
      )
    LIMIT 500
  `;
  const unansweredLeads = await db.sql`
    SELECT l.id, l.dealership_id, l.name
    FROM carnova_crm_leads l
    WHERE l.status = 'new' AND l.created_at <= NOW() - INTERVAL '15 minutes'
      AND l.last_contact_at IS NULL
      AND EXISTS (
        SELECT 1 FROM carnova_dealerships d
        WHERE d.id = l.dealership_id AND d.platform_status = 'active'
      )
      AND EXISTS (
        SELECT 1 FROM carnova_automation_rules r
        WHERE r.dealership_id = l.dealership_id AND r.event_type = 'lead.unanswered' AND r.enabled = TRUE
      )
      AND NOT EXISTS (
        SELECT 1 FROM carnova_alerts a WHERE a.dealership_id = l.dealership_id
          AND a.lead_id = l.id AND a.type = 'unanswered_lead' AND a.acknowledged = FALSE
      )
    LIMIT 500
  `;
  const appointmentReminders = await db.sql`
    SELECT a.id, a.dealership_id, a.lead_id, a.starts_at, l.name
    FROM carnova_appointments a
    JOIN carnova_crm_leads l ON l.id = a.lead_id AND l.dealership_id = a.dealership_id
    WHERE a.status IN ('scheduled','confirmed','rescheduled')
      AND a.starts_at > NOW() AND a.starts_at <= NOW() + INTERVAL '24 hours'
      AND EXISTS (
        SELECT 1 FROM carnova_dealerships d
        WHERE d.id = a.dealership_id AND d.platform_status = 'active'
      )
      AND EXISTS (
        SELECT 1 FROM carnova_automation_rules r
        WHERE r.dealership_id = a.dealership_id AND r.event_type = 'appointment.created' AND r.enabled = TRUE
      )
      AND NOT EXISTS (
        SELECT 1 FROM carnova_alerts alert WHERE alert.dealership_id = a.dealership_id
          AND alert.appointment_id = a.id AND alert.type = 'appointment_reminder'
      )
    LIMIT 500
  `;

  for (const task of dueFollowUps) {
    const payload = {
      type: "follow_up_due",
      dealershipId: task.dealership_id,
      leadId: task.lead_id,
      followUpId: task.id,
      dueAt: task.due_at,
    };
    await createAlert({
      dealershipId: task.dealership_id,
      leadId: task.lead_id,
      type: "follow_up_due",
      severity: "warning",
      title: "Follow-up due",
      message: `${task.name}: ${task.type.replaceAll("_", " ")} follow-up is due.`,
    });
    await createEvent({
      dealershipId: task.dealership_id,
      leadId: task.lead_id,
      type: "follow_up.due",
      payload,
    });
    await postWebhook(payload);
  }
  for (const lead of unansweredLeads) {
    const payload = {
      type: "unanswered_lead",
      dealershipId: lead.dealership_id,
      leadId: lead.id,
    };
    await createAlert({
      dealershipId: lead.dealership_id,
      leadId: lead.id,
      type: "unanswered_lead",
      severity: "critical",
      title: "Unanswered lead",
      message: `${lead.name} has not received a response within 15 minutes.`,
    });
    await createEvent({
      dealershipId: lead.dealership_id,
      leadId: lead.id,
      type: "lead.unanswered",
      payload,
    });
    await postWebhook(payload);
  }
  for (const appointment of appointmentReminders) {
    const payload = {
      type: "appointment_reminder",
      dealershipId: appointment.dealership_id,
      leadId: appointment.lead_id,
      appointmentId: appointment.id,
      startsAt: appointment.starts_at,
    };
    await createAlert({
      dealershipId: appointment.dealership_id,
      leadId: appointment.lead_id,
      appointmentId: appointment.id,
      type: "appointment_reminder",
      title: "Appointment reminder",
      message: `${appointment.name} is scheduled for ${new Date(appointment.starts_at).toLocaleString("en-US")}.`,
    });
    await createEvent({
      dealershipId: appointment.dealership_id,
      leadId: appointment.lead_id,
      type: "appointment.reminder_due",
      payload,
    });
    await postWebhook(payload);
  }

  return Response.json({
    followUps: dueFollowUps.length,
    unanswered: unansweredLeads.length,
    reminders: appointmentReminders.length,
  });
};

export const config = { schedule: "*/15 * * * *" };
