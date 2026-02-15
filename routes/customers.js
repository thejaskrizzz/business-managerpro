const express = require('express');
const Customer = require('../models/Customer');
const Quote = require('../models/Quote');
const { authenticateToken, requireSameCompany } = require('../middleware/auth');

const router = express.Router();

// Get all customers for the company
router.get('/', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const { page = 1, limit = 10, search, tags, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
    
    const query = { 
      company: req.user.company._id,
      isActive: true 
    };

    // Add search filter
    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { companyName: { $regex: search, $options: 'i' } }
      ];
    }

    // Add tags filter
    if (tags) {
      const tagArray = tags.split(',').map(tag => tag.trim());
      query.tags = { $in: tagArray };
    }

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const customers = await Customer.find(query)
      .populate('createdBy', 'firstName lastName')
      .sort(sortOptions)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    // Calculate totalQuotes and totalValue for each customer
    const customersWithStats = await Promise.all(
      customers.map(async (customer) => {
        const stats = await Quote.aggregate([
          { $match: { customer: customer._id, company: customer.company } },
          { $group: { 
            _id: null, 
            totalQuotes: { $sum: 1 },
            totalValue: { $sum: '$total' }
          }}
        ]);

        const customerObj = customer.toObject();
        customerObj.totalQuotes = stats[0]?.totalQuotes || 0;
        customerObj.totalValue = stats[0]?.totalValue || 0;
        
        return customerObj;
      })
    );

    const total = await Customer.countDocuments(query);

    res.json({
      customers: customersWithStats,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total
      }
    });
  } catch (error) {
    console.error('Get customers error:', error);
    res.status(500).json({ 
      message: 'Failed to fetch customers',
      error: error.message 
    });
  }
});

// Get customer by ID
router.get('/:id', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const customer = await Customer.findOne({
      _id: req.params.id,
      company: req.user.company._id,
      isActive: true
    }).populate('createdBy', 'firstName lastName');

    if (!customer) {
      return res.status(404).json({ 
        message: 'Customer not found' 
      });
    }

    // Get recent quotes for this customer
    const recentQuotes = await Quote.find({
      customer: customer._id,
      company: req.user.company._id
    })
    .sort({ createdAt: -1 })
    .limit(5)
    .select('quoteNumber title status total createdAt');

    res.json({
      customer,
      recentQuotes
    });
  } catch (error) {
    console.error('Get customer error:', error);
    res.status(500).json({ 
      message: 'Failed to fetch customer',
      error: error.message 
    });
  }
});

// Create new customer
router.post('/', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const customerData = {
      ...req.body,
      company: req.user.company._id,
      createdBy: req.user._id
    };

    const customer = new Customer(customerData);
    await customer.save();

    await customer.populate('createdBy', 'firstName lastName');

    res.status(201).json({
      message: 'Customer created successfully',
      customer
    });
  } catch (error) {
    console.error('Create customer error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ 
        message: 'Validation error',
        errors: Object.values(error.errors).map(err => err.message)
      });
    }
    res.status(500).json({ 
      message: 'Failed to create customer',
      error: error.message 
    });
  }
});

// Update customer
router.put('/:id', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const customer = await Customer.findOneAndUpdate(
      { 
        _id: req.params.id,
        company: req.user.company._id,
        isActive: true 
      },
      req.body,
      { new: true, runValidators: true }
    ).populate('createdBy', 'firstName lastName');

    if (!customer) {
      return res.status(404).json({ 
        message: 'Customer not found' 
      });
    }

    res.json({
      message: 'Customer updated successfully',
      customer
    });
  } catch (error) {
    console.error('Update customer error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ 
        message: 'Validation error',
        errors: Object.values(error.errors).map(err => err.message)
      });
    }
    res.status(500).json({ 
      message: 'Failed to update customer',
      error: error.message 
    });
  }
});

// Delete customer (soft delete)
router.delete('/:id', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const customer = await Customer.findOneAndUpdate(
      { 
        _id: req.params.id,
        company: req.user.company._id,
        isActive: true 
      },
      { isActive: false },
      { new: true }
    );

    if (!customer) {
      return res.status(404).json({ 
        message: 'Customer not found' 
      });
    }

    res.json({ 
      message: 'Customer deleted successfully' 
    });
  } catch (error) {
    console.error('Delete customer error:', error);
    res.status(500).json({ 
      message: 'Failed to delete customer',
      error: error.message 
    });
  }
});

// Get customer statistics
router.get('/:id/stats', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const customer = await Customer.findOne({
      _id: req.params.id,
      company: req.user.company._id,
      isActive: true
    });

    if (!customer) {
      return res.status(404).json({ 
        message: 'Customer not found' 
      });
    }

    // Get quote statistics
    const stats = await Quote.aggregate([
      { $match: { customer: customer._id, company: req.user.company._id } },
      { $group: { 
        _id: null, 
        totalQuotes: { $sum: 1 },
        totalValue: { $sum: '$total' },
        averageValue: { $avg: '$total' },
        acceptedQuotes: { $sum: { $cond: [{ $eq: ['$status', 'accepted'] }, 1, 0] } },
        pendingQuotes: { $sum: { $cond: [{ $in: ['$status', ['sent', 'viewed']] }, 1, 0] } }
      }}
    ]);

    const result = stats[0] || {
      totalQuotes: 0,
      totalValue: 0,
      averageValue: 0,
      acceptedQuotes: 0,
      pendingQuotes: 0
    };

    res.json(result);
  } catch (error) {
    console.error('Get customer stats error:', error);
    res.status(500).json({ 
      message: 'Failed to fetch customer statistics',
      error: error.message 
    });
  }
});

// Get all tags used by customers
router.get('/tags/all', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const tags = await Customer.aggregate([
      { $match: { company: req.user.company._id, isActive: true } },
      { $unwind: '$tags' },
      { $group: { _id: '$tags', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    res.json(tags);
  } catch (error) {
    console.error('Get tags error:', error);
    res.status(500).json({ 
      message: 'Failed to fetch tags',
      error: error.message 
    });
  }
});

module.exports = router;
