// Other / manual: any lead provider that sends ADF email, an embeddable lead
// form, a generic inventory feed, or CSV uploads inside NovaCar.

import { getDb } from "../crm.mjs";
import { AVAILABILITY, orderTypes } from "./interfaces.mjs";
import { inventoryFeedSetup, leadEmailSetup, leadFormUrl, testInventoryFeed, testLeadEmail } from "./shared.mjs";

/** @type {import("./interfaces.mjs").CrmConnector & import("./interfaces.mjs").InventoryConnector} */
export default {
  system: "manual",
  name: "Other / Manual",
  types: orderTypes([
    {
      type: "lead_email",
      label: "ADF lead email",
      availability: AVAILABILITY.AVAILABLE,
      explanation: "Any CRM or lead provider that sends ADF/XML email (Cars.com, Autotrader, your website).",
    },
    {
      type: "lead_form",
      label: "Website lead form",
      availability: AVAILABILITY.AVAILABLE,
      explanation: "Embed a NovaCar lead form on your website; leads get a text within seconds.",
    },
    {
      type: "inventory_feed",
      label: "Inventory feed",
      availability: AVAILABILITY.AVAILABLE,
      explanation: "Any provider that can post a CSV or XML inventory file to a URL with a login.",
    },
    {
      type: "inventory_upload",
      label: "CSV upload",
      availability: AVAILABILITY.AVAILABLE,
      explanation: "Upload a CSV from the Inventory page whenever stock changes.",
    },
    {
      type: "direct_api",
      label: "Direct API",
      availability: AVAILABILITY.NOT_APPLICABLE,
      explanation: "Manual connections do not use a vendor API.",
    },
  ]),
  setupInstructions: (ctx) => {
    if (ctx.connection?.type === "lead_email") return leadEmailSetup(ctx);
    if (ctx.connection?.type === "lead_form") {
      const url = leadFormUrl(ctx.baseUrl, ctx.dealership);
      return { url, embed: `<iframe src="${url}" title="Contact us" style="width:100%;min-height:520px;border:0"></iframe>` };
    }
    if (ctx.connection?.type === "inventory_upload") return { note: "Use Inventory > Import CSV." };
    return inventoryFeedSetup(ctx);
  },
  sendLeadTest: async (ctx) => {
    if (ctx.connection?.type !== "lead_form") return testLeadEmail(ctx);
    return { ok: true, detail: `Lead form is live at ${leadFormUrl(ctx.baseUrl ?? "", ctx.dealership)}.` };
  },
  sendInventoryTest: async (ctx) => {
    if (ctx.connection?.type !== "inventory_upload") return testInventoryFeed(ctx);
    const [row] = await getDb().sql`
      SELECT MAX(finished_at) AS last FROM carnova_inventory_syncs WHERE dealership_id = ${ctx.dealership.id}
    `;
    return row?.last
      ? { ok: true, detail: `Last inventory import ${new Date(row.last).toISOString()}.` }
      : { ok: false, detail: "No inventory has been imported yet." };
  },
};
