const endpoint = (resource, params = {}) => {
  const search = new URLSearchParams({ resource });
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    // Multi-select inventory filters are repeated keys (status=sold&status=...).
    if (Array.isArray(value)) {
      value
        .filter(
          (entry) => entry !== undefined && entry !== null && entry !== "",
        )
        .forEach((entry) => search.append(key, String(entry)));
      return;
    }
    search.set(key, String(value));
  });
  return `/api/crm?${search}`;
};

// "Log in as": the platform owner's impersonation token lives only in this
// browser tab and is sent on every API call; the server validates and logs it.
const IMPERSONATION_KEY = "novacar.impersonation";
export const impersonation = {
  get: () => {
    try {
      return JSON.parse(sessionStorage.getItem(IMPERSONATION_KEY) || "null");
    } catch {
      return null;
    }
  },
  set: (value) =>
    value
      ? sessionStorage.setItem(IMPERSONATION_KEY, JSON.stringify(value))
      : sessionStorage.removeItem(IMPERSONATION_KEY),
};

const requestHeaders = (hasBody) => {
  const headers = {};
  if (hasBody) headers["Content-Type"] = "application/json";
  const active = impersonation.get();
  if (active?.token && new Date(active.expiresAt) > new Date())
    headers["x-novacar-impersonate"] = active.token;
  return headers;
};

export const apiRequest = async (
  resource,
  { method = "GET", params, body } = {},
) => {
  const response = await fetch(endpoint(resource, params), {
    method,
    credentials: "same-origin",
    headers: requestHeaders(body !== undefined),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      payload.error || `Request failed (${response.status})`,
    );
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
};

export const crmApi = {
  session: () => apiRequest("session"),
  bootstrap: (body) => apiRequest("bootstrap", { method: "POST", body }),
  dashboard: () => apiRequest("dashboard"),
  leads: (params) => apiRequest("leads", { params }),
  createLead: (body) => apiRequest("leads", { method: "POST", body }),
  updateLead: (id, body) =>
    apiRequest("leads", { method: "PATCH", params: { id }, body }),
  messages: (leadId) => apiRequest("messages", { params: { leadId } }),
  sendMessage: (body) => apiRequest("messages", { method: "POST", body }),
  // Inventory search runs on the server so a dealership only ever queries its
  // own inventory, and so TITAN and the CRM see the same filtered results.
  inventory: (params) => apiRequest("inventory", { params }),
  vehicle: (id) => apiRequest("inventory", { params: { id } }),
  createVehicle: (body) => apiRequest("inventory", { method: "POST", body }),
  updateVehicle: (id, body) =>
    apiRequest("inventory", { method: "PATCH", params: { id }, body }),
  updateVehicleStatus: (id, body) =>
    apiRequest("inventory", {
      method: "PATCH",
      params: { id, action: "status" },
      body,
    }),
  importInventory: (vehicles, source = {}) =>
    apiRequest("inventory", {
      method: "POST",
      params: { action: "import" },
      body: { vehicles, ...source },
    }),
  // Pulls the inventory currently published on CarNova.com. Safe to repeat:
  // the server matches on VIN or stock number and updates in place.
  syncCarnovaInventory: () =>
    apiRequest("inventory", {
      method: "POST",
      params: { action: "sync_carnova" },
      body: {},
    }),
  inventorySources: () => apiRequest("inventory_sources"),
  createInventorySource: (body) =>
    apiRequest("inventory_sources", { method: "POST", body }),
  updateInventorySource: (id, body) =>
    apiRequest("inventory_sources", { method: "PATCH", params: { id }, body }),
  leadVehicles: (leadId) => apiRequest("lead_vehicles", { params: { leadId } }),
  attachLeadVehicle: (body) =>
    apiRequest("lead_vehicles", { method: "POST", body }),
  detachLeadVehicle: (leadId, inventoryId) =>
    apiRequest("lead_vehicles", {
      method: "DELETE",
      params: { leadId, inventoryId },
    }),
  appointments: (params) => apiRequest("appointments", { params }),
  createAppointment: (body) =>
    apiRequest("appointments", { method: "POST", body }),
  updateAppointment: (id, body) =>
    apiRequest("appointments", { method: "PATCH", params: { id }, body }),
  availability: (params) => apiRequest("availability", { params }),
  team: () => apiRequest("team"),
  createTeamMember: (body) => apiRequest("team", { method: "POST", body }),
  updateTeamMember: (id, body) =>
    apiRequest("team", { method: "PATCH", params: { id }, body }),
  deleteTeamMember: (id) =>
    apiRequest("team", { method: "DELETE", params: { id } }),
  followUps: () => apiRequest("followups"),
  createFollowUp: (body) => apiRequest("followups", { method: "POST", body }),
  updateFollowUp: (id, body) =>
    apiRequest("followups", { method: "PATCH", params: { id }, body }),
  alerts: () => apiRequest("alerts"),
  acknowledgeAlert: (id) =>
    apiRequest("alerts", { method: "PATCH", params: { id }, body: {} }),
  automations: () => apiRequest("automations"),
  updateAutomation: (id, body) =>
    apiRequest("automations", { method: "PATCH", params: { id }, body }),
  settings: () => apiRequest("settings"),
  updateSettings: (body) => apiRequest("settings", { method: "PATCH", body }),
  consents: (leadId) => apiRequest("consents", { params: { leadId } }),
  recordConsent: (leadId) =>
    apiRequest("consents", {
      method: "POST",
      params: { id: leadId },
      body: { confirmed: true },
    }),
  resolveUrgent: (leadId) =>
    apiRequest("leads", {
      method: "POST",
      params: { id: leadId, action: "resolve_urgent" },
      body: {},
    }),
  exportDealership: (dealershipId) =>
    apiRequest("export", { params: { dealershipId } }),
  platform: () => apiRequest("platform"),
  createPlatformDealership: (body) =>
    apiRequest("platform_dealerships", { method: "POST", body }),
  updatePlatformDealership: (id, body) =>
    apiRequest("platform_dealerships", {
      method: "PATCH",
      params: { id },
      body,
    }),
  deletePlatformDealership: (id) =>
    apiRequest("platform_dealerships", { method: "DELETE", params: { id } }),
  createPlatformUser: (body) =>
    apiRequest("platform_users", { method: "POST", body }),
  updatePlatformUser: (id, body) =>
    apiRequest("platform_users", { method: "PATCH", params: { id }, body }),
  deletePlatformUser: (id) =>
    apiRequest("platform_users", { method: "DELETE", params: { id } }),
  startImpersonation: (dealershipId, reason) =>
    apiRequest("impersonate", { method: "POST", body: { dealershipId, reason } }),
  endImpersonation: () =>
    apiRequest("impersonate", { method: "POST", params: { action: "end" }, body: {} }),
  // Connect Dealership System
  connections: () => apiRequest("connections"),
  createConnection: (body) =>
    apiRequest("connections", { method: "POST", body }),
  testConnection: (id) =>
    apiRequest("connections", { method: "POST", params: { id, action: "test" }, body: {} }),
  disconnectConnection: (id) =>
    apiRequest("connections", { method: "POST", params: { id, action: "disconnect" }, body: {} }),
  requestPartnerAccess: (body) =>
    apiRequest("connections", { method: "POST", params: { action: "request_access" }, body }),
  // Add Dealership wizard
  setupStatus: () => apiRequest("setup"),
  saveSetup: (body) => apiRequest("setup", { method: "PATCH", body }),
  uploadLogo: (dataUrl) =>
    apiRequest("setup", { method: "POST", params: { action: "logo" }, body: { dataUrl } }),
  inviteTeam: (invites) =>
    apiRequest("invites", { method: "POST", body: { invites } }),
  analytics: (days = 30) => apiRequest("analytics", { params: { days } }),
};

export const sendToTitan = async ({ leadId, message, offsetMinutes }) => {
  const response = await fetch("/api/chat", {
    method: "POST",
    credentials: "same-origin",
    headers: requestHeaders(true),
    body: JSON.stringify({ leadId, message, offsetMinutes }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(payload.error || `Chat failed (${response.status})`);
  return payload;
};

export const parseInventoryCsv = (text) => {
  const rows = String(text)
    .split(/\r?\n/)
    .filter((row) => row.trim());
  if (rows.length < 2) return [];
  const parseRow = (row) => {
    const values = [];
    let value = "";
    let quoted = false;
    for (let index = 0; index < row.length; index += 1) {
      const character = row[index];
      if (character === '"' && row[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = !quoted;
      } else if (character === "," && !quoted) {
        values.push(value.trim());
        value = "";
      } else {
        value += character;
      }
    }
    values.push(value.trim());
    return values;
  };
  const headers = parseRow(rows[0]).map((header) => header.trim());
  return rows
    .slice(1)
    .map((row) =>
      Object.fromEntries(
        headers.map((header, index) => [header, parseRow(row)[index] ?? ""]),
      ),
    );
};
