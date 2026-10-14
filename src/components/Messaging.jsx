import { useEffect, useState } from "react";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { crmApi } from "../services/api.js";
import { Notice } from "./ui.jsx";

const TONES = [
  ["friendly", "Friendly"],
  ["professional", "Professional"],
  ["direct", "Direct"],
];

/** "No consent" / "Consent" / "Opted out" badge for a lead. */
export function ConsentBadge({ lead }) {
  if (!lead?.phone && !lead?.phone_e164) return null;
  if (lead.opted_out)
    return <span className="consent-badge opted-out">Opted out</span>;
  return lead.has_consent ? (
    <span className="consent-badge yes">Consent</span>
  ) : (
    <span className="consent-badge no" title="No automated texts. Manual messages only.">
      No consent
    </span>
  );
}

/** Urgent keyword banner shown on a flagged conversation. */
export function UrgentBanner({ lead, onResolved }) {
  const [busy, setBusy] = useState(false);
  if (!lead?.urgent_flagged_at) return null;
  return (
    <div className="urgent-banner">
      <AlertTriangle size={18} />
      <div>
        <strong>URGENT: “{lead.urgent_keyword}”</strong>
        <p>{lead.urgent_message}</p>
      </div>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await crmApi.resolveUrgent(lead.id);
            await onResolved();
          } finally {
            setBusy(false);
          }
        }}
      >
        Clear flag
      </button>
    </div>
  );
}

/** Consent status, history and the manual-consent action for one lead. */
export function ConsentCard({ lead, onChanged }) {
  const [data, setData] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () =>
    crmApi
      .consents(lead.id)
      .then(setData)
      .catch((caught) => setError(caught.message));
  useEffect(() => {
    setData(null);
    setConfirming(false);
    setAgreed(false);
    setError("");
    load();
  }, [lead.id]);
  const active = data?.consents?.find((consent) => !consent.revoked_at);
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await crmApi.recordConsent(lead.id);
      setConfirming(false);
      await load();
      await onChanged();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="rail-card consent-card">
      <span className="eyebrow">Text consent (TCPA)</span>
      {!data && !error && <p className="muted">Loading…</p>}
      {data && (
        <>
          <p>
            <ConsentBadge
              lead={{ ...lead, has_consent: Boolean(active), opted_out: data.optedOut }}
            />
          </p>
          {data.optedOut ? (
            <small>This number replied STOP. No texts of any kind.</small>
          ) : active ? (
            <small>
              Given {new Date(active.created_at).toLocaleString()} via{" "}
              {active.source}
              {active.recorded_by_name ? ` (recorded by ${active.recorded_by_name})` : ""}
              {active.ip_address ? ` · IP ${active.ip_address}` : ""} · disclosure{" "}
              {active.disclosure_version}
            </small>
          ) : (
            <small>
              No automated texts (Andy, follow-ups, reminders). Manual messages only.
            </small>
          )}
          {!active && !data.optedOut && (lead.phone || lead.phone_e164) && (
            <>
              {!confirming ? (
                <button
                  className="secondary-button full"
                  onClick={() => setConfirming(true)}
                >
                  <ShieldCheck size={15} /> Record consent
                </button>
              ) : (
                <div className="consent-confirm">
                  <p className="disclosure">{data.disclosure.text}</p>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={agreed}
                      onChange={(event) => setAgreed(event.target.checked)}
                    />
                    <span>The customer agreed to this disclosure.</span>
                  </label>
                  <button
                    className="primary-button full"
                    disabled={!agreed || busy}
                    onClick={save}
                  >
                    {busy ? "Saving…" : "Save consent"}
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
      {error && <Notice type="error">{error}</Notice>}
    </section>
  );
}

const time = (value, fallback) => value || fallback;

/** Settings: automated texting switch, after-hours, sequence delays, chat widget. */
export function MessagingSettingsPanel({ session, canAdmin, onSaved }) {
  const dealership = session.dealership;
  const settings = dealership.settings ?? {};
  const sequence = settings.sequence ?? {};
  const widget = settings.widget ?? {};
  const [status, setStatus] = useState(null);
  const [form, setForm] = useState({
    automatedEnabled: settings.automated_texting?.enabled === true,
    cutoff: time(settings.after_hours?.cutoff, "21:00"),
    open: time(settings.after_hours?.open, "08:00"),
    text1: sequence.text1_minutes ?? 1,
    text2: sequence.text2_minutes ?? 120,
    text3: sequence.text3_minutes ?? 180,
    day2a: time(sequence.day2_times?.[0], "10:00"),
    day2b: time(sequence.day2_times?.[1], "16:00"),
    day3: time(sequence.day3_time, "11:00"),
    thankYou: time(sequence.thank_you_time, "11:00"),
    pauseDays: sequence.weekly_pause_days ?? 7,
    weekly: time(sequence.weekly_time, "11:00"),
    widgetEnabled: widget.enabled === true,
    tone: widget.tone || "friendly",
    chime: widget.chime !== false,
    greeting: widget.greeting || "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    crmApi
      .settings()
      .then((payload) => setStatus(payload.messaging ?? null))
      .catch(() => null);
  }, []);
  const set = (key) => (event) =>
    setForm({
      ...form,
      [key]: event.target.type === "checkbox" ? event.target.checked : event.target.value,
    });
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await crmApi.updateSettings({
        settings: {
          ...settings,
          automated_texting: { enabled: form.automatedEnabled },
          after_hours: { cutoff: form.cutoff, open: form.open },
          sequence: {
            text1_minutes: Number(form.text1),
            text2_minutes: Number(form.text2),
            text3_minutes: Number(form.text3),
            day2_times: [form.day2a, form.day2b],
            day3_time: form.day3,
            thank_you_time: form.thankYou,
            weekly_pause_days: Number(form.pauseDays),
            weekly_time: form.weekly,
          },
          widget: {
            enabled: form.widgetEnabled,
            tone: form.tone,
            chime: form.chime,
            greeting: form.greeting.trim(),
          },
        },
      });
      setNotice("Messaging settings saved.");
      await onSaved();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  };
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const snippet = dealership.inboundToken
    ? `<script src="${origin}/api/widget.js" data-dealer="${dealership.inboundToken}" async></script>`
    : "";
  const field = (key, labelText, props = {}) => (
    <label>
      <span>{labelText}</span>
      <input disabled={!canAdmin} value={form[key]} onChange={set(key)} {...props} />
    </label>
  );
  return (
    <form className="settings-panel panel messaging-settings" onSubmit={save}>
      <span className="eyebrow">Texting &amp; consent</span>
      <h2>Automated messaging</h2>
      <label className="checkbox-label">
        <input
          type="checkbox"
          disabled={!canAdmin}
          checked={form.automatedEnabled}
          onChange={set("automatedEnabled")}
        />
        <span>
          Send automated texts (Andy, follow-up sequence, reminders)
          <small>
            Off by default. Even when on, only leads with a consent record are
            texted, and never a number that replied STOP.
          </small>
        </span>
      </label>
      {status && (
        <ul className="messaging-status">
          <li className={status.twilioConfigured ? "ok" : "missing"}>
            Twilio texting {status.twilioConfigured ? "connected" : "not configured"}
          </li>
          <li className={status.emailConfigured ? "ok" : "missing"}>
            Owner email alerts {status.emailConfigured ? "connected" : "not configured (RESEND_API_KEY)"}
          </li>
          <li className={status.dealrCalendarConfigured ? "ok" : "missing"}>
            dealr.cloud calendar sync{" "}
            {status.dealrCalendarConfigured ? "connected" : "not configured: bookings are flagged for manual entry"}
          </li>
        </ul>
      )}
      <h3>After hours (lead's local time)</h3>
      <div className="form-grid">
        {field("cutoff", "No texts after", { type: "time" })}
        {field("open", "Resume at (or dealership opening, if later)", { type: "time" })}
      </div>
      <h3>Follow-up sequence</h3>
      <div className="form-grid">
        {field("text1", "Day 1 text 1 (minutes after lead)", { type: "number", min: 0, max: 1440 })}
        {field("text2", "Day 1 text 2 (minutes after lead)", { type: "number", min: 0, max: 1440 })}
        {field("text3", "Day 1 text 3 (minutes after lead)", { type: "number", min: 0, max: 1440 })}
        {field("day2a", "Day 2 first text", { type: "time" })}
        {field("day2b", "Day 2 second text", { type: "time" })}
        {field("day3", "Day 3 text", { type: "time" })}
        {field("thankYou", "Thank-you text (day 4)", { type: "time" })}
        {field("pauseDays", "Pause before weekly texts (days)", { type: "number", min: 0, max: 60 })}
        {field("weekly", "Weekly text time", { type: "time" })}
      </div>
      <h3>Website chat widget</h3>
      <label className="checkbox-label">
        <input
          type="checkbox"
          disabled={!canAdmin}
          checked={form.widgetEnabled}
          onChange={set("widgetEnabled")}
        />
        <span>Show the chat widget on the dealership website</span>
      </label>
      <div className="form-grid">
        <label>
          <span>Andy's tone</span>
          <select disabled={!canAdmin} value={form.tone} onChange={set("tone")}>
            {TONES.map(([value, name]) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox-label">
          <input type="checkbox" disabled={!canAdmin} checked={form.chime} onChange={set("chime")} />
          <span>Soft chime on greeting (visitors can mute it)</span>
        </label>
        <label className="full-span">
          <span>Greeting</span>
          <input
            disabled={!canAdmin}
            value={form.greeting}
            placeholder={`Hi! I'm Andy with ${dealership.name}. Looking for a specific vehicle?`}
            onChange={set("greeting")}
            maxLength={300}
          />
        </label>
      </div>
      {snippet && (
        <label className="full-span">
          <span>Embed code: paste before &lt;/body&gt; on the dealership site</span>
          <textarea className="embed-snippet" readOnly value={snippet} rows={2} />
        </label>
      )}
      {error && <Notice type="error">{error}</Notice>}
      {notice && <Notice type="success">{notice}</Notice>}
      <button className="primary-button" disabled={!canAdmin || busy}>
        {busy ? "Saving…" : "Save messaging settings"}
      </button>
    </form>
  );
}
