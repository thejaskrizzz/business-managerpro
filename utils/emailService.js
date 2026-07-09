const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
const { generateQuotePDF, generateInvoicePDF } = require('./pdfGenerator');

// Email service configuration
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: process.env.EMAIL_PORT || 587,
    secure: process.env.EMAIL_SECURE === 'true', // true for 465, false for other ports
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
};

// Email templates
const getEmailTemplates = () => {
  return {
    quote: {
      subject: (quoteNumber, companyName) => `Quote ${quoteNumber} from ${companyName}`,
      html: (quoteData) => `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Quote ${quoteData.quoteNumber}</title>
          <style>
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 600px;
              margin: 0 auto;
              padding: 20px;
              background-color: #f8f9fb;
            }
            .container {
              background: white;
              border-radius: 12px;
              padding: 30px;
              box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
            }
            .header {
              text-align: center;
              margin-bottom: 30px;
              padding-bottom: 20px;
              border-bottom: 2px solid #e9ecef;
            }
            .logo {
              width: 80px;
              height: 80px;
              border-radius: 50%;
              margin: 0 auto 15px;
              background: linear-gradient(135deg, #99D9F9 0%, #FDD9DB 50%, #FEB1B3 100%);
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 24px;
              color: #1f2937;
            }
            .company-name {
              font-size: 24px;
              font-weight: 700;
              color: #374151;
              margin: 0;
            }
            .quote-title {
              font-size: 28px;
              font-weight: 600;
              color: #1f2937;
              margin: 20px 0;
              text-align: center;
            }
            .quote-info {
              background: #f8f9fb;
              padding: 20px;
              border-radius: 8px;
              margin: 20px 0;
            }
            .info-row {
              display: flex;
              justify-content: space-between;
              margin: 10px 0;
              padding: 8px 0;
              border-bottom: 1px solid #e9ecef;
            }
            .info-row:last-child {
              border-bottom: none;
            }
            .info-label {
              font-weight: 600;
              color: #6b7280;
            }
            .info-value {
              color: #374151;
            }
            .items-table {
              width: 100%;
              border-collapse: collapse;
              margin: 20px 0;
              background: white;
              border-radius: 8px;
              overflow: hidden;
              box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            }
            .items-table th {
              background: linear-gradient(135deg, #99D9F9 0%, #FDD9DB 100%);
              color: #1f2937;
              padding: 15px;
              text-align: left;
              font-weight: 600;
            }
            .items-table td {
              padding: 15px;
              border-bottom: 1px solid #e9ecef;
            }
            .items-table tr:last-child td {
              border-bottom: none;
            }
            .total-section {
              background: #f8f9fb;
              padding: 20px;
              border-radius: 8px;
              margin: 20px 0;
            }
            .total-row {
              display: flex;
              justify-content: space-between;
              margin: 8px 0;
              font-size: 16px;
            }
            .total-row.final {
              font-size: 20px;
              font-weight: 700;
              color: #1f2937;
              border-top: 2px solid #99D9F9;
              padding-top: 12px;
              margin-top: 12px;
            }
            .footer {
              text-align: center;
              margin-top: 30px;
              padding-top: 20px;
              border-top: 1px solid #e9ecef;
              color: #6b7280;
              font-size: 14px;
            }
            .cta-button {
              display: inline-block;
              background: linear-gradient(135deg, #99D9F9 0%, #FDD9DB 50%, #FEB1B3 100%);
              color: #1f2937;
              padding: 12px 24px;
              text-decoration: none;
              border-radius: 8px;
              font-weight: 600;
              margin: 20px 0;
            }
            .cta-button:hover {
              opacity: 0.9;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="logo">📋</div>
              <h1 class="company-name">${quoteData.company.name}</h1>
            </div>
            
            <h2 class="quote-title">Quote ${quoteData.quoteNumber}</h2>
            
            <div class="quote-info">
              <div class="info-row">
                <span class="info-label">Customer:</span>
                <span class="info-value">${quoteData.customer.firstName} ${quoteData.customer.lastName}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Quote Date:</span>
                <span class="info-value">${new Date(quoteData.createdAt).toLocaleDateString()}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Valid Until:</span>
                <span class="info-value">${new Date(quoteData.validUntil).toLocaleDateString()}</span>
              </div>
              <div class="info-row">
                <span class="info-label">Status:</span>
                <span class="info-value">${quoteData.status.charAt(0).toUpperCase() + quoteData.status.slice(1)}</span>
              </div>
            </div>
            
            ${quoteData.description ? `
              <div style="margin: 20px 0; padding: 15px; background: #f8f9fb; border-radius: 8px;">
                <h3 style="margin: 0 0 10px 0; color: #374151;">Description</h3>
                <p style="margin: 0; color: #6b7280;">${quoteData.description}</p>
              </div>
            ` : ''}
            
            <table class="items-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Quantity</th>
                  <th>Unit Price</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                ${quoteData.items.map(item => `
                  <tr>
                    <td>${item.description}</td>
                    <td>${item.quantity}</td>
                    <td>${formatCurrency(item.unitPrice, quoteData.company.settings?.currency || 'USD')}</td>
                    <td>${formatCurrency(item.total, quoteData.company.settings?.currency || 'USD')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
            
            <div class="total-section">
              <div class="total-row">
                <span>Subtotal:</span>
                <span>${formatCurrency(quoteData.subtotal, quoteData.company.settings?.currency || 'USD')}</span>
              </div>
              <div class="total-row">
                <span>Tax (${quoteData.taxRate}%):</span>
                <span>${formatCurrency(quoteData.taxAmount, quoteData.company.settings?.currency || 'USD')}</span>
              </div>
              <div class="total-row final">
                <span>Total:</span>
                <span>${formatCurrency(quoteData.total, quoteData.company.settings?.currency || 'USD')}</span>
              </div>
            </div>
            
            ${quoteData.terms ? `
              <div style="margin: 20px 0; padding: 15px; background: #f8f9fb; border-radius: 8px;">
                <h3 style="margin: 0 0 10px 0; color: #374151;">Terms & Conditions</h3>
                <p style="margin: 0; color: #6b7280;">${quoteData.terms}</p>
              </div>
            ` : ''}
            
            ${quoteData.notes ? `
              <div style="margin: 20px 0; padding: 15px; background: #f8f9fb; border-radius: 8px;">
                <h3 style="margin: 0 0 10px 0; color: #374151;">Notes</h3>
                <p style="margin: 0; color: #6b7280;">${quoteData.notes}</p>
              </div>
            ` : ''}
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/quotes/${quoteData._id}" class="cta-button">
                View Quote Online
              </a>
            </div>
            
            <div class="footer">
              <p>This quote was generated by ${quoteData.company.name}</p>
              <p>If you have any questions, please contact us at ${quoteData.company.email}</p>
              <p style="font-size: 12px; color: #9ca3af;">
                This quote is valid until ${new Date(quoteData.validUntil).toLocaleDateString()}
              </p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: (quoteData) => `
        Quote ${quoteData.quoteNumber} from ${quoteData.company.name}
        
        Customer: ${quoteData.customer.firstName} ${quoteData.customer.lastName}
        Quote Date: ${new Date(quoteData.createdAt).toLocaleDateString()}
        Valid Until: ${new Date(quoteData.validUntil).toLocaleDateString()}
        
        ${quoteData.description ? `Description: ${quoteData.description}\n` : ''}
        
        Items:
        ${quoteData.items.map(item => 
          `${item.description} - Qty: ${item.quantity} - Unit Price: ${formatCurrency(item.unitPrice, quoteData.company.settings?.currency || 'USD')} - Total: ${formatCurrency(item.total, quoteData.company.settings?.currency || 'USD')}`
        ).join('\n')}
        
        Subtotal: ${formatCurrency(quoteData.subtotal, quoteData.company.settings?.currency || 'USD')}
        Tax (${quoteData.taxRate}%): ${formatCurrency(quoteData.taxAmount, quoteData.company.settings?.currency || 'USD')}
        Total: ${formatCurrency(quoteData.total, quoteData.company.settings?.currency || 'USD')}
        
        ${quoteData.terms ? `Terms: ${quoteData.terms}\n` : ''}
        ${quoteData.notes ? `Notes: ${quoteData.notes}\n` : ''}
        
        View quote online: ${process.env.FRONTEND_URL || 'http://localhost:3000'}/quotes/${quoteData._id}
        
        This quote is valid until ${new Date(quoteData.validUntil).toLocaleDateString()}
        
        Contact: ${quoteData.company.email}
      `
    }
  };
};

// Currency formatting function
const formatCurrency = (amount, currency = 'USD') => {
  const currencySymbols = {
    USD: '$',
    EUR: '€',
    GBP: '£',
    CAD: 'C$',
    AUD: 'A$',
    AED: 'AED '
  };
  
  const symbol = currencySymbols[currency] || '$';
  return `${symbol}${amount.toFixed(2)}`;
};

// Helper function to replace {{placeholder}} tags
const replacePlaceholders = (text, data) => {
  if (!text) return '';
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return data[key] !== undefined ? data[key] : match;
  });
};

// Helper function to wrap message body in professional HTML structure
const wrapInEmailTemplate = (body, companyName) => {
  const formattedBody = body.replace(/\n/g, '<br/>');
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8f9fb; }
        .container { background: white; border-radius: 12px; padding: 30px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05); border: 1px solid #e9ecef; }
        .header { text-align: center; margin-bottom: 25px; padding-bottom: 15px; border-bottom: 2px solid #1e40af; }
        .company-name { font-size: 20px; font-weight: 700; color: #1e40af; }
        .message-body { font-size: 14px; color: #4b5563; line-height: 1.7; }
        .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #e9ecef; color: #9ca3af; font-size: 11px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <span class="company-name">${companyName}</span>
        </div>
        <div class="message-body">
          ${formattedBody}
        </div>
        <div class="footer">
          <p>This is an automated message from ${companyName}. Please do not reply directly to this email.</p>
        </div>
      </div>
    </body>
    </html>
  `;
};

// Send quote email
const sendQuoteEmail = async (quoteData, customerEmail) => {
  try {
    const transporter = createTransporter();
    
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.warn('Email credentials not configured. Skipping email send.');
      return { success: false, message: 'Email service not configured' };
    }

    const settings = quoteData.company.settings || {};
    const placeholderData = {
      customerName: `${quoteData.customer.firstName} ${quoteData.customer.lastName}`,
      quoteNumber: quoteData.quoteNumber,
      totalAmount: formatCurrency(quoteData.total, settings.currency || 'USD'),
      companyName: quoteData.company.name
    };

    const rawSubject = settings.quoteEmailSubject || 'Quote {{quoteNumber}} from {{companyName}}';
    const rawBody = settings.quoteEmailBody || 'Dear {{customerName}},\n\nPlease find attached the quote {{quoteNumber}} for your review.\n\nTotal: {{totalAmount}}\n\nThank you for your business!';

    const subject = replacePlaceholders(rawSubject, placeholderData);
    const body = replacePlaceholders(rawBody, placeholderData);
    const html = wrapInEmailTemplate(body, quoteData.company.name);

    // Generate PDF to attach
    console.log('Generating quote PDF attachment...');
    const pdfResult = await generateQuotePDF(quoteData, quoteData.company, quoteData.customer);
    
    const mailOptions = {
      from: `"${quoteData.company.name}" <${process.env.EMAIL_USER}>`,
      to: customerEmail,
      subject: subject,
      html: html,
      text: body,
      attachments: [
        {
          filename: pdfResult.filename || `quote-${quoteData.quoteNumber}.pdf`,
          content: pdfResult.buffer,
          contentType: pdfResult.isHtml ? 'text/html' : 'application/pdf'
        }
      ]
    };
    
    const result = await transporter.sendMail(mailOptions);
    console.log('Quote email sent successfully:', result.messageId);
    
    return {
      success: true,
      messageId: result.messageId,
      message: 'Quote email sent successfully'
    };
  } catch (error) {
    console.error('Error sending quote email:', error);
    return {
      success: false,
      error: error.message,
      message: 'Failed to send quote email'
    };
  }
};

// Send invoice email
const sendInvoiceEmail = async (invoiceData, customerEmail) => {
  try {
    const transporter = createTransporter();
    
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.warn('Email credentials not configured. Skipping email send.');
      return { success: false, message: 'Email service not configured' };
    }

    const settings = invoiceData.company.settings || {};
    const placeholderData = {
      customerName: `${invoiceData.customer.firstName} ${invoiceData.customer.lastName}`,
      invoiceNumber: invoiceData.invoiceNumber,
      totalAmount: formatCurrency(invoiceData.total, settings.currency || 'USD'),
      paidAmount: formatCurrency(invoiceData.paidAmount || 0, settings.currency || 'USD'),
      balanceDue: formatCurrency(invoiceData.total - (invoiceData.paidAmount || 0), settings.currency || 'USD'),
      companyName: invoiceData.company.name
    };

    const rawSubject = settings.invoiceEmailSubject || 'Invoice {{invoiceNumber}} from {{companyName}}';
    const rawBody = settings.invoiceEmailBody || 'Dear {{customerName}},\n\nPlease find attached the invoice {{invoiceNumber}} for your review.\n\nTotal: {{totalAmount}}\nAmount Paid: {{paidAmount}}\nBalance Due: {{balanceDue}}\n\nThank you for your business!';

    const subject = replacePlaceholders(rawSubject, placeholderData);
    const body = replacePlaceholders(rawBody, placeholderData);
    const html = wrapInEmailTemplate(body, invoiceData.company.name);

    // Generate PDF to attach
    console.log('Generating invoice PDF attachment...');
    const pdfResult = await generateInvoicePDF(invoiceData, invoiceData.company, invoiceData.customer);
    const pdfBuffer = pdfResult.isHtml ? pdfResult.buffer : pdfResult;
    const attachmentFilename = pdfResult.isHtml ? pdfResult.filename : `invoice-${invoiceData.invoiceNumber}.pdf`;
    const attachmentContentType = pdfResult.isHtml ? 'text/html' : 'application/pdf';

    const mailOptions = {
      from: `"${invoiceData.company.name}" <${process.env.EMAIL_USER}>`,
      to: customerEmail,
      subject: subject,
      html: html,
      text: body,
      attachments: [
        {
          filename: attachmentFilename,
          content: pdfBuffer,
          contentType: attachmentContentType
        }
      ]
    };
    
    const result = await transporter.sendMail(mailOptions);
    console.log('Invoice email sent successfully:', result.messageId);
    
    return {
      success: true,
      messageId: result.messageId,
      message: 'Invoice email sent successfully'
    };
  } catch (error) {
    console.error('Error sending invoice email:', error);
    return {
      success: false,
      error: error.message,
      message: 'Failed to send invoice email'
    };
  }
};

// Test email configuration
const testEmailConfiguration = async () => {
  try {
    const transporter = createTransporter();
    
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      return { success: false, message: 'Email credentials not configured' };
    }
    
    await transporter.verify();
    console.log('Email configuration is valid');
    return { success: true, message: 'Email configuration is valid' };
  } catch (error) {
    console.error('Email configuration test failed:', error);
    return { success: false, error: error.message, message: 'Email configuration test failed' };
  }
};

module.exports = {
  sendQuoteEmail,
  sendInvoiceEmail,
  testEmailConfiguration,
  formatCurrency
};

