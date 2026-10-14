// Add Dealership wizard, Connect Dealership System, the connections panel,
// and NovaCar analytics. Every action here goes through the CRM API, which
// enforces roles and tenant scope on the server.
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  Link2,
  LoaderCircle,
  Plug,
  Plus,
  RefreshCw,
  Send,
  Unplug,
} from "lucide-react";
import { crmApi } from "../services/api.js";
import { Modal, Notice } from "./ui.jsx";

export const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Puerto_Rico",
];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DEFAULT_HOURS = {
  1: ["09:00", "18:00"],
  2: ["09:00", "18:00"],
  3: ["09:00", "18:00"],
  4: ["09:00", "18:00"],
  5: ["09:00", "18:00"],
  6: ["09:00", "17:00"],
};
const INVITE_ROLES = ["owner", "admin", "manager", "bdc", "sales", "salesperson"];
const AVAILABILITY_LABEL = {
  AVAILABLE: "Available",
  PENDING_PARTNER_APPROVAL: "Pending partner approval",
  NOT_APPLICABLE: "Not applicable",
};
const STATUS_TEXT = {
  active: "Active",
  pending: "Pending",
  error: "Error",
  disconnected: "Disconnected",
};

const titleCase = (value = "") =>
  value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const when = (value) =>
  value
    ? new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "Never";

function CopyField({ label, value }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <div className="copy-field">
      <span>{label}</span>
      <code>{value}</code>
      <button
        type="button"
        className="icon-button"
        aria-label={`Copy ${label}`}
        onClick={async () => {
          await navigator.clipboard?.writeText(value).catch(() => null);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

/** Shows how to finish a connection on the dealer's side. Never asks for their CRM login. */
function SetupDetails({ setup, feedPassword }) {
  if (!setup) return null;
  return (
    <div className="setup-details">
      <CopyField label="Lead email address" value={setup.address} />
      <CopyField label="Feed URL" value={setup.url} />
      <CopyField label="Feed username" value={setup.username} />
      {feedPassword && (
        <>
          <CopyField label="Feed password" value={feedPassword} />
          <Notice type="warning">
            Copy this password now. NovaCar stores only a fingerprint of it and can't show it again.
          </Notice>
        </>
      )}
      {!feedPassword && setup.username && setup.passwordSet && (
        <small>Password was shown once when this connection was created. Reconnect to generate a new one.</small>
      )}
      <CopyField label="Embed code" value={setup.embed} />
      {setup.formats && <small>Accepted formats: {setup.formats.join(", ")} (HTTP POST with basic auth).</small>}
      {setup.note && <small>{setup.note}</small>}
    </div>
  );
}

export function ConnectSystemModal({ catalog, onClose, onConnected }) {
  const [system, setSystem] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [notes, setNotes] = useState("");

  const connect = async (type) => {
    setBusy(type.type);
    setError("");
    try {
      const response = await crmApi.createConnection({ system: system.system, type: type.type, notes });
      setResult({ ...response, type });
      await onConnected();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy("");
    }
  };

  return (
    <Modal
      title={system ? `Connect ${system.name}` : "Connect dealership system"}
      eyebrow={system ? "Step 2 of 2 · Choose a connection" : "Step 1 of 2 · Choose your system"}
      onClose={onClose}
      size="large"
    >
      {!system && (
        <div className="system-grid">
          {catalog.map((entry) => (
            <button key={entry.system} type="button" className="system-card" onClick={() => setSystem(entry)}>
              <Plug size={18} />
              <strong>{entry.name}</strong>
              <small>
                {entry.types.filter((type) => type.availability === "AVAILABLE").map((type) => type.label).join(" · ") ||
                  "Partner access required"}
              </small>
            </button>
          ))}
        </div>
      )}
      {system && !result && (
        <div className="view-stack">
          <button type="button" className="text-button" onClick={() => setSystem(null)}>
            <ArrowLeft size={14} /> Choose a different system
          </button>
          <div className="connection-types">
            {system.types.map((type) => (
              <div key={type.type} className="connection-type">
                <div>
                  <strong>{type.label}</strong>
                  <span className={`availability ${type.availability.toLowerCase()}`}>
                    {AVAILABILITY_LABEL[type.availability]}
                  </span>
                  <p>{type.explanation}</p>
                </div>
                {type.availability === "AVAILABLE" && (
                  <button className="primary-button" disabled={Boolean(busy)} onClick={() => connect(type)}>
                    {busy === type.type ? <LoaderCircle className="spin" size={15} /> : <Link2 size={15} />} Connect
                  </button>
                )}
                {type.availability === "PENDING_PARTNER_APPROVAL" && (
                  <button className="secondary-button" disabled={Boolean(busy)} onClick={() => connect(type)}>
                    {busy === type.type ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />} Request access
                  </button>
                )}
                {type.availability === "NOT_APPLICABLE" && (
                  <button className="secondary-button" disabled>
                    Not applicable
                  </button>
                )}
              </div>
            ))}
          </div>
          {system.types.some((type) => type.availability === "PENDING_PARTNER_APPROVAL") && (
            <label className="form-grid-single">
              <span>Notes for the access request (optional)</span>
              <textarea value={notes} maxLength={1000} onChange={(event) => setNotes(event.target.value)} />
            </label>
          )}
          <Notice>
            NovaCar never asks for your {system.name} username or password. Connections use a lead address, a feed
            login NovaCar generates, or a vendor-approved API.
          </Notice>
          {error && <Notice type="error">{error}</Notice>}
        </div>
      )}
      {result && (
        <div className="view-stack">
          {result.accessRequested ? (
            <Notice type="success">
              Access requested. {system.name} must approve NovaCar as a partner before this connection can go live. It
              will show as Pending until then.
            </Notice>
          ) : (
            <Notice type="success">
              {result.type.label} added.{" "}
              {result.connection.status === "pending"
                ? "It will switch to Active when the first real data arrives."
                : "It is live now."}
            </Notice>
          )}
          <SetupDetails setup={result.connection.setup} feedPassword={result.feedPassword} />
          <div className="modal-actions">
            <button type="button" className="secondary-button" onClick={() => { setResult(null); }}>
              Add another connection
            </button>
            <button type="button" className="primary-button" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function ConnectionsPanel({ canManage }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState("");
  const [testResults, setTestResults] = useState({});

  const load = useCallback(async () => {
    if (!canManage) return;
    setError("");
    try {
      setData(await crmApi.connections());
    } catch (caught) {
      setError(caught.message);
    }
  }, [canManage]);
  useEffect(() => {
    load();
  }, [load]);

  const run = async (key, action) => {
    setBusy(key);
    setError("");
    try {
      await action();
      await load();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy("");
    }
  };

  if (!canManage)
    return (
      <section className="panel">
        <Notice>Only owners, administrators, and managers can manage dealership connections.</Notice>
      </section>
    );

  const visible = (data?.connections ?? []).filter((connection) => connection.status !== "disconnected");
  return (
    <section className="panel connections-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Leads and inventory</span>
          <h2>Dealership system connections</h2>
        </div>
        <div className="header-actions">
          <button className="secondary-button" onClick={load} aria-label="Refresh connections">
            <RefreshCw size={15} />
          </button>
          <button className="primary-button" disabled={!data} onClick={() => setOpen(true)}>
            <Plus size={15} /> Connect dealership system
          </button>
        </div>
      </div>
      {data && !data.inbound.emailConfigured && (
        <Notice type="warning">Inbound lead email is not configured on the platform yet, so ADF lead emails can't arrive.</Notice>
      )}
      {data && !data.inbound.smsConfigured && (
        <Notice type="warning">Texting isn't configured on the platform yet. Andy can't text customers until it is.</Notice>
      )}
      {error && <Notice type="error">{error}</Notice>}
      {!data && !error && <LoaderCircle className="spin" />}
      {data && !visible.length && <p className="muted">No systems connected yet.</p>}
      {visible.length > 0 && (
        <div className="table-scroll">
          <table className="connections-table">
            <thead>
              <tr>
                <th>System</th>
                <th>Type</th>
                <th>Status</th>
                <th>Last received</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((connection) => (
                <tr key={connection.id}>
                  <td data-label="System">{connection.systemName}</td>
                  <td data-label="Type">{connection.definition?.label ?? titleCase(connection.type)}</td>
                  <td data-label="Status">
                    <span className={`pill connection-${connection.status}`}>{STATUS_TEXT[connection.status]}</span>
                    {connection.last_error && <small className="connection-error">{connection.last_error}</small>}
                    {testResults[connection.id] && (
                      <small className={testResults[connection.id].ok ? "connection-ok" : "connection-error"}>
                        Test: {testResults[connection.id].detail}
                      </small>
                    )}
                  </td>
                  <td data-label="Last received">{when(connection.last_sync_at)}</td>
                  <td data-label="Actions" className="row-actions">
                    {connection.setup && (
                      <button
                        className="text-button"
                        onClick={() => setExpanded(expanded === connection.id ? "" : connection.id)}
                      >
                        Setup
                      </button>
                    )}
                    {connection.type !== "direct_api" && (
                      <button
                        className="text-button"
                        disabled={Boolean(busy)}
                        onClick={() =>
                          run(`test-${connection.id}`, async () => {
                            const { result } = await crmApi.testConnection(connection.id);
                            setTestResults((current) => ({ ...current, [connection.id]: result }));
                          })
                        }
                      >
                        {busy === `test-${connection.id}` ? <LoaderCircle className="spin" size={13} /> : <Send size={13} />}{" "}
                        Send test
                      </button>
                    )}
                    <button
                      className="text-button danger-text"
                      disabled={Boolean(busy)}
                      onClick={() =>
                        window.confirm(`Disconnect ${connection.systemName} ${connection.definition?.label ?? ""}?`) &&
                        run(`disconnect-${connection.id}`, () => crmApi.disconnectConnection(connection.id))
                      }
                    >
                      <Unplug size={13} /> Disconnect
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {expanded && <SetupDetails setup={visible.find((connection) => connection.id === expanded)?.setup} />}
      {data?.accessRequests?.length > 0 && (
        <small className="muted">
          Partner access requested: {[...new Set(data.accessRequests.map((request) => request.system))].map(titleCase).join(", ")}.
        </small>
      )}
      {open && data && <ConnectSystemModal catalog={data.catalog} onClose={() => setOpen(false)} onConnected={load} />}
    </section>
  );
}

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });

const WIZARD_STEPS = ["Dealership", "Hours", "Branding", "Team", "Connect", "Finish"];

/**
 * Add Dealership wizard. Runs for a new dealership's first login (onboarding)
 * and for the platform owner while logged in as a dealership.
 */
export function DealershipWizard({ session, onClose, onFinished }) {
  const dealership = session.dealership;
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState({
    name: dealership.name ?? "",
    address: dealership.address ?? "",
    phone: dealership.phone ?? "",
    timezone: dealership.timezone || "America/New_York",
  });
  const [hours, setHours] = useState(
    Object.keys(dealership.settings?.business_hours ?? {}).length ? dealership.settings.business_hours : DEFAULT_HOURS,
  );
  const [brand, setBrand] = useState({
    brandPrimary: dealership.brandPrimary || "#174c39",
    brandAccent: dealership.brandAccent || "#d9a441",
  });
  const [logoUrl, setLogoUrl] = useState(dealership.logoKey ? `/api/logo?d=${dealership.id}` : "");
  const [invites, setInvites] = useState([{ name: "", email: "", role: "sales" }]);
  const [inviteResults, setInviteResults] = useState(null);
  const [status, setStatus] = useState(null);
  const canAdmin = ["owner", "admin"].includes(session.member?.role);

  const saveAndNext = async (payload) => {
    setBusy(true);
    setError("");
    try {
      if (payload) await crmApi.saveSetup(payload);
      if (step + 1 === WIZARD_STEPS.length - 1) setStatus(await crmApi.setupStatus());
      setStep(step + 1);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  };

  const uploadLogo = async (file) => {
    if (!file) return;
    setError("");
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return setError("Use a PNG, JPEG, or WebP image.");
    if (file.size > 1024 * 1024) return setError("Logos must be 1 MB or smaller.");
    setBusy(true);
    try {
      const { logoUrl: url } = await crmApi.uploadLogo(await readFileAsDataUrl(file));
      setLogoUrl(url);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  };

  const sendInvites = async () => {
    const list = invites.filter((invite) => invite.email.trim());
    if (!list.length) return saveAndNext(null);
    setBusy(true);
    setError("");
    try {
      const { results } = await crmApi.inviteTeam(list);
      setInviteResults(results);
      if (results.every((result) => result.ok)) setInvites([{ name: "", email: "", role: "sales" }]);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    setError("");
    try {
      await crmApi.saveSetup({ complete: true });
      await onFinished();
    } catch (caught) {
      setError(caught.message);
      setBusy(false);
    }
  };

  const setDay = (day, value) => {
    const next = { ...hours };
    if (value) next[day] = value;
    else delete next[day];
    setHours(next);
  };

  return (
    <Modal title="Set up your dealership" eyebrow={`Step ${step + 1} of ${WIZARD_STEPS.length} · ${WIZARD_STEPS[step]}`} onClose={onClose} size="large">
      <ol className="wizard-steps" aria-label="Setup progress">
        {WIZARD_STEPS.map((name, index) => (
          <li key={name} className={index === step ? "current" : index < step ? "done" : ""}>
            {index < step ? <Check size={12} /> : index + 1} <span>{name}</span>
          </li>
        ))}
      </ol>
      {!canAdmin && <Notice>Only an owner or administrator can change dealership setup.</Notice>}

      {step === 0 && (
        <div className="form-grid">
          <label className="full-span">
            <span>Dealership name</span>
            <input required value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} />
          </label>
          <label className="full-span">
            <span>Address</span>
            <input value={profile.address} autoComplete="street-address" onChange={(event) => setProfile({ ...profile, address: event.target.value })} />
          </label>
          <label>
            <span>Main phone</span>
            <input type="tel" value={profile.phone} onChange={(event) => setProfile({ ...profile, phone: event.target.value })} />
          </label>
          <label>
            <span>Timezone</span>
            <select value={profile.timezone} onChange={(event) => setProfile({ ...profile, timezone: event.target.value })}>
              {[...new Set([profile.timezone, ...TIMEZONES])].map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace("America/", "").replace("Pacific/", "").replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {step === 1 && (
        <div className="hours-grid">
          <p className="muted">Appointments and Andy's booking offers stay inside these hours ({profile.timezone}).</p>
          {WEEKDAYS.map((name, day) => {
            const value = hours[day] ?? hours[String(day)];
            return (
              <div key={name} className="hours-row">
                <label className="checkbox-label">
                  <input type="checkbox" checked={Boolean(value)} onChange={(event) => setDay(day, event.target.checked ? ["09:00", "18:00"] : null)} />
                  <span>{name}</span>
                </label>
                {value ? (
                  <span className="hours-inputs">
                    <input type="time" aria-label={`${name} opens`} value={value[0]} onChange={(event) => setDay(day, [event.target.value, value[1]])} />
                    <span>to</span>
                    <input type="time" aria-label={`${name} closes`} value={value[1]} onChange={(event) => setDay(day, [value[0], event.target.value])} />
                  </span>
                ) : (
                  <span className="muted">Closed</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {step === 2 && (
        <div className="form-grid">
          <label className="full-span">
            <span>Logo (PNG, JPEG, or WebP, up to 1 MB)</span>
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => uploadLogo(event.target.files?.[0])} />
          </label>
          {logoUrl && <img className="logo-preview full-span" src={logoUrl} alt="Dealership logo" />}
          <label>
            <span>Primary color</span>
            <input type="color" value={brand.brandPrimary} onChange={(event) => setBrand({ ...brand, brandPrimary: event.target.value })} />
          </label>
          <label>
            <span>Accent color</span>
            <input type="color" value={brand.brandAccent} onChange={(event) => setBrand({ ...brand, brandAccent: event.target.value })} />
          </label>
          <div className="brand-preview full-span" style={{ background: brand.brandPrimary }}>
            <strong>{profile.name}</strong>
            <span style={{ background: brand.brandAccent }}>Book a visit</span>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="view-stack">
          {invites.map((invite, index) => (
            <div key={index} className="invite-row">
              <input placeholder="Name" aria-label="Name" value={invite.name} onChange={(event) => setInvites(invites.map((entry, position) => (position === index ? { ...entry, name: event.target.value } : entry)))} />
              <input type="email" placeholder="Email" aria-label="Email" value={invite.email} onChange={(event) => setInvites(invites.map((entry, position) => (position === index ? { ...entry, email: event.target.value } : entry)))} />
              <select aria-label="Role" value={invite.role} onChange={(event) => setInvites(invites.map((entry, position) => (position === index ? { ...entry, role: event.target.value } : entry)))}>
                {INVITE_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {titleCase(role)}
                  </option>
                ))}
              </select>
            </div>
          ))}
          <button type="button" className="text-button" onClick={() => setInvites([...invites, { name: "", email: "", role: "sales" }])}>
            <Plus size={14} /> Add another person
          </button>
          {inviteResults && (
            <ul className="invite-results">
              {inviteResults.map((result) => (
                <li key={result.email} className={result.ok ? "connection-ok" : "connection-error"}>
                  {result.email}: {result.ok ? (result.emailSent ? "invite email sent" : `added${result.note ? ` (${result.note})` : ""}`) : result.error}
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="secondary-button" disabled={busy || !canAdmin} onClick={sendInvites}>
            <Send size={15} /> Send invites
          </button>
        </div>
      )}

      {step === 4 && <ConnectionsPanel canManage={canAdmin || session.member?.role === "manager"} />}

      {step === 5 && (
        <div className="view-stack">
          {!status && <LoaderCircle className="spin" />}
          {status && (
            <>
              <p>{status.remaining ? `${status.remaining} item(s) still need attention. You can finish now and complete them later.` : "Everything is configured."}</p>
              <ul className="setup-checklist">
                {status.items.map((item) => (
                  <li key={item.key} className={item.done ? "done" : ""}>
                    {item.done ? <Check size={14} /> : <span className="dot" />} {item.label}
                    {!item.done && item.platform && <small> (handled by NovaCar)</small>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {error && <Notice type="error">{error}</Notice>}
      <div className="modal-actions">
        {step > 0 && (
          <button type="button" className="secondary-button" disabled={busy} onClick={() => setStep(step - 1)}>
            Back
          </button>
        )}
        {step === 0 && (
          <button className="primary-button" disabled={busy || !canAdmin || !profile.name.trim()} onClick={() => saveAndNext(profile)}>
            Save and continue
          </button>
        )}
        {step === 1 && (
          <button className="primary-button" disabled={busy || !canAdmin} onClick={() => saveAndNext({ businessHours: hours })}>
            Save and continue
          </button>
        )}
        {step === 2 && (
          <button className="primary-button" disabled={busy || !canAdmin} onClick={() => saveAndNext(brand)}>
            Save and continue
          </button>
        )}
        {(step === 3 || step === 4) && (
          <button className="primary-button" disabled={busy} onClick={() => saveAndNext(null)}>
            Continue
          </button>
        )}
        {step === 5 && (
          <button className="primary-button" disabled={busy || !canAdmin} onClick={finish}>
            Finish setup
          </button>
        )}
      </div>
    </Modal>
  );
}

const duration = (seconds) => {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 90) return `${seconds}s`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
  return `${Math.round(seconds / 3600)} hr`;
};

export function AnalyticsPanel() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setError("");
    crmApi
      .analytics(days)
      .then((payload) => !cancelled && setData(payload))
      .catch((caught) => !cancelled && setError(caught.message));
    return () => {
      cancelled = true;
    };
  }, [days]);
  const maxSource = Math.max(1, ...(data?.sources ?? []).map((source) => source.leads));
  return (
    <section className="panel analytics-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Performance</span>
          <h2>Analytics</h2>
        </div>
        <select aria-label="Analytics period" value={days} onChange={(event) => setDays(Number(event.target.value))}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>
      {error && <Notice type="error">{error}</Notice>}
      {!data && !error && <LoaderCircle className="spin" />}
      {data && (
        <>
          <div className="analytics-metrics">
            <div>
              <span>Median first response</span>
              <strong>{duration(data.responseTime.median_seconds)}</strong>
              <small>
                {data.responseTime.within_60s}/{data.responseTime.leads} leads answered within 60s
              </small>
            </div>
            <div>
              <span>Appointments set</span>
              <strong>{data.appointments.set}</strong>
              <small>{data.appointments.booked_by_andy} booked by Andy</small>
            </div>
            <div>
              <span>Show rate</span>
              <strong>{data.appointments.showRate === null ? "—" : `${data.appointments.showRate}%`}</strong>
              <small>
                {data.appointments.showed} showed · {data.appointments.missed} missed
              </small>
            </div>
            <div>
              <span>New leads</span>
              <strong>{data.responseTime.leads}</strong>
              <small>{data.responseTime.responded} responded to</small>
            </div>
          </div>
          <h3>Lead source</h3>
          {!data.sources.length && <p className="muted">No leads in this period.</p>}
          <ul className="source-bars">
            {data.sources.map((source) => (
              <li key={source.source}>
                <span>{titleCase(source.source)}</span>
                <i style={{ width: `${(source.leads / maxSource) * 100}%` }} />
                <b>
                  {source.leads} leads · {source.appointments} appts · {source.sold} sold
                </b>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
