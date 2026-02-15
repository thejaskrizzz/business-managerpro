const express = require('express');
const Company = require('../models/Company');
const User = require('../models/User');
const { authenticateToken, requireRole, requireSameCompany } = require('../middleware/auth');

const router = express.Router();

// Get company information
router.get('/', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const company = await Company.findById(req.user.company._id);
    
    if (!company) {
      return res.status(404).json({ 
        message: 'Company not found' 
      });
    }

    res.json({ company });
  } catch (error) {
    console.error('Get company error:', error);
    res.status(500).json({ 
      message: 'Failed to fetch company information',
      error: error.message 
    });
  }
});

// Update company information
router.put('/', authenticateToken, requireRole('admin', 'manager'), requireSameCompany, async (req, res) => {
  try {
    console.log('Updating company with data:', req.body);
    console.log('Logo data length:', req.body.logo?.length || 0);
    
    const company = await Company.findByIdAndUpdate(
      req.user.company._id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!company) {
      return res.status(404).json({ 
        message: 'Company not found' 
      });
    }

    console.log('Company updated successfully, logo:', company.logo ? 'present' : 'missing');

    res.json({
      message: 'Company updated successfully',
      company
    });
  } catch (error) {
    console.error('Update company error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ 
        message: 'Validation error',
        errors: Object.values(error.errors).map(err => err.message)
      });
    }
    res.status(500).json({ 
      message: 'Failed to update company',
      error: error.message 
    });
  }
});

// Update company settings
router.put('/settings', authenticateToken, requireRole('admin', 'manager'), requireSameCompany, async (req, res) => {
  try {
    const company = await Company.findById(req.user.company._id);
    
    if (!company) {
      return res.status(404).json({ 
        message: 'Company not found' 
      });
    }

    // Update settings
    company.settings = {
      ...company.settings,
      ...req.body
    };

    await company.save();

    res.json({
      message: 'Company settings updated successfully',
      settings: company.settings
    });
  } catch (error) {
    console.error('Update company settings error:', error);
    res.status(500).json({ 
      message: 'Failed to update company settings',
      error: error.message 
    });
  }
});

// Get company users
router.get('/users', authenticateToken, requireRole('admin', 'manager'), requireSameCompany, async (req, res) => {
  try {
    const { page = 1, limit = 10, search, role, isActive } = req.query;
    
    const query = { 
      company: req.user.company._id
    };

    // Add search filter
    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    // Add role filter
    if (role) {
      query.role = role;
    }

    // Add active status filter
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    const users = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await User.countDocuments(query);

    res.json({
      users,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total
      }
    });
  } catch (error) {
    console.error('Get company users error:', error);
    res.status(500).json({ 
      message: 'Failed to fetch company users',
      error: error.message 
    });
  }
});

// Add new user to company
router.post('/users', authenticateToken, requireRole('admin', 'manager'), requireSameCompany, async (req, res) => {
  try {
    const { firstName, lastName, email, password, role = 'employee' } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ 
        message: 'User with this email already exists' 
      });
    }

    // Create user
    const user = new User({
      firstName,
      lastName,
      email,
      password,
      role,
      company: req.user.company._id
    });

    await user.save();

    res.status(201).json({
      message: 'User added successfully',
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('Add user error:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ 
        message: 'Validation error',
        errors: Object.values(error.errors).map(err => err.message)
      });
    }
    res.status(500).json({ 
      message: 'Failed to add user',
      error: error.message 
    });
  }
});

// Update user role
router.put('/users/:userId/role', authenticateToken, requireRole('admin'), requireSameCompany, async (req, res) => {
  try {
    const { role } = req.body;
    const { userId } = req.params;

    // Prevent admin from changing their own role
    if (userId === req.user._id.toString()) {
      return res.status(400).json({ 
        message: 'Cannot change your own role' 
      });
    }

    const user = await User.findOneAndUpdate(
      { 
        _id: userId,
        company: req.user.company._id 
      },
      { role },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ 
        message: 'User not found' 
      });
    }

    res.json({
      message: 'User role updated successfully',
      user
    });
  } catch (error) {
    console.error('Update user role error:', error);
    res.status(500).json({ 
      message: 'Failed to update user role',
      error: error.message 
    });
  }
});

// Deactivate user
router.put('/users/:userId/deactivate', authenticateToken, requireRole('admin'), requireSameCompany, async (req, res) => {
  try {
    const { userId } = req.params;

    // Prevent admin from deactivating themselves
    if (userId === req.user._id.toString()) {
      return res.status(400).json({ 
        message: 'Cannot deactivate your own account' 
      });
    }

    const user = await User.findOneAndUpdate(
      { 
        _id: userId,
        company: req.user.company._id 
      },
      { isActive: false },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ 
        message: 'User not found' 
      });
    }

    res.json({
      message: 'User deactivated successfully',
      user
    });
  } catch (error) {
    console.error('Deactivate user error:', error);
    res.status(500).json({ 
      message: 'Failed to deactivate user',
      error: error.message 
    });
  }
});

// Reactivate user
router.put('/users/:userId/activate', authenticateToken, requireRole('admin'), requireSameCompany, async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findOneAndUpdate(
      { 
        _id: userId,
        company: req.user.company._id 
      },
      { isActive: true },
      { new: true }
    ).select('-password');

    if (!user) {
      return res.status(404).json({ 
        message: 'User not found' 
      });
    }

    res.json({
      message: 'User activated successfully',
      user
    });
  } catch (error) {
    console.error('Activate user error:', error);
    res.status(500).json({ 
      message: 'Failed to activate user',
      error: error.message 
    });
  }
});

// Get company statistics
router.get('/stats', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const mongoose = require('mongoose');
    const Customer = require('../models/Customer');
    const Quote = require('../models/Quote');
    const companyId = new mongoose.Types.ObjectId(req.user.company._id);

    const [customerStats, quoteStats, userStats] = await Promise.all([
      Customer.aggregate([
        { $match: { company: companyId, isActive: true } },
        { $group: { 
          _id: null, 
          totalCustomers: { $sum: 1 }
        }}
      ]),
      Quote.aggregate([
        { $match: { company: companyId } },
        { $group: { 
          _id: null, 
          totalQuotes: { $sum: 1 },
          totalQuoteValue: { $sum: '$total' },
          acceptedQuotes: { $sum: { $cond: [{ $eq: ['$status', 'accepted'] }, 1, 0] } }
        }}
      ]),
      User.aggregate([
        { $match: { company: companyId, isActive: true } },
        { $group: { 
          _id: null, 
          totalUsers: { $sum: 1 }
        }}
      ])
    ]);

    // Calculate total customer value from quotes
    const customerValueStats = await Quote.aggregate([
      { $match: { company: companyId } },
      { $group: { 
        _id: '$customer', 
        totalValue: { $sum: '$total' }
      }},
      { $group: { 
        _id: null, 
        totalValue: { $sum: '$totalValue' }
      }}
    ]);

    const stats = {
      customers: {
        ...customerStats[0] || { totalCustomers: 0 },
        totalValue: customerValueStats[0]?.totalValue || 0
      },
      quotes: quoteStats[0] || { totalQuotes: 0, totalQuoteValue: 0, acceptedQuotes: 0 },
      users: userStats[0] || { totalUsers: 0 }
    };

    res.json(stats);
  } catch (error) {
    console.error('Get company stats error:', error);
    res.status(500).json({ 
      message: 'Failed to fetch company statistics',
      error: error.message 
    });
  }
});

module.exports = router;
