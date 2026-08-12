# CarNova Lead Submission Setup

Enable customers to submit leads that email you automatically.

---

## Step 1: Add Lead Form to Your App

### 1.1 Copy Form Component
Copy `LeadSubmissionForm.jsx` to your project:
```bash
cp LeadSubmissionForm.jsx src/LeadSubmissionForm.jsx
```

### 1.2 Import in App
Add to `src/App.jsx`:

```javascript
import LeadSubmissionForm from './LeadSubmissionForm';

// Then in the JSX, add this wherever you want the form (e.g., new page/modal):
<LeadSubmissionForm onLeadSubmitted={(lead) => {
  // Lead submitted, you can add it to your leads list
  console.log('New lead:', lead);
}} />
```

**Or** add a route/tab to your navbar for "Submit Your Info" → opens form.

---

## Step 2: Set Up Email (Free)

### 2.1 Sign Up for Resend
- Go to https://resend.com
- Sign up (free tier gives 100 emails/day)
- Verify your domain (or use provided domain)
- Create API key in Settings

### 2.2 Add to Netlify Environment Variables
In Netlify:
1. Site → Settings → Build & Deploy → Environment
2. Add these secrets:
   ```
   RESEND_API_KEY=re_xxxxxxxxxxxxxxx
   DEALERSHIP_EMAIL=tonwondun@gmail.com
   ```

---

## Step 3: Deploy Netlify Function

### 3.1 Create Folder Structure
```bash
mkdir -p netlify/functions
cp submit-lead.js netlify/functions/submit-lead.js
```

### 3.2 Install Resend Dependency
```bash
npm install resend
```

### 3.3 Update package.json
Make sure build script stays:
```json
"scripts": {
  "build": "vite build"
}
```

Netlify auto-detects `netlify/functions/` folder.

### 3.4 Test Locally
```bash
npm install -g netlify-cli
netlify dev
```

Then submit a form at `http://localhost:8888` and check if emails arrive.

---

## Step 4: Deploy to Netlify

### Option A: Drag & Drop
```bash
npm run build
# Drag dist/ to app.netlify.com
```

Then add environment variables in Netlify dashboard.

### Option B: Git Push (Recommended)
```bash
git add .
git commit -m "Add lead submission"
git push
# Netlify auto-builds
```

---

## Testing Checklist

- [ ] Form appears in app (if you added it)
- [ ] Can submit form without errors
- [ ] Email arrives in your inbox (check spam folder)
- [ ] Lead confirmation email arrives at test email address
- [ ] Form clears after successful submission

---

## Email Setup Troubleshooting

### "RESEND_API_KEY is undefined"
- Copy your Resend API key
- Add to Netlify environment variables (Settings → Build & Deploy → Environment)
- **Redeploy** the site (just push a commit or retrigger build)

### "Email provider not configured"
- Verify API key is valid at https://resend.com
- Make sure key starts with `re_`

### "Emails not sending"
- Check spam folder
- Verify Resend domain is verified
- Check Resend dashboard for error logs

---

## Customize Email Template

Edit `netlify/functions/submit-lead.js` around line 20 to change:
- Email subject
- HTML content
- Sender email

Example:
```javascript
await resend.emails.send({
  from: 'CarNova Sales <sales@carnova.com>',  // Change this
  to: dealershipEmail,
  subject: `NEW: ${name} interested in ${vehicle_interest}`,  // Change this
  html: `...` // Edit HTML here
});
```

---

## Redirect Leads to Dashboard

After submission, optionally add them to your BDC dashboard:

In `LeadSubmissionForm.jsx`:
```javascript
onLeadSubmitted={(lead) => {
  // Add to leads list
  setLeads(prev => [lead, ...prev]);
  // Or navigate to the lead
  window.location.href = `/lead/${lead.id}`;
}}
```

---

## Scaling Up

For 100+ leads/day:
- Upgrade Resend (paid tier: $20/mo for unlimited)
- Add database to store leads (Firebase, Supabase, etc.)
- Set up CRM sync (dealr.cloud integration)

For now, emails → your inbox is the simplest.

---

## Summary

```bash
# 1. Add form & function
cp LeadSubmissionForm.jsx src/
cp submit-lead.js netlify/functions/

# 2. Get API key
# Sign up at resend.com, copy API key

# 3. Add to Netlify
# Site → Settings → Environment → Add RESEND_API_KEY

# 4. Deploy
git push
# Netlify auto-builds, functions ready

# Done!
```

Customers can now submit leads → You get emails instantly.

---

## API Reference

### POST /.netlify/functions/submit-lead

**Request:**
```json
{
  "name": "Mike Johnson",
  "email": "mike@example.com",
  "phone": "(720) 555-0142",
  "vehicle_interest": "Tesla Model 3",
  "budget": "$40K-$60K",
  "timeline": "this_month",
  "trade_in": "Honda CR-V"
}
```

**Response (Success):**
```json
{
  "message": "Lead submitted successfully",
  "lead": {
    "id": 1723481234567,
    "name": "Mike Johnson",
    "email": "mike@example.com",
    "phone": "(720) 555-0142",
    "status": "new",
    "temp": "warm",
    "created_at": "2026-08-12T08:00:00Z"
  }
}
```

**Response (Error):**
```json
{
  "error": "Missing required fields"
}
```

---

Next: [Optional] Integrate with dealr.cloud to auto-create leads there too.
