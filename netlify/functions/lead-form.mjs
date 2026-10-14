// Embeddable website lead form. GET renders a small branded form for the
// dealership identified by ?d=<inbound token>; POST creates the lead. The TCPA
// consent box is optional and unchecked; only customers who check it are
// eligible for automated texts, and their consent is recorded with the exact
// disclosure shown. Only served while the dealership has an active "Website
// lead form" connection.

import { disclosureText, requestFingerprint } from "../lib/consent.mjs";
import { cleanText, getDb, json } from "../lib/crm.mjs";
import { ingestLead } from "../lib/lead-intake.mjs";
import { normalizePhone } from "../lib/sms.mjs";
import { dealershipByInboundToken, markConnections, runAfterResponse } from "../lib/webhooks.mjs";

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

const safeColor = (value, fallback) => (/^#[0-9a-f]{6}$/i.test(value || "") ? value : fallback);

const page = (dealership, body) => {
  const primary = safeColor(dealership?.brand_primary, "#0f3d2e");
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(dealership?.name ?? "Contact us")}</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1b1f24;background:#fff}
main{max-width:440px;margin:0 auto;padding:20px}h1{font-size:1.25rem;margin:0 0 4px}p{margin:0 0 16px;color:#57606a;font-size:.9rem}
label{display:block;font-size:.85rem;font-weight:600;margin:12px 0 4px}input,textarea{width:100%;padding:10px 12px;border:1px solid #c9d1d9;border-radius:8px;font:inherit}
textarea{min-height:80px}.consent{display:flex;gap:8px;align-items:flex-start;font-weight:400;font-size:.78rem;color:#57606a}.consent input{width:auto;margin-top:2px}
button{margin-top:16px;width:100%;padding:12px;border:0;border-radius:8px;background:${primary};color:#fff;font-weight:700;font:inherit;cursor:pointer}
.hp{position:absolute;left:-9999px}.ok{padding:16px;border-radius:8px;background:#eef7f1}
</style></head><body><main>${body}</main></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
};

const formHtml = (dealership, token, error = "") => `
<h1>${escapeHtml(dealership.name)}</h1>
<p>Tell us what you're looking for and we'll get right back to you.</p>
${error ? `<p role="alert" style="color:#b42318">${escapeHtml(error)}</p>` : ""}
<form method="post" action="?d=${encodeURIComponent(token)}">
  <label for="name">Name</label><input id="name" name="name" autocomplete="name" required maxlength="160">
  <label for="phone">Mobile phone</label><input id="phone" name="phone" type="tel" autocomplete="tel" required maxlength="40">
  <label for="email">Email (optional)</label><input id="email" name="email" type="email" autocomplete="email" maxlength="254">
  <label for="zip">ZIP code (optional)</label><input id="zip" name="zip" inputmode="numeric" autocomplete="postal-code" maxlength="10">
  <label for="vehicle">Vehicle you're interested in</label><input id="vehicle" name="vehicle" maxlength="300">
  <label for="comments">Questions</label><textarea id="comments" name="comments" maxlength="2000"></textarea>
  <input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
  <label class="consent"><input type="checkbox" name="consent" value="yes">
    <span>${escapeHtml(disclosureText(dealership.name))}</span></label>
  <button type="submit">Send</button>
</form>`;

export default async (request, context) => {
  try {
    const token = new URL(request.url).searchParams.get("d");
    const dealership = await dealershipByInboundToken(token);
    const [connection] = dealership
      ? await getDb().sql`
          SELECT id FROM carnova_connections
          WHERE dealership_id = ${dealership.id} AND type = 'lead_form' AND status IN ('active', 'error') LIMIT 1
        `
      : [];
    if (!dealership || !connection) return page(null, "<h1>Form unavailable</h1><p>This form is not active.</p>");

    if (request.method === "GET") return page(dealership, formHtml(dealership, token));
    if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const contentType = request.headers.get("content-type") || "";
    const wantsJson = /json/i.test(contentType);
    const fields = wantsJson ? await request.json().catch(() => ({})) : Object.fromEntries(await request.formData());
    if (fields.website) return wantsJson ? json({ ok: true }) : page(dealership, `<div class="ok">Thanks! We'll be in touch.</div>`);

    const name = cleanText(fields.name, 160);
    const phone = normalizePhone(cleanText(fields.phone, 40));
    const invalid = !name ? "Please enter your name." : !phone ? "Please enter a valid mobile number." : "";
    const consented = fields.consent === "yes" || fields.consent === true;
    if (invalid) return wantsJson ? json({ error: invalid }, 400) : page(dealership, formHtml(dealership, token, invalid));

    await markConnections(dealership.id, ["lead_form"], { ok: true });
    await runAfterResponse(
      context,
      ingestLead({
        dealershipId: dealership.id,
        channel: "web",
        input: {
          name,
          phone,
          email: cleanText(fields.email, 254),
          vehicleInterest: cleanText(fields.vehicle, 300),
          comments: cleanText(fields.comments, 2000),
          postalCode: cleanText(fields.zip, 10),
          source: "website_form",
          consent: consented ? { source: "form", ...requestFingerprint(request, context) } : null,
        },
      }),
    );
    return wantsJson
      ? json({ ok: true })
      : page(dealership, `<div class="ok"><h1>Thanks, ${escapeHtml(name.split(" ")[0])}!</h1><p>${consented ? `Watch for a text from ${escapeHtml(dealership.name)} shortly.` : `Someone from ${escapeHtml(dealership.name)} will be in touch soon.`}</p></div>`);
  } catch (error) {
    console.error("Lead form failed", error.message);
    return json({ error: "The form could not be submitted. Please call the dealership." }, 500);
  }
};
