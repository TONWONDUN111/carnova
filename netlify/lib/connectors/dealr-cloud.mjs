// dealr.cloud: sends ADF leads to NovaCar's lead address and can export
// inventory to a third-party destination. Its API requires partner approval.

import { AVAILABILITY, orderTypes } from "./interfaces.mjs";
import { inventoryFeedSetup, leadEmailSetup, testInventoryFeed, testLeadEmail } from "./shared.mjs";

/** @type {import("./interfaces.mjs").CrmConnector & import("./interfaces.mjs").InventoryConnector} */
export default {
  system: "dealr_cloud",
  name: "dealr.cloud",
  types: orderTypes([
    {
      type: "lead_email",
      label: "ADF lead email",
      availability: AVAILABILITY.AVAILABLE,
      explanation: "Add your NovaCar lead address as an ADF lead recipient in dealr.cloud.",
    },
    {
      type: "inventory_export",
      label: "Inventory export",
      availability: AVAILABILITY.AVAILABLE,
      explanation: "Ask dealr.cloud to add NovaCar as an inventory export destination with the feed URL and login below.",
    },
    {
      type: "direct_api",
      label: "Direct API",
      availability: AVAILABILITY.PENDING,
      explanation: "Requires a dealr.cloud partner agreement. We will request access for you.",
    },
  ]),
  setupInstructions: (ctx) => (ctx.connection?.type === "lead_email" ? leadEmailSetup(ctx) : inventoryFeedSetup(ctx)),
  sendLeadTest: testLeadEmail,
  sendInventoryTest: testInventoryFeed,
};
