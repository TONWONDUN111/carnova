import React, { useState } from 'react';
import { Users, TrendingUp, Clock, CheckCircle, MessageCircle, Phone } from 'lucide-react';

const SalesTeamSection = ({ leads, onUpdateLead }) => {
  const [selectedRep, setSelectedRep] = useState(null);
  const [showTeamList, setShowTeamList] = useState(true);
  const [teamMembers, setTeamMembers] = useState([
    { id: 1, name: 'Sarah Thompson', email: 'sarah@carnova.com', phone: '(720) 555-0101', role: 'Senior Sales Rep', status: 'active', assigned_leads: 12, appointments_booked: 8, conversion_rate: 0.67, calls_today: 14 },
    { id: 2, name: 'Mike Chen', email: 'mike@carnova.com', phone: '(720) 555-0102', role: 'Sales Rep', status: 'active', assigned_leads: 8, appointments_booked: 5, conversion_rate: 0.63, calls_today: 9 },
    { id: 3, name: 'Jessica Rodriguez', email: 'jessica@carnova.com', phone: '(720) 555-0103', role: 'Sales Rep', status: 'active', assigned_leads: 9, appointments_booked: 6, conversion_rate: 0.67, calls_today: 11 },
    { id: 4, name: 'David Kim', email: 'david@carnova.com', phone: '(720) 555-0104', role: 'BDC Manager', status: 'active', assigned_leads: 0, appointments_booked: 0, conversion_rate: 0, calls_today: 0 },
  ]);

  const [showAddRep, setShowAddRep] = useState(false);
  const [newRepForm, setNewRepForm] = useState({
    name: '',
    email: '',
    phone: '',
    role: 'Sales Rep'
  });

  const getRepLeads = (repId) => {
    return leads.filter(l => l.assigned === repId || (l.assigned === 'Open' && !repId));
  };

  const handleAssignLead = (leadId, repId) => {
    const rep = teamMembers.find(r => r.id === repId);
    onUpdateLead(leadId, { assigned: rep?.name || 'Open' });
  };

  const handleAddRep = () => {
    if (newRepForm.name && newRepForm.email && newRepForm.phone) {
      const newRep = {
        id: Date.now(),
        ...newRepForm,
        status: 'active',
        assigned_leads: 0,
        appointments_booked: 0,
        conversion_rate: 0,
        calls_today: 0
      };
      setTeamMembers([...teamMembers, newRep]);
      setNewRepForm({ name: '', email: '', phone: '', role: 'Sales Rep' });
      setShowAddRep(false);
    }
  };

  const removeRep = (repId) => {
    setTeamMembers(teamMembers.filter(r => r.id !== repId));
    if (selectedRep?.id === repId) setSelectedRep(null);
  };

  return (
    <div className="w-full bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Users size={24} className="text-green-600" />
            <div>
              <h2 className="text-2xl font-semibold text-gray-900">Sales Team</h2>
              <p className="text-sm text-gray-600">{teamMembers.length} active reps • {leads.length} leads</p>
            </div>
          </div>
          <button
            onClick={() => setShowAddRep(!showAddRep)}
            className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition text-sm font-medium"
          >
            + Add Sales Rep
          </button>
        </div>
      </div>

      {/* Add Rep Form */}
      {showAddRep && (
        <div className="bg-green-50 border-b border-blue-200 p-4">
          <div className="max-w-2xl">
            <h3 className="font-semibold text-gray-900 mb-3">Add New Sales Rep</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                type="text"
                placeholder="Full name"
                value={newRepForm.name}
                onChange={(e) => setNewRepForm({ ...newRepForm, name: e.target.value })}
                className="px-3 py-2 border border-green-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <input
                type="email"
                placeholder="Email"
                value={newRepForm.email}
                onChange={(e) => setNewRepForm({ ...newRepForm, email: e.target.value })}
                className="px-3 py-2 border border-green-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <input
                type="tel"
                placeholder="Phone"
                value={newRepForm.phone}
                onChange={(e) => setNewRepForm({ ...newRepForm, phone: e.target.value })}
                className="px-3 py-2 border border-green-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <select
                value={newRepForm.role}
                onChange={(e) => setNewRepForm({ ...newRepForm, role: e.target.value })}
                className="px-3 py-2 border border-green-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option>Sales Rep</option>
                <option>Senior Sales Rep</option>
                <option>BDC Manager</option>
                <option>Sales Manager</option>
              </select>
            </div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={handleAddRep}
                className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700 transition"
              >
                Save Rep
              </button>
              <button
                onClick={() => setShowAddRep(false)}
                className="px-3 py-1 bg-gray-300 text-gray-800 rounded text-sm hover:bg-gray-400 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex gap-4 p-4 max-w-7xl">
        {/* Team List / Leaderboard */}
        <div className="flex-1 bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="p-4 border-b border-gray-200 bg-gray-50">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp size={18} className="text-green-600" />
              <h3 className="font-semibold text-gray-900">Leaderboard</h3>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700">Rep Name</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700">Assigned</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700">Booked</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700">Close %</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700">Today</th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-700">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {teamMembers
                  .sort((a, b) => b.conversion_rate - a.conversion_rate)
                  .map((rep, idx) => (
                    <tr
                      key={rep.id}
                      onClick={() => setSelectedRep(rep)}
                      className={`hover:bg-gray-50 cursor-pointer ${selectedRep?.id === rep.id ? 'bg-green-50' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 bg-gradient-to-br from-blue-400 to-blue-600 text-white rounded-full flex items-center justify-center text-xs font-semibold">
                            {idx + 1}
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">{rep.name}</p>
                            <p className="text-xs text-gray-500">{rep.role}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-block px-2 py-1 bg-green-50 text-green-700 rounded text-sm font-semibold">
                          {rep.assigned_leads}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-block px-2 py-1 bg-green-50 text-green-700 rounded text-sm font-semibold">
                          {rep.appointments_booked}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-sm font-semibold text-gray-900">
                          {(rep.conversion_rate * 100).toFixed(0)}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Phone size={14} className="text-gray-400" />
                          <span className="text-sm font-semibold text-gray-700">{rep.calls_today}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeRep(rep.id);
                          }}
                          className="text-xs text-red-600 hover:text-red-800 font-medium"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Rep Details / Lead Assignment */}
        {selectedRep && (
          <div className="w-96 bg-white rounded-lg border border-gray-200 overflow-hidden flex flex-col">
            <div className="p-4 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-blue-100">
              <h3 className="font-semibold text-gray-900">{selectedRep.name}</h3>
              <p className="text-xs text-gray-600">{selectedRep.role}</p>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {/* Rep Info */}
              <div className="mb-4 pb-4 border-b border-gray-200">
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <MessageCircle size={16} className="text-gray-400" />
                    <span className="text-gray-600">{selectedRep.email}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Phone size={16} className="text-gray-400" />
                    <span className="text-gray-600">{selectedRep.phone}</span>
                  </div>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-2 mb-4 pb-4 border-b border-gray-200">
                <div className="bg-green-50 p-3 rounded">
                  <p className="text-xs text-gray-600">Leads</p>
                  <p className="text-lg font-semibold text-green-600">{selectedRep.assigned_leads}</p>
                </div>
                <div className="bg-green-50 p-3 rounded">
                  <p className="text-xs text-gray-600">Booked</p>
                  <p className="text-lg font-semibold text-green-600">{selectedRep.appointments_booked}</p>
                </div>
              </div>

              {/* Assigned Leads */}
              <h4 className="font-semibold text-gray-900 mb-3 text-sm">Assigned Leads</h4>
              <div className="space-y-2">
                {getRepLeads(selectedRep.id).length === 0 ? (
                  <p className="text-xs text-gray-500 text-center py-4">No leads assigned</p>
                ) : (
                  getRepLeads(selectedRep.id).map(lead => (
                    <div key={lead.id} className="p-2 bg-gray-50 rounded text-sm">
                      <p className="font-medium text-gray-900">{lead.name}</p>
                      <p className="text-xs text-gray-600">{lead.vehicle}</p>
                      <span className={`text-xs px-2 py-0.5 rounded inline-block mt-1 ${
                        lead.temp === 'hot' ? 'bg-red-50 text-red-700' :
                        lead.temp === 'warm' ? 'bg-amber-50 text-amber-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>
                        {lead.temp}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SalesTeamSection;
