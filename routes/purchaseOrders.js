const express = require('express');
const router = express.Router();
const PurchaseOrder = require('../models/PurchaseOrder');
const Vendor = require('../models/Vendor');
const Customer = require('../models/Customer');
const Company = require('../models/Company');
const { authenticateToken, requireSameCompany } = require('../middleware/auth');
const { generatePurchaseOrderPDF } = require('../utils/pdfGenerator');

// Get all purchase orders for a company
router.get('/', authenticateToken, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      status = '',
      priority = '',
      vendorId = '',
      clientId = '',
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const companyId = req.user.company;
    const query = { company: companyId };

    // Add search filter
    if (search) {
      query.$or = [
        { poNumber: { $regex: search, $options: 'i' } },
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    // Add status filter
    if (status) {
      query.status = status;
    }

    // Add priority filter
    if (priority) {
      query.priority = priority;
    }

    // Add vendor filter
    if (vendorId) {
      query.vendor = vendorId;
    }

    // Add client filter
    if (clientId) {
      query.client = clientId;
    }

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const purchaseOrders = await PurchaseOrder.find(query)
      .populate('vendor', 'name email')
      .populate('client', 'name email')
      .populate('createdBy', 'name email')
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const total = await PurchaseOrder.countDocuments(query);

    res.json({
      purchaseOrders,
      pagination: {
        page: parseInt(page),
        pages: Math.ceil(total / limit),
        limit: parseInt(limit),
        total
      }
    });
  } catch (error) {
    console.error('Error fetching purchase orders:', error);
    res.status(500).json({ message: 'Error fetching purchase orders', error: error.message });
  }
});

// Get purchase order by ID
router.get('/:id', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const purchaseOrder = await PurchaseOrder.findById(req.params.id)
      .populate('vendor', 'name email phone address contactPerson')
      .populate('client', 'name email phone address')
      .populate('createdBy', 'name email')
      .populate('tax', 'name percentage')
      .lean();

    if (!purchaseOrder) {
      return res.status(404).json({ message: 'Purchase order not found' });
    }

    res.json(purchaseOrder);
  } catch (error) {
    console.error('Error fetching purchase order:', error);
    res.status(500).json({ message: 'Error fetching purchase order', error: error.message });
  }
});

// Create new purchase order
router.post('/', authenticateToken, async (req, res) => {
  try {
    const poData = {
      ...req.body,
      company: req.user.company,
      createdBy: req.user.id
    };

    console.log('Purchase Order Data:', poData);
    console.log('Client value:', poData.client);
    console.log('User company:', req.user.company);

    // Handle client first - if 'company', use company info, otherwise validate customer
    if (poData.client === 'company') {
      // Use company as client - req.user.company is populated
      poData.client = {
        id: req.user.company._id,
        name: req.user.company.name || 'Company',
        email: req.user.company.email || '',
        phone: req.user.company.phone || '',
        address: req.user.company.address || {}
      };
    } else {
      // Validate client exists
      const client = await Customer.findOne({
        _id: poData.client,
        company: req.user.company
      });
      if (!client) {
        return res.status(400).json({ message: 'Invalid client selected' });
      }
    }

    // Validate vendor exists
    const vendor = await Vendor.findOne({
      _id: poData.vendor,
      company: req.user.company
    });
    if (!vendor) {
      return res.status(400).json({ message: 'Invalid vendor selected' });
    }

    // Handle tax selection - transform taxId to tax
    if (poData.taxId) {
      poData.tax = poData.taxId;
      delete poData.taxId;
    }

    // Handle approvedBy - now just a string, no validation needed

    const purchaseOrder = new PurchaseOrder(poData);
    await purchaseOrder.save();

    await purchaseOrder.populate([
      { path: 'vendor', select: 'name email' },
      { path: 'createdBy', select: 'name email' },
      { path: 'tax', select: 'name percentage' }
    ]);

    res.status(201).json({
      message: 'Purchase order created successfully',
      purchaseOrder
    });
  } catch (error) {
    console.error('Error creating purchase order:', error);

    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        message: 'Validation error',
        errors
      });
    }

    res.status(500).json({ message: 'Error creating purchase order', error: error.message });
  }
});

// Update purchase order
// Update purchase order
router.put('/:id', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const updateData = { ...req.body };

    console.log('Update Purchase Order Data:', updateData);

    // Handle client first - if 'company', use company info, otherwise validate customer
    if (updateData.client === 'company') {
      // Use company as client - req.user.company is populated
      updateData.client = {
        id: req.user.company._id,
        name: req.user.company.name || 'Company',
        email: req.user.company.email || '',
        phone: req.user.company.phone || '',
        address: req.user.company.address || {}
      };
    } else if (updateData.client && typeof updateData.client === 'string') {
      // If client is an ID string, validate it exists
      const client = await Customer.findOne({
        _id: updateData.client,
        company: req.user.company
      });
      if (!client) {
        // If not a customer, check if it's the company ID itself just in case
        if (updateData.client === req.user.company._id.toString()) {
          updateData.client = {
            id: req.user.company._id,
            name: req.user.company.name || 'Company',
            email: req.user.company.email || '',
            phone: req.user.company.phone || '',
            address: req.user.company.address || {}
          };
        } else {
          return res.status(400).json({ message: 'Invalid client selected' });
        }
      }
    }

    // Handle tax selection - transform taxId to tax
    if (updateData.taxId) {
      updateData.tax = updateData.taxId;
      delete updateData.taxId;
    }

    // Ensure items have totals calculated if they are being updated
    if (updateData.items) {
      updateData.items.forEach(item => {
        if (item.quantity && item.unitPrice) {
          item.total = item.quantity * item.unitPrice;
        }
      });
    }

    const purchaseOrder = await PurchaseOrder.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate([
      { path: 'vendor', select: 'name email' },
      { path: 'createdBy', select: 'name email' },
      { path: 'tax', select: 'name percentage' }
    ]);

    if (!purchaseOrder) {
      return res.status(404).json({ message: 'Purchase order not found' });
    }

    res.json({
      message: 'Purchase order updated successfully',
      purchaseOrder
    });
  } catch (error) {
    console.error('Error updating purchase order:', error);

    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        message: 'Validation error',
        errors
      });
    }

    res.status(500).json({ message: 'Error updating purchase order', error: error.message });
  }
});

// Delete purchase order
router.delete('/:id', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const purchaseOrder = await PurchaseOrder.findByIdAndDelete(req.params.id);

    if (!purchaseOrder) {
      return res.status(404).json({ message: 'Purchase order not found' });
    }

    res.json({ message: 'Purchase order deleted successfully' });
  } catch (error) {
    console.error('Error deleting purchase order:', error);
    res.status(500).json({ message: 'Error deleting purchase order', error: error.message });
  }
});

// Send purchase order
router.post('/:id/send', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const purchaseOrder = await PurchaseOrder.findById(req.params.id)
      .populate('vendor', 'name email')
      .populate('client', 'name email');

    if (!purchaseOrder) {
      return res.status(404).json({ message: 'Purchase order not found' });
    }

    if (purchaseOrder.status !== 'draft') {
      return res.status(400).json({ message: 'Only draft purchase orders can be sent' });
    }

    await purchaseOrder.markAsSent();

    res.json({
      message: 'Purchase order sent successfully',
      purchaseOrder
    });
  } catch (error) {
    console.error('Error sending purchase order:', error);
    res.status(500).json({ message: 'Error sending purchase order', error: error.message });
  }
});

// Confirm purchase order
router.post('/:id/confirm', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const purchaseOrder = await PurchaseOrder.findById(req.params.id);

    if (!purchaseOrder) {
      return res.status(404).json({ message: 'Purchase order not found' });
    }

    if (purchaseOrder.status !== 'sent') {
      return res.status(400).json({ message: 'Only sent purchase orders can be confirmed' });
    }

    await purchaseOrder.confirm(req.user.id);

    res.json({
      message: 'Purchase order confirmed successfully',
      purchaseOrder
    });
  } catch (error) {
    console.error('Error confirming purchase order:', error);
    res.status(500).json({ message: 'Error confirming purchase order', error: error.message });
  }
});

// Complete purchase order
router.post('/:id/complete', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const purchaseOrder = await PurchaseOrder.findById(req.params.id);

    if (!purchaseOrder) {
      return res.status(404).json({ message: 'Purchase order not found' });
    }

    if (!['confirmed', 'in_progress'].includes(purchaseOrder.status)) {
      return res.status(400).json({ message: 'Only confirmed or in-progress purchase orders can be completed' });
    }

    await purchaseOrder.complete();

    res.json({
      message: 'Purchase order completed successfully',
      purchaseOrder
    });
  } catch (error) {
    console.error('Error completing purchase order:', error);
    res.status(500).json({ message: 'Error completing purchase order', error: error.message });
  }
});

// Generate PDF for purchase order
router.get('/:id/pdf', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const purchaseOrder = await PurchaseOrder.findById(req.params.id)
      .populate('vendor', 'name email phone address')
      .populate('client', 'name email phone address')
      .populate('createdBy', 'name email');

    if (!purchaseOrder) {
      return res.status(404).json({ message: 'Purchase order not found' });
    }

    // Get company information
    const company = await Company.findById(req.user.company._id);
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }

    const pdfResult = await generatePurchaseOrderPDF(purchaseOrder, company, purchaseOrder.vendor, purchaseOrder.client);

    console.log('Purchase Order PDF result type:', pdfResult.isHtml ? 'HTML' : 'PDF');
    console.log('Purchase Order PDF result filename:', pdfResult.filename);
    console.log('Purchase Order PDF result buffer length:', pdfResult.buffer.length);

    if (pdfResult.isHtml) {
      // Fallback to HTML if PDF generation failed
      console.log('Sending HTML response for Purchase Order');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${pdfResult.filename}"`);
      res.send(pdfResult.buffer);
    } else {
      // Normal PDF response
      console.log('Sending PDF response for Purchase Order');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${pdfResult.filename}"`);
      res.send(pdfResult.buffer);
    }
  } catch (error) {
    console.error('Generate Purchase Order PDF error:', error);
    res.status(500).json({
      message: 'Failed to generate Purchase Order PDF',
      error: error.message
    });
  }
});

// Get purchase order statistics
router.get('/stats/overview', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const companyId = new mongoose.Types.ObjectId(req.user.company._id);
    console.log('Fetching PO stats for company ID:', companyId);

    const stats = await PurchaseOrder.getStats(companyId);
    console.log('PO stats returned:', stats);

    res.json(stats);
  } catch (error) {
    console.error('Error fetching purchase order stats:', error);
    res.status(500).json({ message: 'Error fetching purchase order statistics', error: error.message });
  }
});

module.exports = router;
