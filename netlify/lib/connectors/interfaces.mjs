// Connector contracts. One file per dealership system implements these.
//
// NovaCar never collects or stores a dealer's CRM/DMS username or password.
// Every connection is either something the dealer points at us (an ADF lead
// email address, an inventory export destination, a lead form) using
// credentials NovaCar generates, or a direct API that requires a signed
// partner agreement. Direct API types are never shown as connected until the
// vendor has actually granted partner access.

/**
 * @typedef {"AVAILABLE" | "PENDING_PARTNER_APPROVAL" | "NOT_APPLICABLE"} ConnectionAvailability
 *
 * @typedef {object} ConnectionTypeDefinition
 * @property {"lead_email"|"lead_form"|"inventory_export"|"inventory_feed"|"inventory_upload"|"direct_api"} type
 * @property {"lead"|"inventory"|"api"} category
 * @property {string} label
 * @property {ConnectionAvailability} availability
 * @property {string} explanation   One line shown next to the status badge.
 *
 * @typedef {object} TestResult
 * @property {boolean} ok
 * @property {string} detail
 */

/**
 * @typedef {object} CrmConnector
 * @property {string} system                        dealr_cloud | vauto_provision | promax | manual
 * @property {string} name
 * @property {ConnectionTypeDefinition[]} types     Lead types first.
 * @property {(ctx: {dealership: object, connection: object, baseUrl: string}) => object} setupInstructions
 * @property {(ctx: {dealership: object, connection: object}) => Promise<TestResult>} sendLeadTest
 */

/**
 * @typedef {object} InventoryConnector
 * @property {string} system
 * @property {(ctx: {dealership: object, connection: object, baseUrl: string}) => object} setupInstructions
 * @property {(ctx: {dealership: object, connection: object}) => Promise<TestResult>} sendInventoryTest
 */

export const AVAILABILITY = {
  AVAILABLE: "AVAILABLE",
  PENDING: "PENDING_PARTNER_APPROVAL",
  NOT_APPLICABLE: "NOT_APPLICABLE",
};

export const TYPE_CATEGORY = {
  lead_email: "lead",
  lead_form: "lead",
  inventory_export: "inventory",
  inventory_feed: "inventory",
  inventory_upload: "inventory",
  direct_api: "api",
};

const CATEGORY_ORDER = { lead: 0, inventory: 1, api: 2 };

/** NovaCar is a lead product, so lead connection types always list first. */
export const orderTypes = (types) =>
  [...types]
    .map((entry) => ({ ...entry, category: TYPE_CATEGORY[entry.type] }))
    .sort((a, b) => CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category]);
