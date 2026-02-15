const express = require('express');
const router = express.Router();
const Sale = require('../models/Sale');
const Product = require('../models/Product');
const Customer = require('../models/Customer');
const { authenticateToken } = require('../middleware/auth');
const Company = require('../models/Company');

// Get all sales for a company
router.get('/', authenticateToken, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      status = '',
      paymentStatus = '',
      startDate = '',
      endDate = '',
      sortBy = 'saleDate',
      sortOrder = 'desc'
    } = req.query;

    const query = { company: req.user.company };

    // Add search filter
    if (search) {
      query.$or = [
        { saleNumber: { $regex: search, $options: 'i' } },
        { customerName: { $regex: search, $options: 'i' } },
        { customerEmail: { $regex: search, $options: 'i' } }
      ];
    }

    // Add status filter
    if (status) {
      query.status = status;
    }

    // Add payment status filter
    if (paymentStatus) {
      query.paymentStatus = paymentStatus;
    }

    // Add date range filter
    if (startDate || endDate) {
      query.saleDate = {};
      if (startDate) {
        query.saleDate.$gte = new Date(startDate);
      }
      if (endDate) {
        query.saleDate.$lte = new Date(endDate);
      }
    }

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const sales = await Sale.find(query)
      .populate('customer', 'firstName lastName email phone')
      .populate('items.product', 'name sku')
      .populate('createdBy', 'firstName lastName')
      .sort(sortOptions)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const total = await Sale.countDocuments(query);

    res.json({
      sales,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total,
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Error fetching sales:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get sale by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const sale = await Sale.findOne({
      _id: req.params.id,
      company: req.user.company
    })
      .populate('customer', 'firstName lastName email phone companyName address')
      .populate('items.product', 'name sku description unit')
      .populate('createdBy', 'firstName lastName')
      .populate('tax', 'name rate');

    if (!sale) {
      return res.status(404).json({ message: 'Sale not found' });
    }

    res.json(sale);
  } catch (error) {
    console.error('Error fetching sale:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create new sale
router.post('/', authenticateToken, async (req, res) => {
  try {
    const saleData = {
      ...req.body,
      company: req.user.company,
      createdBy: req.user.id
    };

    // Generate sale number
    saleData.saleNumber = await Sale.generateSaleNumber(req.user.company);

    // Validate and populate product information (allow manual items without product)
    for (const item of saleData.items) {
      if (item.product) {
        const product = await Product.findOne({
          _id: item.product,
          company: req.user.company,
          isActive: true
        });

        if (!product) {
          return res.status(400).json({ 
            message: `Product not found: ${item.product}` 
          });
        }

        // Check stock availability
        if (product.isTrackable && product.stockQuantity < item.quantity) {
          return res.status(400).json({ 
            message: `Insufficient stock for ${product.name}. Available: ${product.stockQuantity}` 
          });
        }

        // Populate product information
        item.productName = item.productName || product.name;
        item.productSku = item.productSku || product.sku;
        item.costPrice = item.costPrice ?? product.costPrice;
      } else {
        // Manual line item: require productName
        if (!item.productName || item.productName.trim() === '') {
          return res.status(400).json({ message: 'Manual item requires productName' });
        }
        // Ensure SKU placeholder
        item.productSku = item.productSku || 'CUSTOM';
      }
    }

    // Populate customer information if customer ID is provided
    if (saleData.customer) {
      const customer = await Customer.findOne({
        _id: saleData.customer,
        company: req.user.company
      });

      if (customer) {
        saleData.customerName = `${customer.firstName} ${customer.lastName}`;
        saleData.customerEmail = customer.email;
        saleData.customerPhone = customer.phone;
      }
    }

    const sale = new Sale(saleData);
    await sale.save();

    const populatedSale = await Sale.findById(sale._id)
      .populate('customer', 'firstName lastName email phone')
      .populate('items.product', 'name sku')
      .populate('createdBy', 'firstName lastName');

    res.status(201).json(populatedSale);
  } catch (error) {
    console.error('Error creating sale:', error);
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ message: errors.join(', ') });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// Update sale
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const sale = await Sale.findOne({
      _id: req.params.id,
      company: req.user.company
    });

    if (!sale) {
      return res.status(404).json({ message: 'Sale not found' });
    }

    // Don't allow updates to completed sales unless it's a return
    if (sale.status === 'completed' && !req.body.isReturn) {
      return res.status(400).json({ message: 'Cannot update completed sale' });
    }

    Object.assign(sale, req.body);
    await sale.save();

    const populatedSale = await Sale.findById(sale._id)
      .populate('customer', 'firstName lastName email phone')
      .populate('items.product', 'name sku')
      .populate('createdBy', 'firstName lastName');

    res.json(populatedSale);
  } catch (error) {
    console.error('Error updating sale:', error);
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ message: errors.join(', ') });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete sale (soft delete)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const sale = await Sale.findOne({
      _id: req.params.id,
      company: req.user.company
    });

    if (!sale) {
      return res.status(404).json({ message: 'Sale not found' });
    }

    // Don't allow deletion of completed sales
    if (sale.status === 'completed') {
      return res.status(400).json({ message: 'Cannot delete completed sale' });
    }

    await Sale.findByIdAndDelete(sale._id);

    res.json({ message: 'Sale deleted successfully' });
  } catch (error) {
    console.error('Error deleting sale:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create return/refund
router.post('/:id/return', authenticateToken, async (req, res) => {
  try {
    const originalSale = await Sale.findOne({
      _id: req.params.id,
      company: req.user.company
    });

    if (!originalSale) {
      return res.status(404).json({ message: 'Original sale not found' });
    }

    const returnData = {
      ...req.body,
      company: req.user.company,
      createdBy: req.user.id,
      isReturn: true,
      originalSale: originalSale._id,
      saleNumber: await Sale.generateSaleNumber(req.user.company)
    };

    // Copy customer information from original sale
    returnData.customer = originalSale.customer;
    returnData.customerName = originalSale.customerName;
    returnData.customerEmail = originalSale.customerEmail;
    returnData.customerPhone = originalSale.customerPhone;

    // Validate return items
    for (const returnItem of returnData.items) {
      const originalItem = originalSale.items.find(
        item => item.product.toString() === returnItem.product
      );

      if (!originalItem) {
        return res.status(400).json({ 
          message: `Item not found in original sale: ${returnItem.product}` 
        });
      }

      if (returnItem.quantity > originalItem.quantity) {
        return res.status(400).json({ 
          message: `Return quantity cannot exceed original quantity for ${originalItem.productName}` 
        });
      }

      // Copy product information
      returnItem.productName = originalItem.productName;
      returnItem.productSku = originalItem.productSku;
      returnItem.costPrice = originalItem.costPrice;
    }

    const returnSale = new Sale(returnData);
    await returnSale.save();

    const populatedReturn = await Sale.findById(returnSale._id)
      .populate('customer', 'firstName lastName email phone')
      .populate('items.product', 'name sku')
      .populate('createdBy', 'firstName lastName');

    res.status(201).json(populatedReturn);
  } catch (error) {
    console.error('Error creating return:', error);
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ message: errors.join(', ') });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// Get sales statistics
router.get('/stats/overview', authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const matchQuery = { 
      company: req.user.company._id || req.user.company,
      status: 'completed'
    };

    if (startDate || endDate) {
      matchQuery.saleDate = {};
      if (startDate) matchQuery.saleDate.$gte = new Date(startDate);
      if (endDate) matchQuery.saleDate.$lte = new Date(endDate);
    }

    // Debug: Log the match query and count of matching sales
    const salesCount = await Sale.countDocuments(matchQuery);
    console.log('Sales stats query:', matchQuery);
    console.log('Matching sales count:', salesCount);
    console.log('User company ID:', req.user.company._id || req.user.company);

    // Debug: Get all sales for this company (regardless of status)
    const allSalesCount = await Sale.countDocuments({ company: req.user.company._id || req.user.company });
    console.log('Total sales for company:', allSalesCount);

    // Debug: Get a sample sale to check its structure
    const sampleSale = await Sale.findOne(matchQuery);
    if (sampleSale) {
      console.log('Sample sale structure:', {
        total: sampleSale.total,
        totalProfit: sampleSale.totalProfit,
        totalCost: sampleSale.totalCost,
        status: sampleSale.status,
        company: sampleSale.company
      });
    } else {
      console.log('No completed sales found. Checking all sales...');
      const anySale = await Sale.findOne({ company: req.user.company._id || req.user.company });
      if (anySale) {
        console.log('Any sale structure:', {
          total: anySale.total,
          totalProfit: anySale.totalProfit,
          totalCost: anySale.totalCost,
          status: anySale.status,
          company: anySale.company
        });
      } else {
        console.log('No sales found for this company at all');
      }
    }

    const stats = await Sale.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: null,
          totalSales: { $sum: '$total' },
          totalProfit: { $sum: '$totalProfit' },
          totalCost: { $sum: '$totalCost' },
          totalTransactions: { $sum: 1 },
          averageSaleValue: { $avg: '$total' }
        }
      }
    ]);

    const result = stats[0] || {
      totalSales: 0,
      totalProfit: 0,
      totalCost: 0,
      totalTransactions: 0,
      averageSaleValue: 0
    };

    console.log('Sales stats result:', result);
    res.json(result);
  } catch (error) {
    console.error('Error fetching sales stats:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get daily sales report
router.get('/reports/daily', authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const matchQuery = { 
      company: req.user.company,
      status: 'completed'
    };

    if (startDate || endDate) {
      matchQuery.saleDate = {};
      if (startDate) matchQuery.saleDate.$gte = new Date(startDate);
      if (endDate) matchQuery.saleDate.$lte = new Date(endDate);
    }

    const dailyStats = await Sale.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: {
            year: { $year: '$saleDate' },
            month: { $month: '$saleDate' },
            day: { $dayOfMonth: '$saleDate' }
          },
          totalSales: { $sum: '$total' },
          totalProfit: { $sum: '$totalProfit' },
          totalTransactions: { $sum: 1 }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
    ]);

    res.json(dailyStats);
  } catch (error) {
    console.error('Error fetching daily sales report:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get top selling products
router.get('/reports/top-products', authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate, limit = 10 } = req.query;
    
    const matchQuery = { 
      company: req.user.company,
      status: 'completed'
    };

    if (startDate || endDate) {
      matchQuery.saleDate = {};
      if (startDate) matchQuery.saleDate.$gte = new Date(startDate);
      if (endDate) matchQuery.saleDate.$lte = new Date(endDate);
    }

    const topProducts = await Sale.aggregate([
      { $match: matchQuery },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.product',
          productName: { $first: '$items.productName' },
          productSku: { $first: '$items.productSku' },
          totalQuantity: { $sum: '$items.quantity' },
          totalRevenue: { $sum: '$items.total' },
          totalProfit: { $sum: '$items.profit' }
        }
      },
      { $sort: { totalQuantity: -1 } },
      { $limit: parseInt(limit) }
    ]);

    res.json(topProducts);
  } catch (error) {
    console.error('Error fetching top products report:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Generate Delivery Order PDF
router.get('/:id/delivery-order', authenticateToken, async (req, res) => {
  try {
    const sale = await Sale.findOne({
      _id: req.params.id,
      company: req.user.company
    })
      .populate('customer')
      .populate('items.product')
      .lean();

    if (!sale) {
      return res.status(404).json({ message: 'Sale not found' });
    }

    const company = await Company.findById(sale.company).lean();
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }

    const { generateDeliveryOrderPDF } = require('../utils/pdfGenerator');
    const pdfBuffer = await generateDeliveryOrderPDF(sale, company, sale.customer || null);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="delivery-order-${sale.saleNumber}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    console.error('Generate Delivery Order PDF error:', error);
    res.status(500).json({ message: 'Failed to generate delivery order PDF' });
  }
});

module.exports = router;
