// Postmark inbound webhook: ADF/XML lead emails from dealr.cloud, ProMax, and
// third-party lead providers. Each dealership has its own address,
// <POSTMARK_INBOUND_ADDRESS local part>+<inbound token>@<domain>, so the
// dealership is resolved from the token alone. The webhook URL carries
// INBOUND_WEBHOOK_SECRET (basic-auth password or ?key=).

import { json } from "../lib/crm.mjs";
import { parseAdf } from "../lib/adf.mjs";
import { ingestLead } from "../lib/lead-intake.mjs";
import { basicAuth, constantTimeEqual, dealershipByInboundToken, markConnections, runAfterResponse } from "../lib/webhooks.mjs";

const decodeAttachment = (attachment) => {
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(attachment.Content || ""), (char) => char.charCodeAt(0)));
  } catch {
    return "";
  }
};

/** The +token from MailboxHash, or from any recipient address. */
export const inboundTokenFrom = (payload) => {
  if (payload?.MailboxHash) return payload.MailboxHash;
  const recipients = [
    payload?.OriginalRecipient,
    ...(payload?.ToFull ?? []).map((entry) => entry.Email),
    ...(payload?.CcFull ?? []).map((entry) => entry.Email),
    payload?.To,
  ].filter(Boolean);
  for (const recipient of recipients) {
    const match = String(recipient).match(/\+([a-z0-9]{8,64})@/i);
    if (match) return match[1];
  }
  return null;
};

export const adfSourcesFrom = (payload) => [
  payload?.TextBody,
  payload?.HtmlBody,
  ...(payload?.Attachments ?? [])
    .filter((attachment) => /xml|adf|text/i.test(`${attachment.ContentType} ${attachment.Name}`))
    .map(decodeAttachment),
];

const authorized = (request) => {
  const secret = process.env.INBOUND_WEBHOOK_SECRET;
  if (!secret) return false;
  const supplied = basicAuth(request)?.password || new URL(request.url).searchParams.get("key");
  return constantTimeEqual(supplied, secret);
};

export default async (request, context) => {
  try {
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
    if (!process.env.INBOUND_WEBHOOK_SECRET) return json({ error: "Inbound email is not configured." }, 503);
    if (!authorized(request)) return json({ error: "Unauthorized" }, 401);

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "Body must be Postmark inbound JSON." }, 400);
    }

    const dealership = await dealershipByInboundToken(inboundTokenFrom(payload));
    // 200 so Postmark does not retry mail that can never be delivered.
    if (!dealership) return json({ accepted: false, reason: "Unknown dealership address." });

    let parsed = { leads: [], errors: ["No ADF document found."] };
    for (const source of adfSourcesFrom(payload)) {
      if (!source) continue;
      const attempt = parseAdf(source);
      if (attempt.leads.length) {
        parsed = attempt;
        break;
      }
      if (!/No ADF/.test(attempt.errors[0] ?? "")) parsed = attempt;
    }

    if (!parsed.leads.length) {
      await markConnections(dealership.id, ["lead_email"], {
        ok: false,
        error: `Email from ${String(payload?.From || "unknown sender").slice(0, 120)} was not an ADF lead: ${parsed.errors.join(" ")}`.slice(0, 500),
      });
      return json({ accepted: false, reason: parsed.errors.join(" ") });
    }

    await markConnections(dealership.id, ["lead_email"], { ok: true });
    // Andy's first text runs after Postmark gets its 200; the messaging
    // scheduler re-checks unanswered leads every minute.
    await runAfterResponse(
      context,
      (async () => {
        for (const lead of parsed.leads.slice(0, 20))
          await ingestLead({ dealershipId: dealership.id, input: lead, channel: "email" });
      })(),
    );
    return json({ accepted: true, leads: parsed.leads.length, errors: parsed.errors });
  } catch (error) {
    console.error("Inbound email failed", error.message);
    return json({ error: "Inbound email could not be processed." }, 500);
  }
};
