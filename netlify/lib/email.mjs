// Owner email alerts through Resend. The API key lives only in the
// RESEND_API_KEY environment variable and is never logged.

const DEFAULT_ALERT_EMAIL = "tonwondun@gmail.com";
const DEFAULT_FROM = "NovaCar AI <onboarding@resend.dev>";

export const emailConfigured = () => Boolean(process.env.RESEND_API_KEY);

export const ownerAlertEmail = () => process.env.OWNER_ALERT_EMAIL || DEFAULT_ALERT_EMAIL;

/** Sends a plain-text email. Returns { sent, id?, error? }; never throws. */
export const sendEmail = async ({ to = ownerAlertEmail(), subject, text, fetchImpl = fetch }) => {
  if (!emailConfigured()) return { sent: false, error: "RESEND_API_KEY is not set." };
  try {
    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || DEFAULT_FROM,
        to: [to],
        subject: String(subject).slice(0, 200),
        text,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("Alert email failed", { status: response.status });
      return { sent: false, error: payload?.message || `Resend returned ${response.status}.` };
    }
    return { sent: true, id: payload.id };
  } catch (error) {
    console.error("Alert email failed", error.message);
    return { sent: false, error: error.message };
  }
};
