import React, { useEffect, useRef, useState } from 'react';
import { Calendar, CheckCircle, Inbox, MessageCircle, Send, Sparkles, UserRound } from 'lucide-react';

const INITIAL_LEADS = [
  { id: 1, name: 'Mike Johnson', phone: '(720) 555-0142', source: 'Website', vehicle: 'Jeep Wrangler', status: 'active', temp: 'hot', lastContact: '2 min ago', assigned: 'Sarah Thompson' },
  { id: 2, name: 'Sarah Chen', phone: '(303) 555-0189', source: 'AutoTrader', vehicle: 'Tesla Model 3', status: 'active', temp: 'warm', lastContact: '15 min ago', assigned: 'Mike Chen' },
  { id: 3, name: 'James Martinez', phone: '(719) 555-0176', source: 'Facebook', vehicle: 'Ford F-150', status: 'ghost', temp: 'cold', lastContact: '3 days ago', assigned: 'Open' },
  { id: 4, name: 'Emma Wilson', phone: '(678) 555-0134', source: 'Cars.com', vehicle: 'Honda CR-V', status: 'sold', temp: 'closed', lastContact: '1 week ago', assigned: 'Jessica Rodriguez' },
];

const INBOX_START = [
  { id: 5, name: 'Alex Rodriguez', phone: '(720) 555-0198', source: 'Phone', vehicle: 'Toyota Camry' },
  { id: 6, name: 'Lisa Kumar', phone: '(720) 555-0145', source: 'eBay Motors', vehicle: 'BMW 3 Series' },
];

const statusClass = (value) => ({ active: 'text-green-700 bg-green-50', ghost: 'text-gray-600 bg-gray-100', sold: 'text-green-700 bg-green-50', hot: 'text-red-700 bg-red-50', warm: 'text-amber-700 bg-amber-50', cold: 'text-gray-600 bg-gray-100', closed: 'text-gray-600 bg-gray-100' }[value] || 'text-gray-600 bg-gray-100');

function App() {
  const [leads, setLeads] = useState(INITIAL_LEADS);
  const [selectedLead, setSelectedLead] = useState(INITIAL_LEADS[0]);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [date, setDate] = useState('');
  const [appointment, setAppointment] = useState(null);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [inbox, setInbox] = useState(INBOX_START);
  const [error, setError] = useState('');
  const endRef = useRef(null);

  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), [messages, thinking]);

  const selectLead = (lead) => { setSelectedLead(lead); setMessages([]); setAppointment(null); setError(''); setInboxOpen(false); };

  const sendMessage = async (event) => {
    event?.preventDefault();
    const text = input.trim();
    if (!text || thinking) return;
    const nextMessages = [...messages, { role: 'user', content: text }];
    setMessages(nextMessages); setInput(''); setError(''); setThinking(true);
    try {
      const response = await fetch('/.netlify/functions/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: nextMessages, lead: selectedLead }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'The AI service returned an error.');
      setMessages((current) => [...current, { role: 'assistant', content: data.text }]);
    } catch (err) {
      console.error(err); setError(err.message || 'Unable to send message.'); setMessages((current) => current.slice(0, -1));
    } finally { setThinking(false); }
  };

  const acceptLead = (lead) => {
    const newLead = { ...lead, status: 'active', temp: 'warm', lastContact: 'just now', assigned: 'Open' };
    setLeads((current) => [newLead, ...current]); setInbox((current) => current.filter((item) => item.id !== lead.id)); selectLead(newLead);
    setMessages([{ role: 'assistant', content: `Hi ${lead.name.split(' ')[0]}! I’m CarNova AI BDC. I see you’re interested in the ${lead.vehicle}. What would you like to know, and would you like to schedule a test drive?` }]);
  };

  const book = (time) => { if (!date) return; setAppointment({ date, time }); setMessages((current) => [...current, { role: 'assistant', content: `Great — I’ve selected ${time} on ${date} for ${selectedLead.name}. This demo calendar selection is ready for your real CRM/calendar integration.` }]); setCalendarOpen(false); };
  const times = ['9:00 AM', '9:30 AM', '10:00 AM', '11:00 AM', '2:00 PM', '2:30 PM', '3:00 PM', '4:00 PM'];

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 flex">
      <aside className="w-80 bg-white border-r border-gray-200 flex flex-col min-h-screen">
        <div className="p-5 border-b border-gray-200 flex items-center justify-between"><div><h1 className="text-xl font-bold">CarNova BDC</h1><p className="text-xs text-gray-500">AI Lead Manager</p></div><button aria-label="Open AI inbox" onClick={() => setInboxOpen((v) => !v)} className="relative p-2 rounded-lg hover:bg-gray-100"><Inbox size={20} />{inbox.length > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">{inbox.length}</span>}</button></div>
        {inboxOpen ? <div className="p-4 space-y-3 overflow-y-auto"><h2 className="font-semibold">AI Inbox</h2>{inbox.length === 0 && <p className="text-sm text-gray-500">No new leads.</p>}{inbox.map((lead) => <div key={lead.id} className="p-3 bg-amber-50 border border-amber-200 rounded-lg"><p className="font-medium">{lead.name}</p><p className="text-xs text-gray-600">{lead.source} · {lead.vehicle}</p><button onClick={() => acceptLead(lead)} className="mt-2 w-full py-2 bg-amber-600 text-white text-xs rounded-lg hover:bg-amber-700">Engage with AI</button></div>)}</div> : <div className="overflow-y-auto divide-y divide-gray-100">{leads.map((lead) => <button key={lead.id} onClick={() => selectLead(lead)} className={`w-full text-left p-4 border-l-4 hover:bg-green-50 ${selectedLead.id === lead.id ? 'bg-green-50 border-green-600' : 'border-transparent'}`}><div className="flex justify-between gap-2"><p className="font-medium">{lead.name}</p><span className={`text-xs px-2 py-1 rounded ${statusClass(lead.temp)}`}>{lead.temp}</span></div><p className="text-sm text-gray-600 mt-1">{lead.vehicle}</p><p className="text-xs text-gray-500 mt-1">{lead.source} · {lead.lastContact}</p></button>)}</div>}
      </aside>

      <main className="flex-1 flex flex-col min-h-screen">
        <header className="bg-white border-b border-gray-200 p-5 flex items-center justify-between"><div><h2 className="text-xl font-semibold">{selectedLead.name}</h2><p className="text-sm text-gray-600">{selectedLead.phone} · {selectedLead.vehicle}</p></div><div className="flex gap-2 items-center"><span className={`text-xs px-3 py-1 rounded ${statusClass(selectedLead.status)}`}>{selectedLead.status}</span><span className="text-xs px-3 py-1 bg-gray-100 rounded">{selectedLead.assigned}</span></div></header>
        <div className="flex-1 p-4 flex gap-4 overflow-hidden">
          <section className="flex-1 min-w-0 bg-white rounded-xl border border-gray-200 flex flex-col overflow-hidden">
            <div className="p-4 border-b border-gray-200 flex items-center gap-2"><Sparkles size={18} className="text-amber-600" /><div><p className="font-semibold">CarNova AI</p><p className="text-xs text-gray-500">Connected to Anthropic through Netlify</p></div></div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {messages.length === 0 && <div className="h-full flex items-center justify-center text-gray-400"><div className="text-center"><MessageCircle size={40} className="mx-auto mb-3" /><p>Start a real AI conversation with this lead.</p><p className="text-xs mt-1">Try: “What can you tell me about this vehicle?”</p></div></div>}
              {messages.map((message, index) => <div key={index} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[75%] rounded-xl px-4 py-3 ${message.role === 'user' ? 'bg-green-600 text-white rounded-br-sm' : 'bg-gray-100 rounded-bl-sm'}`}><p className="text-sm whitespace-pre-wrap">{message.content}</p></div></div>)}
              {thinking && <div className="flex"><div className="bg-gray-100 rounded-xl px-4 py-3"><div className="flex gap-1"><i className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"/><i className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:100ms]"/><i className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:200ms]"/></div></div></div>}
              {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">{error}</div>}<div ref={endRef} />
            </div>
            <form onSubmit={sendMessage} className="p-4 border-t border-gray-200 flex gap-2"><input value={input} onChange={(e) => setInput(e.target.value)} disabled={thinking} placeholder="Ask about vehicles, trade-ins, financing, appointments..." className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 disabled:bg-gray-100" /><button type="submit" disabled={!input.trim() || thinking} aria-label="Send message" className="px-5 py-3 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 flex items-center gap-2"><Send size={17} />Send</button></form>
          </section>
          <aside className="w-80 bg-white rounded-xl border border-gray-200 flex flex-col overflow-hidden">
            <div className="p-4 border-b border-gray-200 flex items-center gap-2"><Calendar size={18} /><h3 className="font-semibold">Schedule Appointment</h3></div>
            <div className="p-4 overflow-y-auto">
              {appointment && <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg"><div className="flex gap-2"><CheckCircle size={18} className="text-green-600" /><div><p className="font-semibold text-green-800">Appointment selected</p><p className="text-sm text-green-700">{appointment.date} · {appointment.time}</p></div></div></div>}
              {!calendarOpen ? <button onClick={() => setCalendarOpen(true)} className="w-full py-3 bg-green-50 text-green-700 rounded-lg hover:bg-green-100 font-medium">Pick Available Time</button> : <div className="space-y-4"><label className="block text-sm font-medium">Choose date<input type="date" value={date} min={new Date().toISOString().split('T')[0]} onChange={(e) => setDate(e.target.value)} className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg" /></label>{date && <div className="grid grid-cols-2 gap-2">{times.map((time) => <button key={time} onClick={() => book(time)} className="py-2 border border-gray-200 rounded-lg hover:border-green-500 hover:bg-green-50 text-sm">{time}</button>)}</div>}</div>}
              <div className="mt-6 pt-5 border-t border-gray-100 text-sm text-gray-500"><p className="font-medium text-gray-700 mb-2">Lead details</p><p><UserRound size={14} className="inline mr-1" />{selectedLead.name}</p><p className="mt-1">Vehicle: {selectedLead.vehicle}</p><p className="mt-1">Source: {selectedLead.source}</p></div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

export default App;
