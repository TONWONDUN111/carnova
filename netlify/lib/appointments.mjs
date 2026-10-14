// Appointment rules shared by staff booking and Andy's SMS booking:
// appointments must sit inside the dealership's business hours in its own
// timezone, and every booking sends a confirmation text and notifies the
// salesperson.

import { createEvent, getDb } from "./crm.mjs";
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
