const express = require('express');
const router = express.Router();
const Invoice = require('../models/Invoice');
const Customer = require('../models/Customer');
const Quote = require('../models/Quote');
const Company = require('../models/Company');
const { authenticateToken, requireRole, requireSameCompany } = require('../middleware/auth');
const { sendInvoiceEmail } = require('../utils/emailService');

// Get all invoices with pagination and filtering
router.get('/', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    const filters = {
      company: req.user.company._id
    };
    
    // Add status filter
    if (req.query.status) {
      filters.status = req.query.status;
    }
    
    // Add customer filter
    if (req.query.customerId) {
      filters.customer = req.query.customerId;
    }
    
    // Add date range filter
    if (req.query.startDate || req.query.endDate) {
      filters.createdAt = {};
      if (req.query.startDate) {
        filters.createdAt.$gte = new Date(req.query.startDate);
      }
      if (req.query.endDate) {
        filters.createdAt.$lte = new Date(req.query.endDate);
      }
    }
    
    const invoices = await Invoice.find(filters)
      .populate('customer', 'firstName lastName companyName email')
      .populate('tax', 'name percentage')
      .populate('createdBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
    
    const total = await Invoice.countDocuments(filters);
    const pages = Math.ceil(total / limit);
    
    res.json({
      invoices,
      pagination: {
        current: page,
        pages,
        total,
        limit
      }
    });
  } catch (error) {
    console.error('Get invoices error:', error);
    res.status(500).json({ message: 'Failed to fetch invoices' });
  }
});

// Get single invoice
router.get('/:id', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate('customer')
      .populate('createdBy', 'firstName lastName')
      .populate('originalQuote');
    
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }
    
    // Check if invoice belongs to user's company
    if (invoice.company.toString() !== req.user.company._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    res.json({ invoice });
  } catch (error) {
    console.error('Get invoice error:', error);
    res.status(500).json({ message: 'Failed to fetch invoice' });
  }
});

// Create new invoice
router.post('/', authenticateToken, requireRole('admin', 'manager'), requireSameCompany, async (req, res) => {
  try {
    const invoiceData = {
      ...req.body,
      company: req.user.company._id,
      createdBy: req.user._id
    };
    
    // Debug: Log the invoice data before saving
    console.log('Creating new invoice with data:', {
      customer: invoiceData.customer,
      company: invoiceData.company,
      title: invoiceData.title,
      items: invoiceData.items?.length || 0,
      subtotal: invoiceData.subtotal,
      total: invoiceData.total
    });
    
    const invoice = new Invoice(invoiceData);
    await invoice.save();
    
    await invoice.populate('customer', 'firstName lastName companyName email');
    await invoice.populate('tax', 'name percentage');
    await invoice.populate('createdBy', 'firstName lastName');
    
    res.status(201).json({ invoice });
  } catch (error) {
    console.error('Create invoice error:', error);
    
    // Log detailed error information
    if (error.name === 'ValidationError') {
      console.error('Validation errors:', error.errors);
      return res.status(400).json({ 
        message: 'Invoice validation failed', 
        errors: Object.keys(error.errors).map(key => ({
          field: key,
          message: error.errors[key].message
        }))
      });
    }
    
    res.status(500).json({ 
      message: 'Failed to create invoice',
      error: error.message 
    });
  }
});

// Convert quote to invoice
router.post('/convert-from-quote/:quoteId', authenticateToken, requireRole('admin', 'manager'), requireSameCompany, async (req, res) => {
  try {
    const quote = await Quote.findById(req.params.quoteId)
      .populate('customer')
      .populate('company');
    
    if (!quote) {
      return res.status(404).json({ message: 'Quote not found' });
    }
    
    // Check if quote belongs to user's company
    if (quote.company._id.toString() !== req.user.company._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    const company = await Company.findById(req.user.company._id);
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }
    
    // Calculate due date (30 days from now by default)
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);
    
    const invoiceData = {
      customer: quote.customer._id,
      company: quote.company._id,
      title: quote.title,
      description: quote.description,
      items: quote.items.map(item => ({
        name: item.name || item.description, // Use name if available, fallback to description
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        total: item.total
      })),
      subtotal: quote.subtotal,
      tax: quote.tax,
      taxRate: quote.taxRate,
      taxAmount: quote.taxAmount,
      total: quote.total,
      status: 'draft',
      dueDate: req.body.dueDate || dueDate,
      terms: quote.terms,
      notes: quote.notes,
      createdBy: req.user._id,
      originalQuote: quote._id
    };
    
    const invoice = new Invoice(invoiceData);
    
    // Debug: Log the invoice data before saving
    console.log('Converting quote to invoice:', {
      quoteId: quote._id,
      customer: invoiceData.customer,
      company: invoiceData.company,
      title: invoiceData.title,
      items: invoiceData.items.length,
      subtotal: invoiceData.subtotal,
      total: invoiceData.total
    });
    
    await invoice.save();
    
    await invoice.populate('customer', 'firstName lastName companyName email');
    await invoice.populate('createdBy', 'firstName lastName');
    await invoice.populate('originalQuote');
    
    res.status(201).json({ invoice });
  } catch (error) {
    console.error('Convert quote to invoice error:', error);
    
    // Log detailed error information
    if (error.name === 'ValidationError') {
      console.error('Validation errors:', error.errors);
      return res.status(400).json({ 
        message: 'Invoice validation failed', 
        errors: Object.keys(error.errors).map(key => ({
          field: key,
          message: error.errors[key].message
        }))
      });
    }
    
    res.status(500).json({ message: 'Failed to convert quote to invoice' });
  }
});

// Update invoice
router.put('/:id', authenticateToken, requireRole('admin', 'manager'), requireSameCompany, async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }
    
    // Check if invoice belongs to user's company
    if (invoice.company.toString() !== req.user.company._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    // Update invoice fields
    Object.assign(invoice, req.body);
    
    // Save the invoice to trigger pre-save middleware for recalculation
    await invoice.save();
    
    // Populate the updated invoice
    await invoice.populate('customer', 'firstName lastName companyName email');
    await invoice.populate('createdBy', 'firstName lastName');
    
    res.json({ invoice });
  } catch (error) {
    console.error('Update invoice error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ 
        message: 'Validation error',
        errors: Object.values(error.errors).map(err => err.message)
      });
    }
    res.status(500).json({ message: 'Failed to update invoice' });
  }
});

// Update invoice status
router.patch('/:id/status', authenticateToken, requireRole('admin', 'manager'), requireSameCompany, async (req, res) => {
  try {
    const { status } = req.body;
    
    const invoice = await Invoice.findById(req.params.id);
    
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }
    
    // Check if invoice belongs to user's company
    if (invoice.company.toString() !== req.user.company._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    invoice.status = status;
    await invoice.save();
    
    res.json({ invoice });
  } catch (error) {
    console.error('Update invoice status error:', error);
    res.status(500).json({ message: 'Failed to update invoice status' });
  }
});

// Add payment to invoice
router.post('/:id/payments', authenticateToken, requireRole('admin', 'manager'), requireSameCompany, async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }
    
    // Check if invoice belongs to user's company
    if (invoice.company.toString() !== req.user.company._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    invoice.payments.push(req.body);
    await invoice.save();
    
    // Update status to paid if fully paid
    if (invoice.paidAmount >= invoice.total) {
      invoice.status = 'paid';
      await invoice.save();
    }
    
    res.json({ invoice });
  } catch (error) {
    console.error('Add payment error:', error);
    res.status(500).json({ message: 'Failed to add payment' });
  }
});

// Delete invoice
router.delete('/:id', authenticateToken, requireRole('admin'), requireSameCompany, async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id);
    
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }
    
    // Check if invoice belongs to user's company
    if (invoice.company.toString() !== req.user.company._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    await Invoice.findByIdAndDelete(req.params.id);
    
    res.json({ message: 'Invoice deleted successfully' });
  } catch (error) {
    console.error('Delete invoice error:', error);
    res.status(500).json({ message: 'Failed to delete invoice' });
  }
});

// Generate invoice PDF
router.get('/:id/pdf', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate('customer')
      .populate('company')
      .populate('createdBy', 'firstName lastName');
    
    if (!invoice) {
      return res.status(404).json({ message: 'Invoice not found' });
    }
    
    // Check if invoice belongs to user's company
    if (invoice.company._id.toString() !== req.user.company._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }
    
    const { generateInvoicePDF } = require('../utils/pdfGenerator');
    const pdfResult = await generateInvoicePDF(invoice, invoice.company, invoice.customer);
    
    if (pdfResult && pdfResult.isHtml) {
      // Fallback to HTML if PDF generation failed
      console.log('Sending HTML response for invoice');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${pdfResult.filename}"`);
      res.send(pdfResult.buffer);
    } else {
      // Normal PDF response
      console.log('Sending PDF response for invoice');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.invoiceNumber}.pdf"`);
      res.send(pdfResult);
    }
  } catch (error) {
    console.error('Generate invoice PDF error:', error);
    res.status(500).json({ message: 'Failed to generate invoice PDF' });
  }
});

// Get invoice statistics
router.get('/stats/overview', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const companyId = req.user.company._id;
    
    const stats = await Invoice.aggregate([
      { $match: { company: companyId } },
      {
        $group: {
          _id: null,
          totalInvoices: { $sum: 1 },
          totalValue: { $sum: '$total' },
          paidValue: { $sum: '$paidAmount' },
          outstandingValue: { $sum: { $subtract: ['$total', '$paidAmount'] } },
          averageValue: { $avg: '$total' }
        }
      }
    ]);
    
    const statusStats = await Invoice.aggregate([
      { $match: { company: companyId } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          value: { $sum: '$total' }
        }
      }
    ]);
    
    const monthlyStats = await Invoice.aggregate([
      { $match: { company: companyId } },
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' }
          },
          count: { $sum: 1 },
          value: { $sum: '$total' }
        }
      },
      { $sort: { '_id.year': -1, '_id.month': -1 } },
      { $limit: 12 }
    ]);
    
    res.json({
      overview: stats[0] || {
        totalInvoices: 0,
        totalValue: 0,
        paidValue: 0,
        outstandingValue: 0,
        averageValue: 0
      },
      statusBreakdown: statusStats,
      monthlyTrends: monthlyStats
    });
  } catch (error) {
    console.error('Get invoice stats error:', error);
    res.status(500).json({ message: 'Failed to fetch invoice statistics' });
  }
});

// Send invoice (mark as sent and send email)
router.post('/:id/send', authenticateToken, requireRole('admin', 'manager'), requireSameCompany, async (req, res) => {
  try {
    const invoice = await Invoice.findOne({
      _id: req.params.id,
      company: req.user.company._id
    }).populate('customer').populate('company');

    if (!invoice) {
      return res.status(404).json({ 
        message: 'Invoice not found' 
      });
    }

    if (invoice.status === 'paid') {
      return res.status(400).json({ 
        message: 'Paid invoices cannot be sent' 
      });
    }

    // Update invoice status to sent if it's draft
    if (invoice.status === 'draft') {
      invoice.status = 'sent';
      await invoice.save();
    }

    // Send email to customer
    let emailResult = null;
    if (invoice.customer.email) {
      try {
        emailResult = await sendInvoiceEmail(invoice, invoice.customer.email);
        console.log('Invoice email send result:', emailResult);
      } catch (emailError) {
        console.error('Invoice email sending failed:', emailError);
        // Don't fail the entire request if email fails
        emailResult = {
          success: false,
          error: emailError.message,
          message: 'Invoice marked as sent but email failed to send'
        };
      }
    } else {
      emailResult = {
        success: false,
        message: 'Customer email not available'
      };
    }

    res.json({
      message: 'Invoice sent successfully',
      invoice,
      email: emailResult
    });
  } catch (error) {
    console.error('Send invoice error:', error);
    res.status(500).json({ 
      message: 'Failed to send invoice',
      error: error.message 
    });
  }
});

module.exports = router;
