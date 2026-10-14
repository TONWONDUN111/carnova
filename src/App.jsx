import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BellRing,
  Bot,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  Database,
  FileUp,
  FileDown,
  Gauge,
  Inbox,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Menu,
  MessageSquareText,
  Pencil,
  Phone,
  Palette,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Store,
  Trash2,
  UserCog,
  UsersRound,
  Warehouse,
  X,
} from "lucide-react";
import {
  crmApi,
  impersonation,
  parseInventoryCsv,
  sendToTitan,
} from "./services/api.js";
import { Modal, Notice } from "./components/ui.jsx";
import {
  AnalyticsPanel,
  ConnectionsPanel,
  DealershipWizard,
} from "./components/Setup.jsx";
import {
  AuthError,
  MissingIdentityError,
  initializeAuth,
  recoverPassword,
  setNewPassword,
  signIn,
  signOut,
  signUp,
} from "./services/auth.js";

const LEAD_STATUSES = [
  "new",
  "contacted",
  "engaged",
  "qualified",
  "appointment_set",
  "appointment_confirmed",
  "showed",
  "sold",
  "lost",
  "nurture",
];
const TEMPERATURES = ["hot", "warm", "cold"];
const APPOINTMENT_STATUSES = [
  "requested",
  "scheduled",
  "confirmed",
  "rescheduled",
  "cancelled",
  "showed",
  "no_show",
];
const APPOINTMENT_TYPES = [
  "showroom",
  "test_drive",
  "trade_appraisal",
  "delivery",
  "finance",
];
const ROLES = ["owner", "admin", "manager", "bdc", "sales", "salesperson"];
const ADMIN_ROLES = ["owner", "admin"];
const FOLLOW_UP_TYPES = [
  "call",
  "text",
  "email",
  "appointment_reminder",
  "no_show",
  "hot_lead",
  "human_handoff",
  "unanswered",
];

const labels = {
  appointment_set: "Appointment Set",
  appointment_confirmed: "Appointment Confirmed",
  no_show: "No Show",
  test_drive: "Test Drive",
  trade_appraisal: "Trade Appraisal",
  appointment_reminder: "Appointment Reminder",
  human_handoff: "Human Handoff",
  hot_lead: "Hot Lead",
};

const label = (value = "") =>
  labels[value] ??
  value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const money = (value) =>
  value === null || value === undefined || value === ""
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(Number(value));
const dateTime = (value) =>
  value
    ? new Date(value).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";
const dateOnly = (value) =>
  value
    ? new Date(value).toLocaleDateString([], {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";
const toLocalInput = (value) =>
  value ? new Date(value).toISOString().slice(0, 16) : "";
const classNames = (...values) => values.filter(Boolean).join(" ");
const downloadJson = (payload, filename) => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

const emptyLead = {
  name: "",
  phone: "",
  email: "",
  source: "manual",
  vehicleInterest: "",
  inventoryId: "",
  tradeIn: "",
  budget: "",
  financingInterest: false,
  assignedSalespersonId: "",
  assignedBdcAgentId: "",
  assignedManagerId: "",
  temperature: "warm",
  status: "new",
  notes: "",
  nextFollowUpAt: "",
};
const emptyVehicle = {
  stockNumber: "",
  vin: "",
  year: new Date().getFullYear(),
  make: "",
  model: "",
  trim: "",
  mileage: "",
  price: "",
  internetPrice: "",
  msrp: "",
  vehicleType: "",
  condition: "used",
  exteriorColor: "",
  interiorColor: "",
  images: "",
  features: "",
  description: "",
  status: "available",
  location: "",
};

// One-click row actions (acknowledge, confirm, complete…) share this so every
// click shows progress, blocks double submits, and surfaces a failure instead
// of silently doing nothing.
function useQuickAction(refresh) {
  const [pendingKey, setPendingKey] = useState("");
  const [error, setError] = useState("");
  const run = async (key, action) => {
    setPendingKey(key);
    setError("");
    try {
      await action();
      await refresh();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setPendingKey("");
    }
  };
  return { pendingKey, error, run };
}

function AuthScreen({ onAuthenticated, passwordCallback }) {
  const [mode, setMode] = useState(passwordCallback ? "set_password" : "login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (mode === "set_password") {
        onAuthenticated(await setNewPassword(form.password, passwordCallback));
      } else if (mode === "recovery") {
        await recoverPassword(form.email);
        setMessage("Password recovery email sent.");
      } else if (mode === "signup") {
        const user = await signUp(form.email, form.password, form.name);
        if (user.confirmedAt) onAuthenticated(user);
        else
          setMessage(
            "Account created. Check your email to confirm it, then sign in.",
          );
      } else {
        onAuthenticated(await signIn(form.email, form.password));
      }
    } catch (caught) {
      if (caught instanceof MissingIdentityError)
        setError("Netlify Identity is not enabled for this deployment.");
      else if (caught instanceof AuthError)
        setError(
          caught.status === 401 ? "Invalid email or password." : caught.message,
        );
      else setError(caught.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-story">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Sparkles size={22} />
          </div>
          <div>
            <strong>NOVACARAI</strong>
            <span>Dealership AI BDC + CRM · powered by titan ai</span>
          </div>
        </div>
        <div className="auth-copy">
          <span className="eyebrow light">Connected retail workflow</span>
          <h1>
            From first response
            <br />
            to showroom arrival.
          </h1>
          <p>
            Inventory-aware AI, real lead ownership, appointment capacity, human
            handoffs, and dealership follow-up in one operating system.
          </p>
        </div>
        <div className="auth-flow">
          <span>Lead</span>
          <ChevronRight size={14} />
          <span>Conversation</span>
          <ChevronRight size={14} />
          <span>Appointment</span>
          <ChevronRight size={14} />
          <span>Outcome</span>
        </div>
      </section>
      <section className="auth-panel">
        <form onSubmit={submit}>
          <span className="eyebrow">Secure workspace</span>
          <h2>
            {mode === "login"
              ? "Welcome back"
              : mode === "signup"
                ? "Create your dealership account"
                : mode === "set_password"
                  ? "Choose a new password"
                  : "Reset your password"}
          </h2>
          <p>
            {mode === "recovery"
              ? "We’ll send a secure recovery link."
              : mode === "set_password"
                ? "Set a password to finish signing in."
                : "Use your Netlify Identity account to continue."}
          </p>
          {mode === "signup" && (
            <label>
              <span>Full name</span>
              <input
                required
                value={form.name}
                onChange={(event) =>
                  setForm({ ...form, name: event.target.value })
                }
              />
            </label>
          )}
          {mode !== "set_password" && (
            <label>
              <span>Email</span>
              <input
                type="email"
                required
                value={form.email}
                onChange={(event) =>
                  setForm({ ...form, email: event.target.value })
                }
              />
            </label>
          )}
          {mode !== "recovery" && (
            <label>
              <span>Password</span>
              <input
                type="password"
                minLength={8}
                required
                value={form.password}
                onChange={(event) =>
                  setForm({ ...form, password: event.target.value })
                }
              />
            </label>
          )}
          {error && <Notice type="error">{error}</Notice>}
          {message && <Notice type="success">{message}</Notice>}
          <button className="primary-button full" disabled={busy}>
            {busy ? (
              <>
                <LoaderCircle className="spin" size={17} /> Working…
              </>
            ) : mode === "login" ? (
              "Sign in"
            ) : mode === "signup" ? (
              "Create account"
            ) : mode === "set_password" ? (
              "Save password"
            ) : (
              "Send recovery email"
            )}
          </button>
          <div className="auth-links">
            {mode !== "login" && mode !== "set_password" && (
              <button type="button" onClick={() => setMode("login")}>
                Back to sign in
              </button>
            )}
            {mode === "login" && (
              <>
                <button type="button" onClick={() => setMode("signup")}>
                  Create account
                </button>
                <button type="button" onClick={() => setMode("recovery")}>
                  Forgot password?
                </button>
              </>
            )}
          </div>
        </form>
      </section>
    </main>
  );
}

function Onboarding({ user, onComplete, onCancel, onSignOut }) {
  const [form, setForm] = useState({
    dealershipName: "",
    name: user?.name ?? "",
    phone: "",
    email: user?.email ?? "",
    address: "",
    timezone:
      Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await crmApi.bootstrap(form);
      await onComplete();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="onboarding-shell">
      <form className="onboarding-card" onSubmit={submit}>
        <div className="brand-mark">
          <Store size={22} />
        </div>
        <span className="eyebrow">Workspace setup</span>
        <h1>Connect your dealership</h1>
        <p>
          This creates an isolated dealership tenant. Inventory, leads,
          employees, appointments, and settings remain scoped to this workspace.
        </p>
        <div className="form-grid">
          <label className="full-span">
            <span>Dealership name *</span>
            <input
              required
              value={form.dealershipName}
              onChange={(event) =>
                setForm({ ...form, dealershipName: event.target.value })
              }
            />
          </label>
          <label>
            <span>Your name</span>
            <input
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
            />
          </label>
          <label>
            <span>Main phone</span>
            <input
              value={form.phone}
              onChange={(event) =>
                setForm({ ...form, phone: event.target.value })
              }
            />
          </label>
          <label className="full-span">
            <span>Address</span>
            <input
              value={form.address}
              onChange={(event) =>
                setForm({ ...form, address: event.target.value })
              }
            />
          </label>
          <label className="full-span">
            <span>Timezone</span>
            <input
              value={form.timezone}
              onChange={(event) =>
                setForm({ ...form, timezone: event.target.value })
              }
            />
          </label>
        </div>
        {error && <Notice type="error">{error}</Notice>}
        <button className="primary-button full" disabled={busy}>
          {busy ? "Creating workspace…" : "Create dealership workspace"}
        </button>
        {onCancel && (
          <button
            type="button"
            className="secondary-button full"
            disabled={busy}
            onClick={onCancel}
          >
            Back to master administration
          </button>
        )}
        {onSignOut && (
          <>
            <Notice>
              Joining an existing dealership? Ask its administrator to add your
              email on their Team screen, confirm your email, then sign in again
              instead of creating a new workspace.
            </Notice>
            <button
              type="button"
              className="secondary-button full"
              disabled={busy}
              onClick={onSignOut}
            >
              Sign out
            </button>
          </>
        )}
      </form>
    </main>
  );
}

/**
 * Attaches a real inventory record, not a free-text vehicle name. Search runs
 * server side so the picker can only ever reach this dealership's inventory,
 * and the chosen row carries the identifying fields (id, stock, VIN, year,
 * make, model) that the CRM stores against the lead or appointment.
 */
function VehiclePicker({ value, initialVehicle, onSelect, label: fieldLabel }) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState([]);
  const [selected, setSelected] = useState(initialVehicle ?? null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!value) {
      setSelected(null);
      return;
    }
    if (selected?.id === value) return;
    let active = true;
    crmApi
      .vehicle(value)
      .then((payload) => active && setSelected(payload.vehicle))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [value]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setMatches([]);
      return;
    }
    let active = true;
    const timer = setTimeout(async () => {
      setSearching(true);
      setError("");
      try {
        const payload = await crmApi.inventory({ q: query.trim(), limit: 12 });
        if (active) setMatches(payload.inventory);
      } catch (caught) {
        if (active) setError(caught.message);
      } finally {
        if (active) setSearching(false);
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query]);

  const choose = (vehicle) => {
    setSelected(vehicle);
    setQuery("");
    setMatches([]);
    onSelect(vehicle);
  };

  return (
    <div className="vehicle-picker full-span">
      <span className="field-label">{fieldLabel ?? "Inventory vehicle"}</span>
      {selected ? (
        <div className="vehicle-picker-selected">
          <div>
            <strong>
              #{selected.stock_number} · {selected.year} {selected.make}{" "}
              {selected.model} {selected.trim ?? ""}
            </strong>
            <small>
              {money(selected.internet_price ?? selected.price)} ·{" "}
              {selected.exterior_color || "Color not provided"} ·{" "}
              {selected.vin || "VIN not provided"}
            </small>
          </div>
          <b className={`pill ${selected.status}`}>{label(selected.status)}</b>
          <button
            type="button"
            className="icon-button"
            aria-label="Remove inventory vehicle"
            onClick={() => {
              setSelected(null);
              onSelect(null);
            }}
          >
            <X size={15} />
          </button>
        </div>
      ) : (
        <div className="search-field">
          <Search size={15} />
          <input
            aria-label="Search inventory for a vehicle"
            value={query}
            placeholder="Search stock #, VIN, make, model, trim, color"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      )}
      {!selected && searching && <small className="muted">Searching…</small>}
      {error && <Notice type="error">{error}</Notice>}
      {!selected && matches.length > 0 && (
        <ul className="vehicle-picker-results">
          {matches.map((vehicle) => (
            <li key={vehicle.id}>
              <button type="button" onClick={() => choose(vehicle)}>
                <span>
                  #{vehicle.stock_number} · {vehicle.year} {vehicle.make}{" "}
                  {vehicle.model} {vehicle.trim ?? ""}
                </span>
                <small>
                  {money(vehicle.internet_price ?? vehicle.price)} ·{" "}
                  {label(vehicle.status)} ·{" "}
                  {vehicle.exterior_color || "Color not provided"}
                </small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!selected &&
        !searching &&
        query.trim().length >= 2 &&
        matches.length === 0 && (
          <small className="muted">
            No vehicle in this dealership's inventory matches that search.
          </small>
        )}
    </div>
  );
}

function LeadForm({ lead, inventory, team, onClose, onSaved }) {
  const [form, setForm] = useState(
    lead
      ? {
          name: lead.name ?? "",
          phone: lead.phone ?? "",
          email: lead.email ?? "",
          source: lead.source ?? "manual",
          vehicleInterest: lead.vehicle_interest ?? "",
          inventoryId: lead.inventory_id ?? "",
          tradeIn: lead.trade_in ?? "",
          budget: lead.budget ?? "",
          financingInterest: Boolean(lead.financing_interest),
          assignedSalespersonId: lead.assigned_salesperson_id ?? "",
          assignedBdcAgentId: lead.assigned_bdc_agent_id ?? "",
          assignedManagerId: lead.assigned_manager_id ?? "",
          temperature: lead.temperature ?? "warm",
          status: lead.status ?? "new",
          notes: lead.notes ?? "",
          nextFollowUpAt: toLocalInput(lead.next_follow_up_at),
        }
      : emptyLead,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = {
        ...form,
        nextFollowUpAt: form.nextFollowUpAt
          ? new Date(form.nextFollowUpAt).toISOString()
          : null,
      };
      if (lead) await crmApi.updateLead(lead.id, body);
      else await crmApi.createLead(body);
      await onSaved();
      onClose();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={lead ? "Edit lead" : "Create lead"}
      eyebrow="CRM record"
      onClose={onClose}
      size="large"
    >
      <form onSubmit={save}>
        <div className="form-grid three">
          <label>
            <span>Name *</span>
            <input
              required
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
            />
          </label>
          <label>
            <span>Phone</span>
            <input
              value={form.phone}
              onChange={(event) =>
                setForm({ ...form, phone: event.target.value })
              }
            />
          </label>
          <label>
            <span>Email</span>
            <input
              type="email"
              value={form.email}
              onChange={(event) =>
                setForm({ ...form, email: event.target.value })
              }
            />
          </label>
          <label>
            <span>Source</span>
            <input
              value={form.source}
              onChange={(event) =>
                setForm({ ...form, source: event.target.value })
              }
            />
          </label>
          <label>
            <span>Status</span>
            <select
              value={form.status}
              onChange={(event) =>
                setForm({ ...form, status: event.target.value })
              }
            >
              {LEAD_STATUSES.map((item) => (
                <option key={item} value={item}>
                  {label(item)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Temperature</span>
            <select
              value={form.temperature}
              onChange={(event) =>
                setForm({ ...form, temperature: event.target.value })
              }
            >
              {TEMPERATURES.map((item) => (
                <option key={item} value={item}>
                  {label(item)}
                </option>
              ))}
            </select>
          </label>
          <VehiclePicker
            value={form.inventoryId}
            initialVehicle={
              inventory.find((vehicle) => vehicle.id === lead?.inventory_id) ??
              null
            }
            onSelect={(vehicle) =>
              setForm({
                ...form,
                inventoryId: vehicle?.id ?? "",
                vehicleInterest: vehicle
                  ? `${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim ?? ""}`.trim()
                  : form.vehicleInterest,
              })
            }
          />
          <label className="full-span">
            <span>Vehicle interest</span>
            <input
              value={form.vehicleInterest}
              onChange={(event) =>
                setForm({ ...form, vehicleInterest: event.target.value })
              }
            />
          </label>
          <label>
            <span>Budget</span>
            <input
              value={form.budget}
              onChange={(event) =>
                setForm({ ...form, budget: event.target.value })
              }
            />
          </label>
          <label>
            <span>Trade-in</span>
            <input
              value={form.tradeIn}
              onChange={(event) =>
                setForm({ ...form, tradeIn: event.target.value })
              }
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={form.financingInterest}
              onChange={(event) =>
                setForm({ ...form, financingInterest: event.target.checked })
              }
            />
            <span>Interested in financing</span>
          </label>
          <label>
            <span>Salesperson</span>
            <select
              value={form.assignedSalespersonId}
              onChange={(event) =>
                setForm({ ...form, assignedSalespersonId: event.target.value })
              }
            >
              <option value="">Unassigned</option>
              {team
                .filter(
                  (member) =>
                    ["sales", "salesperson", "manager", "admin", "owner"].includes(member.role) &&
                    member.active,
                )
                .map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span>BDC agent</span>
            <select
              value={form.assignedBdcAgentId}
              onChange={(event) =>
                setForm({ ...form, assignedBdcAgentId: event.target.value })
              }
            >
              <option value="">Unassigned</option>
              {team
                .filter(
                  (member) =>
                    ["bdc", "manager", "admin", "owner"].includes(member.role) &&
                    member.active,
                )
                .map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span>Manager</span>
            <select
              value={form.assignedManagerId}
              onChange={(event) =>
                setForm({ ...form, assignedManagerId: event.target.value })
              }
            >
              <option value="">Unassigned</option>
              {team
                .filter(
                  (member) =>
                    ["manager", "admin", "owner"].includes(member.role) && member.active,
                )
                .map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span>Next follow-up</span>
            <input
              type="datetime-local"
              value={form.nextFollowUpAt}
              onChange={(event) =>
                setForm({ ...form, nextFollowUpAt: event.target.value })
              }
            />
          </label>
          <label className="full-span">
            <span>Notes</span>
            <textarea
              rows={4}
              value={form.notes}
              onChange={(event) =>
                setForm({ ...form, notes: event.target.value })
              }
            />
          </label>
        </div>
        {error && <Notice type="error">{error}</Notice>}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? "Saving…" : "Save lead"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function VehicleForm({ vehicle, onClose, onSaved }) {
  const [form, setForm] = useState(
    vehicle
      ? {
          stockNumber: vehicle.stock_number ?? "",
          vin: vehicle.vin ?? "",
          year: vehicle.year ?? "",
          make: vehicle.make ?? "",
          model: vehicle.model ?? "",
          trim: vehicle.trim ?? "",
          mileage: vehicle.mileage ?? "",
          price: vehicle.price ?? "",
          internetPrice: vehicle.internet_price ?? "",
          msrp: vehicle.msrp ?? "",
          vehicleType: vehicle.vehicle_type ?? "",
          condition: vehicle.condition ?? "used",
          exteriorColor: vehicle.exterior_color ?? "",
          interiorColor: vehicle.interior_color ?? "",
          images: Array.isArray(vehicle.images)
            ? vehicle.images.join(", ")
            : "",
          features: Array.isArray(vehicle.features)
            ? vehicle.features.join(", ")
            : "",
          description: vehicle.description ?? "",
          status: vehicle.status ?? "available",
          location: vehicle.location ?? "",
        }
      : emptyVehicle,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (vehicle) await crmApi.updateVehicle(vehicle.id, form);
      else await crmApi.createVehicle(form);
      await onSaved();
      onClose();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={vehicle ? "Edit vehicle" : "Add inventory vehicle"}
      eyebrow="Inventory record"
      onClose={onClose}
      size="large"
    >
      <form onSubmit={save}>
        <div className="form-grid three">
          <label>
            <span>Stock number *</span>
            <input
              required
              value={form.stockNumber}
              onChange={(event) =>
                setForm({ ...form, stockNumber: event.target.value })
              }
            />
          </label>
          <label>
            <span>VIN</span>
            <input
              value={form.vin}
              onChange={(event) =>
                setForm({ ...form, vin: event.target.value })
              }
            />
          </label>
          <label>
            <span>Year *</span>
            <input
              type="number"
              required
              value={form.year}
              onChange={(event) =>
                setForm({ ...form, year: event.target.value })
              }
            />
          </label>
          <label>
            <span>Make *</span>
            <input
              required
              value={form.make}
              onChange={(event) =>
                setForm({ ...form, make: event.target.value })
              }
            />
          </label>
          <label>
            <span>Model *</span>
            <input
              required
              value={form.model}
              onChange={(event) =>
                setForm({ ...form, model: event.target.value })
              }
            />
          </label>
          <label>
            <span>Trim</span>
            <input
              value={form.trim}
              onChange={(event) =>
                setForm({ ...form, trim: event.target.value })
              }
            />
          </label>
          <label>
            <span>Mileage</span>
            <input
              type="number"
              value={form.mileage}
              onChange={(event) =>
                setForm({ ...form, mileage: event.target.value })
              }
            />
          </label>
          <label>
            <span>Retail price</span>
            <input
              type="number"
              value={form.price}
              onChange={(event) =>
                setForm({ ...form, price: event.target.value })
              }
            />
          </label>
          <label>
            <span>Internet price</span>
            <input
              type="number"
              value={form.internetPrice}
              onChange={(event) =>
                setForm({ ...form, internetPrice: event.target.value })
              }
            />
          </label>
          <label>
            <span>MSRP</span>
            <input
              type="number"
              value={form.msrp}
              onChange={(event) =>
                setForm({ ...form, msrp: event.target.value })
              }
            />
          </label>
          <label>
            <span>Vehicle type</span>
            <input
              value={form.vehicleType}
              onChange={(event) =>
                setForm({ ...form, vehicleType: event.target.value })
              }
              placeholder="SUV, truck, sedan…"
            />
          </label>
          <label>
            <span>Condition</span>
            <select
              value={form.condition}
              onChange={(event) =>
                setForm({ ...form, condition: event.target.value })
              }
            >
              <option value="new">New</option>
              <option value="used">Used</option>
              <option value="certified">Certified</option>
            </select>
          </label>
          <label>
            <span>Exterior color</span>
            <input
              value={form.exteriorColor}
              onChange={(event) =>
                setForm({ ...form, exteriorColor: event.target.value })
              }
            />
          </label>
          <label>
            <span>Interior color</span>
            <input
              value={form.interiorColor}
              onChange={(event) =>
                setForm({ ...form, interiorColor: event.target.value })
              }
            />
          </label>
          <label>
            <span>Status</span>
            <select
              value={form.status}
              onChange={(event) =>
                setForm({ ...form, status: event.target.value })
              }
            >
              {[
                "available",
                "reserved",
                "sold",
                "in_transit",
                "unavailable",
              ].map((item) => (
                <option key={item} value={item}>
                  {label(item)}
                </option>
              ))}
            </select>
          </label>
          <label className="full-span">
            <span>Location</span>
            <input
              value={form.location}
              onChange={(event) =>
                setForm({ ...form, location: event.target.value })
              }
            />
          </label>
          <label className="full-span">
            <span>Image URLs (comma separated)</span>
            <textarea
              rows={2}
              value={form.images}
              onChange={(event) =>
                setForm({ ...form, images: event.target.value })
              }
            />
          </label>
          <label className="full-span">
            <span>Features (comma separated)</span>
            <textarea
              rows={2}
              value={form.features}
              onChange={(event) =>
                setForm({ ...form, features: event.target.value })
              }
            />
          </label>
          <label className="full-span">
            <span>Description</span>
            <textarea
              rows={4}
              value={form.description}
              onChange={(event) =>
                setForm({ ...form, description: event.target.value })
              }
            />
          </label>
        </div>
        {error && <Notice type="error">{error}</Notice>}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? "Saving…" : "Save vehicle"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function AppointmentForm({
  appointment,
  initialLead,
  leads,
  inventory,
  team,
  onClose,
  onSaved,
}) {
  // Slots are requested for a local calendar day, so derive the local date
  // rather than the UTC one (evening appointments would show the next day).
  const localDate = (value) => {
    const date = new Date(value);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 10);
  };
  const initialDate = appointment
    ? localDate(appointment.starts_at)
    : localDate(Date.now() + 86400000);
  const [form, setForm] = useState({
    leadId: appointment?.lead_id ?? initialLead?.id ?? "",
    inventoryId: appointment?.inventory_id ?? initialLead?.inventory_id ?? "",
    salespersonId:
      appointment?.salesperson_id ?? initialLead?.assigned_salesperson_id ?? "",
    appointmentType: appointment?.appointment_type ?? "showroom",
    date: initialDate,
    startsAt: appointment?.starts_at ?? "",
    status: appointment?.status ?? "scheduled",
    notes: appointment?.confirmation_notes ?? "",
    cancellationReason: appointment?.cancellation_reason ?? "",
  });
  const [slots, setSlots] = useState([]);
  const [busy, setBusy] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!form.date) return;
      setLoadingSlots(true);
      try {
        const payload = await crmApi.availability({
          date: form.date,
          salespersonId: form.salespersonId,
          offsetMinutes: new Date().getTimezoneOffset(),
        });
        if (!cancelled) setSlots(payload.slots);
      } catch (caught) {
        if (!cancelled) setError(caught.message);
      } finally {
        if (!cancelled) setLoadingSlots(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [form.date, form.salespersonId]);
  const [warning, setWarning] = useState("");
  const save = async (event) => {
    event.preventDefault();
    if (!form.startsAt && !appointment) {
      setError("Select an available time.");
      return;
    }
    setWarning("");
    setBusy(true);
    setError("");
    try {
      const body = {
        ...form,
        startsAt: form.startsAt || appointment?.starts_at,
      };
      const payload = appointment
        ? await crmApi.updateAppointment(appointment.id, body)
        : await crmApi.createAppointment(body);
      await onSaved();
      // Booking a reserved or sold car is allowed deliberately, but it must be
      // stated rather than implied, so the warning holds the modal open.
      if (payload?.vehicleWarning) {
        setWarning(payload.vehicleWarning);
        setBusy(false);
        return;
      }
      onClose();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={appointment ? "Manage appointment" : "Schedule appointment"}
      eyebrow="Appointment engine"
      onClose={onClose}
      size="large"
    >
      <form onSubmit={save}>
        <div className="form-grid three">
          <label>
            <span>Customer *</span>
            <select
              required
              disabled={Boolean(appointment)}
              value={form.leadId}
              onChange={(event) => {
                const lead = leads.find(
                  (item) => item.id === event.target.value,
                );
                setForm({
                  ...form,
                  leadId: event.target.value,
                  inventoryId: lead?.inventory_id ?? "",
                  salespersonId: lead?.assigned_salesperson_id ?? "",
                });
              }}
            >
              <option value="">Select lead</option>
              {leads.map((lead) => (
                <option key={lead.id} value={lead.id}>
                  {lead.name} · {lead.phone || lead.email}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Type</span>
            <select
              value={form.appointmentType}
              onChange={(event) =>
                setForm({ ...form, appointmentType: event.target.value })
              }
            >
              {APPOINTMENT_TYPES.map((item) => (
                <option key={item} value={item}>
                  {label(item)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Status</span>
            <select
              value={form.status}
              onChange={(event) =>
                setForm({ ...form, status: event.target.value })
              }
            >
              {APPOINTMENT_STATUSES.map((item) => (
                <option key={item} value={item}>
                  {label(item)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Salesperson</span>
            <select
              value={form.salespersonId}
              onChange={(event) =>
                setForm({
                  ...form,
                  salespersonId: event.target.value,
                  startsAt: "",
                })
              }
            >
              <option value="">Unassigned</option>
              {team
                .filter(
                  (member) =>
                    ["sales", "salesperson", "manager", "admin", "owner"].includes(member.role) &&
                    member.active,
                )
                .map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
            </select>
          </label>
          <VehiclePicker
            label="Vehicle for this appointment"
            value={form.inventoryId}
            initialVehicle={
              inventory.find((vehicle) => vehicle.id === form.inventoryId) ??
              null
            }
            onSelect={(vehicle) =>
              setForm({ ...form, inventoryId: vehicle?.id ?? "" })
            }
          />
          <label>
            <span>Date</span>
            <input
              type="date"
              min={new Date().toISOString().slice(0, 10)}
              value={form.date}
              onChange={(event) =>
                setForm({ ...form, date: event.target.value, startsAt: "" })
              }
            />
          </label>
        </div>
        <div className="slot-section">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Live capacity</span>
              <h3>Available times</h3>
            </div>
            {loadingSlots && <LoaderCircle className="spin" size={18} />}
          </div>
          <div className="slot-grid">
            {slots.map((slot) => (
              <button
                type="button"
                className={form.startsAt === slot.startsAt ? "selected" : ""}
                key={slot.startsAt}
                onClick={() => setForm({ ...form, startsAt: slot.startsAt })}
              >
                {new Date(slot.startsAt).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </button>
            ))}
            {!loadingSlots && !slots.length && (
              <p className="empty-inline">
                No open slots for this date and salesperson.
              </p>
            )}
          </div>
        </div>
        <label className="stacked-field">
          <span>Confirmation notes</span>
          <textarea
            rows={3}
            value={form.notes}
            onChange={(event) =>
              setForm({ ...form, notes: event.target.value })
            }
          />
        </label>
        {form.status === "cancelled" && (
          <label className="stacked-field">
            <span>Cancellation reason</span>
            <input
              value={form.cancellationReason}
              onChange={(event) =>
                setForm({ ...form, cancellationReason: event.target.value })
              }
            />
          </label>
        )}
        {error && <Notice type="error">{error}</Notice>}
        {warning && (
          <Notice type="warning">
            {warning}{" "}
            <button type="button" className="link-button" onClick={onClose}>
              Close
            </button>
          </Notice>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          {/* After a save that returned a vehicle warning the appointment
              already exists; a second submit would book a duplicate. */}
          <button
            className="primary-button"
            disabled={busy || Boolean(warning)}
          >
            {busy
              ? "Saving…"
              : warning
                ? "Saved"
                : appointment
                  ? "Update appointment"
                  : "Book appointment"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function FollowUpForm({ lead, leads, team, onClose, onSaved }) {
  const [form, setForm] = useState({
    leadId: lead?.id ?? "",
    assignedUserId: "",
    dueAt: toLocalInput(Date.now() + 86400000),
    type: "call",
    notes: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await crmApi.createFollowUp({
        ...form,
        dueAt: new Date(form.dueAt).toISOString(),
      });
      await onSaved();
      onClose();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Schedule follow-up" eyebrow="BDC task" onClose={onClose}>
      <form onSubmit={save}>
        <div className="form-grid">
          <label className="full-span">
            <span>Lead</span>
            <select
              required
              value={form.leadId}
              onChange={(event) =>
                setForm({ ...form, leadId: event.target.value })
              }
            >
              <option value="">Select lead</option>
              {leads.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Type</span>
            <select
              value={form.type}
              onChange={(event) =>
                setForm({ ...form, type: event.target.value })
              }
            >
              {FOLLOW_UP_TYPES.map((item) => (
                <option key={item} value={item}>
                  {label(item)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Assigned user</span>
            <select
              value={form.assignedUserId}
              onChange={(event) =>
                setForm({ ...form, assignedUserId: event.target.value })
              }
            >
              <option value="">Assign to me</option>
              {team
                .filter((member) => member.active)
                .map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="full-span">
            <span>Due</span>
            <input
              type="datetime-local"
              required
              value={form.dueAt}
              onChange={(event) =>
                setForm({ ...form, dueAt: event.target.value })
              }
            />
          </label>
          <label className="full-span">
            <span>Notes</span>
            <textarea
              rows={3}
              value={form.notes}
              onChange={(event) =>
                setForm({ ...form, notes: event.target.value })
              }
            />
          </label>
        </div>
        {error && <Notice type="error">{error}</Notice>}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? "Saving…" : "Create follow-up"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function TeamForm({ member, canAdmin, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: member?.name ?? "",
    email: member?.email ?? "",
    phone: member?.phone ?? "",
    role: member?.role ?? "salesperson",
    active: member?.active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (member) await crmApi.updateTeamMember(member.id, form);
      else await crmApi.createTeamMember(form);
      await onSaved();
      onClose();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (
      !member ||
      !window.confirm(
        `Delete ${member.name}? Their assignments remain in the CRM but become unassigned.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await crmApi.deleteTeamMember(member.id);
      await onSaved();
      onClose();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={member ? "Edit team member" : "Add team member"}
      eyebrow="Role and assignment"
      onClose={onClose}
    >
      <form onSubmit={save}>
        <div className="form-grid">
          <label>
            <span>Name</span>
            <input
              required
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
            />
          </label>
          <label>
            <span>Email</span>
            <input
              type="email"
              required
              value={form.email}
              onChange={(event) =>
                setForm({ ...form, email: event.target.value })
              }
            />
          </label>
          <label>
            <span>Phone</span>
            <input
              value={form.phone}
              onChange={(event) =>
                setForm({ ...form, phone: event.target.value })
              }
            />
          </label>
          <label>
            <span>Role</span>
            <select
              value={form.role}
              onChange={(event) =>
                setForm({ ...form, role: event.target.value })
              }
            >
              {ROLES.filter((role) => canAdmin || !ADMIN_ROLES.includes(role)).map(
                (role) => (
                  <option key={role} value={role}>
                    {label(role)}
                  </option>
                ),
              )}
            </select>
          </label>
          <label className="checkbox-label full-span">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(event) =>
                setForm({ ...form, active: event.target.checked })
              }
            />
            <span>Active for assignment</span>
          </label>
        </div>
        <Notice>
          Creates a CRM employee record. Invitation emails are not sent
          automatically: ask the employee to sign up at this site with this
          exact email. Once their email is confirmed they join this dealership
          with the role above.
        </Notice>
        {error && <Notice type="error">{error}</Notice>}
        <div className="modal-actions">
          {member && (
            <button
              type="button"
              className="danger-button"
              onClick={remove}
              disabled={busy}
            >
              <Trash2 size={15} /> Delete member
            </button>
          )}
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? "Saving…" : "Save team member"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function MetricCard({
  icon: Icon,
  label: metricLabel,
  value,
  detail,
  tone = "green",
}) {
  return (
    <article className="metric-card">
      <div className={`metric-icon ${tone}`}>
        <Icon size={18} />
      </div>
      <div>
        <span>{metricLabel}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}

function DashboardView({ data, setTab, refresh }) {
  const metrics = data.metrics ?? {};
  const action = useQuickAction(refresh);
  return (
    <div className="view-stack">
      <header className="view-header">
        <div>
          <span className="eyebrow">Live operating picture</span>
          <h1>Dealership dashboard</h1>
          <p>Calculated from current lead, appointment, and outcome records.</p>
        </div>
        <button className="secondary-button" onClick={refresh}>
          <RefreshCw size={16} /> Refresh metrics
        </button>
      </header>
      <section className="metrics-grid">
        <MetricCard
          icon={Plus}
          label="New leads today"
          value={metrics.new_leads ?? 0}
          detail="Created since midnight"
        />
        <MetricCard
          icon={MessageSquareText}
          label="Active conversations"
          value={metrics.active_conversations ?? 0}
          detail="Open sales opportunities"
          tone="blue"
        />
        <MetricCard
          icon={CalendarDays}
          label="Appointments today"
          value={metrics.appointments_today ?? 0}
          detail={`${metrics.appointments_upcoming ?? 0} upcoming`}
          tone="gold"
        />
        <MetricCard
          icon={Gauge}
          label="Show rate"
          value={`${metrics.show_rate ?? 0}%`}
          detail="Showed vs. no-show"
          tone="clay"
        />
        <MetricCard
          icon={CircleDollarSign}
          label="Sold leads"
          value={metrics.sold_leads ?? 0}
          detail={`${metrics.conversion_rate ?? 0}% conversion`}
        />
        <MetricCard
          icon={Activity}
          label="Needs follow-up"
          value={metrics.needs_follow_up ?? 0}
          detail={`${metrics.hot_leads ?? 0} hot leads`}
          tone="red"
        />
        <MetricCard
          icon={Warehouse}
          label="Presentable inventory"
          value={metrics.inventory_available ?? 0}
          detail={`${metrics.inventory_total ?? 0} in stock · ${metrics.inventory_reserved ?? 0} reserved · ${metrics.inventory_sold ?? 0} sold`}
          tone="blue"
        />
      </section>
      {/* TITAN's answers are only as trustworthy as the feed behind them, so
          inventory freshness sits with the operating metrics. */}
      <InventorySyncBanner freshness={data.inventoryFreshness} />
      {action.error && <Notice type="error">{action.error}</Notice>}
      <section className="dashboard-grid">
        <div className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Priority queue</span>
              <h2>Open alerts</h2>
            </div>
            <button className="text-button" onClick={() => setTab("inbox")}>
              Open inbox <ChevronRight size={14} />
            </button>
          </div>
          <div className="alert-list">
            {data.alerts
              .filter((alert) => !alert.acknowledged)
              .slice(0, 8)
              .map((alert) => (
                <article
                  className={`alert-card ${alert.severity}`}
                  key={alert.id}
                >
                  <BellRing size={17} />
                  <div>
                    <strong>{alert.title}</strong>
                    <p>{alert.message}</p>
                    <span>{dateTime(alert.created_at)}</span>
                  </div>
                  <button
                    disabled={action.pendingKey === alert.id}
                    onClick={() =>
                      action.run(alert.id, () =>
                        crmApi.acknowledgeAlert(alert.id),
                      )
                    }
                  >
                    {action.pendingKey === alert.id
                      ? "Acknowledging…"
                      : "Acknowledge"}
                  </button>
                </article>
              ))}
            {!data.alerts.some((alert) => !alert.acknowledged) && (
              <EmptyState
                icon={ShieldCheck}
                title="No open alerts"
                text="New lead, handoff, and appointment alerts appear here."
              />
            )}
          </div>
        </div>
        <div className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Today</span>
              <h2>Appointment board</h2>
            </div>
            <button
              className="text-button"
              onClick={() => setTab("appointments")}
            >
              Manage <ChevronRight size={14} />
            </button>
          </div>
          <div className="compact-list">
            {data.appointments
              .filter(
                (item) =>
                  new Date(item.starts_at).toDateString() ===
                  new Date().toDateString(),
              )
              .map((appointment) => (
                <article key={appointment.id}>
                  <time>
                    {new Date(appointment.starts_at).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </time>
                  <div>
                    <strong>{appointment.lead_name}</strong>
                    <span>
                      {label(appointment.appointment_type)} ·{" "}
                      {appointment.salesperson_name || "Unassigned"}
                    </span>
                  </div>
                  <b className={`pill ${appointment.status}`}>
                    {label(appointment.status)}
                  </b>
                </article>
              ))}
            {!data.appointments.some(
              (item) =>
                new Date(item.starts_at).toDateString() ===
                new Date().toDateString(),
            ) && (
              <EmptyState
                icon={CalendarDays}
                title="No appointments today"
                text="Book from the inbox or appointment calendar."
              />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function EmptyState({ icon: Icon, title, text, action }) {
  return (
    <div className="empty-state">
      <Icon size={24} />
      <strong>{title}</strong>
      <p>{text}</p>
      {action}
    </div>
  );
}

/**
 * What TITAN was actually given. Retrieval is deliberately narrow, so this is
 * a short, checkable list rather than the whole inventory.
 */
function TitanGroundingNotice({ grounding }) {
  const matches = grounding.inventoryMatches ?? [];
  const unavailable = grounding.unavailableVehicles ?? [];
  const alternatives = grounding.alternatives ?? [];
  return (
    <div className="titan-grounding">
      <span className="eyebrow">Inventory given to TITAN</span>
      {matches.length === 0 && unavailable.length === 0 ? (
        <p>
          No vehicle in this dealership's inventory matched the request, so
          TITAN was instructed to say so instead of inventing one.
        </p>
      ) : (
        <ul>
          {matches.map((vehicle) => (
            <li key={vehicle.stockNumber}>
              #{vehicle.stockNumber} · {vehicle.year} {vehicle.make}{" "}
              {vehicle.model} {vehicle.trim ?? ""} ·{" "}
              {vehicle.price ? money(vehicle.price) : "Price not set"} ·{" "}
              {label(vehicle.status)}
            </li>
          ))}
          {unavailable.map((vehicle) => (
            <li key={`gone-${vehicle.stockNumber}`} className="gone">
              #{vehicle.stockNumber} · {vehicle.year} {vehicle.make}{" "}
              {vehicle.model} · {label(vehicle.status)} — offered{" "}
              {alternatives.length} alternative
              {alternatives.length === 1 ? "" : "s"} instead
            </li>
          ))}
        </ul>
      )}
      {grounding.inventoryFreshness?.stale && (
        <p className="stale">
          Inventory is stale, so TITAN asked the dealership to confirm
          availability rather than claiming it.
        </p>
      )}
      {grounding.capturedVehicle && (
        <p>
          Attached #{grounding.capturedVehicle.stockNumber} to this lead as a
          real inventory record.
        </p>
      )}
      {grounding.humanConfirmationRequested && (
        <p className="stale">
          A human follow-up was created to confirm availability.
        </p>
      )}
    </div>
  );
}

const UNPRESENTABLE_STATUSES = [
  "sold",
  "reserved",
  "transferred",
  "removed",
  "unavailable",
];

/**
 * The vehicles this lead is actually tracking, read from the lead -> vehicle
 * relationship rather than from the free-text vehicle name. Status is the live
 * inventory status, so a salesperson sees a sold car as sold — the same fact
 * TITAN is given.
 */
function LeadVehiclePanel({ lead, onChanged }) {
  const [vehicles, setVehicles] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const payload = await crmApi.leadVehicles(lead.id);
      setVehicles(payload.vehicles);
      setError("");
    } catch (caught) {
      setError(caught.message);
    }
  }, [lead.id]);

  useEffect(() => {
    load();
  }, [load]);

  const attach = async (vehicle) => {
    if (!vehicle) return;
    setBusy(true);
    try {
      await crmApi.attachLeadVehicle({
        leadId: lead.id,
        inventoryId: vehicle.id,
        interestLevel: vehicles.length ? "interested" : "primary",
      });
      setAdding(false);
      await load();
      await onChanged();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  };

  const detach = async (inventoryId) => {
    setBusy(true);
    try {
      await crmApi.detachLeadVehicle(lead.id, inventoryId);
      await load();
      await onChanged();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rail-card">
      <span className="eyebrow">Vehicles of interest</span>
      {error && <Notice type="error">{error}</Notice>}
      {!vehicles.length && (
        <p className="muted">
          No inventory vehicle is attached yet.{" "}
          {lead.vehicle_interest
            ? `The customer asked about “${lead.vehicle_interest}”.`
            : ""}
        </p>
      )}
      <ul className="lead-vehicle-list">
        {vehicles.map((vehicle) => {
          const status = vehicle.current_status;
          return (
            <li key={vehicle.id}>
              <div>
                <strong>
                  {vehicle.year} {vehicle.make} {vehicle.model}{" "}
                  {vehicle.trim ?? ""}
                </strong>
                <small>
                  #{vehicle.current_stock_number ?? vehicle.stock_number}
                  {vehicle.effective_price
                    ? ` · ${money(vehicle.effective_price)}`
                    : ""}
                  {vehicle.exterior_color ? ` · ${vehicle.exterior_color}` : ""}
                  {" · "}
                  {label(vehicle.captured_by)} captured
                </small>
              </div>
              <div className="lead-vehicle-status">
                <b className={`pill ${status ?? "removed"}`}>
                  {status ? label(status) : "No longer in inventory"}
                </b>
                <span>{label(vehicle.interest_level)}</span>
              </div>
              {UNPRESENTABLE_STATUSES.includes(status ?? "removed") && (
                <p className="lead-vehicle-warning">
                  <AlertTriangle size={14} /> TITAN will not present this
                  vehicle as available and will offer current alternatives
                  instead.
                </p>
              )}
              <button
                type="button"
                className="link-button"
                disabled={busy}
                onClick={() => detach(vehicle.inventory_id)}
              >
                Remove
              </button>
            </li>
          );
        })}
      </ul>
      {adding ? (
        <VehiclePicker
          label="Attach an inventory vehicle"
          value=""
          onSelect={attach}
        />
      ) : (
        <button
          type="button"
          className="secondary-button full"
          disabled={busy}
          onClick={() => setAdding(true)}
        >
          <Plus size={15} /> Attach inventory vehicle
        </button>
      )}
    </section>
  );
}

function InboxView({
  data,
  refresh,
  openAppointment,
  openFollowUp,
  openLeadForm,
  focusLeadId,
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [selectedId, setSelectedId] = useState(
    focusLeadId || data.leads[0]?.id || "",
  );
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [composer, setComposer] = useState("");
  const [messageMode, setMessageMode] = useState("message");
  const [titanGrounding, setTitanGrounding] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const filtered = data.leads.filter(
    (lead) =>
      (!query ||
        `${lead.name} ${lead.phone ?? ""} ${lead.vehicle_interest ?? ""}`
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (!status || lead.status === status),
  );
  const lead = data.leads.find((item) => item.id === selectedId) ?? filtered[0];
  const loadMessages = useCallback(
    async ({ silent = false } = {}) => {
      if (!lead?.id) {
        setMessages([]);
        return;
      }
      if (!silent) setLoadingMessages(true);
      try {
        setMessages((await crmApi.messages(lead.id)).messages);
      } catch (caught) {
        if (!silent) setError(caught.message);
      } finally {
        if (!silent) setLoadingMessages(false);
      }
    },
    [lead?.id],
  );
  useEffect(() => {
    loadMessages();
  }, [loadMessages]);
  // Near-realtime inbox: customer texts and Andy's replies arrive through
  // webhooks, so poll the open conversation every 5s and the queue every 20s
  // while the tab is visible.
  useEffect(() => {
    const conversation = setInterval(() => {
      if (document.visibilityState === "visible") loadMessages({ silent: true });
    }, 5000);
    const queue = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 20000);
    return () => {
      clearInterval(conversation);
      clearInterval(queue);
    };
  }, [loadMessages, refresh]);
  useEffect(() => {
    if (focusLeadId) setSelectedId(focusLeadId);
  }, [focusLeadId]);
  useEffect(() => {
    if (!selectedId && data.leads[0]) setSelectedId(data.leads[0].id);
  }, [data.leads, selectedId]);
  const patchLead = async (changes) => {
    setBusy(true);
    setError("");
    try {
      await crmApi.updateLead(lead.id, changes);
      await refresh();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    if (!composer.trim() || !lead) return;
    setBusy(true);
    setError("");
    try {
      if (messageMode === "note")
        await crmApi.sendMessage({
          leadId: lead.id,
          content: composer,
          direction: "internal",
        });
      else if (lead.ai_enabled)
        // The reply reports exactly which inventory records TITAN was given,
        // so a salesperson can see the answer was grounded in real stock.
        setTitanGrounding(
          await sendToTitan({
            leadId: lead.id,
            message: composer,
            offsetMinutes: new Date().getTimezoneOffset(),
          }),
        );
      else {
        // Staff replies go out as real texts when the lead has a mobile number.
        const response = await crmApi.sendMessage({
          leadId: lead.id,
          content: composer,
          direction: "outbound",
          channel: lead.phone ? "sms" : "chat",
        });
        if (response.delivery && !response.delivery.sent)
          setError(
            `Saved, but the text was not delivered (${label(response.delivery.reason || "unknown")}).`,
          );
      }
      setComposer("");
      await Promise.all([loadMessages(), refresh()]);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  };
  if (!data.leads.length)
    return (
      <EmptyState
        icon={Inbox}
        title="Inbox is empty"
        text="Create the first real lead to start a conversation."
        action={
          <button className="primary-button" onClick={() => openLeadForm(null)}>
            Create lead
          </button>
        }
      />
    );
  return (
    <div className="inbox-layout">
      <aside className="lead-queue">
        <div className="queue-tools">
          <div className="search-field">
            <Search size={15} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search leads"
            />
          </div>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">All statuses</option>
            {LEAD_STATUSES.map((item) => (
              <option key={item} value={item}>
                {label(item)}
              </option>
            ))}
          </select>
        </div>
        <div className="queue-list">
          {filtered.map((item) => (
            <button
              key={item.id}
              className={classNames(
                "queue-item",
                item.id === lead?.id && "selected",
                item.human_handoff_required && "handoff",
              )}
              onClick={() => setSelectedId(item.id)}
            >
              <div className={`temperature-dot ${item.temperature}`} />
              <div>
                <strong>{item.name}</strong>
                <p>
                  {item.latest_message ||
                    item.vehicle_interest ||
                    "No conversation yet"}
                </p>
                <span>
                  {label(item.status)} ·{" "}
                  {item.assigned_salesperson_name || "Unassigned"}
                </span>
              </div>
              {item.human_handoff_required && <BellRing size={15} />}
            </button>
          ))}
          {!filtered.length && (
            <p className="empty-inline">No leads match these filters.</p>
          )}
        </div>
      </aside>
      {lead && (
        <section className="conversation-workspace">
          <header className="conversation-header">
            <div>
              <span className="eyebrow">{lead.source}</span>
              <h2>{lead.name}</h2>
              <p>
                {lead.phone || lead.email} ·{" "}
                {lead.vehicle_interest || "Vehicle not selected"}
              </p>
            </div>
            <div className="header-actions">
              <button
                className="secondary-button"
                onClick={() => openLeadForm(lead)}
              >
                <Pencil size={15} /> Edit
              </button>
              {lead.phone ? (
                <a
                  className="secondary-button"
                  href={`tel:${lead.phone.replace(/[^+\d]/g, "")}`}
                >
                  <Phone size={15} /> Call
                </a>
              ) : (
                <button
                  className="secondary-button"
                  disabled
                  title="No phone number on file"
                >
                  <Phone size={15} /> Call
                </button>
              )}
            </div>
          </header>
          {lead.human_handoff_required && (
            <div className="handoff-banner">
              <BellRing size={20} />
              <div>
                <strong>HUMAN HANDOFF REQUIRED</strong>
                <p>
                  {lead.name} · {lead.phone || "No phone"} ·{" "}
                  {lead.vehicle_interest || "No vehicle"}
                </p>
                <span>
                  {lead.human_handoff_reason} · Requested{" "}
                  {dateTime(lead.human_handoff_requested_at)}
                </span>
              </div>
              <button
                onClick={() => patchLead({ humanHandoffRequired: false })}
              >
                Resolve alert
              </button>
            </div>
          )}
          <div className="conversation-body">
            {loadingMessages && <LoaderCircle className="spin center" />}
            {!loadingMessages && !messages.length && (
              <EmptyState
                icon={MessageSquareText}
                title="No conversation yet"
                text="Log an inbound customer message for TITAN or take over and send a staff response."
              />
            )}
            {messages.map((message) => (
              <article
                className={`message ${message.direction} ${message.sender_type}`}
                key={message.id}
              >
                <div>
                  <strong>
                    {message.sender_type === "customer"
                      ? lead.name
                      : message.sender_name || label(message.sender_type)}
                  </strong>
                  <p>{message.content}</p>
                  <span>
                    {dateTime(message.created_at)} · {label(message.channel)}
                    {message.delivery_status &&
                      message.direction === "outbound" &&
                      ` · ${label(message.delivery_status)}`}
                  </span>
                </div>
              </article>
            ))}
          </div>
          <footer className="composer-panel">
            <div className="mode-row">
              <button
                className={messageMode === "message" ? "active" : ""}
                onClick={() => setMessageMode("message")}
              >
                {lead.ai_enabled
                  ? "Customer message → TITAN"
                  : lead.phone
                    ? "Staff text (SMS)"
                    : "Staff reply"}
              </button>
              <button
                className={messageMode === "note" ? "active" : ""}
                onClick={() => setMessageMode("note")}
              >
                Internal note
              </button>
              <span
                className={lead.ai_enabled ? "ai-state on" : "ai-state off"}
              >
                {lead.ai_enabled ? "AI active" : "Human takeover"}
              </span>
            </div>
            <div className="composer">
              <textarea
                rows={2}
                value={composer}
                onChange={(event) => setComposer(event.target.value)}
                placeholder={
                  messageMode === "note"
                    ? "Add an internal CRM note…"
                    : lead.ai_enabled
                      ? "Enter the customer’s inbound message for TITAN…"
                      : "Write the dealership response…"
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    send();
                  }
                }}
              />
              <button onClick={send} disabled={busy || !composer.trim()}>
                <Send size={18} />
              </button>
            </div>
            {error && <Notice type="error">{error}</Notice>}
            {titanGrounding?.inventorySearched && (
              <TitanGroundingNotice grounding={titanGrounding} />
            )}
          </footer>
        </section>
      )}
      <aside className="crm-rail">
        {lead && (
          <>
            <section className="rail-card">
              <span className="eyebrow">Ownership</span>
              <label>
                <span>Status</span>
                <select
                  value={lead.status}
                  disabled={busy}
                  onChange={(event) =>
                    patchLead({ status: event.target.value })
                  }
                >
                  {LEAD_STATUSES.map((item) => (
                    <option key={item} value={item}>
                      {label(item)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Temperature</span>
                <select
                  value={lead.temperature}
                  disabled={busy}
                  onChange={(event) =>
                    patchLead({ temperature: event.target.value })
                  }
                >
                  {TEMPERATURES.map((item) => (
                    <option key={item} value={item}>
                      {label(item)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Salesperson</span>
                <select
                  value={lead.assigned_salesperson_id ?? ""}
                  disabled={busy}
                  onChange={(event) =>
                    patchLead({ assignedSalespersonId: event.target.value })
                  }
                >
                  <option value="">Unassigned</option>
                  {data.team
                    .filter(
                      (member) =>
                        ["sales", "salesperson", "manager", "admin", "owner"].includes(
                          member.role,
                        ) && member.active,
                    )
                    .map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                <span>BDC agent</span>
                <select
                  value={lead.assigned_bdc_agent_id ?? ""}
                  disabled={busy}
                  onChange={(event) =>
                    patchLead({ assignedBdcAgentId: event.target.value })
                  }
                >
                  <option value="">Unassigned</option>
                  {data.team
                    .filter(
                      (member) =>
                        ["bdc", "manager", "admin", "owner"].includes(member.role) &&
                        member.active,
                    )
                    .map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                <span>Manager</span>
                <select
                  value={lead.assigned_manager_id ?? ""}
                  disabled={busy}
                  onChange={(event) =>
                    patchLead({ assignedManagerId: event.target.value })
                  }
                >
                  <option value="">Unassigned</option>
                  {data.team
                    .filter(
                      (member) =>
                        ["manager", "admin", "owner"].includes(member.role) &&
                        member.active,
                    )
                    .map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                </select>
              </label>
              <button
                className={
                  lead.ai_enabled ? "danger-button full" : "primary-button full"
                }
                onClick={() => patchLead({ aiEnabled: !lead.ai_enabled })}
              >
                {lead.ai_enabled
                  ? "Take over conversation"
                  : "Return conversation to AI"}
              </button>
              <label className="checkbox-label follow-up-toggle">
                <input
                  type="checkbox"
                  checked={lead.follow_up_enabled !== false}
                  disabled={busy}
                  onChange={(event) =>
                    patchLead({ followUpEnabled: event.target.checked })
                  }
                />
                <span>
                  Automatic follow-up texts
                  <small>
                    {lead.sequence_stopped_at
                      ? `Stopped: ${label(lead.sequence_stop_reason || "stopped")}`
                      : lead.sequence_next_at
                        ? `Next text ${dateTime(lead.sequence_next_at)}`
                        : "Starts after Andy's first reply"}
                  </small>
                </span>
              </label>
            </section>
            <section className="rail-card">
              <span className="eyebrow">Next action</span>
              <button
                className="action-button"
                onClick={() => openAppointment(null, lead)}
              >
                <CalendarDays size={17} />
                <span>
                  <strong>Schedule appointment</strong>
                  <small>Use live available times</small>
                </span>
              </button>
              <button
                className="action-button"
                onClick={() => openFollowUp(lead)}
              >
                <Clock3 size={17} />
                <span>
                  <strong>Schedule follow-up</strong>
                  <small>Assign a due task</small>
                </span>
              </button>
              <button
                className="action-button"
                disabled={lead.status === "sold"}
                onClick={() => patchLead({ status: "sold" })}
              >
                <CircleDollarSign size={17} />
                <span>
                  <strong>Mark sold</strong>
                  <small>Complete as a sale</small>
                </span>
              </button>
              <button
                className="action-button"
                disabled={lead.status === "lost"}
                onClick={() => patchLead({ status: "lost" })}
              >
                <X size={17} />
                <span>
                  <strong>Mark lost</strong>
                  <small>Complete without sale</small>
                </span>
              </button>
            </section>
            <LeadVehiclePanel lead={lead} onChanged={refresh} />
            <section className="rail-card facts">
              <span className="eyebrow">Lead profile</span>
              <dl>
                <div>
                  <dt>Budget</dt>
                  <dd>{lead.budget || "—"}</dd>
                </div>
                <div>
                  <dt>Trade-in</dt>
                  <dd>{lead.trade_in || "—"}</dd>
                </div>
                <div>
                  <dt>Financing</dt>
                  <dd>
                    {lead.financing_interest === null
                      ? "Unknown"
                      : lead.financing_interest
                        ? "Interested"
                        : "No"}
                  </dd>
                </div>
                <div>
                  <dt>Last contact</dt>
                  <dd>{dateTime(lead.last_contact_at)}</dd>
                </div>
                <div>
                  <dt>Next follow-up</dt>
                  <dd>{dateTime(lead.next_follow_up_at)}</dd>
                </div>
              </dl>
              {lead.notes && <p className="note-block">{lead.notes}</p>}
            </section>
          </>
        )}
      </aside>
    </div>
  );
}

function LeadsView({ data, openLeadForm, openInbox }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [temperature, setTemperature] = useState("");
  const leads = data.leads.filter(
    (lead) =>
      (!query ||
        `${lead.name} ${lead.phone ?? ""} ${lead.email ?? ""} ${lead.vehicle_interest ?? ""}`
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (!status || lead.status === status) &&
      (!temperature || lead.temperature === temperature),
  );
  return (
    <div className="view-stack">
      <header className="view-header">
        <div>
          <span className="eyebrow">Customer records</span>
          <h1>Leads</h1>
          <p>
            Every status, assignment, follow-up, appointment, and handoff
            updates the persistent CRM record.
          </p>
        </div>
        <button className="primary-button" onClick={() => openLeadForm(null)}>
          <Plus size={16} /> Create lead
        </button>
      </header>
      <div className="filter-bar">
        <div className="search-field">
          <Search size={15} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, phone, email, or vehicle"
          />
        </div>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">All statuses</option>
          {LEAD_STATUSES.map((item) => (
            <option key={item} value={item}>
              {label(item)}
            </option>
          ))}
        </select>
        <select
          value={temperature}
          onChange={(event) => setTemperature(event.target.value)}
        >
          <option value="">All temperatures</option>
          {TEMPERATURES.map((item) => (
            <option key={item} value={item}>
              {label(item)}
            </option>
          ))}
        </select>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Lead</th>
              <th>Vehicle</th>
              <th>Status</th>
              <th>Owner</th>
              <th>Last contact</th>
              <th>Follow-up</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr key={lead.id}>
                <td>
                  <strong>{lead.name}</strong>
                  <span>{lead.phone || lead.email}</span>
                </td>
                <td>{lead.vehicle_interest || "—"}</td>
                <td>
                  <b className={`pill ${lead.status}`}>{label(lead.status)}</b>
                </td>
                <td>{lead.assigned_salesperson_name || "Unassigned"}</td>
                <td>{dateTime(lead.last_contact_at)}</td>
                <td>{dateTime(lead.next_follow_up_at)}</td>
                <td>
                  <div className="table-actions">
                    <button
                      onClick={() => openLeadForm(lead)}
                      aria-label={`Edit ${lead.name}`}
                    >
                      <Pencil size={15} />
                    </button>
                    <button
                      onClick={() => openInbox(lead.id)}
                      aria-label={`Open ${lead.name} in inbox`}
                    >
                      <MessageSquareText size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!leads.length && (
          <EmptyState
            icon={UsersRound}
            title="No leads found"
            text="Change filters or create a lead."
          />
        )}
      </div>
    </div>
  );
}

const INVENTORY_STATUS_OPTIONS = [
  "available",
  "in_transit",
  "reserved",
  "sold",
  "transferred",
  "unavailable",
  "removed",
];

const INVENTORY_SORT_OPTIONS = [
  ["relevance", "Best match"],
  ["price_asc", "Price: low to high"],
  ["price_desc", "Price: high to low"],
  ["mileage_asc", "Mileage: lowest"],
  ["year_desc", "Year: newest"],
  ["year_asc", "Year: oldest"],
  ["newest", "Recently added"],
];

const EMPTY_INVENTORY_FILTERS = {
  q: "",
  condition: "",
  status: "",
  make: "",
  model: "",
  bodyStyle: "",
  exteriorColor: "",
  interiorColor: "",
  feature: "",
  stockNumber: "",
  vin: "",
  yearMin: "",
  yearMax: "",
  minPrice: "",
  maxPrice: "",
  maxMileage: "",
  availableOnly: false,
  sort: "relevance",
};

const facetValues = (facets, key) =>
  (facets?.[key] ?? []).map((item) =>
    typeof item === "string" ? item : item.value,
  );

/** "Last inventory sync" — TITAN's answers are only as good as this. */
function InventorySyncBanner({ freshness }) {
  if (!freshness) return null;
  const synced = freshness.lastSyncedAt ?? freshness.lastRecordUpdatedAt;
  const age =
    freshness.ageHours === null || freshness.ageHours === undefined
      ? null
      : freshness.ageHours < 1
        ? "just now"
        : freshness.ageHours < 48
          ? `${Math.round(freshness.ageHours)}h ago`
          : `${Math.round(freshness.ageHours / 24)}d ago`;
  return (
    <div
      className={classNames(
        "inventory-sync-banner",
        freshness.stale && "is-stale",
      )}
    >
      <Database size={16} />
      <div>
        <strong>
          Last inventory sync: {synced ? `${dateTime(synced)}` : "never"}
          {age ? ` (${age})` : ""}
        </strong>
        <small>
          {freshness.vehicleCount} vehicle
          {freshness.vehicleCount === 1 ? "" : "s"} ·{" "}
          {freshness.presentableCount} presentable
          {freshness.lastSyncSourceType
            ? ` · via ${label(freshness.lastSyncSourceType)}`
            : ""}
          {freshness.stale
            ? " · TITAN will ask the dealership to confirm availability instead of claiming it."
            : " · TITAN can answer availability questions from these records."}
        </small>
      </div>
    </div>
  );
}

/**
 * CarNova.com is the published source for this dealership's vehicles. This
 * panel is the manual synchronize control plus the answer to "is the feed
 * actually working?" — when it last succeeded, and what went wrong if it
 * didn't, so a stale or broken feed is visible rather than silent.
 */
function CarnovaSyncPanel({
  reloadToken,
  canManage,
  syncing,
  onSync,
  result,
  error,
}) {
  const [state, setState] = useState({
    loading: true,
    source: null,
    syncs: [],
  });

  useEffect(() => {
    let active = true;
    crmApi
      .inventorySources()
      .then((payload) => {
        if (!active) return;
        const source =
          (payload.sources ?? []).find(
            (entry) => entry.provider === "CarNova.com",
          ) ?? null;
        const syncs = source
          ? (payload.syncs ?? []).filter(
              (entry) => entry.source_id === source.id,
            )
          : [];
        setState({ loading: false, source, syncs });
      })
      .catch(() => {
        if (active) setState({ loading: false, source: null, syncs: [] });
      });
    return () => {
      active = false;
    };
  }, [reloadToken]);

  const { source, syncs } = state;
  const lastSuccess = syncs.find((entry) => entry.status !== "failed") ?? null;
  const lastFailure = syncs.find((entry) => entry.status === "failed") ?? null;
  // A failure only still matters if nothing has succeeded since.
  const failureIsCurrent =
    lastFailure &&
    (!lastSuccess ||
      new Date(lastFailure.started_at) > new Date(lastSuccess.started_at));

  return (
    <section className="carnova-sync">
      <div className="carnova-sync-head">
        <div>
          <span className="eyebrow">Published source</span>
          <h2>CarNova.com inventory</h2>
          <p>
            Vehicles published on CarNova.com are imported here, matched by VIN
            or stock number. Synchronizing is safe to repeat: it adds new
            vehicles, updates changed ones, and marks vehicles that are no
            longer listed as removed without deleting their history.
          </p>
        </div>
        <button
          className="primary-button"
          disabled={!canManage || syncing}
          title={
            canManage
              ? "Import the inventory currently published on CarNova.com"
              : "Manager or admin role required"
          }
          onClick={onSync}
        >
          {syncing ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <RefreshCw size={16} />
          )}
          {syncing ? "Synchronizing…" : "Sync CarNova.com"}
        </button>
      </div>

      <dl className="carnova-sync-facts">
        <div>
          <dt>Last successful sync</dt>
          <dd>
            {lastSuccess
              ? dateTime(lastSuccess.finished_at)
              : source
                ? "Never completed"
                : "Not synchronized yet"}
          </dd>
        </div>
        <div>
          <dt>Result</dt>
          <dd>
            {lastSuccess
              ? `${lastSuccess.created_count} added · ${lastSuccess.updated_count} updated`
              : "—"}
          </dd>
        </div>
        <div>
          <dt>Vehicles from CarNova.com</dt>
          <dd>{source ? (source.vehicle_count ?? 0) : 0}</dd>
        </div>
        <div>
          <dt>Feed status</dt>
          <dd>
            {source ? (
              <b className={`pill ${failureIsCurrent ? "sold" : "available"}`}>
                {label(source.last_sync_status ?? "never")}
              </b>
            ) : (
              "—"
            )}
          </dd>
        </div>
      </dl>

      {error && <Notice type="error">{error}</Notice>}
      {result && <Notice type="success">{result}</Notice>}
      {failureIsCurrent && !error && (
        <Notice type="error">
          Last attempt on {dateTime(lastFailure.started_at)} failed:{" "}
          {lastFailure.message ||
            "CarNova.com could not be read. Existing inventory was left unchanged."}
        </Notice>
      )}

      {syncs.length > 1 && (
        <details className="carnova-sync-history">
          <summary>Synchronization history</summary>
          <ul>
            {syncs.map((entry) => (
              <li key={entry.id}>
                <b
                  className={`pill ${entry.status === "failed" ? "sold" : "available"}`}
                >
                  {label(entry.status)}
                </b>
                <span>{dateTime(entry.started_at)}</span>
                <small>{entry.message || "—"}</small>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function VehicleDetailModal({ vehicleId, onClose, openLead }) {
  const [state, setState] = useState({ loading: true, error: "", data: null });
  useEffect(() => {
    let active = true;
    crmApi
      .vehicle(vehicleId)
      .then(
        (payload) =>
          active && setState({ loading: false, error: "", data: payload }),
      )
      .catch(
        (caught) =>
          active &&
          setState({ loading: false, error: caught.message, data: null }),
      );
    return () => {
      active = false;
    };
  }, [vehicleId]);

  const vehicle = state.data?.vehicle;
  return (
    <Modal
      title={
        vehicle
          ? `${vehicle.year} ${vehicle.make} ${vehicle.model}`
          : "Vehicle record"
      }
      eyebrow={vehicle ? `Stock #${vehicle.stock_number}` : "Inventory"}
      size="large"
      onClose={onClose}
    >
      {state.loading && <p className="modal-copy">Loading vehicle record…</p>}
      {state.error && <Notice type="error">{state.error}</Notice>}
      {vehicle && (
        <div className="vehicle-detail">
          <div className="vehicle-detail-facts">
            <dl>
              <div>
                <dt>Status</dt>
                <dd>
                  <b className={`pill ${vehicle.status}`}>
                    {label(vehicle.status)}
                  </b>
                </dd>
              </div>
              <div>
                <dt>Price</dt>
                <dd>{money(vehicle.internet_price ?? vehicle.price)}</dd>
              </div>
              <div>
                <dt>Mileage</dt>
                <dd>
                  {vehicle.mileage === null
                    ? "—"
                    : `${Number(vehicle.mileage).toLocaleString()} mi`}
                </dd>
              </div>
              <div>
                <dt>VIN</dt>
                <dd>{vehicle.vin || "—"}</dd>
              </div>
              <div>
                <dt>Trim</dt>
                <dd>{vehicle.trim || "—"}</dd>
              </div>
              <div>
                <dt>Body style</dt>
                <dd>{vehicle.vehicle_type || "—"}</dd>
              </div>
              <div>
                <dt>Exterior</dt>
                <dd>{vehicle.exterior_color || "—"}</dd>
              </div>
              <div>
                <dt>Interior</dt>
                <dd>{vehicle.interior_color || "—"}</dd>
              </div>
              <div>
                <dt>Drivetrain</dt>
                <dd>{vehicle.drivetrain || "—"}</dd>
              </div>
              <div>
                <dt>Fuel</dt>
                <dd>{vehicle.fuel_type || "—"}</dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>{label(vehicle.source || "manual")}</dd>
              </div>
              <div>
                <dt>Last seen in feed</dt>
                <dd>{dateTime(vehicle.last_seen_at)}</dd>
              </div>
            </dl>
            {vehicle.features?.length > 0 && (
              <div className="chip-row">
                {vehicle.features.map((feature) => (
                  <span className="chip" key={feature}>
                    {feature}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="vehicle-detail-related">
            <h3>Interested leads ({state.data.leads.length})</h3>
            {state.data.leads.length === 0 ? (
              <p className="muted">No lead is attached to this vehicle yet.</p>
            ) : (
              <ul className="record-list">
                {state.data.leads.map((lead) => (
                  <li key={lead.id}>
                    <button
                      className="link-button"
                      onClick={() => {
                        onClose();
                        openLead(lead.id);
                      }}
                    >
                      {lead.name}
                    </button>
                    <small>
                      {label(lead.status)} · {label(lead.temperature)}
                    </small>
                  </li>
                ))}
              </ul>
            )}
            <h3>Appointments ({state.data.appointments.length})</h3>
            {state.data.appointments.length === 0 ? (
              <p className="muted">No appointment references this vehicle.</p>
            ) : (
              <ul className="record-list">
                {state.data.appointments.map((appointment) => (
                  <li key={appointment.id}>
                    <span>
                      {appointment.lead_name} ·{" "}
                      {dateTime(appointment.starts_at)}
                    </span>
                    <small>
                      {label(appointment.status)} ·{" "}
                      {appointment.salesperson_name || "Unassigned"}
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function InventoryView({
  data,
  canManage,
  carnovaFeedEnabled,
  refresh,
  openVehicle,
  openLead,
}) {
  const [filters, setFilters] = useState(EMPTY_INVENTORY_FILTERS);
  const [results, setResults] = useState({
    inventory: data.inventory,
    total: data.inventory.length,
    facets: data.inventoryFacets,
    freshness: data.inventoryFreshness,
  });
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [detailId, setDetailId] = useState("");
  const [statusBusyId, setStatusBusyId] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importError, setImportError] = useState("");
  const [importResult, setImportResult] = useState("");
  const [carnovaSyncing, setCarnovaSyncing] = useState(false);
  const [carnovaError, setCarnovaError] = useState("");
  const [carnovaResult, setCarnovaResult] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  const setFilter = (key, value) =>
    setFilters((current) => ({ ...current, [key]: value }));

  // Search runs on the server: the dealership scope, the filters, and the
  // ranking are identical to what TITAN retrieves.
  useEffect(() => {
    let active = true;
    const timer = setTimeout(async () => {
      setSearching(true);
      setSearchError("");
      try {
        const payload = await crmApi.inventory({
          q: filters.q,
          condition: filters.condition,
          status: filters.status,
          make: filters.make,
          model: filters.model,
          bodyStyle: filters.bodyStyle,
          exteriorColor: filters.exteriorColor,
          interiorColor: filters.interiorColor,
          feature: filters.feature,
          stockNumber: filters.stockNumber,
          vin: filters.vin,
          yearMin: filters.yearMin,
          yearMax: filters.yearMax,
          minPrice: filters.minPrice,
          maxPrice: filters.maxPrice,
          maxMileage: filters.maxMileage,
          availableOnly: filters.availableOnly ? "true" : "",
          sort: filters.sort,
          limit: 120,
        });
        if (!active) return;
        setResults({
          inventory: payload.inventory,
          total: payload.total,
          facets: payload.facets,
          freshness: payload.freshness,
        });
      } catch (caught) {
        if (active) setSearchError(caught.message);
      } finally {
        if (active) setSearching(false);
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
    // data.inventory changes after the Add/Edit vehicle modal saves, so the
    // filtered results re-run instead of showing the pre-save list.
  }, [filters, reloadToken, data.inventory]);

  const reload = async () => {
    setReloadToken((token) => token + 1);
    await refresh();
  };

  const changeStatus = async (vehicle, status) => {
    if (!status || status === vehicle.status) return;
    setStatusBusyId(vehicle.id);
    setSearchError("");
    try {
      await crmApi.updateVehicleStatus(vehicle.id, { status });
      await reload();
    } catch (caught) {
      setSearchError(caught.message);
    } finally {
      setStatusBusyId("");
    }
  };

  const importFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportError("");
    setImportResult("");
    try {
      const records = parseInventoryCsv(await file.text());
      if (!records.length)
        throw new Error(
          "The CSV needs a header row and at least one vehicle row.",
        );
      const payload = await crmApi.importInventory(records, {
        sourceType: "csv",
        sourceName: file.name.slice(0, 80),
      });
      setImportResult(
        `${payload.imported} imported (${payload.created} new, ${payload.updated} updated), ${payload.failed} failed. Imported vehicles are now searchable by the CRM and by TITAN.`,
      );
      await reload();
    } catch (caught) {
      setImportError(caught.message);
    }
  };

  // Manual synchronize against the published CarNova.com listings.
  const syncCarnova = async () => {
    setCarnovaSyncing(true);
    setCarnovaError("");
    setCarnovaResult("");
    try {
      const payload = await crmApi.syncCarnovaInventory();
      const parts = [
        `${payload.created} added`,
        `${payload.updated} updated`,
        `${payload.removed} marked no longer listed`,
      ];
      if (payload.failed)
        parts.push(`${payload.failed} listing(s) could not be imported`);
      setCarnovaResult(
        `Synchronized ${payload.received} published vehicle${
          payload.received === 1 ? "" : "s"
        } from CarNova.com: ${parts.join(", ")}.`,
      );
      if (payload.failures?.length)
        setCarnovaError(
          payload.failures
            .slice(0, 3)
            .map(
              (failure) =>
                `${failure.stockNumber || failure.vin || "Listing"}: ${failure.error}`,
            )
            .join(" · "),
        );
      await reload();
    } catch (caught) {
      setCarnovaError(caught.message);
    } finally {
      setCarnovaSyncing(false);
    }
  };

  const facets = results.facets ?? data.inventoryFacets;
  const vehicles = results.inventory;
  const filtersActive = Object.entries(filters).some(
    ([key, value]) =>
      key !== "sort" && value !== "" && value !== false && value !== undefined,
  );

  return (
    <div className="view-stack">
      <header className="view-header">
        <div>
          <span className="eyebrow">Live inventory source</span>
          <h1>Inventory</h1>
          <p>
            These records are the source of truth. TITAN answers stock, pricing,
            color, condition, and availability questions from them and never
            invents a vehicle.
          </p>
        </div>
        <div className="header-actions">
          <button
            className="secondary-button"
            disabled={!canManage}
            title={
              !canManage
                ? "Manager or admin role required"
                : "Import CSV inventory"
            }
            onClick={() => setImportOpen(true)}
          >
            <FileUp size={16} /> Import CSV
          </button>
          <button
            className="primary-button"
            disabled={!canManage}
            title={
              !canManage ? "Manager or admin role required" : "Add vehicle"
            }
            onClick={() => openVehicle(null)}
          >
            <Plus size={16} /> Add vehicle
          </button>
        </div>
      </header>

      <InventorySyncBanner
        freshness={results.freshness ?? data.inventoryFreshness}
      />

      {carnovaFeedEnabled && (
        <CarnovaSyncPanel
          reloadToken={reloadToken}
          canManage={canManage}
          syncing={carnovaSyncing}
          onSync={syncCarnova}
          result={carnovaResult}
          error={carnovaError}
        />
      )}

      <div className="filter-bar">
        <div className="search-field">
          <Search size={15} />
          <input
            aria-label="Search inventory"
            value={filters.q}
            onChange={(event) => setFilter("q", event.target.value)}
            placeholder="Stock, VIN, make, model, trim, color, feature"
          />
        </div>
        <select
          aria-label="Condition"
          value={filters.condition}
          onChange={(event) => setFilter("condition", event.target.value)}
        >
          <option value="">All conditions</option>
          <option value="new">New</option>
          <option value="used">Used</option>
          <option value="certified">Certified</option>
        </select>
        <select
          aria-label="Filter by availability"
          value={filters.status}
          onChange={(event) => setFilter("status", event.target.value)}
        >
          <option value="">All availability</option>
          {INVENTORY_STATUS_OPTIONS.map((item) => (
            <option key={item} value={item}>
              {label(item)}
            </option>
          ))}
        </select>
        <select
          aria-label="Sort inventory"
          value={filters.sort}
          onChange={(event) => setFilter("sort", event.target.value)}
        >
          {INVENTORY_SORT_OPTIONS.map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </select>
        <label className="toggle-inline">
          <input
            type="checkbox"
            checked={filters.availableOnly}
            onChange={(event) =>
              setFilter("availableOnly", event.target.checked)
            }
          />
          <span>Only what TITAN can present</span>
        </label>
      </div>

      <div className="filter-bar filter-bar-secondary">
        <select
          aria-label="Make"
          value={filters.make}
          onChange={(event) => setFilter("make", event.target.value)}
        >
          <option value="">All makes</option>
          {facetValues(facets, "makes").map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select
          aria-label="Model"
          value={filters.model}
          onChange={(event) => setFilter("model", event.target.value)}
        >
          <option value="">All models</option>
          {(facets?.models ?? [])
            .filter(
              (item) =>
                !filters.make ||
                String(item.make ?? "").toLowerCase() ===
                  filters.make.toLowerCase(),
            )
            .map((item) => (
              <option key={`${item.make}-${item.value}`} value={item.value}>
                {item.value}
              </option>
            ))}
        </select>
        <select
          aria-label="Body style"
          value={filters.bodyStyle}
          onChange={(event) => setFilter("bodyStyle", event.target.value)}
        >
          <option value="">All body styles</option>
          {facetValues(facets, "bodyStyles").map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select
          aria-label="Exterior color"
          value={filters.exteriorColor}
          onChange={(event) => setFilter("exteriorColor", event.target.value)}
        >
          <option value="">All exterior colors</option>
          {facetValues(facets, "exteriorColors").map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select
          aria-label="Interior color"
          value={filters.interiorColor}
          onChange={(event) => setFilter("interiorColor", event.target.value)}
        >
          <option value="">All interior colors</option>
          {facetValues(facets, "interiorColors").map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <select
          aria-label="Feature"
          value={filters.feature}
          onChange={(event) => setFilter("feature", event.target.value)}
        >
          <option value="">Any feature</option>
          {facetValues(facets, "features")
            .slice(0, 60)
            .map((value) => (
              <option key={value} value={value}>
                {label(value)}
              </option>
            ))}
        </select>
      </div>

      <div className="filter-bar filter-bar-secondary">
        <input
          aria-label="Stock number"
          placeholder="Stock #"
          value={filters.stockNumber}
          onChange={(event) => setFilter("stockNumber", event.target.value)}
        />
        <input
          aria-label="VIN"
          placeholder="VIN"
          value={filters.vin}
          onChange={(event) => setFilter("vin", event.target.value)}
        />
        <input
          aria-label="Year from"
          type="number"
          placeholder="Year from"
          value={filters.yearMin}
          onChange={(event) => setFilter("yearMin", event.target.value)}
        />
        <input
          aria-label="Year to"
          type="number"
          placeholder="Year to"
          value={filters.yearMax}
          onChange={(event) => setFilter("yearMax", event.target.value)}
        />
        <input
          aria-label="Min price"
          type="number"
          placeholder="Min price"
          value={filters.minPrice}
          onChange={(event) => setFilter("minPrice", event.target.value)}
        />
        <input
          aria-label="Max price"
          type="number"
          placeholder="Max price"
          value={filters.maxPrice}
          onChange={(event) => setFilter("maxPrice", event.target.value)}
        />
        <input
          aria-label="Max mileage"
          type="number"
          placeholder="Max mileage"
          value={filters.maxMileage}
          onChange={(event) => setFilter("maxMileage", event.target.value)}
        />
        {filtersActive && (
          <button
            className="secondary-button"
            onClick={() => setFilters(EMPTY_INVENTORY_FILTERS)}
          >
            <X size={15} /> Clear filters
          </button>
        )}
      </div>

      <p className="result-count" aria-live="polite">
        {searching
          ? "Searching inventory…"
          : `${results.total} matching vehicle${results.total === 1 ? "" : "s"}${
              facets?.total ? ` of ${facets.total} in inventory` : ""
            }`}
      </p>
      {searchError && <Notice type="error">{searchError}</Notice>}

      {!facets?.total && !searching && (
        <Notice>
          No inventory is loaded. TITAN correctly reports that matching
          inventory is unavailable until vehicles are synced from CarNova,
          imported, or added.
        </Notice>
      )}

      <div className="inventory-grid">
        {vehicles.map((vehicle) => (
          <article className="vehicle-card" key={vehicle.id}>
            <div className="vehicle-image">
              {vehicle.images?.[0] ? (
                <img
                  src={vehicle.images[0]}
                  alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
                />
              ) : (
                <Warehouse size={28} />
              )}
            </div>
            <div className="vehicle-card-body">
              <div className="vehicle-topline">
                <span>#{vehicle.stock_number}</span>
                <b className={`pill ${vehicle.status}`}>
                  {label(vehicle.status)}
                </b>
              </div>
              <h3>
                {vehicle.year} {vehicle.make} {vehicle.model}
              </h3>
              <p>
                {vehicle.trim || vehicle.vehicle_type || "Trim not provided"} ·{" "}
                {vehicle.exterior_color || "Color not provided"}
              </p>
              <div className="price-line">
                <strong>
                  {money(vehicle.internet_price ?? vehicle.price)}
                </strong>
                <span>
                  {vehicle.mileage === null
                    ? "Mileage unavailable"
                    : `${Number(vehicle.mileage).toLocaleString()} mi`}
                </span>
              </div>
              <dl>
                <div>
                  <dt>VIN</dt>
                  <dd>{vehicle.vin || "—"}</dd>
                </div>
                <div>
                  <dt>Location</dt>
                  <dd>{vehicle.location || "—"}</dd>
                </div>
                <div>
                  <dt>Added</dt>
                  <dd>{dateOnly(vehicle.date_added)}</dd>
                </div>
              </dl>
              <label className="vehicle-status-change">
                <span>Availability</span>
                <select
                  aria-label={`Availability for stock ${vehicle.stock_number}`}
                  value={vehicle.status}
                  disabled={!canManage || statusBusyId === vehicle.id}
                  onChange={(event) =>
                    changeStatus(vehicle, event.target.value)
                  }
                >
                  {INVENTORY_STATUS_OPTIONS.map((item) => (
                    <option key={item} value={item}>
                      {label(item)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="vehicle-card-actions">
                <button
                  className="secondary-button"
                  onClick={() => setDetailId(vehicle.id)}
                >
                  <Search size={15} /> Details
                </button>
                <button
                  className="secondary-button"
                  disabled={!canManage}
                  title={
                    !canManage
                      ? "Manager or admin role required"
                      : "Edit vehicle"
                  }
                  onClick={() => openVehicle(vehicle)}
                >
                  <Pencil size={15} /> Edit
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
      {!vehicles.length && Boolean(facets?.total) && !searching && (
        <EmptyState
          icon={Search}
          title="No matching inventory"
          text="No vehicle in this dealership's inventory matches those filters. TITAN reports the same result to customers instead of inventing a vehicle."
        />
      )}

      {detailId && (
        <VehicleDetailModal
          vehicleId={detailId}
          onClose={() => setDetailId("")}
          openLead={openLead}
        />
      )}

      {importOpen && (
        <Modal
          title="Import inventory CSV"
          eyebrow="Feed interface"
          onClose={() => setImportOpen(false)}
        >
          <p className="modal-copy">
            Upload a CSV with headers matching inventory fields such as{" "}
            <code>stockNumber</code>, <code>vin</code>, <code>year</code>,{" "}
            <code>make</code>, <code>model</code>, <code>trim</code>,{" "}
            <code>internetPrice</code>, <code>condition</code>, and{" "}
            <code>status</code>. Common DMS and dealer-feed headers such as{" "}
            <code>Stock Number</code> and <code>Model Year</code> are also
            accepted. Imported vehicles belong to this dealership only.
          </p>
          <label className="file-drop">
            <FileUp size={24} />
            <span>Select inventory CSV</span>
            <input type="file" accept=".csv,text/csv" onChange={importFile} />
          </label>
          {importError && <Notice type="error">{importError}</Notice>}
          {importResult && <Notice type="success">{importResult}</Notice>}
          <Notice>
            Every import is recorded in the inventory sync history.
          </Notice>
        </Modal>
      )}
    </div>
  );
}

// Seven-day calendar starting at the chosen date; each appointment opens its
// manage dialog.
function WeekCalendar({ from, appointments, openAppointment }) {
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(`${from}T00:00:00`);
    day.setDate(day.getDate() + index);
    return day;
  });
  return (
    <div className="week-calendar">
      {days.map((day) => {
        const items = appointments
          .filter(
            (appointment) =>
              new Date(appointment.starts_at).toDateString() ===
              day.toDateString(),
          )
          .sort((a, b) => new Date(a.starts_at) - new Date(b.starts_at));
        return (
          <section key={day.toISOString()} className="calendar-day">
            <header>
              <strong>
                {day.toLocaleDateString([], { weekday: "short" })}
              </strong>
              <span>
                {day.toLocaleDateString([], { month: "short", day: "numeric" })}
              </span>
            </header>
            {items.map((appointment) => (
              <button
                key={appointment.id}
                className={`calendar-event ${appointment.status}`}
                onClick={() => openAppointment(appointment, null)}
              >
                <time>
                  {new Date(appointment.starts_at).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </time>
                <span>{appointment.lead_name}</span>
              </button>
            ))}
            {!items.length && <small className="muted">Open</small>}
          </section>
        );
      })}
    </div>
  );
}

function AppointmentsView({ data, openAppointment, refresh }) {
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [status, setStatus] = useState("");
  const [layout, setLayout] = useState("list");
  const appointments = data.appointments.filter(
    (appointment) =>
      new Date(appointment.starts_at) >= new Date(`${from}T00:00:00`) &&
      (!status || appointment.status === status),
  );
  const action = useQuickAction(refresh);
  const quickStatus = (appointment, nextStatus) =>
    action.run(appointment.id, () =>
      crmApi.updateAppointment(appointment.id, { status: nextStatus }),
    );
  return (
    <div className="view-stack">
      <header className="view-header">
        <div>
          <span className="eyebrow">Capacity and outcomes</span>
          <h1>Appointments</h1>
          <p>
            Book against live slots, assign salespeople, reschedule, confirm,
            cancel, and record show outcomes.
          </p>
        </div>
        <button
          className="primary-button"
          onClick={() => openAppointment(null, null)}
        >
          <Plus size={16} /> Book appointment
        </button>
      </header>
      <div className="filter-bar">
        <label className="inline-field">
          <span>From</span>
          <input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">All statuses</option>
          {APPOINTMENT_STATUSES.map((item) => (
            <option key={item} value={item}>
              {label(item)}
            </option>
          ))}
        </select>
        <div className="segmented" role="group" aria-label="Appointment layout">
          <button
            className={layout === "list" ? "active" : ""}
            onClick={() => setLayout("list")}
          >
            List
          </button>
          <button
            className={layout === "week" ? "active" : ""}
            onClick={() => setLayout("week")}
          >
            Week
          </button>
        </div>
      </div>
      {action.error && <Notice type="error">{action.error}</Notice>}
      {layout === "week" && (
        <WeekCalendar
          from={from}
          appointments={appointments}
          openAppointment={openAppointment}
        />
      )}
      <div className="appointment-list" hidden={layout === "week"}>
        {appointments.map((appointment) => (
          <article key={appointment.id}>
            <div className="appointment-date">
              <strong>
                {new Date(appointment.starts_at).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </strong>
              <span>
                {new Date(appointment.starts_at).toLocaleDateString([], {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </div>
            <div className="appointment-main">
              <div>
                <h3>{appointment.lead_name}</h3>
                <p>
                  {label(appointment.appointment_type)} ·{" "}
                  {appointment.vehicle_interest ||
                    `${appointment.inventory_year ?? ""} ${appointment.inventory_make ?? ""} ${appointment.inventory_model ?? ""}`.trim() ||
                    "Vehicle not set"}
                </p>
              </div>
              <span>
                {appointment.salesperson_name || "Salesperson unassigned"}
              </span>
            </div>
            <b className={`pill ${appointment.status}`}>
              {label(appointment.status)}
            </b>
            <div className="appointment-actions">
              <button onClick={() => openAppointment(appointment, null)}>
                Manage
              </button>
              {!["confirmed", "cancelled", "showed", "no_show"].includes(
                appointment.status,
              ) && (
                <button
                  disabled={action.pendingKey === appointment.id}
                  onClick={() => quickStatus(appointment, "confirmed")}
                >
                  Confirm
                </button>
              )}
              {!["cancelled", "showed"].includes(appointment.status) && (
                <button
                  disabled={action.pendingKey === appointment.id}
                  onClick={() => quickStatus(appointment, "showed")}
                >
                  Showed
                </button>
              )}
              {!["cancelled", "showed", "no_show"].includes(
                appointment.status,
              ) && (
                <button
                  disabled={action.pendingKey === appointment.id}
                  onClick={() => quickStatus(appointment, "no_show")}
                >
                  No show
                </button>
              )}
            </div>
          </article>
        ))}
        {!appointments.length && (
          <EmptyState
            icon={CalendarDays}
            title="No appointments found"
            text="Change the date/status filter or book an appointment."
          />
        )}
      </div>
    </div>
  );
}

function FollowUpsView({ data, openFollowUp, refresh }) {
  const [status, setStatus] = useState("pending");
  const tasks = data.followUps.filter(
    (task) => !status || task.status === status,
  );
  const action = useQuickAction(refresh);
  const update = (task, nextStatus) =>
    action.run(task.id, () =>
      crmApi.updateFollowUp(task.id, { status: nextStatus }),
    );
  return (
    <div className="view-stack">
      <header className="view-header">
        <div>
          <span className="eyebrow">Task discipline</span>
          <h1>Follow-ups</h1>
          <p>
            Due tasks are attached to real leads and feed dashboard reminders.
          </p>
        </div>
        <button className="primary-button" onClick={() => openFollowUp(null)}>
          <Plus size={16} /> Create follow-up
        </button>
      </header>
      <div className="filter-bar">
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">All tasks</option>
          <option value="pending">Pending</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>
      {action.error && <Notice type="error">{action.error}</Notice>}
      <div className="task-list">
        {tasks.map((task) => (
          <article
            className={
              new Date(task.due_at) < new Date() && task.status === "pending"
                ? "overdue"
                : ""
            }
            key={task.id}
          >
            <div className="task-icon">
              <Clock3 size={18} />
            </div>
            <div>
              <strong>{task.lead_name}</strong>
              <p>
                {label(task.type)} · {task.notes || "No notes"}
              </p>
              <span>
                Due {dateTime(task.due_at)} ·{" "}
                {task.assigned_user_name || "Unassigned"}
              </span>
            </div>
            <b className={`pill ${task.status}`}>{label(task.status)}</b>
            {task.status === "pending" && (
              <div className="task-actions">
                <button
                  disabled={action.pendingKey === task.id}
                  onClick={() => update(task, "completed")}
                >
                  Complete
                </button>
                <button
                  disabled={action.pendingKey === task.id}
                  onClick={() => update(task, "cancelled")}
                >
                  Cancel
                </button>
              </div>
            )}
          </article>
        ))}
        {!tasks.length && (
          <EmptyState
            icon={ClipboardCheck}
            title="No follow-ups found"
            text="Create a task or change the status filter."
          />
        )}
      </div>
    </div>
  );
}

function TeamView({ data, canManage, canAdmin, openTeam }) {
  return (
    <div className="view-stack">
      <header className="view-header">
        <div>
          <span className="eyebrow">Ownership and permissions</span>
          <h1>Sales team</h1>
          <p>
            Assign BDC agents, salespeople, managers, and administrators to
            dealership work.
          </p>
        </div>
        <button
          className="primary-button"
          disabled={!canManage}
          title={
            !canManage ? "Manager or admin role required" : "Add team member"
          }
          onClick={() => openTeam(null)}
        >
          <Plus size={16} /> Add team member
        </button>
      </header>
      <Notice>
        CRM roles are enforced by the API. Invitation emails are not yet
        automated: employees sign up with the email on their record and are
        linked to this dealership after confirming it. Only administrators can
        add or change administrators.
      </Notice>
      <div className="team-grid">
        {data.team.map((member) => (
          <article key={member.id}>
            <div className="team-avatar">
              {member.name
                .split(" ")
                .map((part) => part[0])
                .slice(0, 2)
                .join("")}
            </div>
            <div>
              <h3>{member.name}</h3>
              <p>{member.email}</p>
              <span>{member.phone || "No phone"}</span>
            </div>
            <b className={`role-badge ${member.role}`}>{label(member.role)}</b>
            <i className={member.active ? "active" : "inactive"}>
              {member.active ? "Active" : "Inactive"}
            </i>
            <button
              className="icon-button"
              disabled={!canManage || (ADMIN_ROLES.includes(member.role) && !canAdmin)}
              title={
                !canManage
                  ? "Manager or admin role required"
                  : ADMIN_ROLES.includes(member.role) && !canAdmin
                    ? "Admin role required to edit an administrator"
                    : "Edit member"
              }
              onClick={() => openTeam(member)}
            >
              <Pencil size={15} />
            </button>
          </article>
        ))}
        {!data.team.length && (
          <EmptyState
            icon={UserCog}
            title="No team members"
            text="Add employees for assignment and permissions."
          />
        )}
      </div>
    </div>
  );
}

function AutomationsView({ data, canManage, refresh }) {
  const action = useQuickAction(refresh);
  const toggle = (rule) =>
    action.run(rule.id, () =>
      crmApi.updateAutomation(rule.id, {
        enabled: !rule.enabled,
        delayMinutes: rule.delay_minutes,
      }),
    );
  return (
    <div className="view-stack">
      <header className="view-header">
        <div>
          <span className="eyebrow">Event-driven operations</span>
          <h1>Automations</h1>
          <p>
            Rules are tied to actual CRM events and scheduled follow-up
            conditions.
          </p>
        </div>
      </header>
      <div className="integration-strip">
        <div>
          <Check size={16} />
          <span>In-app alerts connected</span>
        </div>
        <div className={data.delivery.webhook ? "connected" : "unavailable"}>
          {data.delivery.webhook ? <Check size={16} /> : <X size={16} />}
          <span>
            {data.delivery.webhook
              ? "Webhook connected"
              : "Webhook unavailable — set CRM_AUTOMATION_WEBHOOK_URL"}
          </span>
        </div>
      </div>
      {action.error && <Notice type="error">{action.error}</Notice>}
      <div className="automation-list">
        {data.automations.map((rule) => (
          <article key={rule.id}>
            <div className="automation-icon">
              <Activity size={18} />
            </div>
            <div>
              <strong>{label(rule.action_type)}</strong>
              <p>
                Event: {label(rule.event_type)} · Delay: {rule.delay_minutes}{" "}
                minutes
              </p>
            </div>
            <button
              className={classNames("toggle", rule.enabled && "on")}
              disabled={!canManage || action.pendingKey === rule.id}
              aria-pressed={rule.enabled}
              title={
                !canManage
                  ? "Manager or admin role required"
                  : rule.enabled
                    ? "Disable automation"
                    : "Enable automation"
              }
              onClick={() => toggle(rule)}
            >
              <span />
            </button>
          </article>
        ))}
      </div>
    </div>
  );
}

const SOURCE_TYPE_OPTIONS = [
  ["csv", "CSV file / feed"],
  ["api", "Dealer inventory API"],
  ["dms", "DMS feed"],
  ["manual", "Manual entry"],
];

/**
 * Inventory feed configuration and sync history. No DMS connector is
 * fabricated here: each source records where inventory comes from, how often
 * it is expected to arrive, and when it goes stale, which is what tells TITAN
 * whether it may assert current availability.
 */
function InventorySyncPanel({ canAdmin }) {
  const [state, setState] = useState({
    sources: [],
    syncs: [],
    freshness: null,
  });
  const [form, setForm] = useState({
    name: "",
    sourceType: "csv",
    provider: "",
    staleAfterHours: 24,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      setState(await crmApi.inventorySources());
      setError("");
    } catch (caught) {
      setError(caught.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createSource = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await crmApi.createInventorySource(form);
      setForm({ ...form, name: "", provider: "" });
      setNotice("Inventory source saved.");
      await load();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleSource = async (source) => {
    setBusy(true);
    try {
      await crmApi.updateInventorySource(source.id, {
        enabled: !source.enabled,
      });
      await load();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel inventory-sync-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Inventory freshness</span>
          <h2>Inventory sources and sync history</h2>
          <p>
            Inventory is the source of truth for TITAN. When a feed goes stale,
            TITAN stops asserting availability and asks the dealership to
            confirm instead.
          </p>
        </div>
      </div>
      <InventorySyncBanner freshness={state.freshness} />
      {error && <Notice type="error">{error}</Notice>}
      {notice && <Notice type="success">{notice}</Notice>}

      {state.sources.length > 0 && (
        <table className="data-table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Type</th>
              <th>Goes stale after</th>
              <th>Last sync</th>
              <th>Vehicles</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {state.sources.map((source) => (
              <tr key={source.id} className={source.enabled ? "" : "dimmed"}>
                <td>
                  <strong>{source.name}</strong>
                  {source.provider && <small> · {source.provider}</small>}
                </td>
                <td>{label(source.source_type)}</td>
                <td>{source.stale_after_hours}h</td>
                <td>
                  {source.last_synced_at
                    ? dateTime(source.last_synced_at)
                    : "Never"}
                  <small> · {label(source.last_sync_status)}</small>
                </td>
                <td>{source.last_sync_vehicle_count}</td>
                <td>
                  <button
                    className="link-button"
                    disabled={!canAdmin || busy}
                    onClick={() => toggleSource(source)}
                  >
                    {source.enabled ? "Disable" : "Enable"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form className="form-grid three" onSubmit={createSource}>
        <label>
          <span>Source name</span>
          <input
            disabled={!canAdmin}
            value={form.name}
            placeholder="Main lot feed"
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
        </label>
        <label>
          <span>Feed type</span>
          <select
            disabled={!canAdmin}
            value={form.sourceType}
            onChange={(event) =>
              setForm({ ...form, sourceType: event.target.value })
            }
          >
            {SOURCE_TYPE_OPTIONS.map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Provider</span>
          <input
            disabled={!canAdmin}
            value={form.provider}
            placeholder="CDK, Reynolds, HomeNet…"
            onChange={(event) =>
              setForm({ ...form, provider: event.target.value })
            }
          />
        </label>
        <label>
          <span>Stale after (hours)</span>
          <input
            type="number"
            min="1"
            max="168"
            disabled={!canAdmin}
            value={form.staleAfterHours}
            onChange={(event) =>
              setForm({ ...form, staleAfterHours: event.target.value })
            }
          />
        </label>
        <button className="secondary-button" disabled={!canAdmin || busy}>
          <Plus size={15} /> Save inventory source
        </button>
      </form>
      <Notice>
        Inventory belongs only to this dealership and can arrive through CSV
        import, manual vehicle entry, or this dealership's configured import
        API. Every run is written to the sync history below so freshness is
        always attributable.
      </Notice>

      <h3>Recent syncs</h3>
      {state.syncs.length === 0 ? (
        <p className="muted">No inventory sync has been recorded yet.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Started</th>
              <th>Type</th>
              <th>Result</th>
              <th>Received</th>
              <th>New</th>
              <th>Updated</th>
              <th>Failed</th>
            </tr>
          </thead>
          <tbody>
            {state.syncs.map((sync) => (
              <tr key={sync.id}>
                <td>{dateTime(sync.started_at)}</td>
                <td>{label(sync.source_type)}</td>
                <td>
                  <b className={`pill ${sync.status}`}>{label(sync.status)}</b>
                  {sync.message && <small> · {sync.message}</small>}
                </td>
                <td>{sync.vehicles_received}</td>
                <td>{sync.created_count}</td>
                <td>{sync.updated_count}</td>
                <td>{sync.failed_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function SettingsView({ session, canAdmin, canManage, onSaved, openWizard }) {
  const dealership = session.dealership;
  const [form, setForm] = useState({
    name: dealership.name ?? "",
    phone: dealership.phone ?? "",
    email: dealership.email ?? "",
    website: dealership.website ?? "",
    address: dealership.address ?? "",
    timezone: dealership.timezone ?? "America/New_York",
    trimColor: dealership.trimColor ?? "dark_blue",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const exportData = async () => {
    setBusy(true);
    setError("");
    try {
      const payload = await crmApi.exportDealership();
      downloadJson(
        payload,
        `${session.dealership.slug || "dealership"}-novacarai-export.json`,
      );
      setNotice("Dealership export downloaded.");
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  };
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await crmApi.updateSettings(form);
      setNotice("Dealership settings saved.");
      await onSaved();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="view-stack">
      <header className="view-header">
        <div>
          <span className="eyebrow">Tenant configuration</span>
          <h1>Dealership settings</h1>
          <p>These records inform AI context and the appointment timezone.</p>
        </div>
        <div className="header-actions">
          {canAdmin && (
            <button className="secondary-button" onClick={openWizard}>
              <Sparkles size={16} /> Setup wizard
            </button>
          )}
          <button
            className="secondary-button"
            disabled={!canAdmin || busy}
            onClick={exportData}
          >
            <FileDown size={16} /> Export dealership data
          </button>
        </div>
      </header>
      <form className="settings-panel panel" onSubmit={save}>
        <div className="form-grid">
          <label>
            <span>Dealership name</span>
            <input
              disabled={!canAdmin}
              value={form.name}
              onChange={(event) =>
                setForm({ ...form, name: event.target.value })
              }
            />
          </label>
          <label>
            <span>Main phone</span>
            <input
              disabled={!canAdmin}
              value={form.phone}
              onChange={(event) =>
                setForm({ ...form, phone: event.target.value })
              }
            />
          </label>
          <label>
            <span>Email</span>
            <input
              disabled={!canAdmin}
              type="email"
              value={form.email}
              onChange={(event) =>
                setForm({ ...form, email: event.target.value })
              }
            />
          </label>
          <label>
            <span>Website</span>
            <input
              disabled={!canAdmin}
              value={form.website}
              onChange={(event) =>
                setForm({ ...form, website: event.target.value })
              }
            />
          </label>
          <label className="full-span">
            <span>Address</span>
            <input
              disabled={!canAdmin}
              value={form.address}
              onChange={(event) =>
                setForm({ ...form, address: event.target.value })
              }
            />
          </label>
          <label className="full-span">
            <span>Timezone</span>
            <input
              disabled={!canAdmin}
              value={form.timezone}
              onChange={(event) =>
                setForm({ ...form, timezone: event.target.value })
              }
            />
          </label>
          <label className="full-span">
            <span>Website trim color</span>
            <select
              disabled={!canAdmin}
              value={form.trimColor}
              onChange={(event) =>
                setForm({ ...form, trimColor: event.target.value })
              }
            >
              {TRIM_COLORS.map(([value, name]) => (
                <option key={value} value={value}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
        {!canAdmin && (
          <Notice>Only dealership administrators can change settings.</Notice>
        )}
        {error && <Notice type="error">{error}</Notice>}
        {notice && <Notice type="success">{notice}</Notice>}
        <button className="primary-button" disabled={!canAdmin || busy}>
          {busy ? "Saving…" : "Save settings"}
        </button>
      </form>
      <ConnectionsPanel canManage={canManage} />
      <InventorySyncPanel canAdmin={canAdmin} />
    </div>
  );
}

const TRIM_COLORS = [
  ["dark_green", "Dark green", "#174c39"],
  ["light_green", "Light green", "#5f8f6f"],
  ["light_blue", "Light blue", "#588ca6"],
  ["dark_blue", "Dark blue", "#244a68"],
  ["slate", "Slate", "#53656c"],
  ["burgundy", "Burgundy", "#743f4b"],
  ["charcoal", "Charcoal", "#3f4745"],
];
const TRIM_THEMES = Object.fromEntries(
  TRIM_COLORS.map(([value, , color]) => [value, color]),
);

function PlatformDealershipForm({ onClose, onSaved }) {
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
    timezone: "America/New_York",
    trimColor: "dark_blue",
    carnovaFeedEnabled: false,
    adminName: "",
    adminEmail: "",
    adminPhone: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await crmApi.createPlatformDealership(form);
      await onSaved();
      onClose();
    } catch (caught) {
      setError(caught.message);
      setBusy(false);
    }
  };
  const field = (key) => (event) =>
    setForm({ ...form, [key]: event.target.value });
  return (
    <Modal
      title="Add dealership"
      eyebrow="Workspace and administrator"
      onClose={onClose}
      size="large"
    >
      <form onSubmit={save}>
        <div className="form-grid">
          <label>
            <span>Dealership name</span>
            <input required value={form.name} onChange={field("name")} />
          </label>
          <label>
            <span>Dealership email</span>
            <input type="email" value={form.email} onChange={field("email")} />
          </label>
          <label>
            <span>Phone</span>
            <input value={form.phone} onChange={field("phone")} />
          </label>
          <label>
            <span>Timezone</span>
            <input
              required
              value={form.timezone}
              onChange={field("timezone")}
            />
          </label>
          <label className="full-span">
            <span>Address</span>
            <input value={form.address} onChange={field("address")} />
          </label>
          <label>
            <span>Owner name</span>
            <input
              required
              value={form.adminName}
              onChange={field("adminName")}
            />
          </label>
          <label>
            <span>Owner email</span>
            <input
              required
              type="email"
              value={form.adminEmail}
              onChange={field("adminEmail")}
            />
          </label>
          <label>
            <span>Owner phone</span>
            <input value={form.adminPhone} onChange={field("adminPhone")} />
          </label>
          <label>
            <span>Website trim color</span>
            <select value={form.trimColor} onChange={field("trimColor")}>
              {TRIM_COLORS.map(([value, name]) => (
                <option key={value} value={value}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox-label full-span">
            <input
              type="checkbox"
              checked={form.carnovaFeedEnabled}
              onChange={(event) =>
                setForm({ ...form, carnovaFeedEnabled: event.target.checked })
              }
            />
            <span>This is the CarNova dealership workspace</span>
          </label>
        </div>
        <Notice>
          NovaCar emails the appointed owner an invite. On first login they
          finish the setup wizard: hours, branding, team invites, and
          connecting their dealership system.
        </Notice>
        {error && <Notice type="error">{error}</Notice>}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? "Creating…" : "Create dealership"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PlatformUserForm({ dealerships, onClose, onSaved }) {
  const [form, setForm] = useState({
    dealershipId: dealerships[0]?.id || "",
    name: "",
    email: "",
    phone: "",
    role: "salesperson",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await crmApi.createPlatformUser(form);
      await onSaved();
      onClose();
    } catch (caught) {
      setError(caught.message);
      setBusy(false);
    }
  };
  const field = (key) => (event) =>
    setForm({ ...form, [key]: event.target.value });
  return (
    <Modal
      title="Add team member"
      eyebrow="Master administration"
      onClose={onClose}
    >
      <form onSubmit={save}>
        <div className="form-grid">
          <label className="full-span">
            <span>Dealership</span>
            <select
              required
              value={form.dealershipId}
              onChange={field("dealershipId")}
            >
              {dealerships.map((dealer) => (
                <option key={dealer.id} value={dealer.id}>
                  {dealer.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Name</span>
            <input required value={form.name} onChange={field("name")} />
          </label>
          <label>
            <span>Email</span>
            <input
              required
              type="email"
              value={form.email}
              onChange={field("email")}
            />
          </label>
          <label>
            <span>Phone</span>
            <input value={form.phone} onChange={field("phone")} />
          </label>
          <label>
            <span>Role</span>
            <select value={form.role} onChange={field("role")}>
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {label(role)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && <Notice type="error">{error}</Notice>}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? "Adding…" : "Add team member"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

const connectionSummary = (connections = []) => {
  if (!connections.length) return ["Not connected", "cancelled"];
  if (connections.some((connection) => connection.status === "error"))
    return ["Error", "cancelled"];
  if (connections.some((connection) => connection.status === "active"))
    return [
      `${connections.filter((connection) => connection.status === "active").length} active`,
      "completed",
    ];
  return ["Pending", "pending"];
};

function PlatformView({ onImpersonate }) {
  const [data, setData] = useState({
    dealerships: [],
    users: [],
    operations: [],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState("");
  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setData(await crmApi.platform());
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const updateDealership = async (dealership, changes) => {
    setBusy(true);
    try {
      await crmApi.updatePlatformDealership(dealership.id, changes);
      await load();
    } catch (caught) {
      setError(caught.message);
      setBusy(false);
    }
  };
  const updateUser = async (user, changes) => {
    setBusy(true);
    try {
      await crmApi.updatePlatformUser(user.id, changes);
      await load();
    } catch (caught) {
      setError(caught.message);
      setBusy(false);
    }
  };
  const exportDealership = async (dealership) => {
    setBusy(true);
    try {
      const payload = await crmApi.exportDealership(dealership.id);
      downloadJson(payload, `${dealership.slug}-novacarai-export.json`);
      await load();
    } catch (caught) {
      setError(caught.message);
      setBusy(false);
    }
  };
  const deleteDealership = async (dealership) => {
    if (
      !window.confirm(
        `Permanently delete ${dealership.name} and all of its CRM data? This cannot be undone.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await crmApi.deletePlatformDealership(dealership.id);
      await load();
    } catch (caught) {
      setError(caught.message);
      setBusy(false);
    }
  };
  const deleteUser = async (user) => {
    if (!window.confirm(`Delete ${user.name} from ${user.dealership_name}?`))
      return;
    setBusy(true);
    setError("");
    try {
      await crmApi.deletePlatformUser(user.id);
      await load();
    } catch (caught) {
      setError(caught.message);
      setBusy(false);
    }
  };
  return (
    <div className="view-stack">
      <header className="view-header">
        <div>
          <span className="eyebrow">Platform owner</span>
          <h1>Master administration</h1>
          <p>
            Manage dealership access, subscriptions, users, transfers, and
            exports.
          </p>
        </div>
        <div className="header-actions">
          <button className="secondary-button" onClick={load} disabled={busy}>
            <RefreshCw size={16} /> Refresh
          </button>
          <button
            className="primary-button"
            onClick={() => setDialog("dealership")}
          >
            <Plus size={16} /> Add dealership
          </button>
          <button
            className="secondary-button"
            onClick={() => setDialog("user")}
            disabled={!data.dealerships.length}
          >
            <UserCog size={16} /> Add person
          </button>
        </div>
      </header>
      {error && <Notice type="error">{error}</Notice>}
      {data.environment?.some((item) => !item.set && item.required) && (
        <Notice type="warning">
          Missing configuration:{" "}
          {data.environment
            .filter((item) => !item.set && item.required)
            .map((item) => `${item.name} (${item.purpose})`)
            .join(", ")}
          . Add these in Netlify environment variables.
        </Notice>
      )}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Overview</span>
            <h2>Dealership list</h2>
          </div>
        </div>
        <div className="table-scroll">
          <table className="connections-table dealership-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Plan</th>
                <th>Connection status</th>
                <th>Users</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.dealerships.map((dealership) => {
                const [summary, tone] = connectionSummary(
                  dealership.connections,
                );
                return (
                  <tr key={dealership.id}>
                    <td data-label="Name">
                      <strong>{dealership.name}</strong>
                      {dealership.platform_status !== "active" && (
                        <small> · {label(dealership.platform_status)}</small>
                      )}
                    </td>
                    <td data-label="Plan">
                      <select
                        aria-label={`${dealership.name} plan`}
                        value={dealership.plan || "starter"}
                        disabled={busy}
                        onChange={(event) =>
                          updateDealership(dealership, {
                            plan: event.target.value,
                          })
                        }
                      >
                        {["starter", "growth", "pro", "enterprise"].map(
                          (plan) => (
                            <option key={plan} value={plan}>
                              {label(plan)}
                            </option>
                          ),
                        )}
                      </select>
                    </td>
                    <td data-label="Connection status">
                      <span className={`pill ${tone}`}>{summary}</span>
                    </td>
                    <td data-label="Users">{dealership.user_count}</td>
                    <td data-label="Created">
                      {dateOnly(dealership.created_at)}
                    </td>
                    <td data-label="Actions">
                      <button
                        className="text-button"
                        disabled={
                          busy ||
                          !dealership.user_count ||
                          dealership.platform_status !== "active"
                        }
                        title={
                          dealership.user_count
                            ? "Open this dealership's workspace (audited)"
                            : "Add a user first"
                        }
                        onClick={() =>
                          onImpersonate?.(dealership).catch((caught) =>
                            setError(caught.message),
                          )
                        }
                      >
                        <UserCog size={14} /> Log in as
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section className="panel integration-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Tenants</span>
            <h2>Dealerships</h2>
          </div>
        </div>
        <div className="integration-rows platform-rows">
          {data.dealerships.map((dealership) => (
            <div key={dealership.id}>
              <Store size={18} />
              <span>
                <strong>{dealership.name}</strong>
                <small>
                  {dealership.user_count} users · {dealership.lead_count} leads
                  · {dealership.inventory_count} vehicles ·{" "}
                  {dealership.appointment_count} appointments
                </small>
              </span>
              <select
                aria-label={`${dealership.name} platform status`}
                value={dealership.platform_status}
                disabled={busy}
                onChange={(event) =>
                  updateDealership(dealership, {
                    platformStatus: event.target.value,
                  })
                }
              >
                {["active", "suspended", "closed", "transferring"].map(
                  (status) => (
                    <option key={status} value={status}>
                      {label(status)}
                    </option>
                  ),
                )}
              </select>
              <select
                aria-label={`${dealership.name} trim color`}
                value={dealership.trim_color || "dark_blue"}
                disabled={busy}
                onChange={(event) =>
                  updateDealership(dealership, {
                    trimColor: event.target.value,
                  })
                }
              >
                {TRIM_COLORS.map(([value, name]) => (
                  <option key={value} value={value}>
                    {name}
                  </option>
                ))}
              </select>
              <select
                aria-label={`${dealership.name} subscription status`}
                value={dealership.subscription_status}
                disabled={busy}
                onChange={(event) =>
                  updateDealership(dealership, {
                    subscriptionStatus: event.target.value,
                  })
                }
              >
                {["trial", "active", "past_due", "cancelled"].map((status) => (
                  <option key={status} value={status}>
                    {label(status)}
                  </option>
                ))}
              </select>
              <select
                aria-label={`${dealership.name} inventory ownership`}
                value={
                  dealership.carnova_feed_enabled ? "carnova" : "independent"
                }
                disabled={busy}
                onChange={(event) =>
                  updateDealership(dealership, {
                    carnovaFeedEnabled: event.target.value === "carnova",
                  })
                }
              >
                <option value="independent">Independent inventory</option>
                <option value="carnova">CarNova feed</option>
              </select>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => exportDealership(dealership)}
              >
                <FileDown size={14} /> Export
              </button>
              <button
                className="icon-button danger-icon"
                aria-label={`Delete ${dealership.name}`}
                disabled={busy}
                onClick={() => deleteDealership(dealership)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      </section>
      <section className="panel integration-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Access and transfer</span>
            <h2>Users</h2>
          </div>
        </div>
        <div className="integration-rows platform-rows">
          {data.users.map((user) => (
            <div key={user.id}>
              <UserCog size={18} />
              <span>
                <strong>{user.name}</strong>
                <small>
                  {user.email} · {user.dealership_name}
                </small>
              </span>
              <select
                aria-label={`${user.name} role`}
                value={user.role}
                disabled={busy}
                onChange={(event) =>
                  updateUser(user, { role: event.target.value })
                }
              >
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {label(role)}
                  </option>
                ))}
              </select>
              <select
                aria-label={`${user.name} dealership`}
                value={user.dealership_id}
                disabled={busy}
                onChange={(event) =>
                  updateUser(user, { dealershipId: event.target.value })
                }
              >
                {data.dealerships.map((dealership) => (
                  <option key={dealership.id} value={dealership.id}>
                    {dealership.name}
                  </option>
                ))}
              </select>
              <button
                className="text-button"
                disabled={busy}
                onClick={() => updateUser(user, { active: !user.active })}
              >
                {user.active ? "Deactivate" : "Activate"}
              </button>
              <button
                className="icon-button danger-icon"
                aria-label={`Delete ${user.name}`}
                disabled={busy}
                onClick={() => deleteUser(user)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
      </section>
      {dialog === "dealership" && (
        <PlatformDealershipForm onClose={() => setDialog("")} onSaved={load} />
      )}
      {dialog === "user" && (
        <PlatformUserForm
          dealerships={data.dealerships}
          onClose={() => setDialog("")}
          onSaved={load}
        />
      )}
    </div>
  );
}

const navItems = [
  ["dashboard", LayoutDashboard, "Dashboard"],
  ["inbox", Inbox, "Inbox"],
  ["leads", UsersRound, "Leads"],
  ["inventory", Warehouse, "Inventory"],
  ["appointments", CalendarDays, "Appointments"],
  ["followups", ClipboardCheck, "Follow-ups"],
  ["team", UserCog, "Team"],
  ["automations", Activity, "Automations"],
  ["settings", Settings, "Settings"],
];

const emptyData = {
  metrics: {},
  inventoryFreshness: null,
  leads: [],
  inventory: [],
  inventoryFacets: null,
  appointments: [],
  team: [],
  followUps: [],
  alerts: [],
  automations: [],
  delivery: {},
};

export default function App() {
  const [authState, setAuthState] = useState({
    loading: true,
    user: null,
    error: "",
  });
  const [session, setSession] = useState(null);
  const [data, setData] = useState(emptyData);
  const [tab, setTab] = useState("dashboard");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [navOpen, setNavOpen] = useState(false);
  const [modal, setModal] = useState(null);
  const [focusLeadId, setFocusLeadId] = useState("");
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  const loadSession = useCallback(async () => {
    const next = await crmApi.session();
    // A stored "Log in as" token that the server no longer honors is dropped.
    if (!next.impersonating && impersonation.get()) impersonation.set(null);
    setSession(next);
    // First run: owners and administrators finish the setup wizard.
    if (
      next.member &&
      ["owner", "admin"].includes(next.member.role) &&
      !next.dealership?.onboardingCompletedAt &&
      localStorage.getItem("novacar.wizardDismissed") !== next.dealership.id
    )
      setWizardOpen(true);
    return next;
  }, []);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [
        dashboard,
        leads,
        inventory,
        appointments,
        team,
        followUps,
        alerts,
        automations,
      ] = await Promise.all([
        crmApi.dashboard(),
        crmApi.leads(),
        crmApi.inventory(),
        crmApi.appointments({
          from: new Date(Date.now() - 30 * 86400000).toISOString(),
          to: new Date(Date.now() + 180 * 86400000).toISOString(),
        }),
        crmApi.team(),
        crmApi.followUps(),
        crmApi.alerts(),
        crmApi.automations(),
      ]);
      setData({
        metrics: dashboard.metrics,
        inventoryFreshness: dashboard.inventoryFreshness ?? null,
        leads: leads.leads,
        inventory: inventory.inventory,
        inventoryFacets: inventory.facets ?? null,
        appointments: appointments.appointments,
        team: team.team,
        followUps: followUps.followUps,
        alerts: alerts.alerts,
        automations: automations.rules,
        delivery: automations.delivery,
      });
    } catch (caught) {
      setError(caught.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    initializeAuth()
      .then(async ({ callback, user }) => {
        // Reset and invite links must set a password before entering the CRM.
        if (callback?.type === "recovery" || callback?.type === "invite") {
          setAuthState({ loading: false, user: null, error: "", callback });
          return;
        }
        setAuthState({ loading: false, user, error: "" });
        if (user) {
          const next = await loadSession();
          if (!next.needsOnboarding) await refresh();
        }
      })
      .catch((caught) =>
        setAuthState({ loading: false, user: null, error: caught.message }),
      );
  }, [loadSession, refresh]);
  const authenticated = async (user) => {
    setAuthState({ loading: false, user, error: "" });
    const next = await loadSession();
    if (!next.needsOnboarding) await refresh();
  };
  const logoutUser = async () => {
    await signOut();
    setAuthState({ loading: false, user: null, error: "" });
    setSession(null);
    setData(emptyData);
  };
  const canManage = ["owner", "admin", "manager"].includes(
    session?.member?.role,
  );
  const canAdmin = ADMIN_ROLES.includes(session?.member?.role);
  const closeModal = () => setModal(null);
  const startImpersonation = async (dealership) => {
    const reason = window.prompt(
      `Log in as ${dealership.name}. This is recorded in the audit log. Reason (optional):`,
      "",
    );
    if (reason === null) return;
    const result = await crmApi.startImpersonation(dealership.id, reason);
    impersonation.set({
      token: result.token,
      expiresAt: result.expiresAt,
      dealershipName: result.dealership.name,
    });
    setTab("dashboard");
    await loadSession();
    await refresh();
  };
  const endImpersonation = async () => {
    await crmApi.endImpersonation().catch(() => null);
    impersonation.set(null);
    setData(emptyData);
    const next = await loadSession();
    if (next.member) await refresh();
    setTab(next.member ? "platform" : "dashboard");
  };
  const modalSaved = async () => {
    await refresh();
  };

  if (authState.loading)
    return (
      <div className="loading-screen">
        <div className="brand-mark">
          <Sparkles size={20} />
        </div>
        <LoaderCircle className="spin" />
      </div>
    );
  if (!authState.user)
    return (
      <AuthScreen
        onAuthenticated={authenticated}
        passwordCallback={authState.callback}
      />
    );
  if (!session)
    return (
      <div className="loading-screen">
        <LoaderCircle className="spin" />
      </div>
    );
  if (session.needsOnboarding && !session.platformAdmin)
    return (
      <Onboarding
        user={authState.user}
        onComplete={async () => {
          await loadSession();
          await refresh();
        }}
        onSignOut={logoutUser}
      />
    );

  if (!session.member && session.platformAdmin && creatingWorkspace)
    return (
      <Onboarding
        user={authState.user}
        onComplete={async () => {
          setCreatingWorkspace(false);
          await loadSession();
          await refresh();
        }}
        onCancel={() => setCreatingWorkspace(false)}
      />
    );

  if (!session.member && session.platformAdmin)
    return (
      <div className="crm-shell platform-shell">
        <aside className="sidebar open">
          <div className="sidebar-brand">
            <div className="brand-mark">
              <Sparkles size={19} />
            </div>
            <div>
              <strong>NOVACARAI</strong>
              <span>powered by titan ai</span>
            </div>
          </div>
          <div className="sidebar-user">
            <div className="team-avatar small">PA</div>
            <div>
              <strong>Platform owner</strong>
              <span>{session.user.email}</span>
            </div>
            <button onClick={logoutUser} aria-label="Sign out">
              <LogOut size={17} />
            </button>
          </div>
          <button
            className="sidebar-action"
            onClick={() => setCreatingWorkspace(true)}
          >
            <Store size={16} /> Create dealership workspace
          </button>
        </aside>
        <main className="content">
          <PlatformView onImpersonate={startImpersonation} />
        </main>
      </div>
    );

  const viewProps = { data, refresh, setTab };
  const visibleNavItems = session.platformAdmin
    ? [...navItems, ["platform", ShieldCheck, "Master admin"]]
    : navItems;
  const trimColor =
    TRIM_THEMES[session.dealership.trimColor] || TRIM_THEMES.dark_blue;
  return (
    <div className="crm-shell" style={{ "--dealer-trim": trimColor }}>
      <aside className={classNames("sidebar", navOpen && "open")}>
        <div className="sidebar-brand">
          <div className="brand-mark">
            <Sparkles size={19} />
          </div>
          <div>
            <strong>NOVACARAI</strong>
            <span>{session.dealership.name}</span>
          </div>
          <button
            className="mobile-only icon-button dark"
            onClick={() => setNavOpen(false)}
          >
            <X size={18} />
          </button>
        </div>
        <nav>
          {visibleNavItems.map(([id, Icon, title]) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => {
                setTab(id);
                setNavOpen(false);
              }}
            >
              <Icon size={17} />
              <span>{title}</span>
              {id === "inbox" &&
                data.alerts.filter((item) => !item.acknowledged).length > 0 && (
                  <b>
                    {data.alerts.filter((item) => !item.acknowledged).length}
                  </b>
                )}
            </button>
          ))}
        </nav>
        <div className="sidebar-user">
          <div className="team-avatar small">
            {session.member.name
              .split(" ")
              .map((part) => part[0])
              .slice(0, 2)
              .join("")}
          </div>
          <div>
            <strong>{session.member.name}</strong>
            <span>{label(session.member.role)}</span>
          </div>
          <button onClick={logoutUser} aria-label="Sign out">
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      {navOpen && (
        <button
          className="nav-scrim"
          onClick={() => setNavOpen(false)}
          aria-label="Close navigation"
        />
      )}
      <main className="content">
        <header className="mobile-topbar">
          <button className="icon-button" onClick={() => setNavOpen(true)}>
            <Menu size={19} />
          </button>
          <strong>NOVACARAI</strong>
          {loading && <LoaderCircle className="spin" size={17} />}
        </header>
        {session.impersonating && (
          <div className="impersonation-banner" role="status">
            <ShieldCheck size={16} />
            <span>
              Logged in as <strong>{session.dealership.name}</strong> (acting
              as {session.member.name}). Every action is audited.
            </span>
            <button className="secondary-button" onClick={endImpersonation}>
              End session
            </button>
          </div>
        )}
        {canAdmin && !session.dealership.onboardingCompletedAt && !wizardOpen && (
          <div className="setup-banner">
            <span>Finish setting up {session.dealership.name}.</span>
            <button className="text-button" onClick={() => setWizardOpen(true)}>
              Continue setup
            </button>
          </div>
        )}
        {error && <Notice type="error">{error}</Notice>}
        {tab === "dashboard" && <DashboardView {...viewProps} />}
        {tab === "dashboard" && canManage && <AnalyticsPanel />}
        {tab === "inbox" && (
          <InboxView
            {...viewProps}
            focusLeadId={focusLeadId}
            openLeadForm={(lead) => setModal({ type: "lead", lead })}
            openAppointment={(appointment, lead) =>
              setModal({ type: "appointment", appointment, lead })
            }
            openFollowUp={(lead) => setModal({ type: "followup", lead })}
          />
        )}
        {tab === "leads" && (
          <LeadsView
            {...viewProps}
            openLeadForm={(lead) => setModal({ type: "lead", lead })}
            openInbox={(leadId) => {
              setFocusLeadId(leadId);
              setTab("inbox");
            }}
          />
        )}
        {tab === "inventory" && (
          <InventoryView
            {...viewProps}
            canManage={canManage}
            carnovaFeedEnabled={session.dealership.carnovaFeedEnabled}
            openVehicle={(vehicle) => setModal({ type: "vehicle", vehicle })}
            openLead={(leadId) => {
              setFocusLeadId(leadId);
              setTab("inbox");
            }}
          />
        )}
        {tab === "appointments" && (
          <AppointmentsView
            {...viewProps}
            openAppointment={(appointment, lead) =>
              setModal({ type: "appointment", appointment, lead })
            }
          />
        )}
        {tab === "followups" && (
          <FollowUpsView
            {...viewProps}
            openFollowUp={(lead) => setModal({ type: "followup", lead })}
          />
        )}
        {tab === "team" && (
          <TeamView
            {...viewProps}
            canManage={canManage}
            canAdmin={canAdmin}
            openTeam={(member) => setModal({ type: "team", member })}
          />
        )}
        {tab === "automations" && (
          <AutomationsView {...viewProps} canManage={canManage} />
        )}
        {tab === "settings" && (
          <SettingsView
            session={session}
            canAdmin={canAdmin}
            canManage={canManage}
            onSaved={loadSession}
            openWizard={() => setWizardOpen(true)}
          />
        )}
        {tab === "platform" && session.platformAdmin && (
          <PlatformView onImpersonate={startImpersonation} />
        )}
      </main>
      {wizardOpen && (
        <DealershipWizard
          session={session}
          onClose={() => {
            localStorage.setItem(
              "novacar.wizardDismissed",
              session.dealership.id,
            );
            setWizardOpen(false);
          }}
          onFinished={async () => {
            setWizardOpen(false);
            await loadSession();
            await refresh();
          }}
        />
      )}
      {modal?.type === "lead" && (
        <LeadForm
          lead={modal.lead}
          inventory={data.inventory}
          team={data.team}
          onClose={closeModal}
          onSaved={modalSaved}
        />
      )}
      {modal?.type === "vehicle" && (
        <VehicleForm
          vehicle={modal.vehicle}
          onClose={closeModal}
          onSaved={modalSaved}
        />
      )}
      {modal?.type === "appointment" && (
        <AppointmentForm
          appointment={modal.appointment}
          initialLead={modal.lead}
          leads={data.leads}
          inventory={data.inventory}
          team={data.team}
          onClose={closeModal}
          onSaved={modalSaved}
        />
      )}
      {modal?.type === "followup" && (
        <FollowUpForm
          lead={modal.lead}
          leads={data.leads}
          team={data.team}
          onClose={closeModal}
          onSaved={modalSaved}
        />
      )}
      {modal?.type === "team" && (
        <TeamForm
          member={modal.member}
          canAdmin={canAdmin}
          onClose={closeModal}
          onSaved={modalSaved}
        />
      )}
    </div>
  );
}
