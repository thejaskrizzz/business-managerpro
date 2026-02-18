const puppeteer = require('puppeteer');
const htmlPdf = require('html-pdf-node');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { promisify } = require('util');

// PDF generation options
const PDF_OPTIONS = {
  format: 'A4',
  printBackground: true,
  margin: {
    top: '20mm',
    right: '10mm',
    bottom: '20mm',
    left: '10mm'
  },
  timeout: 300000, // 5 minutes timeout
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--disable-gpu',
    '--no-zygote'
  ]
};

// Convert logo to base64 if it exists
const getLogoBase64 = async (logoUrl) => {
  if (!logoUrl) return null;

  try {
    // If it's already a data URL, extract the base64 part
    if (logoUrl.startsWith('data:')) {
      return logoUrl.split(',')[1]; // Extract base64 part
    }

    // If it's a URL, fetch and convert to base64
    if (logoUrl.startsWith('http://') || logoUrl.startsWith('https://')) {
      const base64DataUrl = await fetchImageAsBase64(logoUrl);
      return base64DataUrl.split(',')[1]; // Extract base64 part
    }

    // If it's a local file path, read and convert to base64
    if (fs.existsSync(logoUrl)) {
      const buffer = fs.readFileSync(logoUrl);
      return buffer.toString('base64');
    }

    return null;
  } catch (error) {
    console.error('Error processing logo:', error);
    return null;
  }
};

// Fetch image and convert to base64
const fetchImageAsBase64 = async (url) => {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;

    client.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to fetch image: ${response.statusCode}`));
        return;
      }

      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const base64 = buffer.toString('base64');
        const contentType = response.headers['content-type'] || 'image/png';
        resolve(`data:${contentType};base64,${base64}`);
      });
    }).on('error', (error) => {
      reject(error);
    });
  });
};

// Ensure uploads directory exists
const ensureUploadsDir = () => {
  const uploadsDir = path.join(__dirname, '../uploads');
  const pdfsDir = path.join(uploadsDir, 'pdfs');

  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
  if (!fs.existsSync(pdfsDir)) {
    fs.mkdirSync(pdfsDir, { recursive: true });
  }

  return pdfsDir;
};

// Helper function to launch Puppeteer with fallback paths
const launchPuppeteer = async () => {
  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor'
      ]
    });
    console.log('Successfully launched Puppeteer');
    return browser;
  } catch (error) {
    console.error('Failed to launch Puppeteer:', error);
    throw error;
  }
};

// Generate PDF from quote data with optimized settings
const generateQuotePDF = async (quote, company, customer) => {
  let browser;
  try {
    // Get logo as base64 if available
    const logoBase64 = company.logo ? await getLogoBase64(company.logo) : null;

    // Generate HTML content with logo
    const htmlContent = await generateQuoteHTML(quote, company, customer, logoBase64);

    console.log('Starting PDF generation for quote:', quote.quoteNumber);

    // Launch browser with optimized settings
    browser = await launchPuppeteer();
    const page = await browser.newPage();

    // Set viewport and content with timeout
    await page.setViewport({ width: 1200, height: 1600, deviceScaleFactor: 2 });
    await page.setContent(htmlContent, {
      waitUntil: 'networkidle0',
      timeout: 30000 // 30 seconds to load the content
    });

    // Generate PDF with optimized settings
    console.log('Generating PDF buffer...');
    const pdfBuffer = await page.pdf({
      ...PDF_OPTIONS,
      displayHeaderFooter: false,
      preferCSSPageSize: true
    });

    console.log(`PDF generated successfully, size: ${pdfBuffer.length} bytes`);

    return {
      buffer: pdfBuffer,
      filename: `quote-${quote.quoteNumber}.pdf`,
      isHtml: false
    };
  } catch (error) {
    console.error('PDF generation error:', error);

    // Fallback to HTML if PDF generation fails
    console.log('Falling back to HTML generation');
    const fallbackHtml = await generateQuoteHTML(quote, company, customer, null, true);

    return {
      buffer: Buffer.from(fallbackHtml),
      filename: `quote-${quote.quoteNumber}.html`,
      isHtml: true
    };
  } finally {
    // Make sure to close the browser instance
    if (browser) {
      try {
        await browser.close();
      } catch (err) {
        console.error('Error closing browser:', err);
      }
    }
  }
};

// Generate SOA PDF
const generateSOAPDF = async (statementData, company, customer) => {
  try {
    // Get logo as base64 if available
    const logoBase64 = company && company.logo ? await getLogoBase64(company.logo) : null;

    // Generate HTML content
    const htmlContent = await generateSOAHTML(statementData, company, customer, logoBase64);

    console.log('Starting PDF generation for SOA using html-pdf-node');

    // Use html-pdf-node as primary (consistent with rest of file)
    const options = {
      format: 'A4',
      margin: { top: '15mm', right: '10mm', bottom: '15mm', left: '10mm' },
      printBackground: true,
      displayHeaderFooter: false,
      preferCSSPageSize: false,
      timeout: 60000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--disable-extensions',
        '--disable-plugins'
      ]
    };

    const pdfBuffer = await htmlPdf.generatePdf({ content: htmlContent }, options);

    return {
      buffer: pdfBuffer,
      filename: `SOA-${customer ? customer.firstName : 'Customer'}-${statementData.period.to}.pdf`,
      isHtml: false
    };
  } catch (error) {
    console.error('PDF generation error (html-pdf-node), trying Puppeteer fallback:', error.message);
    // Fallback to Puppeteer
    let browser;
    try {
      const htmlContent = await generateSOAHTML(statementData, company, customer, null);
      browser = await launchPuppeteer();
      const page = await browser.newPage();
      await page.setContent(htmlContent, { waitUntil: 'networkidle0', timeout: 30000 });
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '15mm', right: '10mm', bottom: '15mm', left: '10mm' }
      });
      return {
        buffer: pdfBuffer,
        filename: `SOA-${customer ? customer.firstName : 'Customer'}-${statementData.period.to}.pdf`,
        isHtml: false
      };
    } catch (puppeteerError) {
      console.error('Puppeteer fallback also failed:', puppeteerError.message);
      // Last resort: return HTML
      const fallbackHtml = await generateSOAHTML(statementData, company, customer, null);
      return {
        buffer: Buffer.from(fallbackHtml),
        filename: `SOA-${customer ? customer.firstName : 'Customer'}.html`,
        isHtml: true
      };
    } finally {
      if (browser) {
        try { await browser.close(); } catch (e) { /* ignore */ }
      }
    }
  }
};

// Generate HTML for SOA
const generateSOAHTML = async (data, company, customer, logoBase64) => {
  const formatCurrency = (amount) => {
    const currency = company.settings?.currency || 'AED';
    const locale = currency === 'AED' ? 'ar-AE' : 'en-US';
    return new Intl.NumberFormat(locale, { style: 'currency', currency: currency }).format(amount);
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-GB'); // DD/MM/YYYY
  };

  return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <title>Statement of Account</title>
        <style>
          body { font-family: 'Inter', sans-serif; font-size: 10px; color: #1a1a1a; }
          .container { padding: 20px; }
          .header { display: flex; justify-content: space-between; margin-bottom: 30px; border-bottom: 2px solid #1e40af; padding-bottom: 10px; }
          .company-info h1 { margin: 0; font-size: 18px; color: #1e40af; }
          .statement-title { text-align: right; }
          .statement-title h2 { margin: 0; font-size: 20px; text-transform: uppercase; color: #1a1a1a; }
          .info-grid { display: flex; justify-content: space-between; margin-bottom: 30px; gap: 20px; }
          .box { background: #f8fafc; padding: 15px; border-radius: 4px; flex: 1; }
          .box h3 { margin: 0 0 10px 0; font-size: 12px; color: #1e40af; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px; }
          table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
          th { background: #1e40af; color: white; padding: 8px; text-align: left; font-size: 9px; }
          td { padding: 8px; border-bottom: 1px solid #e2e8f0; font-size: 9px; }
          .amount-col { text-align: right; }
          .total-section { display: flex; justify-content: flex-end; }
          .total-box { width: 200px; }
          .total-row { display: flex; justify-content: space-between; padding: 8px; background: #1e40af; color: white; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="company-info">
              ${logoBase64 ? `<img src="data:image/png;base64,${logoBase64}" style="height: 40px; margin-bottom: 10px;">` : ''}
              <h1>${company.name}</h1>
              <p>${company.address?.street || ''}, ${company.address?.city || ''}</p>
              <p>${company.email || ''} | ${company.phone || ''}</p>
            </div>
            <div class="statement-title">
              <h2>Statement of Account</h2>
              <p>Date: ${formatDate(new Date())}</p>
            </div>
          </div>

          <div class="info-grid">
            <div class="box">
              <h3>Customer Details</h3>
              <strong>${customer.firstName} ${customer.lastName}</strong><br>
              ${customer.companyName ? customer.companyName + '<br>' : ''}
              ${customer.address?.street || ''}<br>
              ${customer.address?.city || ''}
            </div>
            <div class="box">
              <h3>Statement Period</h3>
              <p><strong>From:</strong> ${formatDate(data.period.from)}</p>
              <p><strong>To:</strong> ${formatDate(data.period.to)}</p>
            </div>
          </div>

          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Invoice No</th>
                <th>Description</th>
                <th class="amount-col">Amount (excl. tax)</th>
                <th class="amount-col">Tax</th>
                <th class="amount-col">Payment</th>
                <th class="amount-col">Balance</th>
              </tr>
            </thead>
            <tbody>
              ${data.invoices.map(inv => `
                <tr>
                  <td>${formatDate(inv.invoiceDate)}</td>
                  <td>${inv.invoiceNumber}</td>
                  <td>${inv.description}</td>
                  <td class="amount-col">${formatCurrency(inv.amount)}</td>
                  <td class="amount-col">${formatCurrency(inv.taxAmount || 0)}</td>
                  <td class="amount-col">${formatCurrency(inv.payment)}</td>
                  <td class="amount-col">${formatCurrency(inv.runningBalance)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <div class="total-section">
            <div class="total-box" style="width: 260px;">
              <div style="display: flex; justify-content: space-between; padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 9px;">
                <span>Subtotal (excl. tax):</span>
                <span>${formatCurrency(data.totalBalance)}</span>
              </div>
              <div style="display: flex; justify-content: space-between; padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 9px; color: #4b5563;">
                <span>Tax (${data.avgTaxRate || 0}%):</span>
                <span>${formatCurrency(data.totalTax || 0)}</span>
              </div>
              <div class="total-row">
                <span>Grand Total (incl. tax)</span>
                <span>${formatCurrency(data.grandTotal || data.totalBalance)}</span>
              </div>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
};
// Generate HTML content for the quote
const generateQuoteHTML = async (quote, company, customer) => {
  const formatCurrency = (amount) => {
    const currency = company.settings?.currency || 'USD';
    const locale = currency === 'AED' ? 'ar-AE' : 'en-US';

    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency
    }).format(amount);
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const logoBase64 = await getLogoBase64(company.logo);

  return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Quote ${quote.quoteNumber}</title>
        <style>
          
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.2;
            color: #1a1a1a;
            background: #ffffff;
            font-size: 10px;
            margin: 0;
            padding: 0;
          }
          
          .container {
            max-width: 100%;
            margin: 0;
            padding: 8px;
            background: #ffffff;
          }
          
          /* Professional Header */
          .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 2px solid #1e40af;
          }
          
          .company-section {
            flex: 1;
          }
          
          .logo-container {
            margin-bottom: 6px;
          }
          
          .logo {
            max-height: 35px;
            max-width: 120px;
            object-fit: contain;
          }
          
          .company-name {
            font-size: 16px;
            font-weight: 700;
            color: #1a1a1a;
            margin-bottom: 3px;
            letter-spacing: -0.2px;
          }
          
          .company-tagline {
            font-size: 9px;
            color: #6b7280;
            font-weight: 400;
            margin-bottom: 6px;
          }
          
          .company-details {
            font-size: 9px;
            color: #4b5563;
            line-height: 1.3;
          }
          
          .company-details p {
            margin-bottom: 1px;
          }
          
          .invoice-section {
            text-align: right;
            background: linear-gradient(135deg, #f8fafc, #f1f5f9);
            padding: 10px;
            border-radius: 6px;
            border: 1px solid #e2e8f0;
            min-width: 180px;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
          }
          
          .invoice-title {
            font-size: 14px;
            font-weight: 700;
            color: #1e40af;
            margin-bottom: 6px;
            text-transform: uppercase;
            letter-spacing: 0.8px;
          }
          
          .invoice-meta {
            font-size: 9px;
            color: #4b5563;
          }
          
          .invoice-meta p {
            margin-bottom: 2px;
            font-weight: 500;
          }
          
          .invoice-meta strong {
            color: #1a1a1a;
            font-weight: 600;
          }
          
          /* Address Section */
          .address-section {
            display: flex;
            gap: 15px;
            margin-bottom: 15px;
            justify-content: space-between;
          }
          
          .address-block {
            flex: 1;
            background: #f8fafc;
            padding: 8px;
            border-radius: 4px;
            border-left: 2px solid #1e40af;
          }
          
          .address-block.bill-to {
            border-left-color: #10b981;
          }
          
          .address-block.from {
            border-left-color: #1e40af;
          }
          
          .address-title {
            font-size: 9px;
            font-weight: 600;
            color: #1a1a1a;
            margin-bottom: 5px;
            text-transform: uppercase;
            letter-spacing: 0.3px;
          }
          
          .address-content {
            font-size: 8px;
            color: #4b5563;
            line-height: 1.2;
          }
          
          .address-content p {
            margin-bottom: 1px;
          }
          
          .address-name {
            font-size: 9px;
            font-weight: 600;
            color: #1a1a1a;
            margin-bottom: 3px;
          }
          
          .address-company {
            font-size: 8px;
            color: #6b7280;
            margin-bottom: 4px;
            font-weight: 500;
          }
          
          /* Invoice Details */
          .invoice-details-section {
            background: #ffffff;
            padding: 8px;
            border-radius: 4px;
            border: 1px solid #e5e7eb;
            margin-bottom: 10px;
          }
          
          .invoice-details-title {
            font-size: 10px;
            font-weight: 600;
            color: #1a1a1a;
            margin-bottom: 5px;
            border-bottom: 1px solid #f3f4f6;
            padding-bottom: 2px;
          }
          
          .invoice-details-content p {
            margin-bottom: 2px;
            color: #4b5563;
            font-size: 8px;
          }
          
          .invoice-details-content strong {
            color: #1a1a1a;
            font-weight: 600;
          }
          
          /* Professional Items Table */
          .items-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 10px;
            background: #ffffff;
            border-radius: 4px;
            overflow: hidden;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
          }
          
          .items-table thead {
            background: linear-gradient(135deg, #1e40af, #3b82f6);
            color: #ffffff;
          }
          
          .items-table th {
            padding: 6px 8px;
            text-align: left;
            font-weight: 600;
            font-size: 8px;
            text-transform: uppercase;
            letter-spacing: 0.2px;
          }
          
          .items-table th:last-child {
            text-align: right;
          }
          
          .items-table td {
            padding: 6px 8px;
            border-bottom: 1px solid #f3f4f6;
            color: #4b5563;
            font-size: 8px;
          }
          
          .items-table tbody tr:hover {
            background: #f8fafc;
          }
          
          .items-table tbody tr:last-child td {
            border-bottom: none;
          }
          
          .text-right {
            text-align: right;
            font-weight: 500;
          }
          
          .item-description {
            font-weight: 600;
            color: #1a1a1a;
            font-size: 9px;
            line-height: 1.3;
          }
          
          /* Professional Totals Section */
          .totals-section {
            display: flex;
            justify-content: flex-end;
            margin-bottom: 10px;
          }
          
          .totals-table {
            width: 240px;
            border-collapse: collapse;
            background: #ffffff;
            border-radius: 4px;
            overflow: hidden;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
          }
          
          .totals-table td {
            padding: 4px 8px;
            border-bottom: 1px solid #f3f4f6;
            font-size: 8px;
          }
          
          .totals-table tr:last-child td {
            border-bottom: none;
          }
          
          .subtotal-row {
            background: #f8fafc;
            font-weight: 500;
            color: #4b5563;
          }
          
          .tax-row {
            background: #f1f5f9;
            font-weight: 500;
            color: #4b5563;
          }
          
          .total-row {
            background: linear-gradient(135deg, #1e40af, #3b82f6);
            color: #ffffff;
            font-weight: 700;
            font-size: 9px;
          }
          
          .total-row td:last-child {
            font-size: 10px;
          }
          
          /* Terms and Notes */
          .terms-section {
            background: #f8fafc;
            padding: 8px;
            border-radius: 4px;
            margin-bottom: 8px;
            border-left: 2px solid #10b981;
          }
          
          .terms-title {
            font-size: 9px;
            font-weight: 600;
            color: #1a1a1a;
            margin-bottom: 4px;
            text-transform: uppercase;
            letter-spacing: 0.3px;
          }
          
          .terms-content {
            color: #4b5563;
            line-height: 1.2;
            font-size: 7px;
          }
          
          .notes-section {
            background: #fef3c7;
            padding: 8px;
            border-radius: 4px;
            border-left: 2px solid #f59e0b;
          }
          
          .notes-title {
            font-size: 9px;
            font-weight: 600;
            color: #92400e;
            margin-bottom: 4px;
          }
          
          .notes-content {
            color: #92400e;
            line-height: 1.2;
            font-size: 7px;
          }
          
          /* Professional Footer */
          .footer {
            margin-top: 15px;
            padding-top: 8px;
            border-top: 1px solid #e5e7eb;
            text-align: center;
            color: #6b7280;
            font-size: 7px;
          }
          
          .footer p {
            margin-bottom: 1px;
          }
          
          /* Status Badge */
          .status-badge {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 7px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.3px;
          }
          
          .status-draft {
            background: #fef3c7;
            color: #92400e;
          }
          
          .status-sent {
            background: #dbeafe;
            color: #1e40af;
          }
          
          .status-accepted {
            background: #d1fae5;
            color: #065f46;
          }
          
          .status-rejected {
            background: #fee2e2;
            color: #991b1b;
          }
          
          /* Responsive adjustments */
          @media print {
            .container {
              padding: 15px;
            }
            
            .header {
              flex-direction: row;
              gap: 20px;
            }
            
            .address-section {
              flex-direction: row;
              gap: 15px;
            }
            
            .invoice-section {
              text-align: left;
              width: 30%;
            }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <!-- Professional Header -->
          <div class="header">
            <div class="company-section">
              ${logoBase64 ? `
                <div class="logo-container">
                  <img src="data:image/png;base64,${logoBase64}" alt="${company.name} Logo" class="logo">
                </div>
              ` : `
                <div class="logo-container">
                  <div style="width: 180px; height: 60px; background: linear-gradient(135deg, #1e40af, #3b82f6); border-radius: 8px; display: flex; align-items: center; justify-content: center; color: white; font-size: 20px; font-weight: 700;">
                    ${company.name.charAt(0).toUpperCase()}
                  </div>
                </div>
              `}
              <h1 class="company-name">${company.name}</h1>
              ${company.description ? `<p class="company-tagline">${company.description}</p>` : ''}
              <div class="company-details">
                ${company.address.street ? `<p>${company.address.street}</p>` : ''}
                ${company.address.city ? `<p>${company.address.city}, ${company.address.state} ${company.address.zipCode}</p>` : ''}
                ${company.address.country ? `<p>${company.address.country}</p>` : ''}
                ${company.email ? `<p>📧 ${company.email}</p>` : ''}
                ${company.phone ? `<p>📞 ${company.phone}</p>` : ''}
                ${company.website ? `<p>🌐 ${company.website}</p>` : ''}
              </div>
            </div>
            
            <div class="invoice-section">
              <h2 class="invoice-title">Quote</h2>
              <div class="invoice-meta">
                <p><strong>Quote #:</strong> ${quote.quoteNumber}</p>
                <p><strong>Date:</strong> ${formatDate(quote.createdAt)}</p>
                <p><strong>Valid Until:</strong> ${formatDate(quote.validUntil)}</p>
                <div class="status-badge status-${quote.status}">${quote.status}</div>
              </div>
            </div>
          </div>

        <!-- Address Section -->
        <div class="address-section">
          <div class="address-block bill-to">
            <h3 class="address-title">Bill To</h3>
            <div class="address-content">
              <div class="address-name">${customer.firstName} ${customer.lastName}</div>
              ${customer.companyName ? `<div class="address-company">${customer.companyName}</div>` : ''}
              ${customer.address.street ? `<p>${customer.address.street}</p>` : ''}
              ${customer.address.city ? `<p>${customer.address.city}, ${customer.address.state} ${customer.address.zipCode}</p>` : ''}
              ${customer.address.country ? `<p>${customer.address.country}</p>` : ''}
              <p>📧 ${customer.email}</p>
              ${customer.phone ? `<p>📞 ${customer.phone}</p>` : ''}
            </div>
          </div>
          
          <div class="address-block from">
            <h3 class="address-title">From</h3>
            <div class="address-content">
              <div class="address-name">${company.name}</div>
              ${company.description ? `<div class="address-company">${company.description}</div>` : ''}
              ${company.address.street ? `<p>${company.address.street}</p>` : ''}
              ${company.address.city ? `<p>${company.address.city}, ${company.address.state} ${company.address.zipCode}</p>` : ''}
              ${company.address.country ? `<p>${company.address.country}</p>` : ''}
              ${company.email ? `<p>📧 ${company.email}</p>` : ''}
              ${company.phone ? `<p>📞 ${company.phone}</p>` : ''}
            </div>
          </div>
        </div>

          <!-- Invoice Details -->
          <div class="invoice-details-section">
            <h3 class="invoice-details-title">Quote Details</h3>
            <div class="invoice-details-content">
              <p><strong>Title:</strong> ${quote.title}</p>
              ${quote.description ? `<p><strong>Description:</strong> ${quote.description}</p>` : ''}
            </div>
          </div>

          <!-- Professional Items Table -->
          <table class="items-table">
            <thead>
              <tr>
                <th>Item Name</th>
                <th>Image</th>
                <th>Description</th>
                <th class="text-right">Quantity</th>
                <th class="text-right">Unit Price</th>
                <th class="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              ${quote.items.map(item => `
                <tr>
                  <td style="padding: 8px; max-width: 150px; word-wrap: break-word;">
                    <strong>${item.name || 'N/A'}</strong>
                  </td>
                  <td style="text-align: center; padding: 6px; width: 60px;">
                    ${item.image ? `
                      <img src="${item.image}" alt="Product" style="width: 40px; height: 40px; object-fit: cover; border-radius: 4px;" />
                    ` : `
                      <div style="width: 40px; height: 40px; background: #f5f5f5; border-radius: 4px; display: flex; align-items: center; justify-content: center; color: #999; font-size: 8px;">
                        No Image
                      </div>
                    `}
                  </td>
                  <td class="item-description" style="padding: 8px; max-width: 200px; word-wrap: break-word;">
                    ${item.description}
                  </td>
                  <td class="text-right" style="padding: 8px;">${item.quantity}</td>
                  <td class="text-right" style="padding: 8px;">${formatCurrency(item.unitPrice, company.settings?.currency || 'USD')}</td>
                  <td class="text-right" style="padding: 8px;">${formatCurrency(item.total, company.settings?.currency || 'USD')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <!-- Professional Totals Section -->
          <div class="totals-section">
            <table class="totals-table">
              <tr class="subtotal-row">
                <td>Subtotal:</td>
                <td class="text-right">${formatCurrency(quote.subtotal, company.settings?.currency || 'USD')}</td>
              </tr>
              <tr class="tax-row">
                <td>${quote.tax?.name || 'Tax'} (${quote.taxRate}%):</td>
                <td class="text-right">${formatCurrency(quote.taxAmount, company.settings?.currency || 'USD')}</td>
              </tr>
              <tr class="total-row">
                <td>Total:</td>
                <td class="text-right">${formatCurrency(quote.total, company.settings?.currency || 'USD')}</td>
              </tr>
            </table>
          </div>

          <!-- Terms Section -->
          <div class="terms-section">
            <h3 class="terms-title">Terms & Conditions</h3>
            <div class="terms-content">${quote.terms}</div>
          </div>

          <!-- Notes Section -->
          ${quote.notes ? `
            <div class="notes-section">
              <h3 class="notes-title">Additional Notes</h3>
              <div class="notes-content">${quote.notes}</div>
            </div>
          ` : ''}

          <!-- Professional Footer -->
          <div class="footer">
            <p>Thank you for your business!</p>
            <p>This quote is valid until ${formatDate(quote.validUntil)}</p>
            <p>Generated on ${formatDate(new Date().toISOString())}</p>
          </div>
        </div>
      </body>
      </html>
    `;
};

// Generate Invoice PDF (similar to quote but for invoices)
const generateInvoicePDF = async (invoice, company, customer) => {
  try {
    ensureUploadsDir();

    // Get company logo as base64
    const logoBase64 = await getLogoBase64(company.logo);
    const htmlContent = generateInvoiceHTML(invoice, company, customer, logoBase64);

    // Use html-pdf-node as primary PDF generation method
    console.log('Generating invoice PDF using html-pdf-node');
    const options = {
      format: 'A4',
      margin: {
        top: '6mm',
        right: '6mm',
        bottom: '6mm',
        left: '6mm'
      },
      printBackground: true,
      displayHeaderFooter: false,
      preferCSSPageSize: true
    };

    const pdfBuffer = await htmlPdf.generatePdf({ content: htmlContent }, options);

    console.log('Invoice PDF generated successfully using html-pdf-node');
    return pdfBuffer;
  } catch (error) {
    console.error('Error generating invoice PDF:', error);

    // Fallback: Try Puppeteer if html-pdf-node fails
    try {
      console.log('Trying Puppeteer as fallback for invoice');
      const browser = await launchPuppeteer();
      const page = await browser.newPage();

      const logoBase64 = await getLogoBase64(company.logo);
      const htmlContent = generateInvoiceHTML(invoice, company, customer, logoBase64);

      await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '6mm',
          right: '6mm',
          bottom: '6mm',
          left: '6mm'
        },
        preferCSSPageSize: true,
        displayHeaderFooter: false
      });

      await browser.close();

      console.log('Invoice PDF generated successfully using Puppeteer fallback');
      return pdfBuffer;
    } catch (puppeteerError) {
      console.error('Puppeteer fallback also failed for invoice:', puppeteerError);

      // Ultimate fallback - return HTML content
      console.log('Falling back to HTML response for invoice');
      const logoBase64 = await getLogoBase64(company.logo);
      const htmlContent = generateInvoiceHTML(invoice, company, customer, logoBase64);

      return {
        buffer: Buffer.from(htmlContent, 'utf8'),
        filename: `invoice-${invoice.invoiceNumber}-${Date.now()}.html`,
        filepath: null,
        isHtml: true
      };
    }
  }
};

// Generate Invoice HTML (similar to quote but for invoices)
const generateInvoiceHTML = (invoice, company, customer, logoBase64) => {
  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const formatCurrency = (amount, currency = 'USD') => {
    const locale = currency === 'AED' ? 'ar-AE' : 'en-US';
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency,
    }).format(amount);
  };

  return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Invoice ${invoice.invoiceNumber}</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.2;
            color: #1a1a1a;
            background: #ffffff;
            font-size: 10px;
            margin: 0;
            padding: 0;
          }
          
          .container {
            max-width: 100%;
            margin: 0;
            padding: 8px;
            background: #ffffff;
          }
          
          /* Professional Header */
          .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 2px solid #1e40af;
          }
          
          .company-section {
            flex: 1;
          }
          
          .logo-container {
            margin-bottom: 6px;
          }
          
          .logo {
            max-height: 35px;
            max-width: 120px;
            object-fit: contain;
          }
          
          .company-name {
            font-size: 16px;
            font-weight: 700;
            color: #1a1a1a;
            margin-bottom: 3px;
            letter-spacing: -0.2px;
          }
          
          .company-tagline {
            font-size: 9px;
            color: #6b7280;
            font-weight: 400;
            margin-bottom: 6px;
          }
          
          .company-details {
            font-size: 9px;
            color: #4b5563;
            line-height: 1.3;
          }
          
          .company-details p {
            margin-bottom: 1px;
          }
          
          .invoice-section {
            text-align: right;
            background: linear-gradient(135deg, #f8fafc, #f1f5f9);
            padding: 10px;
            border-radius: 6px;
            border: 1px solid #e2e8f0;
            min-width: 180px;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
          }
          
          .invoice-title {
            font-size: 14px;
            font-weight: 700;
            color: #1e40af;
            margin-bottom: 6px;
            text-transform: uppercase;
            letter-spacing: 0.8px;
          }
          
          .invoice-meta {
            font-size: 9px;
            color: #4b5563;
          }
          
          .invoice-meta p {
            margin-bottom: 2px;
            font-weight: 500;
          }
          
          .invoice-meta strong {
            color: #1a1a1a;
            font-weight: 600;
          }
          
          /* Address Section */
          .address-section {
            display: flex;
            gap: 15px;
            margin-bottom: 15px;
            justify-content: space-between;
          }
          
          .address-block {
            flex: 1;
            background: #f8fafc;
            padding: 8px;
            border-radius: 4px;
            border-left: 2px solid #1e40af;
          }
          
          .address-block.bill-to {
            border-left-color: #10b981;
          }
          
          .address-block.from {
            border-left-color: #1e40af;
          }
          
          .address-title {
            font-size: 9px;
            font-weight: 600;
            color: #1a1a1a;
            margin-bottom: 5px;
            text-transform: uppercase;
            letter-spacing: 0.3px;
          }
          
          .address-content {
            font-size: 8px;
            color: #4b5563;
            line-height: 1.2;
          }
          
          .address-content p {
            margin-bottom: 1px;
          }
          
          .address-name {
            font-size: 9px;
            font-weight: 600;
            color: #1a1a1a;
            margin-bottom: 3px;
          }
          
          .address-company {
            font-size: 8px;
            color: #6b7280;
            margin-bottom: 4px;
            font-weight: 500;
          }
          
          /* Invoice Details */
          .invoice-details-section {
            background: #ffffff;
            padding: 8px;
            border-radius: 4px;
            border: 1px solid #e5e7eb;
            margin-bottom: 10px;
          }
          
          .invoice-details-title {
            font-size: 10px;
            font-weight: 600;
            color: #1a1a1a;
            margin-bottom: 5px;
            border-bottom: 1px solid #f3f4f6;
            padding-bottom: 2px;
          }
          
          .invoice-details-content p {
            margin-bottom: 2px;
            color: #4b5563;
            font-size: 8px;
          }
          
          .invoice-details-content strong {
            color: #1a1a1a;
            font-weight: 600;
          }
          
          /* Professional Items Table */
          .items-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 10px;
            background: #ffffff;
            border-radius: 4px;
            overflow: hidden;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
          }
          
          .items-table thead {
            background: linear-gradient(135deg, #1e40af, #3b82f6);
            color: #ffffff;
          }
          
          .items-table th {
            padding: 6px 8px;
            text-align: left;
            font-weight: 600;
            font-size: 8px;
            text-transform: uppercase;
            letter-spacing: 0.2px;
          }
          
          .items-table th:last-child {
            text-align: right;
          }
          
          .items-table td {
            padding: 6px 8px;
            border-bottom: 1px solid #f3f4f6;
            color: #4b5563;
            font-size: 8px;
          }
          
          .items-table tbody tr:hover {
            background: #f8fafc;
          }
          
          .items-table tbody tr:last-child td {
            border-bottom: none;
          }
          
          .text-right {
            text-align: right;
            font-weight: 500;
          }
          
          .item-description {
            font-weight: 600;
            color: #1a1a1a;
            font-size: 9px;
            line-height: 1.3;
          }
          
          /* Professional Totals Section */
          .totals-section {
            display: flex;
            justify-content: flex-end;
            margin-bottom: 10px;
          }
          
          .totals-table {
            width: 240px;
            border-collapse: collapse;
            background: #ffffff;
            border-radius: 4px;
            overflow: hidden;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
          }
          
          .totals-table td {
            padding: 4px 8px;
            border-bottom: 1px solid #f3f4f6;
            font-size: 8px;
          }
          
          .totals-table tr:last-child td {
            border-bottom: none;
          }
          
          .subtotal-row {
            background: #f8fafc;
            font-weight: 500;
            color: #4b5563;
          }
          
          .tax-row {
            background: #f1f5f9;
            font-weight: 500;
            color: #4b5563;
          }
          
          .total-row {
            background: linear-gradient(135deg, #1e40af, #3b82f6);
            color: #ffffff;
            font-weight: 700;
            font-size: 9px;
          }
          
          .total-row td:last-child {
            font-size: 10px;
          }
          
          /* Payment Status */
          .payment-status {
            background: ${invoice.status === 'paid' ? '#d1fae5' : invoice.status === 'overdue' ? '#fee2e2' : '#fef3c7'};
            padding: 8px;
            border-radius: 4px;
            margin-bottom: 8px;
            border-left: 3px solid ${invoice.status === 'paid' ? '#10b981' : invoice.status === 'overdue' ? '#ef4444' : '#f59e0b'};
          }
          
          .payment-status-title {
            font-size: 9px;
            font-weight: 600;
            color: ${invoice.status === 'paid' ? '#065f46' : invoice.status === 'overdue' ? '#991b1b' : '#92400e'};
            margin-bottom: 4px;
          }
          
          .payment-status-content {
            color: ${invoice.status === 'paid' ? '#065f46' : invoice.status === 'overdue' ? '#991b1b' : '#92400e'};
            line-height: 1.2;
            font-size: 7px;
          }
          
          /* Terms and Notes */
          .terms-section {
            background: #f8fafc;
            padding: 8px;
            border-radius: 4px;
            margin-bottom: 8px;
            border-left: 2px solid #10b981;
          }
          
          .terms-title {
            font-size: 9px;
            font-weight: 600;
            color: #1a1a1a;
            margin-bottom: 4px;
            text-transform: uppercase;
            letter-spacing: 0.3px;
          }
          
          .terms-content {
            color: #4b5563;
            line-height: 1.2;
            font-size: 7px;
          }
          
          .notes-section {
            background: #fef3c7;
            padding: 8px;
            border-radius: 4px;
            border-left: 2px solid #f59e0b;
          }
          
          .notes-title {
            font-size: 9px;
            font-weight: 600;
            color: #92400e;
            margin-bottom: 4px;
          }
          
          .notes-content {
            color: #92400e;
            line-height: 1.2;
            font-size: 7px;
          }
          
          /* Professional Footer */
          .footer {
            margin-top: 15px;
            padding-top: 8px;
            border-top: 1px solid #e5e7eb;
            text-align: center;
            color: #6b7280;
            font-size: 7px;
          }
          
          .footer p {
            margin-bottom: 1px;
          }
          
          .status-badge {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 7px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.3px;
          }
          
          .status-draft { background: #f3f4f6; color: #374151; }
          .status-sent { background: #dbeafe; color: #1e40af; }
          .status-paid { background: #d1fae5; color: #065f46; }
          .status-overdue { background: #fee2e2; color: #991b1b; }
          .status-cancelled { background: #f3f4f6; color: #6b7280; }
        </style>
      </head>
      <body>
        <div class="container">
          <!-- Professional Header -->
          <div class="header">
            <div class="company-section">
              ${logoBase64 ? `
                <div class="logo-container">
                  <img src="data:image/png;base64,${logoBase64}" alt="${company.name} Logo" class="logo">
                </div>
              ` : `
                <div class="logo-container">
                  <div style="width: 120px; height: 35px; background: linear-gradient(135deg, #1e40af, #3b82f6); border-radius: 4px; display: flex; align-items: center; justify-content: center; color: white; font-size: 14px; font-weight: 700;">
                    ${company.name.charAt(0).toUpperCase()}
                  </div>
                </div>
              `}
              <h1 class="company-name">${company.name}</h1>
              ${company.description ? `<p class="company-tagline">${company.description}</p>` : ''}
              <div class="company-details">
                ${company.address.street ? `<p>${company.address.street}</p>` : ''}
                ${company.address.city ? `<p>${company.address.city}, ${company.address.state} ${company.address.zipCode}</p>` : ''}
                ${company.address.country ? `<p>${company.address.country}</p>` : ''}
                ${company.email ? `<p>📧 ${company.email}</p>` : ''}
                ${company.phone ? `<p>📞 ${company.phone}</p>` : ''}
                ${company.website ? `<p>🌐 ${company.website}</p>` : ''}
              </div>
            </div>
            
            <div class="invoice-section">
              <h2 class="invoice-title">TAX INVOICE</h2>
              <div class="invoice-meta">
                <p><strong>Invoice #:</strong> ${invoice.invoiceNumber}</p>
                <p><strong>Date:</strong> ${formatDate(invoice.createdAt)}</p>
                <p><strong>Due Date:</strong> ${formatDate(invoice.dueDate)}</p>
                <div class="status-badge status-${invoice.status}">${invoice.status}</div>
              </div>
            </div>
          </div>

          <!-- Address Section -->
          <div class="address-section">
            <div class="address-block bill-to">
              <h3 class="address-title">Bill To</h3>
              <div class="address-content">
                <div class="address-name">${customer.firstName} ${customer.lastName}</div>
                ${customer.companyName ? `<div class="address-company">${customer.companyName}</div>` : ''}
                ${customer.address.street ? `<p>${customer.address.street}</p>` : ''}
                ${customer.address.city ? `<p>${customer.address.city}, ${customer.address.state} ${customer.address.zipCode}</p>` : ''}
                ${customer.address.country ? `<p>${customer.address.country}</p>` : ''}
                <p>📧 ${customer.email}</p>
                ${customer.phone ? `<p>📞 ${customer.phone}</p>` : ''}
              </div>
            </div>
            
            <div class="address-block from">
              <h3 class="address-title">From</h3>
              <div class="address-content">
                <div class="address-name">${company.name}</div>
                ${company.description ? `<div class="address-company">${company.description}</div>` : ''}
                ${company.address.street ? `<p>${company.address.street}</p>` : ''}
                ${company.address.city ? `<p>${company.address.city}, ${company.address.state} ${company.address.zipCode}</p>` : ''}
                ${company.address.country ? `<p>${company.address.country}</p>` : ''}
                ${company.email ? `<p>📧 ${company.email}</p>` : ''}
                ${company.phone ? `<p>📞 ${company.phone}</p>` : ''}
              </div>
            </div>
          </div>

          <!-- Invoice Details -->
          <div class="invoice-details-section">
            <h3 class="invoice-details-title">Invoice Details</h3>
            <div class="invoice-details-content">
              <p><strong>Title:</strong> ${invoice.title}</p>
              ${invoice.description ? `<p><strong>Description:</strong> ${invoice.description}</p>` : ''}
            </div>
          </div>

          <!-- Professional Items Table -->
          <table class="items-table">
            <thead>
              <tr>
                <th>Item Name</th>
                <th>Description</th>
                <th class="text-right">Quantity</th>
                <th class="text-right">Unit Price</th>
                <th class="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              ${invoice.items.map(item => `
                <tr>
                  <td style="padding: 8px; max-width: 150px; word-wrap: break-word;">
                    <strong>${item.name || 'N/A'}</strong>
                  </td>
                  <td class="item-description" style="padding: 8px; max-width: 200px; word-wrap: break-word;">
                    ${item.description}
                  </td>
                  <td class="text-right" style="padding: 8px;">${item.quantity}</td>
                  <td class="text-right" style="padding: 8px;">${formatCurrency(item.unitPrice, company.settings?.currency || 'USD')}</td>
                  <td class="text-right" style="padding: 8px;">${formatCurrency(item.total, company.settings?.currency || 'USD')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <!-- Professional Totals Section -->
          <div class="totals-section">
            <table class="totals-table">
              <tr class="subtotal-row">
                <td>Subtotal:</td>
                <td class="text-right">${formatCurrency(invoice.subtotal, company.settings?.currency || 'USD')}</td>
              </tr>
              <tr class="tax-row">
                <td>${invoice.tax?.name || 'Tax'} (${invoice.taxRate}%):</td>
                <td class="text-right">${formatCurrency(invoice.taxAmount, company.settings?.currency || 'USD')}</td>
              </tr>
              <tr class="total-row">
                <td>Total:</td>
                <td class="text-right">${formatCurrency(invoice.total, company.settings?.currency || 'USD')}</td>
              </tr>
              ${invoice.paidAmount > 0 ? `
                <tr class="subtotal-row">
                  <td>Paid Amount:</td>
                  <td class="text-right">${formatCurrency(invoice.paidAmount, company.settings?.currency || 'USD')}</td>
                </tr>
                <tr class="tax-row">
                  <td>Balance Due:</td>
                  <td class="text-right">${formatCurrency(invoice.total - invoice.paidAmount, company.settings?.currency || 'USD')}</td>
                </tr>
              ` : ''}
            </table>
          </div>

          <!-- Payment Status -->
          <div class="payment-status">
            <h3 class="payment-status-title">Payment Status</h3>
            <div class="payment-status-content">
              <p><strong>Status:</strong> ${invoice.status.toUpperCase()}</p>
              <p><strong>Total Amount:</strong> ${formatCurrency(invoice.total, company.settings?.currency || 'USD')}</p>
              <p><strong>Paid Amount:</strong> ${formatCurrency(invoice.paidAmount, company.settings?.currency || 'USD')}</p>
              <p><strong>Balance Due:</strong> ${formatCurrency(invoice.total - invoice.paidAmount, company.settings?.currency || 'USD')}</p>
              ${invoice.payments && invoice.payments.length > 0 ? `
                <p><strong>Payment History:</strong></p>
                ${invoice.payments.map(payment => `
                  <p>• ${formatCurrency(payment.amount, company.settings?.currency || 'USD')} on ${formatDate(payment.paymentDate)} (${payment.paymentMethod})</p>
                `).join('')}
              ` : ''}
            </div>
          </div>

          <!-- Terms Section -->
          <div class="terms-section">
            <h3 class="terms-title">Terms & Conditions</h3>
            <div class="terms-content">${invoice.terms}</div>
          </div>

          <!-- Notes Section -->
          ${invoice.notes ? `
            <div class="notes-section">
              <h3 class="notes-title">Additional Notes</h3>
              <div class="notes-content">${invoice.notes}</div>
            </div>
          ` : ''}

          <!-- Signature Section -->
          <div class="signature-section" style="margin-top: 20px; display: flex; justify-content: space-between; gap: 20px;">
            <div class="signature-block" style="flex: 1; text-align: center;">
              <div style="border-top: 1px solid #1e40af; padding-top: 5px; margin-top: 40px;">
                <p style="font-size: 8px; color: #4b5563; margin-bottom: 2px;">Company Signature</p>
                <p style="font-size: 9px; font-weight: 600; color: #1a1a1a;">${invoice.companySignature || '_________________'}</p>
              </div>
            </div>
            <div class="signature-block" style="flex: 1; text-align: center;">
              <div style="border-top: 1px solid #1e40af; padding-top: 5px; margin-top: 40px;">
                <p style="font-size: 8px; color: #4b5563; margin-bottom: 2px;">Customer Signature</p>
                <p style="font-size: 9px; font-weight: 600; color: #1a1a1a;">${invoice.customerSignature || '_________________'}</p>
              </div>
            </div>
          </div>

          <!-- Professional Footer -->
          <div class="footer">
            <p>Thank you for your business!</p>
            <p>Payment is due by ${formatDate(invoice.dueDate)}</p>
            <p>Generated on ${formatDate(new Date().toISOString())}</p>
          </div>
        </div>
      </body>
      </html>
    `;
};

// Generate Purchase Order PDF
const generatePurchaseOrderPDF = async (purchaseOrder, company, vendor, client) => {
  try {
    ensureUploadsDir();

    // Generate HTML content first
    const htmlContent = await generatePurchaseOrderHTML(purchaseOrder, company, vendor, client);

    // Use html-pdf-node as primary PDF generation method
    console.log('Generating Purchase Order PDF using html-pdf-node');
    console.log('HTML content length:', htmlContent.length);

    const options = {
      format: 'A4',
      margin: {
        top: '10mm',
        right: '10mm',
        bottom: '10mm',
        left: '10mm'
      },
      printBackground: true,
      displayHeaderFooter: false,
      preferCSSPageSize: true,
      timeout: 60000, // 60 second timeout
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--disable-extensions',
        '--disable-plugins',
        '--disable-javascript' // Disable JS for faster generation
      ]
    };

    console.log('PDF generation options:', options);
    const pdfBuffer = await htmlPdf.generatePdf({ content: htmlContent }, options);
    console.log('PDF buffer generated, size:', pdfBuffer.length);

    // Save PDF to file
    const pdfsDir = ensureUploadsDir();
    const filename = `purchase-order-${purchaseOrder.poNumber}-${Date.now()}.pdf`;
    const filepath = path.join(pdfsDir, filename);

    fs.writeFileSync(filepath, pdfBuffer);

    console.log('Purchase Order PDF generated successfully using html-pdf-node');
    return {
      buffer: pdfBuffer,
      filename,
      filepath,
      isHtml: false
    };
  } catch (error) {
    console.error('Purchase Order PDF generation error:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });

    // Fallback: Try Puppeteer if html-pdf-node fails
    try {
      console.log('Trying Puppeteer as fallback for Purchase Order');
      const browser = await launchPuppeteer();
      const page = await browser.newPage();

      const htmlContent = await generatePurchaseOrderHTML(purchaseOrder, company, vendor, client);
      await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '10mm',
          right: '10mm',
          bottom: '10mm',
          left: '10mm'
        },
        preferCSSPageSize: true,
        displayHeaderFooter: false
      });

      await browser.close();

      const pdfsDir = ensureUploadsDir();
      const filename = `purchase-order-${purchaseOrder.poNumber}-${Date.now()}.pdf`;
      const filepath = path.join(pdfsDir, filename);

      fs.writeFileSync(filepath, pdfBuffer);

      console.log('Purchase Order PDF generated successfully using Puppeteer fallback');
      return {
        buffer: pdfBuffer,
        filename,
        filepath,
        isHtml: false
      };
    } catch (puppeteerError) {
      console.error('Puppeteer fallback also failed for Purchase Order:', puppeteerError);

      // Ultimate fallback - return HTML content
      console.log('Falling back to HTML response for Purchase Order');
      const htmlContent = await generatePurchaseOrderHTML(purchaseOrder, company, vendor, client);

      return {
        buffer: Buffer.from(htmlContent, 'utf8'),
        filename: `purchase-order-${purchaseOrder.poNumber}-${Date.now()}.html`,
        filepath: null,
        isHtml: true
      };
    }
  }
};

// Generate HTML content for the purchase order
const generatePurchaseOrderHTML = async (purchaseOrder, company, vendor, client) => {
  const formatCurrency = (amount) => {
    const currency = company.settings?.currency || 'USD';
    const locale = currency === 'AED' ? 'ar-AE' : 'en-US';

    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency
    }).format(amount);
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const logoBase64 = await getLogoBase64(company.logo);

  return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Purchase Order ${purchaseOrder.poNumber}</title>
        <style>
          
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          
          body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.2;
            color: #1a1a1a;
            background: #ffffff;
            font-size: 10px;
            margin: 0;
            padding: 0;
          }
          
          .container {
            max-width: 100%;
            margin: 0;
            padding: 8px;
            background: #ffffff;
          }
          
          /* Professional Header */
          .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 2px solid #1e40af;
          }
          
          .company-section {
            flex: 1;
          }
          
          .logo-container {
            margin-bottom: 6px;
          }
          
          .logo {
            max-height: 35px;
            max-width: 120px;
            object-fit: contain;
          }
          
          .company-name {
            font-size: 16px;
            font-weight: 700;
            color: #1a1a1a;
            margin-bottom: 3px;
            letter-spacing: -0.2px;
          }
          
          .company-tagline {
            font-size: 9px;
            color: #6b7280;
            font-weight: 400;
            margin-bottom: 6px;
          }
          
          .company-details {
            font-size: 9px;
            color: #4b5563;
            line-height: 1.3;
          }
          
          .company-details p {
            margin-bottom: 1px;
          }
          
          .po-section {
            text-align: right;
            background: linear-gradient(135deg, #f8fafc, #f1f5f9);
            padding: 10px;
            border-radius: 6px;
            border: 1px solid #e2e8f0;
            min-width: 180px;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
          }
          
          .po-title {
            font-size: 14px;
            font-weight: 700;
            color: #1e40af;
            margin-bottom: 6px;
            text-transform: uppercase;
            letter-spacing: 0.8px;
          }
          
          .po-meta {
            font-size: 9px;
            color: #4b5563;
          }
          
          .po-meta p {
            margin-bottom: 2px;
            font-weight: 500;
          }
          
          .po-meta strong {
            color: #1a1a1a;
            font-weight: 600;
          }
          
          /* Address Section */
          .address-section {
            display: flex;
            gap: 15px;
            margin-bottom: 15px;
            justify-content: space-between;
          }
          
          .address-block {
            flex: 1;
            background: #f8fafc;
            padding: 8px;
            border-radius: 4px;
            border-left: 2px solid #1e40af;
          }
          
          .address-block.vendor {
            border-left-color: #10b981;
          }
          
          .address-block.client {
            border-left-color: #1e40af;
          }
          
          .address-block.delivery {
            border-left-color: #3b82f6;
          }
          
          .address-title {
            font-size: 9px;
            font-weight: 600;
            color: #1a1a1a;
            margin-bottom: 5px;
            text-transform: uppercase;
            letter-spacing: 0.3px;
          }
          
          .address-content {
            font-size: 8px;
            color: #4b5563;
            line-height: 1.2;
          }
          
          .address-content p {
            margin-bottom: 1px;
          }
          
          .address-name {
            font-size: 9px;
            font-weight: 600;
            color: #1a1a1a;
            margin-bottom: 3px;
          }
          
          .address-company {
            font-size: 8px;
            color: #6b7280;
            margin-bottom: 4px;
            font-weight: 500;
          }
          
          /* PO Details */
          .po-details-section {
            background: #ffffff;
            padding: 8px;
            border-radius: 4px;
            border: 1px solid #e5e7eb;
            margin-bottom: 10px;
          }
          
          .po-details-title {
            font-size: 10px;
            font-weight: 600;
            color: #1a1a1a;
            margin-bottom: 5px;
            border-bottom: 1px solid #f3f4f6;
            padding-bottom: 2px;
          }
          
          .po-details-content p {
            margin-bottom: 2px;
            color: #4b5563;
            font-size: 8px;
          }
          
          .po-details-content strong {
            color: #1a1a1a;
            font-weight: 600;
          }
          
          /* Professional Items Table */
          .items-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 10px;
            background: #ffffff;
            border-radius: 4px;
            overflow: hidden;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
          }
          
          .items-table thead {
            background: linear-gradient(135deg, #1e40af, #3b82f6);
            color: #ffffff;
          }
          
          .items-table th {
            padding: 6px 8px;
            text-align: left;
            font-weight: 600;
            font-size: 8px;
            text-transform: uppercase;
            letter-spacing: 0.2px;
          }
          
          .items-table th:last-child {
            text-align: right;
          }
          
          .items-table td {
            padding: 6px 8px;
            border-bottom: 1px solid #f3f4f6;
            color: #4b5563;
            font-size: 8px;
          }
          
          .items-table tbody tr:hover {
            background: #f8fafc;
          }
          
          .items-table tbody tr:last-child td {
            border-bottom: none;
          }
          
          .text-right {
            text-align: right;
            font-weight: 500;
          }
          
          .item-description {
            font-weight: 600;
            color: #1a1a1a;
            font-size: 9px;
            line-height: 1.3;
          }
          
          /* Professional Totals Section */
          .totals-section {
            display: flex;
            justify-content: flex-end;
            margin-bottom: 10px;
          }
          
          .totals-table {
            width: 240px;
            border-collapse: collapse;
            background: #ffffff;
            border-radius: 4px;
            overflow: hidden;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
          }
          
          .totals-table td {
            padding: 4px 8px;
            border-bottom: 1px solid #f3f4f6;
            font-size: 8px;
          }
          
          .totals-table tr:last-child td {
            border-bottom: none;
          }
          
          .subtotal-row {
            background: #f8fafc;
            font-weight: 500;
            color: #4b5563;
          }
          
          .tax-row {
            background: #f1f5f9;
            font-weight: 500;
            color: #4b5563;
          }
          
          .total-row {
            background: linear-gradient(135deg, #1e40af, #3b82f6);
            color: #ffffff;
            font-weight: 700;
            font-size: 9px;
          }
          
          .total-row td:last-child {
            font-size: 10px;
          }
          
          /* Terms and Notes */
          .terms-section {
            background: #f8fafc;
            padding: 8px;
            border-radius: 4px;
            margin-bottom: 8px;
            border-left: 2px solid #10b981;
          }
          
          .terms-title {
            font-size: 9px;
            font-weight: 600;
            color: #1a1a1a;
            margin-bottom: 4px;
            text-transform: uppercase;
            letter-spacing: 0.3px;
          }
          
          .terms-content {
            color: #4b5563;
            line-height: 1.2;
            font-size: 7px;
          }
          
          .notes-section {
            background: #fef3c7;
            padding: 8px;
            border-radius: 4px;
            border-left: 2px solid #f59e0b;
          }
          
          .notes-title {
            font-size: 9px;
            font-weight: 600;
            color: #92400e;
            margin-bottom: 4px;
          }
          
          .notes-content {
            color: #92400e;
            line-height: 1.2;
            font-size: 7px;
          }
          
          /* Professional Footer */
          .footer {
            margin-top: 15px;
            padding-top: 8px;
            border-top: 1px solid #e5e7eb;
            text-align: center;
            color: #6b7280;
            font-size: 7px;
          }
          
          .footer p {
            margin-bottom: 1px;
          }
          
          /* Status Badge */
          .status-badge {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 7px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.3px;
          }
          
          .status-draft {
            background: #fef3c7;
            color: #92400e;
          }
          
          .status-sent {
            background: #dbeafe;
            color: #1e40af;
          }
          
          .status-confirmed {
            background: #d1fae5;
            color: #065f46;
          }
          
          .status-in_progress {
            background: #dbeafe;
            color: #1e40af;
          }
          
          .status-completed {
            background: #d1fae5;
            color: #065f46;
          }
          
          .status-cancelled {
            background: #fee2e2;
            color: #991b1b;
          }
          
          /* Responsive adjustments */
          @media print {
            .container {
              padding: 15px;
            }
            
            .header {
              flex-direction: row;
              gap: 20px;
            }
            
            .address-section {
              flex-direction: row;
              gap: 15px;
            }
            
            .po-section {
              text-align: left;
              width: 30%;
            }
          }
        </style>
      </head>
      <body>
        <div class="container">
          <!-- Professional Header -->
          <div class="header">
            <div class="company-section">
              ${logoBase64 ? `
                <div class="logo-container">
                  <img src="data:image/png;base64,${logoBase64}" alt="${company.name} Logo" class="logo">
                </div>
              ` : `
                <div class="logo-container">
                  <div style="width: 180px; height: 60px; background: linear-gradient(135deg, #1e40af, #3b82f6); border-radius: 8px; display: flex; align-items: center; justify-content: center; color: white; font-size: 20px; font-weight: 700;">
                    ${company.name.charAt(0).toUpperCase()}
                  </div>
                </div>
              `}
              <h1 class="company-name">${company.name}</h1>
              ${company.description ? `<p class="company-tagline">${company.description}</p>` : ''}
              <div class="company-details">
                ${company.address.street ? `<p>${company.address.street}</p>` : ''}
                ${company.address.city ? `<p>${company.address.city}, ${company.address.state} ${company.address.zipCode}</p>` : ''}
                ${company.address.country ? `<p>${company.address.country}</p>` : ''}
                ${company.email ? `<p>📧 ${company.email}</p>` : ''}
                ${company.phone ? `<p>📞 ${company.phone}</p>` : ''}
                ${company.website ? `<p>🌐 ${company.website}</p>` : ''}
              </div>
            </div>
            
            <div class="po-section">
              <h2 class="po-title">Purchase Order</h2>
              <div class="po-meta">
                <p><strong>PO #:</strong> ${purchaseOrder.poNumber}</p>
                <p><strong>Date:</strong> ${formatDate(purchaseOrder.createdAt)}</p>
                ${purchaseOrder.expectedDeliveryDate ? `<p><strong>Expected Delivery:</strong> ${formatDate(purchaseOrder.expectedDeliveryDate)}</p>` : ''}
                <div class="status-badge status-${purchaseOrder.status}">${purchaseOrder.status.replace('_', ' ')}</div>
              </div>
            </div>
          </div>

          <!-- Address Section -->
          <div class="address-section">
            <div class="address-block vendor">
              <h3 class="address-title">Supplier/Vendor</h3>
              <div class="address-content">
                <div class="address-name">${vendor.name}</div>
                ${vendor.email ? `<p>📧 ${vendor.email}</p>` : ''}
                ${vendor.phone ? `<p>📞 ${vendor.phone}</p>` : ''}
                ${vendor.address ? `
                  ${vendor.address.street ? `<p>${vendor.address.street}</p>` : ''}
                  ${vendor.address.city ? `<p>${vendor.address.city}, ${vendor.address.state} ${vendor.address.zipCode}</p>` : ''}
                  ${vendor.address.country ? `<p>${vendor.address.country}</p>` : ''}
                ` : ''}
              </div>
            </div>
            
            <div class="address-block delivery">
              <h3 class="address-title">Delivery Address</h3>
              <div class="address-content">
                <div class="address-name">${company.name}</div>
                ${company.description ? `<div class="address-company">${company.description}</div>` : ''}
                ${company.address.street ? `<p>${company.address.street}</p>` : ''}
                ${company.address.city ? `<p>${company.address.city}, ${company.address.state} ${company.address.zipCode}</p>` : ''}
                ${company.address.country ? `<p>${company.address.country}</p>` : ''}
                ${company.email ? `<p>📧 ${company.email}</p>` : ''}
                ${company.phone ? `<p>📞 ${company.phone}</p>` : ''}
              </div>
            </div>
          </div>

          <!-- PO Details -->
          <div class="po-details-section">
            <h3 class="po-details-title">Purchase Order Details</h3>
            <div class="po-details-content">
              <p><strong>Title:</strong> ${purchaseOrder.title}</p>
              ${purchaseOrder.description ? `<p><strong>Description:</strong> ${purchaseOrder.description}</p>` : ''}
              <p><strong>Priority:</strong> ${purchaseOrder.priority}</p>
              <p><strong>Status:</strong> ${purchaseOrder.status.replace('_', ' ')}</p>
                  ${purchaseOrder.approvedBy ? `<p><strong>Approved By:</strong> ${purchaseOrder.approvedBy}</p>` : ''}
            </div>
          </div>

          <!-- Professional Items Table -->
          <table class="items-table">
            <thead>
              <tr>
                <th>Item Name</th>
                <th>Description</th>
                <th class="text-right">Quantity</th>
                <th class="text-right">Unit Price</th>
                <th class="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              ${purchaseOrder.items.map(item => `
                <tr>
                  <td style="padding: 8px; max-width: 150px; word-wrap: break-word;">
                    <strong>${item.name || 'N/A'}</strong>
                  </td>
                  <td class="item-description" style="padding: 8px; max-width: 200px; word-wrap: break-word;">
                    ${item.description}
                  </td>
                  <td class="text-right" style="padding: 8px;">${item.quantity}</td>
                  <td class="text-right" style="padding: 8px;">${formatCurrency(item.unitPrice)}</td>
                  <td class="text-right" style="padding: 8px;">${formatCurrency(item.total)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>

          <!-- Professional Totals Section -->
          <div class="totals-section">
            <table class="totals-table">
              <tr class="subtotal-row">
                <td>Subtotal:</td>
                <td class="text-right">${formatCurrency(purchaseOrder.subtotal)}</td>
              </tr>
              <tr class="tax-row">
                <td>Tax (${purchaseOrder.taxRate}%):</td>
                <td class="text-right">${formatCurrency(purchaseOrder.taxAmount)}</td>
              </tr>
              <tr class="total-row">
                <td>Total:</td>
                <td class="text-right">${formatCurrency(purchaseOrder.total)}</td>
              </tr>
            </table>
          </div>

          <!-- Terms Section -->
          <div class="terms-section">
            <h3 class="terms-title">Terms & Conditions</h3>
            <div class="terms-content">${purchaseOrder.terms}</div>
          </div>

          <!-- Notes Section -->
          ${purchaseOrder.notes ? `
            <div class="notes-section">
              <h3 class="notes-title">Additional Notes</h3>
              <div class="notes-content">${purchaseOrder.notes}</div>
            </div>
          ` : ''}

          <!-- Professional Footer -->
          <div class="footer">
            <p>Thank you for your business!</p>
            <p>This purchase order is valid until ${purchaseOrder.expectedDeliveryDate ? formatDate(purchaseOrder.expectedDeliveryDate) : 'delivery completion'}</p>
            <p>System Generated on ${formatDate(new Date().toISOString())}</p>
          </div>
        </div>
      </body>
      </html>
    `;
};

module.exports = {
  generateQuotePDF,
  generateInvoicePDF,
  generateSOAPDF,
  generatePurchaseOrderPDF,
  // New export for Delivery Order PDFs
  generateDeliveryOrderPDF: async (sale, company, customer) => {
    // Build a delivery order HTML and render to PDF (no prices, includes SI No., image, qty)
    const formatDate = (dateString) => {
      return new Date(dateString).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    };

    const logoBase64 = await getLogoBase64(company.logo);

    const htmlContent = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Delivery Order ${sale.saleNumber}</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a1a; background: #ffffff; font-size: 10px; }
            .container { padding: 8px; }
            .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 2px solid #1e40af; }
            .logo { max-height: 35px; max-width: 120px; object-fit: contain; }
            .company-name { font-size: 16px; font-weight: 700; margin-bottom: 3px; }
            .company-details { font-size: 9px; color: #4b5563; }
            .doc-section { text-align: right; background: #f1f5f9; padding: 10px; border-radius: 6px; border: 1px solid #e2e8f0; min-width: 180px; }
            .doc-title { font-size: 14px; font-weight: 700; color: #1e40af; margin-bottom: 6px; letter-spacing: 0.8px; }
            .meta { font-size: 9px; color: #4b5563; }
            .address-section { display: flex; gap: 15px; margin: 12px 0 15px; }
            .address-block { flex: 1; background: #f8fafc; padding: 8px; border-radius: 4px; border-left: 2px solid #1e40af; }
            .address-title { font-size: 9px; font-weight: 600; margin-bottom: 5px; text-transform: uppercase; }
            .address-content { font-size: 8px; color: #4b5563; line-height: 1.2; }
            .items-table { width: 100%; border-collapse: collapse; margin-top: 8px; background: #ffffff; border-radius: 4px; overflow: hidden; }
            .items-table thead { background: linear-gradient(135deg, #1e40af, #3b82f6); color: #ffffff; }
            .items-table th { padding: 6px 8px; text-align: left; font-weight: 600; font-size: 8px; }
            .items-table td { padding: 6px 8px; border-bottom: 1px solid #f3f4f6; font-size: 8px; color: #4b5563; vertical-align: top; }
            .si-col { width: 28px; text-align: center; }
            .img-cell { text-align: center; width: 60px; }
            .img-ph { width: 40px; height: 40px; background: #f5f5f5; border-radius: 4px; display: inline-flex; align-items: center; justify-content: center; color: #999; font-size: 8px; }
            .ack { margin-top: 16px; padding: 10px; border: 1px dashed #1e40af; border-radius: 6px; background: #f8fafc; }
            .ack-title { font-weight: 700; color: #1e40af; margin-bottom: 6px; font-size: 10px; }
            .ack-text { font-size: 9px; color: #374151; margin-bottom: 10px; }
            .sign-row { display: flex; gap: 20px; margin-top: 18px; }
            .sign-block { flex: 1; text-align: center; }
            .line { border-top: 1px solid #1e40af; padding-top: 5px; margin-top: 30px; }
            .footer { margin-top: 16px; padding-top: 8px; border-top: 1px solid #e5e7eb; text-align: center; color: #6b7280; font-size: 7px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div>
                ${logoBase64 ? `<img src="data:image/png;base64,${logoBase64}" alt="${company.name} Logo" class="logo"/>` : ''}
                <div class="company-name">${company.name}</div>
                <div class="company-details">
                  ${company.address?.street ? `<div>${company.address.street}</div>` : ''}
                  ${company.address?.city ? `<div>${company.address.city}, ${company.address.state || ''} ${company.address.zipCode || ''}</div>` : ''}
                  ${company.address?.country ? `<div>${company.address.country}</div>` : ''}
                  ${company.email ? `<div>📧 ${company.email}</div>` : ''}
                  ${company.phone ? `<div>📞 ${company.phone}</div>` : ''}
                </div>
              </div>
              <div class="doc-section">
                <div class="doc-title">Delivery Order</div>
                <div class="meta">
                  <div><strong>DO #:</strong> ${sale.saleNumber}</div>
                  <div><strong>Date:</strong> ${formatDate(sale.saleDate || sale.createdAt)}</div>
                </div>
              </div>
            </div>

            <div class="address-section">
              <div class="address-block">
                <div class="address-title">Deliver To</div>
                <div class="address-content">
                  <div style="font-weight:600; color:#1a1a1a;">${customer ? `${customer.firstName} ${customer.lastName}` : (sale.customerName || 'Customer')}</div>
                  ${customer?.companyName ? `<div style="color:#6b7280;">${customer.companyName}</div>` : ''}
                  ${customer?.address?.street ? `<div>${customer.address.street}</div>` : ''}
                  ${customer?.address?.city ? `<div>${customer.address.city}, ${customer.address.state || ''} ${customer.address.zipCode || ''}</div>` : ''}
                  ${customer?.address?.country ? `<div>${customer.address.country}</div>` : ''}
                  ${customer?.email ? `<div>📧 ${customer.email}</div>` : ''}
                  ${customer?.phone ? `<div>📞 ${customer.phone}</div>` : ''}
                </div>
              </div>
            </div>

            <table class="items-table">
              <thead>
                <tr>
                  <th class="si-col">SI</th>
                  <th>Item Name</th>
                  <th>Image</th>
                  <th>Description</th>
                  <th style="text-align:right;">Quantity</th>
                </tr>
              </thead>
              <tbody>
                ${sale.items.map((item, idx) => {
      const product = item.product || {};
      const img = (product.images && product.images.length > 0) ? product.images[0] : null;
      const safeDesc = (product.description || item.description || '').toString();
      const safeName = (product.name || item.productName || item.name || 'N/A').toString();
      return `
                    <tr>
                      <td class="si-col">${idx + 1}</td>
                      <td><strong>${safeName}</strong>${product.sku ? `<div style="color:#6b7280; font-size:7px;">SKU: ${product.sku}</div>` : ''}</td>
                      <td class="img-cell">
                        ${img ? `<img src="${img}" alt="Product" style="width:40px; height:40px; object-fit:cover; border-radius:4px;"/>` : `<div class="img-ph">No Image</div>`}
                      </td>
                      <td style="max-width:240px; word-wrap:break-word;">${safeDesc}</td>
                      <td style="text-align:right; font-weight:600;">${item.quantity}</td>
                    </tr>
                  `;
    }).join('')}
              </tbody>
            </table>

            <div class="ack">
              <div class="ack-title">Acknowledgement of Receipt</div>
              <div class="ack-text">I received the above items in good order and condition.</div>
              <div class="ack-text"><strong>Client:</strong> ${customer ? `${customer.firstName} ${customer.lastName}` : (sale.customerName || 'Customer')}</div>
              <div class="sign-row">
                <div class="sign-block">
                  <div class="line">
                    <div style="font-size:8px; color:#4b5563;">Client Signature</div>
                  </div>
                </div>
                <div class="sign-block">
                  <div class="line">
                    <div style="font-size:8px; color:#4b5563;">Date Received</div>
                  </div>
                </div>
                <div class="sign-block">
                  <div class="line">
                    <div style="font-size:8px; color:#4b5563;">Company Signature</div>
                  </div>
                </div>
              </div>
            </div>

            <div class="footer">
              <p>Generated on ${formatDate(new Date().toISOString())}</p>
            </div>
          </div>
        </body>
        </html>
      `;

    try {
      ensureUploadsDir();
      const options = {
        format: 'A4',
        margin: { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' },
        printBackground: true,
        displayHeaderFooter: false,
        preferCSSPageSize: true,
        timeout: 60000,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          '--disable-extensions',
          '--disable-plugins',
          '--disable-javascript'
        ]
      };
      const pdfBuffer = await htmlPdf.generatePdf({ content: htmlContent }, options);
      return pdfBuffer;
    } catch (error) {
      // Fallback to Puppeteer
      const browser = await launchPuppeteer();
      const page = await browser.newPage();
      await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '8mm', right: '8mm', bottom: '8mm', left: '8mm' },
        preferCSSPageSize: true,
        displayHeaderFooter: false
      });
      await browser.close();
      return pdfBuffer;
    }
  }
};
