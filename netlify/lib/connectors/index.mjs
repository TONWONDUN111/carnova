// Connector registry.

import dealrCloud from "./dealr-cloud.mjs";
import manual from "./manual.mjs";
import promax from "./promax.mjs";
import vautoProvision from "./vauto-provision.mjs";
import { AVAILABILITY, TYPE_CATEGORY } from "./interfaces.mjs";

export { AVAILABILITY, TYPE_CATEGORY };

export const CONNECTORS = {
  dealr_cloud: dealrCloud,
  vauto_provision: vautoProvision,
  promax,
  manual,
};

export const SYSTEMS = Object.keys(CONNECTORS);

export const getConnector = (system) => CONNECTORS[system] ?? null;

export const getTypeDefinition = (system, type) =>
  getConnector(system)?.types.find((entry) => entry.type === type) ?? null;

/** Client-facing catalog: systems and their typed options, lead types first. */
export const connectorCatalog = () =>
  SYSTEMS.map((system) => ({
    system,
    name: CONNECTORS[system].name,
    types: CONNECTORS[system].types.map(({ type, label, availability, explanation, category }) => ({
      type,
      label,
      availability,
      explanation,
      category,
    })),
  }));

/** Runs the right test for a connection's category. */
export const testConnection = async (ctx) => {
  const connector = getConnector(ctx.connection.system);
  if (!connector) return { ok: false, detail: "Unknown system." };
  const category = TYPE_CATEGORY[ctx.connection.type];
  if (category === "lead") return connector.sendLeadTest(ctx);
  if (category === "inventory") return connector.sendInventoryTest(ctx);
  return { ok: false, detail: "Direct API connections are not active until the vendor grants partner access." };
};
