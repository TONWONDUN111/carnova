import React, { useState, useRef, useEffect } from 'react';
import { MessageCircle, Calendar, CheckCircle, AlertCircle, Inbox, Users, BarChart3 } from 'lucide-react';
import SalesTeamSection from './SalesTeamSection';
import LeadSubmissionForm from './LeadSubmissionForm';

const CarNovaAIBDC = () => {
  const [activeTab, setActiveTab] = useState('bdc'); // bdc, team, submissions
  const [leads, setLeads] = useState([
    { id: 1, name: 'Mike Johnson', phone: '(720) 555-0142', source: 'Website', vehicle: 'Jeep Wrangler', status: 'active', temp: 'hot', lastContact: '2 min ago', assigned: 'Sarah Thompson' },
    { id: 2, name: 'Sarah Chen', phone: '(303) 555-0189', source: 'AutoTrader', vehicle: 'Tesla Model 3', status: 'active', temp: 'warm', lastContact: '15 min ago', assigned: 'Mike Chen' },
    { id: 3, name: 'James Martinez', phone: '(719) 555-0176', source: 'Facebook', vehicle: 'Ford F-150', status: 'ghost', temp: 'cold', lastContact: '3 days ago', assigned: 'Open' },
    { id: 4, name: 'Emma Wilson', phone: '(678) 555-0134', source: 'Cars.com', vehicle: 'Honda CR-V', status: 'sold', temp: 'closed', lastContact: '1 week ago', assigned: 'Jessica Rodriguez' },
  ]);

  const [selectedLead, setSelectedLead] = useState(leads[0]);
  const [chatMessages, setChatMessages] = useState([]);
  const [userInput, setUserInput] = useState('');
  const [isAIThinking, setIsAIThinking] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [selectedDate, setSelectedDate] = useState(null);
  const [extractedData, setExtractedData] = useState({});
  const [inboxOpen, setInboxOpen] = useState(false);
  const [newLeadsQueue, setNewLeadsQueue] = useState([
    { id: 5, name: 'Alex Rodriguez', phone: '(720) 555-0198', source: 'Phone', vehicle: 'Toyota Camry' },
    { id: 6, name: 'Lisa Kumar', phone: '(720) 555-0145', source: 'eBay Motors', vehicle: 'BMW 3 Series' },
  ]);
  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const dealrAPI = {
    checkAvailability: async (date) => {
      const slots = ['9:00 AM', '9:30 AM', '10:00 AM', '11:00 AM', '2:00 PM', '2:30 PM', '3:00 PM', '4:00 PM'];
      return slots;
    },
    createAppointment: async (leadId, time, date) => {
      return { appointmentId: `apt_${Date.now()}`, confirmed: true, reminder_sms_sent: true };
    },
    updateLead: async (leadId, data) => {
      setLeads(prev => prev.map(l => l.id === leadId ? { ...l, ...data } : l));
      return { success: true };
    },
    createTask: async (leadId, task) => {
      return { taskId: `tsk_${Date.now()}`, created: true };
    }
  };

  const handleUpdateLead = (leadId, data) => {
    dealrAPI.updateLead(leadId, data);
  };

  const sendMessage = async () => {
    if (!userInput.trim()) return;

    const newMessage = { role: 'user', text: userInput };
    setChatMessages(prev => [...prev, newMessage]);
    setUserInput('');
    setIsAIThinking(true);

    setTimeout(() => {
      const aiResponse = generateAIResponse(userInput, selectedLead);
      
      setChatMessages(prev => [...prev, {
        role: 'assistant',
        text: aiResponse.text,
        extracted: aiResponse.extracted
      }]);

      if (aiResponse.extracted && Object.keys(aiResponse.extracted).length > 0) {
        setExtractedData(aiResponse.extracted);
        dealrAPI.updateLead(selectedLead.id, aiResponse.extracted);
      }

      setIsAIThinking(false);
    }, 800);
  };

  const generateAIResponse = (input, lead) => {
    const responses = [
      {
        input: /hello|hi|good morning/i,
        text: `Hi ${lead.name}! 👋 Thanks for reaching out about the ${lead.vehicle}. I'm Emma with CarNova's BDC team. I can help you find the perfect vehicle and schedule a test drive. What's most important to you?`,
        extracted: {}
      },
      {
        input: /jeep|wrangler|budget|price/i,
        text: `Great! I see you're interested in the Jeep Wrangler. We have excellent 4WD models with solid off-road capability. What's your budget range, and are you looking to trade in?`,
        extracted: { vehicle: 'Jeep Wrangler', interest_level: 'high' }
      },
      {
        input: /today|tomorrow|this week|test drive|appointment/i,
        text: `Perfect! I can get you scheduled for a test drive. Let me pull up availability. What time works best for you?`,
        extracted: { ready_to_book: true, appointment_interest: true }
      },
      {
        input: /trade|finance|down payment/i,
        text: `Good question. We offer flexible financing and competitive trade-in appraisals. Can you tell me about your current vehicle and monthly payment comfort zone?`,
        extracted: { trade_in_interested: true }
      },
      {
        input: /./,
        text: `Thanks for that info! I'm tracking everything and our team will be ready for your visit. Any other questions?`,
        extracted: {}
      }
    ];

    const match = responses.find(r => r.input.test(input));
    return match || responses[responses.length - 1];
  };

  const handleBookAppointment = async (time) => {
    setIsAIThinking(true);
    const result = await dealrAPI.createAppointment(selectedLead.id, time, selectedDate);
    
    await dealrAPI.createTask(selectedLead.id, {
      type: 'call_if_no_show',
      scheduled_for: new Date(new Date(selectedDate).getTime() + 24 * 60 * 60 * 1000),
      description: 'Call if no-show on scheduled appointment'
    });

    setChatMessages(prev => [...prev, {
      role: 'assistant',
      text: `✅ Appointment confirmed for ${time} on ${selectedDate}! We've sent a confirmation SMS to ${selectedLead.phone}. See you then!`
    }]);

    setShowCalendar(false);
    setIsAIThinking(false);
  };

  const acceptInboxLead = async (lead) => {
    const updatedLead = { ...lead, status: 'active', temp: 'warm', assigned: 'Open' };
    setLeads(prev => [...prev, updatedLead]);
    setNewLeadsQueue(prev => prev.filter(l => l.id !== lead.id));
    
    setChatMessages([{
      role: 'assistant',
      text: `👋 New lead incoming! ${lead.name} from ${lead.source} is interested in the ${lead.vehicle}. Starting engagement now...`
    }]);
  };

  const handleLeadSubmitted = (newLead) => {
    setLeads(prev => [newLead, ...prev]);
  };

  const getStatusColor = (status) => {
    const colors = {
      'active': 'text-green-600 bg-green-50',
      'ghost': 'text-gray-600 bg-gray-100',
      'sold': 'text-green-600 bg-green-50',
      'hot': 'text-red-600 bg-red-50',
      'warm': 'text-amber-600 bg-amber-50',
      'cold': 'text-gray-500 bg-gray-100'
    };
    return colors[status] || 'text-gray-600 bg-gray-50';
  };

  // BDC Tab Content
  const BDCTab = () => (
    <div className="flex h-screen bg-gray-50">
      <div className="w-80 border-r border-gray-200 bg-white overflow-y-auto">
        <div className="p-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">CarNova BDC</h2>
            <p className="text-xs text-gray-500">Lead Manager</p>
          </div>
          <button
            onClick={() => setInboxOpen(!inboxOpen)}
            className="relative p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition"
          >
            <Inbox size={20} />
            {newLeadsQueue.length > 0 && (
              <span className="absolute top-0 right-0 bg-red-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">
                {newLeadsQueue.length}
              </span>
            )}
          </button>
        </div>

        {inboxOpen ? (
          <div className="p-4 space-y-3">
            <h3 className="font-semibold text-gray-900 mb-4">AI Inbox</h3>
            {newLeadsQueue.map(lead => (
              <div key={lead.id} className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="font-medium text-gray-900">{lead.name}</p>
                <p className="text-xs text-gray-600">{lead.source} • {lead.vehicle}</p>
                <button
                  onClick={() => acceptInboxLead(lead)}
                  className="mt-2 w-full px-3 py-1 bg-amber-600 text-white text-xs rounded hover:bg-amber-700 transition"
                >
                  Engage
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {leads.map(lead => (
              <button
                key={lead.id}
                onClick={() => {
                  setSelectedLead(lead);
                  setChatMessages([]);
                  setExtractedData({});
                }}
                className={`w-full p-4 text-left hover:bg-green-50 transition border-l-4 ${
                  selectedLead.id === lead.id ? 'bg-green-50 border-green-600' : 'border-transparent'
                }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <p className="font-medium text-gray-900">{lead.name}</p>
                  <span className={`text-xs px-2 py-1 rounded ${getStatusColor(lead.temp)}`}>
                    {lead.temp.charAt(0).toUpperCase() + lead.temp.slice(1)}
                  </span>
                </div>
                <p className="text-sm text-gray-600">{lead.vehicle}</p>
                <p className="text-xs text-gray-500 mt-1">{lead.source} • {lead.lastContact}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col">
        <div className="bg-white border-b border-gray-200 p-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">{selectedLead.name}</h1>
            <p className="text-sm text-gray-600">{selectedLead.phone} • {selectedLead.vehicle}</p>
          </div>
          <div className="flex gap-2">
            <span className={`text-xs px-3 py-1 rounded ${getStatusColor(selectedLead.status)}`}>
              {selectedLead.status.charAt(0).toUpperCase() + selectedLead.status.slice(1)}
            </span>
            <span className="text-xs px-3 py-1 bg-gray-100 text-gray-700 rounded">
              {selectedLead.assigned}
            </span>
          </div>
        </div>

        <div className="flex flex-1 gap-4 p-4 overflow-hidden">
          <div className="flex-1 flex flex-col bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {chatMessages.length === 0 && (
                <div className="flex items-center justify-center h-full text-gray-400">
                  <div className="text-center">
                    <MessageCircle size={32} className="mx-auto mb-2" />
                    <p>Start a conversation to engage this lead</p>
                  </div>
                </div>
              )}

              {chatMessages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-xs px-4 py-2 rounded-lg ${
                      msg.role === 'user'
                        ? 'bg-green-600 text-white rounded-br-none'
                        : 'bg-gray-100 text-gray-900 rounded-bl-none'
                    }`}
                  >
                    <p className="text-sm">{msg.text}</p>
                    {msg.extracted && Object.keys(msg.extracted).length > 0 && (
                      <div className="mt-2 text-xs opacity-75 border-t border-current pt-2">
                        {Object.entries(msg.extracted).map(([k, v]) => (
                          <div key={k}>✓ {k}: {String(v)}</div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {isAIThinking && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 text-gray-900 px-4 py-2 rounded-lg rounded-bl-none">
                    <div className="flex gap-1">
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="border-t border-gray-200 p-4">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                  placeholder="Ask about vehicles, schedule test drive..."
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                />
                <button
                  onClick={sendMessage}
                  disabled={isAIThinking}
                  className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50 transition"
                >
                  Send
                </button>
              </div>
            </div>
          </div>

          <div className="w-80 flex flex-col bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="p-4 border-b border-gray-200 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Calendar size={18} />
                Schedule Appointment
              </h3>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {!showCalendar ? (
                <button
                  onClick={() => setShowCalendar(true)}
                  className="w-full px-4 py-3 bg-green-50 text-green-600 rounded-lg hover:bg-green-100 transition font-medium mb-4"
                >
                  Pick Available Time
                </button>
              ) : (
                <div className="space-y-4">
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                  {selectedDate && (
                    <div className="grid grid-cols-2 gap-2">
                      {['9:00 AM', '9:30 AM', '10:00 AM', '11:00 AM', '2:00 PM', '2:30 PM', '3:00 PM', '4:00 PM'].map(time => (
                        <button
                          key={time}
                          onClick={() => handleBookAppointment(time)}
                          className="px-3 py-2 bg-green-50 text-green-700 hover:bg-green-100 border border-green-200 rounded text-sm transition"
                        >
                          {time}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-6 pt-6 border-t border-gray-200">
                <h4 className="font-semibold text-gray-900 mb-3 text-sm">Lead Insights</h4>
                <div className="space-y-2 text-sm">
                  <div className="flex items-start gap-2">
                    <MessageCircle size={16} className="text-green-600 mt-0.5" />
                    <div>
                      <p className="font-medium text-gray-900">Engaged</p>
                      <p className="text-gray-600">{chatMessages.length} messages</p>
                    </div>
                  </div>
                  {Object.keys(extractedData).length > 0 && (
                    <div className="flex items-start gap-2">
                      <CheckCircle size={16} className="text-green-600 mt-0.5" />
                      <div>
                        <p className="font-medium text-gray-900">Data Captured</p>
                        <p className="text-gray-600">{Object.keys(extractedData).length} fields</p>
                      </div>
                    </div>
                  )}
                  <div className="flex items-start gap-2">
                    <AlertCircle size={16} className="text-amber-600 mt-0.5" />
                    <div>
                      <p className="font-medium text-gray-900">Temp: {selectedLead.temp}</p>
                      <p className="text-gray-600">Ready for handoff</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="h-screen bg-gray-50 flex flex-col">
      {/* Navigation Tabs */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-8">
            <button
              onClick={() => setActiveTab('bdc')}
              className={`py-4 px-2 font-semibold text-sm border-b-2 transition ${
                activeTab === 'bdc'
                  ? 'text-green-600 border-green-600'
                  : 'text-gray-600 border-transparent hover:text-gray-900'
              }`}
            >
              <div className="flex items-center gap-2">
                <MessageCircle size={18} />
                AI BDC
              </div>
            </button>
            <button
              onClick={() => setActiveTab('team')}
              className={`py-4 px-2 font-semibold text-sm border-b-2 transition ${
                activeTab === 'team'
                  ? 'text-green-600 border-green-600'
                  : 'text-gray-600 border-transparent hover:text-gray-900'
              }`}
            >
              <div className="flex items-center gap-2">
                <Users size={18} />
                Sales Team
              </div>
            </button>
            <button
              onClick={() => setActiveTab('submissions')}
              className={`py-4 px-2 font-semibold text-sm border-b-2 transition ${
                activeTab === 'submissions'
                  ? 'text-green-600 border-green-600'
                  : 'text-gray-600 border-transparent hover:text-gray-900'
              }`}
            >
              <div className="flex items-center gap-2">
                <BarChart3 size={18} />
                Lead Submissions
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'bdc' && <BDCTab />}
        {activeTab === 'team' && <SalesTeamSection leads={leads} onUpdateLead={handleUpdateLead} />}
        {activeTab === 'submissions' && (
          <div className="p-8">
            <div className="max-w-2xl">
              <h2 className="text-2xl font-semibold text-gray-900 mb-2">Lead Submission Form</h2>
              <p className="text-gray-600 mb-6">Share this link with customers to submit their information</p>
              <LeadSubmissionForm onLeadSubmitted={handleLeadSubmitted} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CarNovaAIBDC;
