// ProMax: forwards ADF leads by email and exports inventory. Its API
// requires partner approval.

import { AVAILABILITY, orderTypes } from "./interfaces.mjs";
import { inventoryFeedSetup, leadEmailSetup, testInventoryFeed, testLeadEmail } from "./shared.mjs";

/** @type {import("./interfaces.mjs").CrmConnector & import("./interfaces.mjs").InventoryConnector} */
export default {
  system: "promax",
  name: "ProMax",
  types: orderTypes([
    {
      type: "lead_email",
      label: "ADF lead email",
      availability: AVAILABILITY.AVAILABLE,
      explanation: "Add your NovaCar lead address as an ADF lead forward in ProMax.",
    },
    {
      type: "inventory_export",
      label: "Inventory export",
      availability: AVAILABILITY.AVAILABLE,
      explanation: "Ask ProMax support to send an inventory export to the feed URL and login below.",
    },
    {
      type: "direct_api",
      label: "Direct API",
      availability: AVAILABILITY.PENDING,
      explanation: "Requires a ProMax partner agreement. We will request access for you.",
    },
  ]),
  setupInstructions: (ctx) => (ctx.connection?.type === "lead_email" ? leadEmailSetup(ctx) : inventoryFeedSetup(ctx)),
  sendLeadTest: testLeadEmail,
  sendInventoryTest: testInventoryFeed,
};
