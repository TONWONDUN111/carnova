const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (statusCode, body) => ({
  statusCode,
  headers,
  body: JSON.stringify(body),
});

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not configured in Netlify.');
    return json(500, { error: 'AI service is not configured. Add ANTHROPIC_API_KEY in Netlify environment variables.' });
  }

  try {
    const payload = JSON.parse(event.body || '{}');
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const lead = payload.lead || {};

    const cleanMessages = messages
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-20)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));

    if (!cleanMessages.length || cleanMessages[cleanMessages.length - 1].role !== 'user') {
      return json(400, { error: 'A user message is required.' });
    }

    const system = `You are CarNova AI BDC, a professional automotive dealership internet sales and appointment assistant.

Your goals:
- Help shoppers with vehicle questions, pricing conversations, trade-ins, financing questions, and test drives.
- Be friendly, concise, confident, and sales-oriented without being pushy.
- Never invent inventory, prices, discounts, financing terms, availability, or dealership policies. If information is unavailable, say so and offer to have a salesperson confirm it.
- Move qualified shoppers toward a test-drive appointment.
- You can explain that appointment times shown in the UI are demo/placeholder times unless a real dealership calendar integration is connected.
- Do not claim an SMS, email, CRM update, or appointment was actually completed unless the application explicitly confirms it.
- Ask one useful follow-up question when it helps move the lead forward.

Current lead context:
Name: ${lead.name || 'Unknown'}
Phone: ${lead.phone || 'Unknown'}
Vehicle interest: ${lead.vehicle || 'Not specified'}
Lead source: ${lead.source || 'Website'}
Status: ${lead.status || 'new'}
Temperature: ${lead.temp || 'warm'}

Keep most responses under 120 words. Return plain text only.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 700,
        system,
        messages: cleanMessages,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Anthropic API error:', response.status, data);
      return json(response.status === 401 ? 502 : 502, {
        error: 'The AI service could not complete the request.',
        detail: process.env.NODE_ENV === 'development' ? data?.error?.message : undefined,
      });
    }

    const text = Array.isArray(data.content)
      ? data.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n').trim()
      : '';

    if (!text) return json(502, { error: 'The AI returned an empty response.' });

    return json(200, { text, model: data.model || MODEL });
  } catch (error) {
    console.error('Chat function error:', error);
    return json(500, { error: 'Unable to reach the AI service. Please try again.' });
  }
};
