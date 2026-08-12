# CarNova AI BDC → dealr.cloud Integration Guide

## Setup (One-Time)

### 1. Get dealr.cloud Credentials
- Log into https://dealr.cloud
- Settings → Integrations → API Keys
- Generate new API key (keep secret)
- Copy your **dealr instance URL** (e.g., `https://YOUR-STORE.dealr.cloud`)

### 2. Environment Variables
```bash
REACT_APP_DEALR_API_KEY=xxx_your_api_key_xxx
REACT_APP_DEALR_INSTANCE=https://your-store.dealr.cloud
REACT_APP_CLAUDE_API_KEY=sk-ant-xxx_your_anthropic_key_xxx
```

### 3. Install Dependencies
```bash
npm install axios date-fns
```

---

## API Integration Layer

Replace the mock `dealrAPI` object in `carnova-ai-bdc.jsx` with this:

```javascript
// dealr-cloud-api.js
import axios from 'axios';

const dealrAPI = axios.create({
  baseURL: process.env.REACT_APP_DEALR_INSTANCE + '/api/v1',
  headers: {
    'Authorization': `Bearer ${process.env.REACT_APP_DEALR_API_KEY}`,
    'Content-Type': 'application/json'
  }
});

// Lead Management
export const leadAPI = {
  // Get all leads
  getLeads: async (filter = {}) => {
    const res = await dealrAPI.get('/crm/leads', { params: filter });
    return res.data.leads;
  },

  // Get single lead
  getLead: async (leadId) => {
    const res = await dealrAPI.get(`/crm/leads/${leadId}`);
    return res.data.lead;
  },

  // Update lead (auto-extraction from chat)
  updateLead: async (leadId, data) => {
    const res = await dealrAPI.patch(`/crm/leads/${leadId}`, {
      vehicle_of_interest: data.vehicle,
      trade_in_vehicle: data.trade_in,
      budget: data.budget,
      timeline: data.timeline,
      contact_preference: data.contact_preference,
      notes: data.notes,
      temperature: data.temp,
      status: data.status
    });
    return res.data;
  },

  // Create lead from inbox
  createLead: async (data) => {
    const res = await dealrAPI.post('/crm/leads', {
      first_name: data.name.split(' ')[0],
      last_name: data.name.split(' ')[1] || '',
      phone: data.phone,
      source: data.source,
      vehicle_of_interest: data.vehicle
    });
    return res.data.lead;
  }
};

// Calendar & Appointments
export const appointmentAPI = {
  // Check dealer availability
  getAvailability: async (date) => {
    const res = await dealrAPI.get('/calendar/availability', {
      params: { date }
    });
    return res.data.slots;
  },

  // Create appointment
  createAppointment: async (leadId, data) => {
    const res = await dealrAPI.post('/appointments', {
      lead_id: leadId,
      scheduled_time: data.time,
      scheduled_date: data.date,
      appointment_type: 'test_drive',
      notes: 'AI-scheduled via CarNova BDC'
    });
    
    if (res.data.appointmentId) {
      await smsAPI.sendConfirmation(leadId, res.data.appointmentId);
    }
    
    return res.data;
  },

  // Get appointments for date
  getAppointments: async (date) => {
    const res = await dealrAPI.get('/appointments', {
      params: { date }
    });
    return res.data.appointments;
  }
};

// Tasks (Auto-Generated Follow-ups)
export const taskAPI = {
  // Create task
  createTask: async (leadId, data) => {
    const res = await dealrAPI.post('/tasks', {
      lead_id: leadId,
      task_type: data.type,
      scheduled_for: data.scheduled_for,
      description: data.description,
      priority: data.priority || 'normal',
      assigned_to: 'ai_system'
    });
    return res.data;
  }
};

// SMS & Notifications
export const smsAPI = {
  // Send appointment confirmation
  sendConfirmation: async (leadId, appointmentId) => {
    const lead = await leadAPI.getLead(leadId);
    const res = await dealrAPI.post('/messaging/sms', {
      phone: lead.phone,
      template: 'appointment_confirmation',
      variables: {
        customer_name: lead.first_name,
        appointment_time: 'See appointment details'
      }
    });
    return res.data;
  },

  // Send follow-up sequences
  sendFollowUp: async (leadId, sequence) => {
    const res = await dealrAPI.post(`/messaging/sequences/${sequence}/send`, {
      lead_id: leadId
    });
    return res.data;
  }
};

// Claude AI Integration
export const claudeAPI = {
  chat: async (messages, systemPrompt) => {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.REACT_APP_CLAUDE_API_KEY,
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-1',
        max_tokens: 1024,
        system: systemPrompt,
        messages: messages
      })
    });

    const data = await response.json();
    return data.content[0].text;
  }
};
```

---

## Chat System Prompt

```javascript
const CARNOVA_BDC_PROMPT = `You are Emma, CarNova's AI business development representative. Your job is to:

1. **Engage naturally** - Ask one question at a time, listen
2. **Extract key data** - Capture: vehicle interest, budget, trade-in, timeline, preference
3. **Qualify gently** - Gauge urgency and interest level
4. **Move to appointment** - When interested, offer to schedule test drive

**Response format** - Include JSON block at end:
\`\`\`json
{
  "extracted_data": {
    "vehicle": "if mentioned",
    "budget": "if mentioned",
    "trade_in": "if mentioned",
    "timeline": "if mentioned",
    "ready_to_book": true/false,
    "temperature": "hot|warm|cold"
  }
}
\`\`\`

**Tone** - Friendly, knowledgeable, never pushy.`;
```

---

## Flow: Lead Message → AI Response → dealr.cloud Update

```javascript
const handleSendMessage = async (userMessage) => {
  // 1. Get lead context
  const lead = await leadAPI.getLead(selectedLeadId);
  
  // 2. Call Claude
  const messages = [
    ...chatHistory,
    { role: 'user', content: userMessage }
  ];
  
  const aiResponse = await claudeAPI.chat(messages, CARNOVA_BDC_PROMPT);
  
  // 3. Parse extracted data
  const jsonMatch = aiResponse.match(/\`\`\`json\n(.*?)\n\`\`\`/s);
  const extracted = jsonMatch ? JSON.parse(jsonMatch[1]) : {};
  
  // 4. Update lead in dealr.cloud
  if (Object.keys(extracted.extracted_data).length > 0) {
    await leadAPI.updateLead(selectedLeadId, extracted.extracted_data);
  }
  
  // 5. Display message
  setChatMessages(prev => [...prev, {
    role: 'assistant',
    text: aiResponse.split('```json')[0],
    extracted: extracted.extracted_data
  }]);
};
```

---

## Appointment Booking Flow

```javascript
const handleBookAppointment = async (time, date) => {
  // 1. Create appointment
  const apt = await appointmentAPI.createAppointment(selectedLeadId, {
    time,
    date
  });
  
  // 2. Auto-create follow-up tasks
  const tomorrow = new Date(new Date(date).getTime() + 24 * 60 * 60 * 1000);
  await taskAPI.createTask(selectedLeadId, {
    type: 'call_if_no_show',
    scheduled_for: tomorrow.toISOString(),
    description: `Call ${lead.phone} if no-show on ${date} at ${time}`,
    priority: 'high'
  });
  
  // 3. SMS confirmation (auto-sent by dealr.cloud)
  await smsAPI.sendConfirmation(selectedLeadId, apt.appointmentId);
  
  // 4. Show confirmation
  setChatMessages(prev => [...prev, {
    role: 'assistant',
    text: `✅ All set! Your test drive is booked for ${time} on ${date}. Reminder SMS coming 24 hours before.`
  }]);
};
```

---

## AI Inbox: Auto-Accept Leads

```javascript
const acceptLead = async (lead) => {
  // 1. Move to active
  await leadAPI.updateLead(lead.id, { status: 'active', temperature: 'warm' });
  
  // 2. Start AI conversation
  const greeting = await claudeAPI.chat(
    [{ role: 'user', content: `New lead: ${lead.first_name} from ${lead.source} interested in ${lead.vehicle_interest}` }],
    CARNOVA_BDC_PROMPT
  );
  
  setChatMessages([{
    role: 'assistant',
    text: greeting
  }]);
};
```

---

## Background Sequences: Re-engage Ghosted Leads

```javascript
export const ghostedLeadSequence = async () => {
  const ghosted = await leadAPI.getLeads({
    status: 'ghost',
    last_contact_before: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  });

  for (const lead of ghosted) {
    // Send new inventory SMS
    await smsAPI.sendFollowUp(lead.id, 'new_inventory_available');
    
    // Create re-engagement task
    await taskAPI.createTask(lead.id, {
      type: 'outbound_call',
      description: 'Re-engage ghosted lead',
      priority: 'normal'
    });
    
    // Mark as re-engaged
    await leadAPI.updateLead(lead.id, { status: 'active', temperature: 'cold' });
  }
};
```

---

## Compliance & Logging

### TCPA Opt-in Tracking
```javascript
const logSMSCompliance = (leadId, phone, template) => {
  dealrAPI.post('/compliance/sms_log', {
    lead_id: leadId,
    phone,
    template,
    timestamp: new Date(),
    user_consented: lead.sms_opted_in,
    consent_source: lead.consent_source
  });
};
```

---

## Testing Without dealr.cloud

```javascript
const USE_MOCK_API = process.env.NODE_ENV === 'development' && !process.env.REACT_APP_DEALR_API_KEY;

const dealrAPI = USE_MOCK_API ? mockDealrAPI : realDealrAPI;
```

---

## dealr.cloud API Endpoints (Reference)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/crm/leads` | List leads |
| PATCH | `/api/v1/crm/leads/{id}` | Update lead |
| POST | `/api/v1/appointments` | Book appointment |
| POST | `/api/v1/tasks` | Create task |
| POST | `/api/v1/messaging/sms` | Send SMS |

For full docs: https://dealr.cloud/help/developers
