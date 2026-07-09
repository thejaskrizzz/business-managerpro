const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const CreditNote = require('../models/CreditNote');
const Invoice = require('../models/Invoice');
const Sale = require('../models/Sale');
const Product = require('../models/Product');
const Customer = require('../models/Customer');
const Company = require('../models/Company');
const { authenticateToken, requireRole, requireSameCompany } = require('../middleware/auth');

// Get all credit notes with pagination and filtering
router.get('/', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const filters = {
      company: req.user.company._id
    };

    if (req.query.status) {
      filters.status = req.query.status;
    }

    if (req.query.customerId) {
      filters.customer = req.query.customerId;
    }

    if (req.query.search) {
      filters.$or = [
        { creditNoteNumber: { $regex: req.query.search, $options: 'i' } }
      ];
    }

    if (req.query.startDate || req.query.endDate) {
      filters.createdAt = {};
      if (req.query.startDate) {
        filters.createdAt.$gte = new Date(req.query.startDate);
      }
      if (req.query.endDate) {
        filters.createdAt.$lte = new Date(req.query.endDate);
      }
    }

    const creditNotes = await CreditNote.find(filters)
      .populate('customer', 'firstName lastName companyName email phone')
      .populate('originalInvoice', 'invoiceNumber total')
      .populate('originalSale', 'saleNumber total')
      .populate('createdBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await CreditNote.countDocuments(filters);
    const pages = Math.ceil(total / limit);

    res.json({
      creditNotes,
      pagination: {
        current: page,
        pages,
        total,
        limit
      }
    });
  } catch (error) {
    console.error('Get credit notes error:', error);
    res.status(500).json({ message: 'Failed to fetch credit notes' });
  }
});

// Get credit note statistics
router.get('/stats/overview', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const companyId = req.user.company._id;

    const stats = await CreditNote.aggregate([
      { $match: { company: companyId } },
      {
        $group: {
          _id: null,
          totalCreditNotes: { $sum: 1 },
          totalCreditAmount: { $sum: '$creditAmount' },
          totalUsed: { $sum: '$usedAmount' },
          totalOutstanding: { $sum: '$remainingBalance' }
        }
      }
    ]);

    const statusStats = await CreditNote.aggregate([
      { $match: { company: companyId } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          amount: { $sum: '$creditAmount' },
          remaining: { $sum: '$remainingBalance' }
        }
      }
    ]);

    const statusBreakdown = {};
    statusStats.forEach(s => {
      statusBreakdown[s._id] = { count: s.count, amount: s.amount, remaining: s.remaining };
    });

    res.json({
      overview: stats[0] || {
        totalCreditNotes: 0,
        totalCreditAmount: 0,
        totalUsed: 0,
        totalOutstanding: 0
      },
      statusBreakdown
    });
  } catch (error) {
    console.error('Get credit note stats error:', error);
    res.status(500).json({ message: 'Failed to fetch credit note statistics' });
  }
});

// Get outstanding credit notes report
router.get('/reports/outstanding', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const creditNotes = await CreditNote.find({
      company: req.user.company._id,
      status: { $in: ['unused', 'partially_used'] }
    })
      .populate('customer', 'firstName lastName companyName email')
      .populate('originalInvoice', 'invoiceNumber')
      .populate('originalSale', 'saleNumber')
      .sort({ createdAt: 1 });

    const customerSummary = await CreditNote.aggregate([
      {
        $match: {
          company: req.user.company._id,
          status: { $in: ['unused', 'partially_used'] }
        }
      },
      {
        $group: {
          _id: '$customer',
          totalOutstanding: { $sum: '$remainingBalance' },
          creditNoteCount: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: 'customers',
          localField: '_id',
          foreignField: '_id',
          as: 'customerDetails'
        }
      },
      { $unwind: '$customerDetails' },
      {
        $project: {
          customerId: '$_id',
          customerName: { $concat: ['$customerDetails.firstName', ' ', '$customerDetails.lastName'] },
          totalOutstanding: 1,
          creditNoteCount: 1
        }
      },
      { $sort: { totalOutstanding: -1 } }
    ]);

    res.json({
      creditNotes,
      customerSummary
    });
  } catch (error) {
    console.error('Get outstanding credit notes error:', error);
    res.status(500).json({ message: 'Failed to fetch outstanding credit notes' });
  }
});

// Get customer credit balance
router.get('/customer/:customerId/balance', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const customerId = req.params.customerId;

    const creditNotes = await CreditNote.find({
      company: req.user.company._id,
      customer: customerId,
      status: { $in: ['unused', 'partially_used'] }
    })
      .populate('originalInvoice', 'invoiceNumber')
      .populate('originalSale', 'saleNumber')
      .sort({ createdAt: 1 });

    const stats = await CreditNote.aggregate([
      {
        $match: {
          company: req.user.company._id,
          customer: new mongoose.Types.ObjectId(customerId)
        }
      },
      {
        $group: {
          _id: null,
          totalCredit: { $sum: '$creditAmount' },
          totalUsed: { $sum: '$usedAmount' },
          remainingBalance: { $sum: '$remainingBalance' }
        }
      }
    ]);

    res.json({
      balance: stats[0] || { totalCredit: 0, totalUsed: 0, remainingBalance: 0 },
      availableCreditNotes: creditNotes
    });
  } catch (error) {
    console.error('Get customer credit balance error:', error);
    res.status(500).json({ message: 'Failed to fetch customer credit balance' });
  }
});

// Get all credit notes for a customer
router.get('/customer/:customerId', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const creditNotes = await CreditNote.find({
      company: req.user.company._id,
      customer: req.params.customerId
    })
      .populate('originalInvoice', 'invoiceNumber total')
      .populate('originalSale', 'saleNumber total')
      .populate('createdBy', 'firstName lastName')
      .sort({ createdAt: -1 });

    res.json({ creditNotes });
  } catch (error) {
    console.error('Get customer credit notes error:', error);
    res.status(500).json({ message: 'Failed to fetch customer credit notes' });
  }
});

// Get single credit note
router.get('/:id', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const creditNote = await CreditNote.findById(req.params.id)
      .populate('customer', 'firstName lastName companyName email phone address')
      .populate('originalInvoice')
      .populate('originalSale')
      .populate('createdBy', 'firstName lastName')
      .populate('redemptions.invoice', 'invoiceNumber total')
      .populate('redemptions.sale', 'saleNumber total');

    if (!creditNote) {
      return res.status(404).json({ message: 'Credit note not found' });
    }

    if (creditNote.company.toString() !== req.user.company._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    res.json({ creditNote });
  } catch (error) {
    console.error('Get credit note error:', error);
    res.status(500).json({ message: 'Failed to fetch credit note' });
  }
});

// Create credit note from invoice return
router.post('/', authenticateToken, requireRole('admin', 'manager'), requireSameCompany, async (req, res) => {
  try {
    const { sourceType, sourceId, returnedItems, returnReason, notes } = req.body;

    if (!sourceType || !sourceId || !returnedItems || returnedItems.length === 0) {
      return res.status(400).json({
        message: 'Source type, source ID, and at least one return item are required'
      });
    }

    let source, sourceItems, customerId, taxRate;

    if (sourceType === 'invoice') {
      source = await Invoice.findById(sourceId).populate('customer');
      if (!source) {
        return res.status(404).json({ message: 'Invoice not found' });
      }
      if (source.company.toString() !== req.user.company._id.toString()) {
        return res.status(403).json({ message: 'Access denied' });
      }
      sourceItems = source.items;
      customerId = source.customer._id;
      taxRate = source.taxRate || 0;
    } else if (sourceType === 'sale') {
      source = await Sale.findById(sourceId);
      if (!source) {
        return res.status(404).json({ message: 'Sale not found' });
      }
      if (source.company.toString() !== req.user.company._id.toString()) {
        return res.status(403).json({ message: 'Access denied' });
      }
      sourceItems = source.items;
      customerId = source.customer;
      taxRate = source.taxRate || 0;
    } else {
      return res.status(400).json({ message: 'Invalid source type. Must be "invoice" or "sale".' });
    }

    // Find existing credit notes for this source to check already-returned quantities
    const existingCNs = await CreditNote.find({
      company: req.user.company._id,
      [sourceType === 'invoice' ? 'originalInvoice' : 'originalSale']: sourceId
    });

    // Build map of already returned quantities per product/item
    const alreadyReturned = {};
    existingCNs.forEach(cn => {
      cn.returnedItems.forEach(item => {
        const key = item.product ? item.product.toString() : item.productName;
        alreadyReturned[key] = (alreadyReturned[key] || 0) + item.quantity;
      });
    });

    // Validate return items
    const validatedItems = [];
    for (const returnItem of returnedItems) {
      // Find matching item in source
      let sourceItem;
      if (sourceType === 'invoice') {
        sourceItem = sourceItems.find(item =>
          item.name === returnItem.productName ||
          (returnItem.itemIndex !== undefined && sourceItems.indexOf(item) === returnItem.itemIndex)
        );
      } else {
        sourceItem = sourceItems.find(item =>
          (item.product && returnItem.product && item.product.toString() === returnItem.product) ||
          item.productName === returnItem.productName
        );
      }

      if (!sourceItem) {
        return res.status(400).json({
          message: `Item "${returnItem.productName}" not found in original ${sourceType}`
        });
      }

      const originalQty = sourceType === 'invoice' ? sourceItem.quantity : sourceItem.quantity;
      const key = sourceType === 'invoice'
        ? (returnItem.productName || sourceItem.name)
        : (sourceItem.product ? sourceItem.product.toString() : sourceItem.productName);
      const previouslyReturned = alreadyReturned[key] || 0;
      const maxReturnableQty = originalQty - previouslyReturned;

      if (returnItem.quantity > maxReturnableQty) {
        return res.status(400).json({
          message: `Cannot return ${returnItem.quantity} of "${returnItem.productName}". Maximum returnable: ${maxReturnableQty} (original: ${originalQty}, already returned: ${previouslyReturned})`
        });
      }

      if (returnItem.quantity <= 0) {
        return res.status(400).json({
          message: `Return quantity must be greater than 0 for "${returnItem.productName}"`
        });
      }

      const unitPrice = sourceType === 'invoice' ? sourceItem.unitPrice : sourceItem.unitPrice;

      validatedItems.push({
        product: sourceType === 'sale' ? sourceItem.product : returnItem.product,
        productName: sourceType === 'invoice' ? sourceItem.name : sourceItem.productName,
        productSku: sourceType === 'sale' ? sourceItem.productSku : (returnItem.productSku || ''),
        quantity: returnItem.quantity,
        unitPrice: unitPrice,
        total: returnItem.quantity * unitPrice
      });
    }

    // Update inventory — add stock back for returned items
    for (const item of validatedItems) {
      if (item.product) {
        const product = await Product.findById(item.product);
        if (product && product.isTrackable) {
          await product.updateStock(item.quantity, 'add');
        }
      }
    }

    // Get company settings for expiry
    const company = await Company.findById(req.user.company._id);
    let expiryDate = null;
    if (company && company.settings && company.settings.creditNoteExpiryEnabled && company.settings.creditNoteExpiryDays) {
      expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + company.settings.creditNoteExpiryDays);
    }

    // Create credit note
    const creditNoteData = {
      company: req.user.company._id,
      customer: customerId,
      sourceType,
      originalInvoice: sourceType === 'invoice' ? sourceId : undefined,
      originalSale: sourceType === 'sale' ? sourceId : undefined,
      returnedItems: validatedItems,
      taxRate,
      returnReason: returnReason || '',
      notes: notes || '',
      expiryDate,
      createdBy: req.user._id
    };

    const creditNote = new CreditNote(creditNoteData);
    await creditNote.save();

    await creditNote.populate('customer', 'firstName lastName companyName email');
    await creditNote.populate('originalInvoice', 'invoiceNumber total');
    await creditNote.populate('originalSale', 'saleNumber total');
    await creditNote.populate('createdBy', 'firstName lastName');

    res.status(201).json({ creditNote });
  } catch (error) {
    console.error('Create credit note error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        message: 'Validation error',
        errors: Object.values(error.errors).map(err => err.message)
      });
    }
    res.status(500).json({ message: 'Failed to create credit note', error: error.message });
  }
});

// Redeem credit for an invoice (FIFO)
router.post('/redeem-for-invoice', authenticateToken, requireRole('admin', 'manager'), requireSameCompany, async (req, res) => {
  try {
    const { customerId, amount, invoiceId } = req.body;

    if (!customerId || !amount || amount <= 0) {
      return res.status(400).json({ message: 'Customer ID and valid amount are required' });
    }

    // Get available credit notes (FIFO — oldest first), excluding expired
    const now = new Date();
    const creditNotes = await CreditNote.find({
      company: req.user.company._id,
      customer: customerId,
      status: { $in: ['unused', 'partially_used'] },
      $or: [
        { expiryDate: null },
        { expiryDate: { $gt: now } }
      ]
    }).sort({ createdAt: 1 });

    const totalAvailable = creditNotes.reduce((sum, cn) => sum + cn.remainingBalance, 0);
    if (amount > totalAvailable) {
      return res.status(400).json({
        message: `Insufficient credit. Available: ${totalAvailable.toFixed(2)}, Requested: ${amount.toFixed(2)}`
      });
    }

    let remaining = amount;
    const redemptions = [];

    for (const cn of creditNotes) {
      if (remaining <= 0) break;

      const deduction = Math.min(remaining, cn.remainingBalance);
      cn.redemptions.push({
        invoice: invoiceId || undefined,
        amount: deduction,
        date: new Date(),
        notes: `Applied to invoice`
      });
      cn.usedAmount += deduction;
      await cn.save(); // triggers pre-save recalc

      redemptions.push({
        creditNote: cn._id,
        creditNoteNumber: cn.creditNoteNumber,
        amount: deduction
      });

      remaining -= deduction;
    }

    res.json({
      message: 'Credit redeemed successfully',
      totalRedeemed: amount - remaining,
      redemptions
    });
  } catch (error) {
    console.error('Redeem credit error:', error);
    res.status(500).json({ message: 'Failed to redeem credit' });
  }
});

// Redeem credit for a sale (FIFO)
router.post('/redeem-for-sale', authenticateToken, requireRole('admin', 'manager'), requireSameCompany, async (req, res) => {
  try {
    const { customerId, amount, saleId } = req.body;

    if (!customerId || !amount || amount <= 0) {
      return res.status(400).json({ message: 'Customer ID and valid amount are required' });
    }

    const now = new Date();
    const creditNotes = await CreditNote.find({
      company: req.user.company._id,
      customer: customerId,
      status: { $in: ['unused', 'partially_used'] },
      $or: [
        { expiryDate: null },
        { expiryDate: { $gt: now } }
      ]
    }).sort({ createdAt: 1 });

    const totalAvailable = creditNotes.reduce((sum, cn) => sum + cn.remainingBalance, 0);
    if (amount > totalAvailable) {
      return res.status(400).json({
        message: `Insufficient credit. Available: ${totalAvailable.toFixed(2)}, Requested: ${amount.toFixed(2)}`
      });
    }

    let remaining = amount;
    const redemptions = [];

    for (const cn of creditNotes) {
      if (remaining <= 0) break;

      const deduction = Math.min(remaining, cn.remainingBalance);
      cn.redemptions.push({
        sale: saleId || undefined,
        amount: deduction,
        date: new Date(),
        notes: `Applied to sale`
      });
      cn.usedAmount += deduction;
      await cn.save();

      redemptions.push({
        creditNote: cn._id,
        creditNoteNumber: cn.creditNoteNumber,
        amount: deduction
      });

      remaining -= deduction;
    }

    res.json({
      message: 'Credit redeemed successfully',
      totalRedeemed: amount - remaining,
      redemptions
    });
  } catch (error) {
    console.error('Redeem credit for sale error:', error);
    res.status(500).json({ message: 'Failed to redeem credit for sale' });
  }
});

// Generate credit note PDF
router.get('/:id/pdf', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const creditNote = await CreditNote.findById(req.params.id)
      .populate('customer')
      .populate('company')
      .populate('originalInvoice', 'invoiceNumber')
      .populate('originalSale', 'saleNumber')
      .populate('createdBy', 'firstName lastName');

    if (!creditNote) {
      return res.status(404).json({ message: 'Credit note not found' });
    }

    if (creditNote.company._id.toString() !== req.user.company._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const { generateCreditNotePDF } = require('../utils/pdfGenerator');
    const pdfResult = await generateCreditNotePDF(creditNote, creditNote.company, creditNote.customer);

    if (pdfResult && pdfResult.isHtml) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${pdfResult.filename}"`);
      res.send(pdfResult.buffer);
    } else {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="credit-note-${creditNote.creditNoteNumber}.pdf"`);
      res.send(pdfResult);
    }
  } catch (error) {
    console.error('Generate credit note PDF error:', error);
    res.status(500).json({ message: 'Failed to generate credit note PDF' });
  }
});

// Delete credit note (only unused)
router.delete('/:id', authenticateToken, requireRole('admin'), requireSameCompany, async (req, res) => {
  try {
    const creditNote = await CreditNote.findById(req.params.id);

    if (!creditNote) {
      return res.status(404).json({ message: 'Credit note not found' });
    }

    if (creditNote.company.toString() !== req.user.company._id.toString()) {
      return res.status(403).json({ message: 'Access denied' });
    }

    if (creditNote.status !== 'unused') {
      return res.status(400).json({
        message: 'Cannot delete a credit note that has been partially or fully used'
      });
    }

    // Reverse stock changes — subtract stock back
    for (const item of creditNote.returnedItems) {
      if (item.product) {
        const product = await Product.findById(item.product);
        if (product && product.isTrackable) {
          await product.updateStock(item.quantity, 'subtract');
        }
      }
    }

    await CreditNote.findByIdAndDelete(req.params.id);

    res.json({ message: 'Credit note deleted successfully' });
  } catch (error) {
    console.error('Delete credit note error:', error);
    res.status(500).json({ message: 'Failed to delete credit note' });
  }
});

module.exports = router;
