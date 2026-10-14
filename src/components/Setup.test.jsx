import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { connectorCatalog } from "../../netlify/lib/connectors/index.mjs";
import { ConnectSystemModal, DealershipWizard } from "./Setup.jsx";

const api = vi.hoisted(() => ({
  connections: vi.fn(),
  createConnection: vi.fn(),
  testConnection: vi.fn(),
  disconnectConnection: vi.fn(),
  saveSetup: vi.fn(),
  setupStatus: vi.fn(),
  uploadLogo: vi.fn(),
  inviteTeam: vi.fn(),
}));
vi.mock("../services/api.js", () => ({ crmApi: api }));

const catalog = connectorCatalog();
const session = {
  member: { id: "u1", role: "owner" },
  dealership: { id: "d1", name: "Ridgeway Motors", timezone: "America/Chicago", settings: {} },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Connect Dealership System", () => {
  it("shows availability badges and only requests access for partner APIs", async () => {
    api.createConnection.mockResolvedValue({ connection: { status: "pending" }, accessRequested: true });
    const onConnected = vi.fn();
    render(<ConnectSystemModal catalog={catalog} onClose={vi.fn()} onConnected={onConnected} />);
    for (const system of catalog) expect(screen.getByRole("button", { name: new RegExp(system.name) })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /ProMax/ }));
    expect(screen.getAllByText(/Available/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Pending partner approval/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/never asks for your ProMax username or password/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /Request access/ }));
    await waitFor(() => expect(api.createConnection).toHaveBeenCalledWith(expect.objectContaining({ system: "promax", type: "direct_api" })));
    expect(onConnected).toHaveBeenCalled();
  });
});

describe("Add Dealership wizard", () => {
  it("walks every step and lists what is still unconfigured", async () => {
    api.saveSetup.mockResolvedValue({ dealership: {} });
    api.connections.mockResolvedValue({ catalog, connections: [], accessRequests: [], inbound: { emailConfigured: false, smsConfigured: false } });
    api.setupStatus.mockResolvedValue({
      items: [
        { key: "profile", label: "Dealership profile", done: true },
        { key: "sms_provider", label: "Twilio texting", done: false, platform: true },
      ],
      remaining: 1,
    });
    const onFinished = vi.fn();
    render(<DealershipWizard session={session} onClose={vi.fn()} onFinished={onFinished} />);

    for (let index = 0; index < 3; index += 1) await userEvent.click(await screen.findByRole("button", { name: "Save and continue" }));
    await userEvent.click(await screen.findByRole("button", { name: "Continue" }));
    await userEvent.click(await screen.findByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Twilio texting")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Finish setup" }));
    await waitFor(() => expect(onFinished).toHaveBeenCalled());
    expect(api.saveSetup).toHaveBeenCalledWith(expect.objectContaining({ timezone: "America/Chicago" }));
    expect(api.saveSetup).toHaveBeenCalledWith(expect.objectContaining({ businessHours: expect.any(Object) }));
    expect(api.saveSetup).toHaveBeenLastCalledWith({ complete: true });
  });
});
