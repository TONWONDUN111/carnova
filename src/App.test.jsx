import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App.jsx";

const fixture = {
  session: {
    user: {
      id: "identity-1",
      email: "admin@ridgeway.example",
      name: "Avery Cole",
    },
    member: {
      id: "user-1",
      name: "Avery Cole",
      email: "admin@ridgeway.example",
      role: "admin",
    },
    dealership: {
      id: "dealer-1",
      name: "Ridgeway Motors",
      timezone: "America/New_York",
      settings: {},
      onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
    },
    needsOnboarding: false,
  },
  lead: {
    id: "lead-1",
    name: "Nia Harper",
    phone: "7045550184",
    email: "nia@example.com",
    source: "website",
    vehicle_interest: "2024 Chevrolet Tahoe",
    inventory_id: "vehicle-1",
    trade_in: "2018 Accord",
    budget: "Under $50,000",
    financing_interest: true,
    assigned_salesperson_id: "sales-1",
    assigned_bdc_agent_id: "user-1",
    assigned_manager_id: "manager-1",
    assigned_salesperson_name: "Marco Ellis",
    assigned_bdc_agent_name: "Avery Cole",
    assigned_manager_name: "Leah Grant",
    temperature: "hot",
    status: "engaged",
    ai_enabled: true,
    human_handoff_required: false,
    notes: "Prefers afternoon.",
    last_contact_at: "2026-08-26T13:00:00.000Z",
    next_follow_up_at: "2026-08-27T14:00:00.000Z",
    latest_message: "Is the black Tahoe available?",
  },
  vehicle: {
    id: "vehicle-1",
    stock_number: "T24018",
    vin: "1GNSKPKD0RR100001",
    year: 2024,
    make: "Chevrolet",
    model: "Tahoe",
    trim: "LT",
    mileage: 18200,
    price: 51995,
    internet_price: 48940,
    msrp: null,
    vehicle_type: "SUV",
    condition: "used",
    exterior_color: "Black",
    interior_color: "Jet Black",
    images: [],
    features: ["Leather"],
    status: "available",
    location: "Main lot",
    date_added: "2026-08-20T12:00:00.000Z",
  },
  team: [
    {
      id: "user-1",
      name: "Avery Cole",
      email: "admin@ridgeway.example",
      role: "admin",
      active: true,
    },
    {
      id: "sales-1",
      name: "Marco Ellis",
      email: "marco@ridgeway.example",
      role: "salesperson",
      active: true,
    },
    {
      id: "manager-1",
      name: "Leah Grant",
      email: "leah@ridgeway.example",
      role: "manager",
      active: true,
    },
  ],
};

const mocks = vi.hoisted(() => {
  const resolved = (value = {}) => vi.fn().mockResolvedValue(value);
  return {
    initializeAuth: resolved({
      user: {
        id: "identity-1",
        email: "admin@ridgeway.example",
        name: "Avery Cole",
      },
    }),
    signOut: resolved(),
    setNewPassword: resolved({
      id: "identity-1",
      email: "admin@ridgeway.example",
    }),
    crmApi: {
      session: resolved(),
      dashboard: resolved(),
      leads: resolved(),
      inventory: resolved(),
      appointments: resolved(),
      team: resolved(),
      followUps: resolved(),
      alerts: resolved(),
      automations: resolved(),
      messages: resolved(),
      availability: resolved(),
      createLead: resolved({ lead: {} }),
      updateLead: resolved({ lead: {} }),
      createVehicle: resolved({ vehicle: {} }),
      updateVehicle: resolved({ vehicle: {} }),
      importInventory: resolved({
        imported: 1,
        created: 1,
        updated: 0,
        failed: 0,
      }),
      vehicle: resolved({
        vehicle: {},
        leads: [],
        appointments: [],
        interests: [],
      }),
      updateVehicleStatus: resolved({ vehicle: {} }),
      inventorySources: resolved({ sources: [], syncs: [] }),
      createInventorySource: resolved({ source: {} }),
      updateInventorySource: resolved({ source: {} }),
      leadVehicles: resolved({ vehicles: [] }),
      attachLeadVehicle: resolved({ vehicle: {} }),
      detachLeadVehicle: resolved({ removed: true }),
      createAppointment: resolved({ appointment: {} }),
      updateAppointment: resolved({ appointment: {} }),
      createFollowUp: resolved({ followUp: {} }),
      updateFollowUp: resolved({ followUp: {} }),
      createTeamMember: resolved({ member: {} }),
      updateTeamMember: resolved({ member: {} }),
      updateAutomation: resolved({ rule: {} }),
      acknowledgeAlert: resolved({ alert: {} }),
      updateSettings: resolved({ dealership: {} }),
      consents: resolved({
        consents: [],
        disclosure: { version: "test", text: "Test disclosure" },
        optedOut: false,
      }),
      recordConsent: resolved({ consent: {} }),
      resolveUrgent: resolved({ ok: true }),
      settings: resolved({ dealership: {}, messaging: null }),
      exportDealership: resolved({ dealership: {} }),
      platform: resolved({ dealerships: [], users: [], operations: [] }),
      updatePlatformDealership: resolved({ dealership: {} }),
      updatePlatformUser: resolved({ user: {} }),
      sendMessage: resolved({ message: {} }),
      bootstrap: resolved(),
      startImpersonation: resolved({ token: "t", expiresAt: null, dealership: {} }),
      endImpersonation: resolved({ ended: true }),
      connections: resolved({
        catalog: [],
        connections: [],
        accessRequests: [],
        inbound: { emailConfigured: true, smsConfigured: true },
      }),
      createConnection: resolved({ connection: {} }),
      testConnection: resolved({ ok: true }),
      disconnectConnection: resolved({ connection: {} }),
      requestPartnerAccess: resolved({ request: {} }),
      setupStatus: resolved({ items: [], remaining: 0 }),
      saveSetup: resolved({ dealership: {} }),
      uploadLogo: resolved({ logoUrl: "" }),
      inviteTeam: resolved({ results: [] }),
      analytics: resolved({
        responseTime: {},
        appointments: {},
        sources: [],
        daily: [],
      }),
    },
    sendToTitan: resolved({ response: "Would today or tomorrow be better?" }),
  };
});

vi.mock("./services/auth.js", () => ({
  initializeAuth: mocks.initializeAuth,
  signOut: mocks.signOut,
  signIn: vi.fn(),
  signUp: vi.fn(),
  recoverPassword: vi.fn(),
  setNewPassword: mocks.setNewPassword,
  AuthError: class AuthError extends Error {},
  MissingIdentityError: class MissingIdentityError extends Error {},
}));

vi.mock("./services/api.js", () => ({
  crmApi: mocks.crmApi,
  sendToTitan: mocks.sendToTitan,
  parseInventoryCsv: vi.fn(() => []),
  impersonation: { get: vi.fn(() => null), set: vi.fn(), clear: vi.fn() },
}));

// The appointments view filters from today forward and slot buttons are
// labelled in local time, so fixture times are anchored to tomorrow at a fixed
// local hour rather than to a hard-coded calendar date.
const tomorrowAt = (hour, minute = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
};
const APPOINTMENT_START = tomorrowAt(14);
const APPOINTMENT_END = tomorrowAt(14, 30);

const resetApi = () => {
  mocks.crmApi.session.mockResolvedValue(fixture.session);
  mocks.crmApi.dashboard.mockResolvedValue({
    metrics: {
      new_leads: 1,
      active_conversations: 1,
      appointments_today: 1,
      appointments_upcoming: 1,
      show_rate: 50,
      sold_leads: 1,
      conversion_rate: 20,
      needs_follow_up: 1,
      hot_leads: 1,
    },
  });
  mocks.crmApi.leads.mockResolvedValue({ leads: [fixture.lead] });
  mocks.crmApi.inventory.mockResolvedValue({ inventory: [fixture.vehicle] });
  mocks.crmApi.appointments.mockResolvedValue({
    appointments: [
      {
        id: "appt-1",
        lead_id: "lead-1",
        lead_name: "Nia Harper",
        lead_phone: "7045550184",
        starts_at: APPOINTMENT_START,
        ends_at: APPOINTMENT_END,
        appointment_type: "test_drive",
        status: "scheduled",
        salesperson_id: "sales-1",
        salesperson_name: "Marco Ellis",
        vehicle_interest: "2024 Chevrolet Tahoe",
      },
    ],
  });
  mocks.crmApi.team.mockResolvedValue({ team: fixture.team });
  mocks.crmApi.followUps.mockResolvedValue({
    followUps: [
      {
        id: "follow-1",
        lead_id: "lead-1",
        lead_name: "Nia Harper",
        type: "call",
        status: "pending",
        due_at: "2026-08-27T14:00:00.000Z",
        assigned_user_name: "Avery Cole",
      },
    ],
  });
  mocks.crmApi.alerts.mockResolvedValue({
    alerts: [
      {
        id: "alert-1",
        lead_id: "lead-1",
        type: "hot_lead",
        severity: "warning",
        title: "Hot lead",
        message: "Nia Harper needs follow-up.",
        acknowledged: false,
        created_at: "2026-08-26T13:00:00.000Z",
      },
    ],
  });
  mocks.crmApi.automations.mockResolvedValue({
    rules: [
      {
        id: "rule-1",
        event_type: "lead.created",
        action_type: "new_lead_alert",
        delay_minutes: 0,
        enabled: true,
      },
    ],
    delivery: { inApp: true, webhook: false, sms: false, email: false },
  });
  mocks.crmApi.messages.mockResolvedValue({
    messages: [
      {
        id: "message-1",
        lead_id: "lead-1",
        direction: "inbound",
        sender_type: "customer",
        content: "Is the black Tahoe available?",
        channel: "chat",
        created_at: "2026-08-26T13:00:00.000Z",
      },
    ],
  });
  mocks.crmApi.availability.mockResolvedValue({
    slots: [
      {
        startsAt: APPOINTMENT_START,
        endsAt: APPOINTMENT_END,
      },
    ],
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  resetApi();
});

afterEach(() => cleanup());

const renderWorkspace = async () => {
  render(<App />);
  await screen.findByRole("heading", { name: "Dealership dashboard" });
};

describe("NOVACARAI CRM workspace", () => {
  it("opens every primary navigation view", async () => {
    const user = userEvent.setup();
    await renderWorkspace();
    for (const [button, heading] of [
      ["Inbox", "Nia Harper"],
      ["Leads", "Leads"],
      ["Inventory", "Inventory"],
      ["Appointments", "Appointments"],
      ["Follow-ups", "Follow-ups"],
      ["Team", "Sales team"],
      ["Automations", "Automations"],
      ["Settings", "Dealership settings"],
    ]) {
      await user.click(
        screen.getByRole("button", { name: new RegExp(button) }),
      );
      await screen.findByRole("heading", { name: heading });
    }
  });

  it("creates and edits CRM records through functional forms", async () => {
    const user = userEvent.setup();
    await renderWorkspace();
    await user.click(screen.getByRole("button", { name: "Leads" }));
    await user.click(screen.getByRole("button", { name: /Create lead/ }));
    await user.type(screen.getByLabelText("Name *"), "Tessa Morgan");
    await user.type(screen.getByLabelText("Phone"), "7045550112");
    await user.click(screen.getByRole("button", { name: "Save lead" }));
    await waitFor(() => expect(mocks.crmApi.createLead).toHaveBeenCalled());

    await user.click(screen.getByRole("button", { name: "Inventory" }));
    await user.click(screen.getByRole("button", { name: /Add vehicle/ }));
    await user.type(screen.getByLabelText("Stock number *"), "J26004");
    await user.clear(screen.getByLabelText("Year *"));
    await user.type(screen.getByLabelText("Year *"), "2026");
    await user.type(screen.getByLabelText("Make *"), "Jeep");
    await user.type(screen.getByLabelText("Model *"), "Wrangler");
    await user.click(screen.getByRole("button", { name: "Save vehicle" }));
    await waitFor(() => expect(mocks.crmApi.createVehicle).toHaveBeenCalled());
  });

  it("supports AI takeover, assignments, appointments, follow-ups, and outcomes", async () => {
    const user = userEvent.setup();
    await renderWorkspace();
    await user.click(screen.getByRole("button", { name: /Inbox/ }));
    expect(
      (await screen.findAllByText("Is the black Tahoe available?")).length,
    ).toBeGreaterThan(0);
    await user.selectOptions(screen.getByLabelText("Status"), "qualified");
    await waitFor(() =>
      expect(mocks.crmApi.updateLead).toHaveBeenCalledWith("lead-1", {
        status: "qualified",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Take over conversation" }),
    );
    await waitFor(() =>
      expect(mocks.crmApi.updateLead).toHaveBeenCalledWith("lead-1", {
        aiEnabled: false,
      }),
    );
    await user.click(
      screen.getByRole("button", { name: /Schedule appointment/ }),
    );
    await screen.findByRole("heading", { name: "Schedule appointment" });
    await user.click(screen.getByRole("button", { name: /2:00 PM|6:00 PM/ }));
    await user.click(screen.getByRole("button", { name: "Book appointment" }));
    await waitFor(() =>
      expect(mocks.crmApi.createAppointment).toHaveBeenCalled(),
    );
  });

  it("updates appointment outcomes, follow-ups, alerts, and automations", async () => {
    const user = userEvent.setup();
    await renderWorkspace();
    await user.click(screen.getByRole("button", { name: "Acknowledge" }));
    await waitFor(() =>
      expect(mocks.crmApi.acknowledgeAlert).toHaveBeenCalledWith("alert-1"),
    );
    await user.click(screen.getByRole("button", { name: "Appointments" }));
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(mocks.crmApi.updateAppointment).toHaveBeenCalledWith("appt-1", {
        status: "confirmed",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Follow-ups" }));
    await user.click(screen.getByRole("button", { name: "Complete" }));
    await waitFor(() =>
      expect(mocks.crmApi.updateFollowUp).toHaveBeenCalledWith("follow-1", {
        status: "completed",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Automations" }));
    await user.click(screen.getByTitle("Disable automation"));
    await waitFor(() =>
      expect(mocks.crmApi.updateAutomation).toHaveBeenCalledWith("rule-1", {
        enabled: false,
        delayMinutes: 0,
      }),
    );
  });

  it("surfaces a failed one-click action instead of silently doing nothing", async () => {
    const user = userEvent.setup();
    mocks.crmApi.acknowledgeAlert.mockRejectedValueOnce(
      new Error("Alert could not be acknowledged."),
    );
    await renderWorkspace();
    await user.click(screen.getByRole("button", { name: "Acknowledge" }));
    expect(
      await screen.findByText("Alert could not be acknowledged."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Acknowledge" })).toBeEnabled();
  });

  it("disables actions that cannot do anything for the current record", async () => {
    const user = userEvent.setup();
    mocks.crmApi.leads.mockResolvedValue({
      leads: [{ ...fixture.lead, phone: "", status: "sold" }],
    });
    await renderWorkspace();
    await user.click(screen.getByRole("button", { name: /Inbox/ }));
    await screen.findByRole("heading", { name: "Nia Harper" });
    expect(screen.getByRole("button", { name: "Call" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Mark sold/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Mark lost/ })).toBeEnabled();
  });

  it("does not offer fake test inventory in the dealership workspace", async () => {
    const user = userEvent.setup();
    mocks.crmApi.inventory.mockResolvedValue({
      inventory: [],
      facets: { total: 0 },
    });
    await renderWorkspace();
    await user.click(screen.getByRole("button", { name: "Inventory" }));
    await screen.findByText(/No inventory is loaded/);
    expect(screen.queryByText(/test inventory/i)).not.toBeInTheDocument();
  });

  it("filters live records and persists appointment cancellation details", async () => {
    const user = userEvent.setup();
    await renderWorkspace();
    await user.click(screen.getByRole("button", { name: "Inventory" }));
    expect(screen.getByText("2024 Chevrolet Tahoe")).toBeInTheDocument();

    // Inventory search runs against the API, not a client-side copy, so the
    // dealership scope and every filter are enforced by the server.
    await user.type(screen.getByLabelText("Search inventory"), "Wrangler");
    await waitFor(() =>
      expect(mocks.crmApi.inventory).toHaveBeenCalledWith(
        expect.objectContaining({ q: "Wrangler" }),
      ),
    );
    await user.selectOptions(screen.getByLabelText("Condition"), "used");
    await user.selectOptions(
      screen.getByLabelText("Filter by availability"),
      "sold",
    );
    await waitFor(() =>
      expect(mocks.crmApi.inventory).toHaveBeenCalledWith(
        expect.objectContaining({
          q: "Wrangler",
          condition: "used",
          status: "sold",
        }),
      ),
    );

    await user.click(screen.getByRole("button", { name: "Appointments" }));
    await user.click(screen.getByRole("button", { name: "Manage" }));
    await user.selectOptions(screen.getByLabelText("Status"), "cancelled");
    await user.type(
      screen.getByLabelText("Cancellation reason"),
      "Customer rescheduled",
    );
    await user.click(
      screen.getByRole("button", { name: "Update appointment" }),
    );
    await waitFor(() =>
      expect(mocks.crmApi.updateAppointment).toHaveBeenCalledWith(
        "appt-1",
        expect.objectContaining({
          status: "cancelled",
          cancellationReason: "Customer rescheduled",
        }),
      ),
    );
  });

  it("keeps the inventory search dealership scoped and shows sync freshness", async () => {
    const user = userEvent.setup();
    mocks.crmApi.dashboard.mockResolvedValue({
      metrics: {},
      inventoryFreshness: {
        vehicleCount: 12,
        presentableCount: 9,
        lastSyncedAt: "2026-08-30T09:00:00.000Z",
        lastRecordUpdatedAt: "2026-08-30T09:00:00.000Z",
        lastSyncStatus: "success",
        lastSyncSourceType: "csv",
        staleAfterHours: 24,
        ageHours: 2,
        stale: false,
      },
    });
    mocks.crmApi.inventory.mockResolvedValue({
      inventory: [fixture.vehicle],
      total: 1,
      facets: {
        total: 12,
        makes: [{ value: "Chevrolet", count: 3 }],
        models: [{ make: "Chevrolet", value: "Tahoe", count: 3 }],
        bodyStyles: [{ value: "SUV", count: 5 }],
        exteriorColors: [{ value: "Black", count: 4 }],
        interiorColors: [{ value: "Jet Black", count: 4 }],
        features: ["leather"],
      },
      freshness: {
        vehicleCount: 12,
        presentableCount: 9,
        lastSyncedAt: "2026-08-30T09:00:00.000Z",
        ageHours: 2,
        stale: false,
        lastSyncSourceType: "csv",
      },
    });
    await renderWorkspace();
    await user.click(screen.getByRole("button", { name: "Inventory" }));
    expect(screen.getByText(/Last inventory sync:/)).toBeInTheDocument();

    // Every filter is sent to the server, which is the only place the
    // dealership scope can be enforced.
    await user.selectOptions(screen.getByLabelText("Make"), "Chevrolet");
    await user.selectOptions(screen.getByLabelText("Body style"), "SUV");
    await user.type(screen.getByLabelText("Max price"), "40000");
    await user.click(screen.getByLabelText("Only what TITAN can present"));
    await waitFor(() =>
      expect(mocks.crmApi.inventory).toHaveBeenCalledWith(
        expect.objectContaining({
          make: "Chevrolet",
          bodyStyle: "SUV",
          maxPrice: "40000",
          availableOnly: "true",
        }),
      ),
    );

    // A quick availability change goes through the inventory API so TITAN
    // stops presenting the vehicle immediately.
    await user.selectOptions(
      screen.getByLabelText("Availability for stock T24018"),
      "sold",
    );
    await waitFor(() =>
      expect(mocks.crmApi.updateVehicleStatus).toHaveBeenCalledWith(
        "vehicle-1",
        { status: "sold" },
      ),
    );
  });

  it("attaches a real inventory vehicle to a lead and flags sold vehicles", async () => {
    const user = userEvent.setup();
    mocks.crmApi.leadVehicles.mockResolvedValue({
      vehicles: [
        {
          id: "lv-1",
          inventory_id: "vehicle-1",
          stock_number: "T24018",
          current_stock_number: "T24018",
          year: 2024,
          make: "Chevrolet",
          model: "Tahoe",
          trim: "LT",
          current_status: "sold",
          interest_level: "primary",
          captured_by: "ai",
          effective_price: 48940,
          exterior_color: "Black",
        },
      ],
    });
    await renderWorkspace();
    await user.click(screen.getByRole("button", { name: /Inbox/ }));
    await waitFor(() =>
      expect(mocks.crmApi.leadVehicles).toHaveBeenCalledWith("lead-1"),
    );
    expect(
      screen.getByText(/will not present this vehicle as available/),
    ).toBeInTheDocument();

    mocks.crmApi.inventory.mockResolvedValue({
      inventory: [
        { ...fixture.vehicle, id: "vehicle-2", stock_number: "T24019" },
      ],
      total: 1,
    });
    await user.click(
      screen.getByRole("button", { name: "Attach inventory vehicle" }),
    );
    await user.type(
      screen.getByLabelText("Search inventory for a vehicle"),
      "Tahoe",
    );
    const option = await screen.findByRole("button", { name: /T24019/ });
    await user.click(option);
    await waitFor(() =>
      expect(mocks.crmApi.attachLeadVehicle).toHaveBeenCalledWith({
        leadId: "lead-1",
        inventoryId: "vehicle-2",
        interestLevel: "interested",
      }),
    );
  });

  it("exposes master administration only to platform owners", async () => {
    mocks.crmApi.session.mockResolvedValue({
      ...fixture.session,
      platformAdmin: true,
    });
    const user = userEvent.setup();
    await renderWorkspace();
    await user.click(screen.getByRole("button", { name: "Master admin" }));
    await screen.findByRole("heading", { name: "Master administration" });
    await waitFor(() => expect(mocks.crmApi.platform).toHaveBeenCalled());
  });

  it("lets a platform owner without a dealership create one", async () => {
    mocks.crmApi.session.mockResolvedValue({
      user: fixture.session.user,
      member: null,
      dealership: null,
      platformAdmin: true,
      needsOnboarding: true,
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Master administration" });

    await user.click(
      screen.getByRole("button", { name: "Create dealership workspace" }),
    );
    await screen.findByRole("heading", { name: "Connect your dealership" });

    await user.type(
      screen.getByLabelText("Dealership name *"),
      "Ridgeway Motors",
    );
    await user.click(
      screen.getByRole("button", { name: "Create dealership workspace" }),
    );
    await waitFor(() =>
      expect(mocks.crmApi.bootstrap).toHaveBeenCalledWith(
        expect.objectContaining({ dealershipName: "Ridgeway Motors" }),
      ),
    );
  });

  it("returns a platform owner to master administration on cancel", async () => {
    mocks.crmApi.session.mockResolvedValue({
      user: fixture.session.user,
      member: null,
      dealership: null,
      platformAdmin: true,
      needsOnboarding: true,
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Master administration" });

    await user.click(
      screen.getByRole("button", { name: "Create dealership workspace" }),
    );
    await screen.findByRole("heading", { name: "Connect your dealership" });
    await user.click(
      screen.getByRole("button", { name: "Back to master administration" }),
    );
    await screen.findByRole("heading", { name: "Master administration" });
    expect(mocks.crmApi.bootstrap).not.toHaveBeenCalled();
  });

  it("keeps administrator roles out of a manager's reach", async () => {
    mocks.crmApi.session.mockResolvedValue({
      ...fixture.session,
      member: { ...fixture.session.member, role: "manager" },
    });
    const user = userEvent.setup();
    await renderWorkspace();
    await user.click(screen.getByRole("button", { name: "Team" }));
    await screen.findByRole("heading", { name: "Sales team" });
    expect(
      screen.getByTitle("Admin role required to edit an administrator"),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /Add team member/ }));
    const roleOptions = screen
      .getByLabelText("Role")
      .querySelectorAll("option");
    expect([...roleOptions].map((option) => option.value)).not.toContain(
      "admin",
    );
  });

  it("asks for a new password when opened from a recovery link", async () => {
    mocks.initializeAuth.mockResolvedValueOnce({
      callback: { type: "recovery", user: fixture.session.user },
      user: fixture.session.user,
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Choose a new password" });
    await user.type(screen.getByLabelText("Password"), "new-secret-pass");
    await user.click(screen.getByRole("button", { name: "Save password" }));
    await waitFor(() =>
      expect(mocks.setNewPassword).toHaveBeenCalledWith(
        "new-secret-pass",
        expect.objectContaining({ type: "recovery" }),
      ),
    );
    await screen.findByRole("heading", { name: "Dealership dashboard" });
  });

  it("lets a signed-in user without a dealership sign out of onboarding", async () => {
    mocks.crmApi.session.mockResolvedValue({
      user: fixture.session.user,
      member: null,
      dealership: null,
      platformAdmin: false,
      needsOnboarding: true,
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Connect your dealership" });
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalled());
    expect(mocks.crmApi.bootstrap).not.toHaveBeenCalled();
  });
});
