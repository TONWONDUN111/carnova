// Appointment rules shared by staff booking and Andy's SMS booking:
// appointments must sit inside the dealership's business hours in its own
// timezone, and every booking sends a confirmation text and notifies the
// salesperson.

import { createAlert, createEvent, getDb } from "./crm.mjs";
import { ownerAlertEmail, sendEmail } from "./email.mjs";
import { notifyTeam } from "./notify.mjs";
import { sendCustomerSms } from "./sms.mjs";
import { formatLocal, isWithinBusinessHours } from "./timezone.mjs";

export const businessHoursError = (dealership, startsAt, endsAt) =>
  isWithinBusinessHours(dealership, startsAt, endsAt)
    ? null
    : `Appointments must be inside business hours (${dealership.timezone}). Pick a time when the dealership is open.`;

export const stopSequence = async (db, dealershipId, leadId, reason) => {
  await db.sql`
    UPDATE carnova_crm_leads SET
      sequence_stopped_at = COALESCE(sequence_stopped_at, NOW()),
      sequence_stop_reason = COALESCE(sequence_stop_reason, ${reason}),
      sequence_next_at = NULL, updated_at = NOW()
    WHERE id = ${leadId} AND dealership_id = ${dealershipId}
  `;
};

/** Confirmation text + salesperson notification after any booking. */
export const afterAppointmentBooked = async ({ dealership, lead, appointment }) => {
  const db = getDb();
  await stopSequence(db, dealership.id, lead.id, "booked");
  const when = formatLocal(appointment.starts_at, dealership.timezone);
  let confirmation = { sent: false };
  if (!appointment.confirmation_sent_at) {
    confirmation = await sendCustomerSms({
      dealership,
      lead,
      body: `You're booked at ${dealership.name} for ${when}.${dealership.address ? ` ${dealership.address}.` : ""} Reply here if you need to change it.`,
      senderType: "system",
      kind: "appointment_confirmation",
    });
    if (confirmation.sent)
      await db.sql`UPDATE carnova_appointments SET confirmation_sent_at = NOW() WHERE id = ${appointment.id}`;
  }
  await notifyTeam({
    dealership,
    lead: { ...lead, assigned_salesperson_id: appointment.salesperson_id || lead.assigned_salesperson_id },
    audience: ["sales"],
    type: "appointment_set",
    severity: "info",
    appointmentId: appointment.id,
    title: "Appointment booked",
    message: `${lead.name} is booked for ${when}.`,
  });
  await createEvent({
    dealershipId: dealership.id,
    leadId: lead.id,
    type: "appointment.confirmation_sent",
    payload: { appointmentId: appointment.id, sms: confirmation.sent },
  });
  return confirmation;
};

/** Books an appointment for Andy. Returns { appointment } or { error }. */
export const bookAppointment = async ({ dealership, lead, startsAt, durationMinutes = 30, appointmentType = "showroom" }) => {
  const db = getDb();
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime()) || start <= new Date()) return { error: "Invalid time." };
  const endsAt = new Date(start.getTime() + durationMinutes * 60000).toISOString();
  const hoursError = businessHoursError(dealership, start.toISOString(), endsAt);
  if (hoursError) return { error: hoursError };
  const salespersonId = lead.assigned_salesperson_id || null;
  if (salespersonId) {
    const [conflict] = await db.sql`
      SELECT id FROM carnova_appointments
      WHERE dealership_id = ${dealership.id} AND salesperson_id = ${salespersonId}
        AND status NOT IN ('cancelled','no_show')
        AND starts_at < ${endsAt}::timestamptz AND ends_at > ${start.toISOString()}::timestamptz
      LIMIT 1
    `;
    if (conflict) return { error: "That time was just taken." };
  }
  const [appointment] = await db.sql`
    INSERT INTO carnova_appointments (
      id, dealership_id, lead_id, inventory_id, salesperson_id, appointment_type, starts_at, ends_at, status, confirmation_notes
    ) VALUES (
      ${crypto.randomUUID()}, ${dealership.id}, ${lead.id}, ${lead.inventory_id ?? null}, ${salespersonId},
      ${appointmentType}, ${start.toISOString()}, ${endsAt}, 'scheduled', 'Booked by Andy over SMS.'
    ) RETURNING *
  `;
  await db.sql`
    UPDATE carnova_crm_leads SET status = 'appointment_set', updated_at = NOW()
    WHERE id = ${lead.id} AND dealership_id = ${dealership.id}
  `;
  await createEvent({
    dealershipId: dealership.id,
    leadId: lead.id,
    type: "appointment.created",
    payload: { appointmentId: appointment.id, startsAt: appointment.starts_at, bookedBy: "andy" },
  });
  return { appointment };
};

/**
 * dealr.cloud has no public calendar API. When DEALR_CALENDAR_WEBHOOK_URL is
 * set (a partner or integration endpoint), the appointment is posted there;
 * otherwise, or on any failure, it is flagged for manual entry.
 */
export const syncToDealrCalendar = async ({ dealership, lead, appointment, fetchImpl = fetch }) => {
  const url = process.env.DEALR_CALENDAR_WEBHOOK_URL;
  if (!url) return { ok: false, status: "manual_required", error: "No dealr.cloud calendar connection is configured." };
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.DEALR_CALENDAR_WEBHOOK_SECRET
          ? { authorization: `Bearer ${process.env.DEALR_CALENDAR_WEBHOOK_SECRET}` }
          : {}),
      },
      body: JSON.stringify({
        dealership: dealership.name,
        customer: { name: lead.name, phone: lead.phone || lead.phone_e164, email: lead.email ?? null },
        startsAt: appointment.starts_at,
        endsAt: appointment.ends_at,
        type: appointment.appointment_type,
        vehicle: lead.vehicle_interest ?? null,
        novacarAppointmentId: appointment.id,
      }),
    });
    return response.ok
      ? { ok: true, status: "synced" }
      : { ok: false, status: "failed", error: `dealr.cloud sync returned ${response.status}.` };
  } catch (error) {
    return { ok: false, status: "failed", error: `dealr.cloud sync failed: ${error.message}` };
  }
};

/** Extra steps when Andy books: owner email and dealr.cloud calendar sync. */
export const afterAndyBooking = async ({ dealership, lead, appointment }) => {
  const db = getDb();
  const when = formatLocal(appointment.starts_at, dealership.timezone);
  const email = await sendEmail({
    to: ownerAlertEmail(),
    subject: `Andy booked ${lead.name || "a customer"} at ${dealership.name} for ${when}`,
    text: [
      `Dealership: ${dealership.name}`,
      `Customer: ${lead.name || "Unknown"}`,
      `Phone: ${lead.phone || lead.phone_e164 || "Not provided"}`,
      `When: ${when} (${dealership.timezone})`,
      `Vehicle: ${lead.vehicle_interest || "Not stated"}`,
    ].join("\n"),
  });
  const sync = await syncToDealrCalendar({ dealership, lead, appointment });
  await db.sql`
    UPDATE carnova_appointments SET
      owner_email_sent_at = CASE WHEN ${email.sent} THEN NOW() ELSE owner_email_sent_at END,
      dealr_sync_status = ${sync.status}, dealr_sync_error = ${sync.error ?? null}, updated_at = NOW()
    WHERE id = ${appointment.id} AND dealership_id = ${dealership.id}
  `;
  if (!sync.ok)
    await createAlert({
      dealershipId: dealership.id,
      leadId: lead.id,
      appointmentId: appointment.id,
      type: "dealr_sync_failed",
      severity: "warning",
      title: "Enter this appointment in dealr.cloud",
      message: `${lead.name} is booked for ${when}, but it could not be added to the dealr.cloud calendar automatically. ${sync.error ?? ""}`.trim(),
    });
  await createEvent({
    dealershipId: dealership.id,
    leadId: lead.id,
    type: "appointment.andy_booked",
    payload: { appointmentId: appointment.id, emailed: email.sent, dealrSync: sync.status },
  });
  return { emailed: email.sent, sync: sync.status };
};
