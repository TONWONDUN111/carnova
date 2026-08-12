# CarNova AI BDC - Quick Start

## Run Locally (Right Now)

### 1. Install
```bash
npm create vite@latest carnova-bdc -- --template react
cd carnova-bdc
npm install lucide-react
```

### 2. Replace `src/App.jsx`
Paste contents of `carnova-ai-bdc.jsx` into `src/App.jsx`

### 3. Start Dev Server
```bash
npm run dev
```

Open http://localhost:5173 — full CarNova AI BDC dashboard ready.

**Works out of the box:**
- Lead list with filtering
- AI chat (simulated)
- Appointment calendar
- AI inbox for new leads
- Task auto-generation
- Hot/warm/cold tracking

---

## Add Real Claude API (10 min)

### 1. Get API Key
- https://console.anthropic.com
- Create API key

### 2. Set Environment Variable
Create `.env.local`:
```
VITE_CLAUDE_API_KEY=sk-ant-xxx-your-key-xxx
```

### 3. Update Component
At top of `src/App.jsx`:

```javascript
const CLAUDE_API_KEY = import.meta.env.VITE_CLAUDE_API_KEY;

const callClaude = async (messages) => {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': CLAUDE_API_KEY,
      'content-type': 'application/json',
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-opus-4-1',
      max_tokens: 512,
      system: 'You are Emma, CarNova\'s AI BDC. Help customers find vehicles and book test drives.',
      messages: messages
    })
  });
  const data = await res.json();
  return data.content[0].text;
};
```

### 4. Restart Dev Server
```bash
npm run dev
```

Now chat responses come from real Claude.

---

## Connect dealr.cloud (30 min)

### 1. Get dealr.cloud API Key
- Log into https://dealr.cloud
- Settings → Integrations → API Keys
- Generate key, copy it

### 2. Add to `.env.local`
```
VITE_DEALR_API_KEY=xxx_your_key_xxx
VITE_DEALR_INSTANCE=https://your-store.dealr.cloud
VITE_CLAUDE_API_KEY=sk-ant-xxx_your_claude_key_xxx
```

### 3. Install Axios
```bash
npm install axios
```

### 4. Create `src/dealr-api.js`
Copy the integration code from `DEALR-INTEGRATION.md` into a new file.

### 5. Import in `src/App.jsx`
Replace mock `dealrAPI` with real imports.

### 6. Test
- Create test lead in dealr.cloud
- Select it in CarNova BDC
- Send message, watch lead update in real-time
- Book appointment, confirm SMS

---

## Deploy to Netlify

### 1. Build
```bash
npm run build
```

### 2. Deploy
- Go to https://app.netlify.com
- Drag & drop `dist/` folder
- Done

### 3. Set Environment Variables
In Netlify:
- Site Settings → Build & Deploy → Environment
- Add `VITE_CLAUDE_API_KEY`
- Add `VITE_DEALR_API_KEY`
- Add `VITE_DEALR_INSTANCE`
- Redeploy

---

## Deploy to Vercel

```bash
npm install -g vercel
vercel --prod
```

Set environment variables in Vercel dashboard.

---

## Test Checklist

- [ ] Chat sends/receives messages
- [ ] Lead list shows 4+ leads
- [ ] Selecting lead resets chat
- [ ] Calendar picker opens & closes
- [ ] Picking time shows confirmation
- [ ] AI Inbox shows new leads
- [ ] Accept lead adds to list
- [ ] Hot/warm/cold badges styled
- [ ] No console errors (F12)

---

## Troubleshooting

### "Cannot find module axios"
```bash
npm install axios
```

### "VITE_CLAUDE_API_KEY is undefined"
- Check `.env.local` exists in project root
- Verify line: `VITE_CLAUDE_API_KEY=sk-ant-xxx`
- Restart dev server: `npm run dev`
- Check in browser: `import.meta.env.VITE_CLAUDE_API_KEY`

### "dealr.cloud API 401"
- Verify API key is valid in dealr.cloud settings
- Check instance URL matches (e.g., `https://denver.dealr.cloud`)
- Ensure Bearer token in headers

### Chat not responding
- Open browser console (F12)
- Check for fetch errors
- Verify Claude API key works: `curl -H "x-api-key: $KEY" https://api.anthropic.com/v1/messages`

### Appointments not showing
- In mock mode (no dealr.cloud key), always shows 8 slots
- Real mode pulls from your calendar availability

---

## Performance Tips

- Lazy-load chat history (fetch last 20 messages only)
- Debounce lead updates (500ms after user stops typing)
- Cache appointment slots (refresh once per day)
- Use dealr.cloud webhooks (instead of polling)

---

## Next Features

1. **Multi-location dashboard** - Compare metrics across dealerships
2. **Team leaderboard** - Top performers, rep activity
3. **Video call** - Zoom/Twilio in appointment
4. **Vehicle search** - Query inventory in chat
5. **Trade-in appraisal** - VIN decoder + instant value
6. **Finance calculator** - Show payment estimates
7. **Mobile app** - React Native version

---

## Support

- **Setup issues?** Check `DEALR-INTEGRATION.md`
- **Claude API questions?** https://support.anthropic.com
- **dealr.cloud help?** support@dealr.cloud

**You're live.** 🚀
