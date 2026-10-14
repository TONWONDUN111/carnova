// vAuto Provision (Cox Automotive) manages used-vehicle inventory. It is not
// a lead source, but it can export inventory to third-party destinations.

import { AVAILABILITY, orderTypes } from "./interfaces.mjs";
import { inventoryFeedSetup, testInventoryFeed } from "./shared.mjs";

/** @type {import("./interfaces.mjs").CrmConnector & import("./interfaces.mjs").InventoryConnector} */
export default {
  system: "vauto_provision",
  name: "vAuto Provision",
  types: orderTypes([
    {
      type: "lead_email",
      label: "ADF lead email",
      availability: AVAILABILITY.NOT_APPLICABLE,
      explanation: "vAuto Provision is an inventory tool and does not send leads.",
    },
    {
      type: "inventory_export",
      label: "Inventory export",
      availability: AVAILABILITY.AVAILABLE,
      explanation: "Ask your vAuto performance manager to add NovaCar as an export using the feed URL and login below.",
    },
    {
      type: "direct_api",
      label: "Direct API",
      availability: AVAILABILITY.PENDING,
      explanation: "Requires Cox Automotive partner approval. We will request access for you.",
    },
  ]),
  setupInstructions: inventoryFeedSetup,
  sendLeadTest: async () => ({ ok: false, detail: "vAuto Provision does not send leads." }),
  sendInventoryTest: testInventoryFeed,
};
