// Create this file at: netlify/functions/submit-lead.js

import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { name, email, phone, vehicle_interest, budget, timeline, trade_in } = JSON.parse(event.body);

    // Validate required fields
    if (!name || !email || !phone || !vehicle_interest) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required fields' })
      };
    }

    // Email to you (dealership owner)
    const dealershipEmail = process.env.DEALERSHIP_EMAIL || 'tonwondun@gmail.com';

    // Send email to dealership
    await resend.emails.send({
      from: 'CarNova BDC <noreply@carnova-bdc.com>',
      to: dealershipEmail,
      subject: `New Lead: ${name} - ${vehicle_interest}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1f2937;">🚗 New Lead Submitted</h2>
          
          <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Contact Information</h3>
            <p><strong>Name:</strong> ${name}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Phone:</strong> ${phone}</p>
          </div>

          <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0;">Vehicle Interest</h3>
            <p><strong>Vehicle:</strong> ${vehicle_interest}</p>
            <p><strong>Budget:</strong> ${budget || 'Not specified'}</p>
            <p><strong>Timeline:</strong> ${timeline || 'Not specified'}</p>
            <p><strong>Trade-in:</strong> ${trade_in || 'No'}</p>
          </div>

          <p style="color: #6b7280; font-size: 14px;">
            Submitted via CarNova AI BDC • ${new Date().toLocaleString()}
          </p>
        </div>
      `
    });

    // Send confirmation email to lead
    await resend.emails.send({
      from: 'CarNova <noreply@carnova-bdc.com>',
      to: email,
      subject: 'We received your inquiry - CarNova',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #1f2937;">Thanks for your interest, ${name.split(' ')[0]}!</h2>
          
          <p>We received your inquiry about the <strong>${vehicle_interest}</strong>.</p>
          
          <p>Our team will review your information and get back to you within 2 hours during business hours.</p>

          <div style="background: #dbeafe; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0; border-radius: 4px;">
            <p style="margin: 0;"><strong>What's next?</strong></p>
            <p style="margin: 5px 0;">We'll call you at <strong>${phone}</strong> or email you with available times for a test drive.</p>
          </div>

          <p style="color: #6b7280; font-size: 14px;">
            CarNova Team<br/>
            Questions? Reply to this email or call us.
          </p>
        </div>
      `
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Lead submitted successfully',
        lead: {
          id: Date.now(),
          name,
          email,
          phone,
          vehicle_interest,
          budget,
          timeline,
          trade_in,
          status: 'new',
          temp: 'warm',
          created_at: new Date().toISOString()
        }
      })
    };
  } catch (error) {
    console.error('Error submitting lead:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to submit lead' })
    };
  }
};
