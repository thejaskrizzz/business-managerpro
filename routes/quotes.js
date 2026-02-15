const express = require('express');
const Quote = require('../models/Quote');
const Customer = require('../models/Customer');
const Company = require('../models/Company');
const { authenticateToken, requireSameCompany } = require('../middleware/auth');
const { generateQuotePDF } = require('../utils/pdfGenerator');
const { sendQuoteEmail } = require('../utils/emailService');

const router = express.Router();

// Get all quotes for the company
router.get('/', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      search, 
      status, 
      customerId,
      sortBy = 'createdAt', 
      sortOrder = 'desc' 
    } = req.query;
    
    const query = { 
      company: req.user.company._id
    };

    // Add search filter
    if (search) {
      query.$or = [
        { quoteNumber: { $regex: search, $options: 'i' } },
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    // Add status filter
    if (status) {
      query.status = status;
    }

    // Add customer filter
    if (customerId) {
      query.customer = customerId;
    }

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const quotes = await Quote.find(query)
      .populate('customer', 'firstName lastName email companyName')
      .populate('tax', 'name percentage')
      .populate('createdBy', 'firstName lastName')
      .sort(sortOptions)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Quote.countDocuments(query);

    res.json({
      quotes,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total
      }
    });
  } catch (error) {
    console.error('Get quotes error:', error);
    res.status(500).json({ 
      message: 'Failed to fetch quotes',
      error: error.message 
    });
  }
});

// Get quote by ID
router.get('/:id', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const quote = await Quote.findOne({
      _id: req.params.id,
      company: req.user.company._id
    })
    .populate('customer')
    .populate('tax', 'name percentage')
    .populate('createdBy', 'firstName lastName');

    if (!quote) {
      return res.status(404).json({ 
        message: 'Quote not found' 
      });
    }

    res.json({ quote });
  } catch (error) {
    console.error('Get quote error:', error);
    res.status(500).json({ 
      message: 'Failed to fetch quote',
      error: error.message 
    });
  }
});

// Create new quote
router.post('/', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const { customerId, ...quoteData } = req.body;

    // Verify customer exists and belongs to company
    const customer = await Customer.findOne({
      _id: customerId,
      company: req.user.company._id,
      isActive: true
    });

    if (!customer) {
      return res.status(404).json({ 
        message: 'Customer not found' 
      });
    }

    // Generate quote number
    const company = await Company.findById(req.user.company._id);
    const quoteNumber = company.generateQuoteNumber();
    await company.save();

    // Set default validity if not provided
    if (!quoteData.validUntil) {
      const validityDays = company.settings?.quoteValidityDays || 14;
      const validUntil = new Date();
      validUntil.setDate(validUntil.getDate() + validityDays);
      quoteData.validUntil = validUntil;
    }

    const quote = new Quote({
      ...quoteData,
      customer: customerId,
      company: req.user.company._id,
      createdBy: req.user._id,
      quoteNumber
    });

    await quote.save();

    // Update customer statistics
    await customer.updateStats();

    await quote.populate('customer');
    await quote.populate('tax');
    await quote.populate('createdBy', 'firstName lastName');

    res.status(201).json({
      message: 'Quote created successfully',
      quote
    });
  } catch (error) {
    console.error('Create quote error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ 
        message: 'Validation error',
        errors: Object.values(error.errors).map(err => err.message)
      });
    }
    res.status(500).json({ 
      message: 'Failed to create quote',
      error: error.message 
    });
  }
});

// Update quote
router.put('/:id', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const quote = await Quote.findOne({
      _id: req.params.id,
      company: req.user.company._id
    });

    if (!quote) {
      return res.status(404).json({ 
        message: 'Quote not found' 
      });
    }

    // Extract customerId if present and validate
    const { customerId, ...quoteData } = req.body;
    const oldCustomerId = quote.customer.toString();
    let newCustomerId = oldCustomerId;

    // If customer is being changed, validate the new customer
    if (customerId && customerId !== oldCustomerId) {
      const newCustomer = await Customer.findOne({
        _id: customerId,
        company: req.user.company._id,
        isActive: true
      });

      if (!newCustomer) {
        return res.status(404).json({ 
          message: 'Customer not found' 
        });
      }

      newCustomerId = customerId;
      quoteData.customer = customerId;
    }

    // Update quote fields
    Object.assign(quote, quoteData);
    
    // Save the quote to trigger pre-save middleware for recalculation
    await quote.save();

    // Update customer statistics for both old and new customers if changed
    if (oldCustomerId !== newCustomerId) {
      // Update old customer stats
      const oldCustomer = await Customer.findById(oldCustomerId);
      if (oldCustomer) {
        await oldCustomer.updateStats();
      }
      
      // Update new customer stats
      const newCustomer = await Customer.findById(newCustomerId);
      if (newCustomer) {
        await newCustomer.updateStats();
      }
    } else {
      // Update current customer statistics
      const customer = await Customer.findById(quote.customer);
      if (customer) {
        await customer.updateStats();
      }
    }

    // Populate the updated quote
    await quote.populate('customer');
    await quote.populate('createdBy', 'firstName lastName');

    res.json({
      message: 'Quote updated successfully',
      quote
    });
  } catch (error) {
    console.error('Update quote error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ 
        message: 'Validation error',
        errors: Object.values(error.errors).map(err => err.message)
      });
    }
    res.status(500).json({ 
      message: 'Failed to update quote',
      error: error.message 
    });
  }
});

// Delete quote
router.delete('/:id', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const quote = await Quote.findOne({
      _id: req.params.id,
      company: req.user.company._id
    });

    if (!quote) {
      return res.status(404).json({ 
        message: 'Quote not found' 
      });
    }

    // Store customer ID before deletion
    const customerId = quote.customer;

    // Delete the quote
    await Quote.findByIdAndDelete(quote._id);

    // Update customer statistics
    const customer = await Customer.findById(customerId);
    if (customer) {
      await customer.updateStats();
    }

    res.json({ 
      message: 'Quote deleted successfully' 
    });
  } catch (error) {
    console.error('Delete quote error:', error);
    res.status(500).json({ 
      message: 'Failed to delete quote',
      error: error.message 
    });
  }
});

// Send quote (mark as sent and send email)
router.post('/:id/send', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const quote = await Quote.findOne({
      _id: req.params.id,
      company: req.user.company._id
    }).populate('customer').populate('company');

    if (!quote) {
      return res.status(404).json({ 
        message: 'Quote not found' 
      });
    }

    if (quote.status !== 'draft') {
      return res.status(400).json({ 
        message: 'Only draft quotes can be sent' 
      });
    }

    // Mark quote as sent
    await quote.markAsSent();

    // Send email to customer
    let emailResult = null;
    if (quote.customer.email) {
      try {
        emailResult = await sendQuoteEmail(quote, quote.customer.email);
        console.log('Email send result:', emailResult);
      } catch (emailError) {
        console.error('Email sending failed:', emailError);
        // Don't fail the entire request if email fails
        emailResult = {
          success: false,
          error: emailError.message,
          message: 'Quote marked as sent but email failed to send'
        };
      }
    } else {
      emailResult = {
        success: false,
        message: 'Customer email not available'
      };
    }

    res.json({
      message: 'Quote sent successfully',
      quote,
      email: emailResult
    });
  } catch (error) {
    console.error('Send quote error:', error);
    res.status(500).json({ 
      message: 'Failed to send quote',
      error: error.message 
    });
  }
});

// Accept quote
router.post('/:id/accept', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const quote = await Quote.findOne({
      _id: req.params.id,
      company: req.user.company._id
    });

    if (!quote) {
      return res.status(404).json({ 
        message: 'Quote not found' 
      });
    }

    if (!['sent', 'viewed'].includes(quote.status)) {
      return res.status(400).json({ 
        message: 'Only sent or viewed quotes can be accepted' 
      });
    }

    await quote.accept();

    res.json({
      message: 'Quote accepted successfully',
      quote
    });
  } catch (error) {
    console.error('Accept quote error:', error);
    res.status(500).json({ 
      message: 'Failed to accept quote',
      error: error.message 
    });
  }
});

// Reject quote
router.post('/:id/reject', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const { reason } = req.body;
    const quote = await Quote.findOne({
      _id: req.params.id,
      company: req.user.company._id
    });

    if (!quote) {
      return res.status(404).json({ 
        message: 'Quote not found' 
      });
    }

    if (!['sent', 'viewed'].includes(quote.status)) {
      return res.status(400).json({ 
        message: 'Only sent or viewed quotes can be rejected' 
      });
    }

    await quote.reject(reason);

    res.json({
      message: 'Quote rejected successfully',
      quote
    });
  } catch (error) {
    console.error('Reject quote error:', error);
    res.status(500).json({ 
      message: 'Failed to reject quote',
      error: error.message 
    });
  }
});

// Duplicate quote
router.post('/:id/duplicate', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const originalQuote = await Quote.findOne({
      _id: req.params.id,
      company: req.user.company._id
    });

    if (!originalQuote) {
      return res.status(404).json({ 
        message: 'Quote not found' 
      });
    }

    // Generate new quote number
    const company = await Company.findById(req.user.company._id);
    const quoteNumber = company.generateQuoteNumber();
    await company.save();

    // Create duplicate
    const duplicateData = originalQuote.toObject();
    delete duplicateData._id;
    delete duplicateData.createdAt;
    delete duplicateData.updatedAt;
    delete duplicateData.sentAt;
    delete duplicateData.viewedAt;
    delete duplicateData.acceptedAt;
    delete duplicateData.rejectedAt;
    delete duplicateData.rejectionReason;

    const duplicateQuote = new Quote({
      ...duplicateData,
      quoteNumber,
      title: `${originalQuote.title} (Copy)`,
      status: 'draft',
      createdBy: req.user._id
    });

    await duplicateQuote.save();

    await duplicateQuote.populate('customer');
    await duplicateQuote.populate('createdBy', 'firstName lastName');

    res.status(201).json({
      message: 'Quote duplicated successfully',
      quote: duplicateQuote
    });
  } catch (error) {
    console.error('Duplicate quote error:', error);
    res.status(500).json({ 
      message: 'Failed to duplicate quote',
      error: error.message 
    });
  }
});

// Generate PDF for quote with improved timeout handling
router.get('/:id/pdf', authenticateToken, requireSameCompany, async (req, res) => {
  // Set a longer timeout for this endpoint (5 minutes)
  req.setTimeout(300000);
  
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error('PDF generation timed out after 5 minutes'));
    }, 290000); // Reject 10 seconds before the actual timeout
  });

  try {
    const quote = await Quote.findOne({
      _id: req.params.id,
      company: req.user.company._id
    })
    .populate('customer')
    .populate('createdBy', 'firstName lastName');

    if (!quote) {
      return res.status(404).json({ 
        message: 'Quote not found' 
      });
    }

    const company = await Company.findById(req.user.company._id);
    if (!company) {
      return res.status(404).json({ 
        message: 'Company not found' 
      });
    }

    // Race between PDF generation and timeout
    const pdfResult = await Promise.race([
      generateQuotePDF(quote, company, quote.customer),
      timeoutPromise
    ]);

    // Clear the timeout if PDF generation completes in time
    clearTimeout(timeout);

    if (pdfResult.isHtml) {
      console.log('Sending HTML response (PDF generation fallback)');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
    } else {
      console.log('Sending PDF response');
      res.setHeader('Content-Type', 'application/pdf');
    }
    
    res.setHeader('Content-Disposition', `attachment; filename="${pdfResult.filename}"`);
    res.send(pdfResult.buffer);

  } catch (error) {
    console.error('PDF generation error:', error);
    
    // Clear the timeout in case of error
    if (timeout) clearTimeout(timeout);
    
    // Return error as JSON with appropriate status code
    if (error.message.includes('timed out')) {
      return res.status(504).json({ 
        message: 'PDF generation took too long. Please try again or contact support.',
        error: 'timeout'
      });
    }
    
    // Fallback to HTML response
    try {
      console.log('Falling back to HTML response due to error');
      const quote = await Quote.findOne({
        _id: req.params.id,
        company: req.user.company._id
      })
      .populate('customer')
      .populate('createdBy', 'firstName lastName');
      
      if (!quote) {
        return res.status(404).json({ message: 'Quote not found' });
      }
      
      const company = await Company.findById(req.user.company._id);
      if (!company) {
        return res.status(404).json({ message: 'Company not found' });
      }
      
      const htmlContent = await generateQuoteHTML(quote, company, quote.customer, null, true);
      
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="quote-${quote.quoteNumber}.html"`);
      return res.send(Buffer.from(htmlContent));
      
    } catch (fallbackError) {
      console.error('Fallback HTML generation also failed:', fallbackError);
      res.status(500).json({ 
        message: 'Failed to generate PDF and fallback HTML',
        error: error.message 
      });
    }
  }
});

// Get quote statistics
router.get('/stats/overview', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const companyId = new mongoose.Types.ObjectId(req.user.company._id);
    
    const stats = await Quote.aggregate([
      { $match: { company: companyId } },
      { $group: { 
        _id: null, 
        totalQuotes: { $sum: 1 },
        totalQuoteValue: { $sum: '$total' },
        averageValue: { $avg: '$total' },
        draftQuotes: { $sum: { $cond: [{ $eq: ['$status', 'draft'] }, 1, 0] } },
        sentQuotes: { $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] } },
        viewedQuotes: { $sum: { $cond: [{ $eq: ['$status', 'viewed'] }, 1, 0] } },
        acceptedQuotes: { $sum: { $cond: [{ $eq: ['$status', 'accepted'] }, 1, 0] } },
        rejectedQuotes: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
        expiredQuotes: { $sum: { $cond: [{ $eq: ['$status', 'expired'] }, 1, 0] } }
      }}
    ]);

    const result = stats[0] || {
      totalQuotes: 0,
      totalQuoteValue: 0,
      averageValue: 0,
      draftQuotes: 0,
      sentQuotes: 0,
      viewedQuotes: 0,
      acceptedQuotes: 0,
      rejectedQuotes: 0,
      expiredQuotes: 0
    };

    res.json(result);
  } catch (error) {
    console.error('Get quote stats error:', error);
    res.status(500).json({ 
      message: 'Failed to fetch quote statistics',
      error: error.message 
    });
  }
});

module.exports = router;
