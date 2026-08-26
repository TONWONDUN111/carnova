// Add this component to display lead submission form
// Add to src/ folder as LeadSubmissionForm.jsx

import React, { useState } from 'react';
import { Send, AlertCircle, CheckCircle } from 'lucide-react';

const LeadSubmissionForm = ({ onLeadSubmitted }) => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    vehicle_interest: '',
    budget: '',
    timeline: '',
    trade_in: ''
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState(null);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setMessage(null);

    try {
      const response = await fetch('/.netlify/functions/submit-lead', {
        method: 'POST',
        body: JSON.stringify(formData)
      });

      if (!response.ok) {
        throw new Error('Failed to submit lead');
      }

      const data = await response.json();
      setMessage({ type: 'success', text: 'Lead submitted! We\'ll be in touch soon.' });
      setFormData({
        name: '',
        email: '',
        phone: '',
        vehicle_interest: '',
        budget: '',
        timeline: '',
        trade_in: ''
      });

      if (onLeadSubmitted) {
        onLeadSubmitted(data.lead);
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Error submitting lead. Please try again.' });
      console.error('Submit error:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-md bg-white rounded-lg border border-gray-200 shadow-lg p-6">
      <h2 className="text-2xl font-semibold text-gray-900 mb-6">Get Started with CarNova</h2>
      
      {message && (
        <div className={`mb-4 p-3 rounded-lg flex items-start gap-2 ${
          message.type === 'success' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
        }`}>
          {message.type === 'success' ? (
            <CheckCircle size={20} className="mt-0.5 flex-shrink-0" />
          ) : (
            <AlertCircle size={20} className="mt-0.5 flex-shrink-0" />
          )}
          <p className="text-sm">{message.text}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
          <input
            type="text"
            name="name"
            value={formData.name}
            onChange={handleChange}
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
            placeholder="Your name"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
          <input
            type="email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
            placeholder="your@email.com"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
          <input
            type="tel"
            name="phone"
            value={formData.phone}
            onChange={handleChange}
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
            placeholder="(720) 555-0000"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Vehicle of Interest</label>
          <input
            type="text"
            name="vehicle_interest"
            value={formData.vehicle_interest}
            onChange={handleChange}
            required
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
            placeholder="e.g., Tesla Model 3"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Budget</label>
            <input
              type="text"
              name="budget"
              value={formData.budget}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="$20K-$40K"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Timeline</label>
            <select
              name="timeline"
              value={formData.timeline}
              onChange={handleChange}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
            >
              <option value="">Select...</option>
              <option value="this_week">This week</option>
              <option value="this_month">This month</option>
              <option value="this_quarter">This quarter</option>
              <option value="flexible">Flexible</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Trade-in?</label>
          <input
            type="text"
            name="trade_in"
            value={formData.trade_in}
            onChange={handleChange}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
            placeholder="Current vehicle make/model (optional)"
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition flex items-center justify-center gap-2 font-medium"
        >
          <Send size={18} />
          {isSubmitting ? 'Submitting...' : 'Submit Lead'}
        </button>
      </form>

      <p className="text-xs text-gray-500 mt-4 text-center">
        We'll contact you within 2 hours of business hours
      </p>
    </div>
  );
};

export default LeadSubmissionForm;
