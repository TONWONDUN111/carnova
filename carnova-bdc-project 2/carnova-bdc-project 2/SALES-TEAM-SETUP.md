# Sales Team Section - Setup Guide

Add a complete Sales Team management dashboard to CarNova BDC with leaderboards, rep assignment, and performance tracking.

---

## What's Included

### Components
- **SalesTeamSection.jsx** — Full sales team management with:
  - Leaderboard (sorted by conversion rate)
  - Add/remove sales reps
  - Assign leads to reps
  - Track rep performance metrics
  - View rep contact info

### Updated App
- **App-with-sales-team.jsx** — Tabbed navigation:
  - AI BDC (existing)
  - Sales Team (new)
  - Lead Submissions (new)

---

## Installation

### Option 1: Quick Add (5 min)

#### 1.1 Copy Components
```bash
cp SalesTeamSection.jsx src/
cp LeadSubmissionForm.jsx src/  # If not already there
```

#### 1.2 Replace App.jsx
```bash
cp App-with-sales-team.jsx src/App.jsx
```

#### 1.3 Restart
```bash
npm run dev
```

Done! Now you have three tabs: AI BDC → Sales Team → Lead Submissions

---

## Features

### Sales Team Leaderboard
- Ranked by close rate (conversion %)
- Shows assigned leads count
- Shows appointments booked
- Shows calls made today
- Click any rep to see their details & assigned leads

### Manage Reps
- **Add new rep** — Name, email, phone, role
- **Remove rep** — One-click deletion
- **Rep roles:** Sales Rep, Senior Sales Rep, BDC Manager, Sales Manager

### Assign Leads
- Drag & drop (via BDC tab) or assign in lead details
- Track which rep has which leads
- See rep workload at a glance

### Metrics Tracked
- **Assigned Leads** — How many leads assigned
- **Appointments Booked** — How many closed the deal
- **Close Rate %** — Appointments booked / Assigned leads
- **Calls Today** — Real-time activity tracking

---

## Default Sales Team

Pre-loaded with 4 reps:
1. **Sarah Thompson** (Senior Sales Rep) — 67% close rate, 12 leads
2. **Mike Chen** (Sales Rep) — 63% close rate, 8 leads
3. **Jessica Rodriguez** (Sales Rep) — 67% close rate, 9 leads
4. **David Kim** (BDC Manager) — 0 leads (management role)

You can modify these in the component state.

---

## Add Your Own Reps

### Via UI (Easiest)
1. Click "+ Add Sales Rep" button
2. Fill in: Name, Email, Phone, Role
3. Click "Save Rep"
4. Rep appears in leaderboard

### Via Code
Edit `SalesTeamSection.jsx`, find `useState([` and add to array:

```javascript
{ 
  id: 5, 
  name: 'Your Name', 
  email: 'email@carnova.com', 
  phone: '(720) 555-xxxx', 
  role: 'Sales Rep', 
  status: 'active', 
  assigned_leads: 0, 
  appointments_booked: 0, 
  conversion_rate: 0, 
  calls_today: 0 
}
```

---

## Customize Metrics

Edit metrics in `generateAIResponse()` to auto-populate real data from Claude/dealr.cloud:

```javascript
const assignedCount = leads.filter(l => l.assigned === rep.id).length;
const bookedCount = leads.filter(l => l.assigned === rep.id && l.status === 'booked').length;
const rate = bookedCount / assignedCount || 0;

return {
  assigned_leads: assignedCount,
  appointments_booked: bookedCount,
  conversion_rate: rate,
  calls_today: rep.calls_today
};
```

---

## Integration Points

### Connect to dealr.cloud
The Sales Team section can auto-pull rep data from dealr.cloud API:

```javascript
// In SalesTeamSection.jsx
useEffect(() => {
  const fetchReps = async () => {
    const reps = await fetch(`${DEALR_INSTANCE}/api/v1/team/reps`)
      .then(r => r.json());
    setTeamMembers(reps);
  };
  fetchReps();
}, []);
```

### Sync Lead Assignments
When you assign a lead to a rep in the Sales Team tab, it auto-updates in the BDC tab:

```javascript
const handleAssignLead = (leadId, repId) => {
  const rep = teamMembers.find(r => r.id === repId);
  onUpdateLead(leadId, { assigned: rep?.name || 'Open' });
};
```

---

## Styling Customization

### Change Colors
All colors use Tailwind classes. Update in `SalesTeamSection.jsx`:

- `bg-blue-50 / text-blue-600` — Primary (blue)
- `bg-green-50 / text-green-600` — Success (green)
- `bg-red-50 / text-red-600` — Alert (red)
- `bg-amber-50 / text-amber-600` — Warning (amber)

Example: Change primary to purple
```jsx
// Replace all 'blue-600' with 'purple-600'
// Replace all 'bg-blue-50' with 'bg-purple-50'
```

---

## Tab Navigation

The updated `App.jsx` uses three tabs:

| Tab | Component | Purpose |
|-----|-----------|---------|
| AI BDC | BDCTab() | Lead conversations (original) |
| Sales Team | SalesTeamSection | Rep management & leaderboard |
| Lead Submissions | LeadSubmissionForm | Customer lead form |

Add more tabs by:
```javascript
const [activeTab, setActiveTab] = useState('bdc');

// Add button
<button onClick={() => setActiveTab('new-tab')}>New Tab</button>

// Add content
{activeTab === 'new-tab' && <YourComponent />}
```

---

## Performance Metrics Explained

### Close Rate %
```
Close Rate = Appointments Booked / Assigned Leads
```
- 8/12 = 67% — Strong performer
- Highest rate appears at top of leaderboard

### Calls Today
- Real-time counter of outbound calls
- Updates as rep make contact with leads
- Resets daily

### Assigned Leads
- Active leads under that rep
- Leads with status "ghost" or "sold" don't count

---

## Troubleshooting

### "SalesTeamSection is not defined"
- Make sure `SalesTeamSection.jsx` is in `src/` folder
- Check import line in App.jsx:
  ```javascript
  import SalesTeamSection from './SalesTeamSection';
  ```

### Tab switching doesn't work
- Verify `activeTab` state is updating
- Check onClick handlers are correct:
  ```javascript
  onClick={() => setActiveTab('team')}
  ```

### Leads not showing in rep detail panel
- Make sure leads have `assigned` field set to rep name
- Check rep name matches exactly (case-sensitive)
- In BDC tab, assigned field should be rep name, not rep ID

### Metrics not updating
- Metrics are mocked. To use real data:
  - Connect dealr.cloud API
  - Pull lead count & status from database
  - Update metrics after each lead action

---

## Next Steps

1. **Deploy:** Push updated code to Netlify
2. **Add dealr.cloud sync:** Auto-pull rep list & performance data
3. **Add reporting:** Monthly/quarterly metrics dashboard
4. **Mobile view:** Make leaderboard responsive for mobile
5. **Export data:** Download rep metrics as CSV

---

## Code Structure

```
src/
├── App.jsx (NEW - with tabs)
├── SalesTeamSection.jsx (NEW)
├── LeadSubmissionForm.jsx (existing)
├── main.jsx (unchanged)
└── [other files]
```

---

## Summary

```bash
# 1. Copy new components
cp SalesTeamSection.jsx src/
cp App-with-sales-team.jsx src/App.jsx

# 2. Test locally
npm run dev

# 3. Deploy
npm run build
# Drag dist/ to Netlify
```

You now have:
- ✅ AI BDC dashboard (existing)
- ✅ Sales Team leaderboard (new)
- ✅ Lead submission form (existing)
- ✅ Full rep management (new)

---

**Questions?** Check the component source code for inline comments and customization options.
