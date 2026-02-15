const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Expense = require('../models/Expense');
const Vendor = require('../models/Vendor');
const { authenticateToken } = require('../middleware/auth');

// Get all expenses for a company
router.get('/', authenticateToken, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      category = '',
      paymentStatus = '',
      paymentMethod = '',
      startDate = '',
      endDate = '',
      sortBy = 'expenseDate',
      sortOrder = 'desc'
    } = req.query;

    const query = { company: req.user.company };

    // Add search filter
    if (search) {
      query.$or = [
        { expenseNumber: { $regex: search, $options: 'i' } },
        { title: { $regex: search, $options: 'i' } },
        { vendorName: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    // Add category filter
    if (category) {
      query.category = category;
    }

    // Add payment status filter
    if (paymentStatus) {
      query.paymentStatus = paymentStatus;
    }

    // Add payment method filter
    if (paymentMethod) {
      query.paymentMethod = paymentMethod;
    }

    // Add date range filter
    if (startDate || endDate) {
      query.expenseDate = {};
      if (startDate) {
        query.expenseDate.$gte = new Date(startDate);
      }
      if (endDate) {
        query.expenseDate.$lte = new Date(endDate);
      }
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

    // Execute query
    const expenses = await Expense.find(query)
      .populate('vendor', 'name email phone')
      .populate('createdBy', 'firstName lastName')
      .populate('approvedBy', 'firstName lastName')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Expense.countDocuments(query);

    res.json({
      expenses,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
        total
      }
    });
  } catch (error) {
    console.error('Error fetching expenses:', error);
    res.status(500).json({ message: 'Error fetching expenses', error: error.message });
  }
});

// Get expense statistics
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const matchQuery = { company: new mongoose.Types.ObjectId(req.user.company) };
    
    // Add date range filter if provided
    if (startDate || endDate) {
      matchQuery.expenseDate = {};
      if (startDate) {
        matchQuery.expenseDate.$gte = new Date(startDate);
      }
      if (endDate) {
        matchQuery.expenseDate.$lte = new Date(endDate);
      }
    }

    const stats = await Expense.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: null,
          totalExpenses: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          averageAmount: { $avg: '$amount' },
          pendingExpenses: {
            $sum: { $cond: [{ $eq: ['$paymentStatus', 'pending'] }, 1, 0] }
          },
          paidExpenses: {
            $sum: { $cond: [{ $eq: ['$paymentStatus', 'paid'] }, 1, 0] }
          },
          reimbursedExpenses: {
            $sum: { $cond: [{ $eq: ['$paymentStatus', 'reimbursed'] }, 1, 0] }
          }
        }
      }
    ]);

    // Get category breakdown
    const categoryBreakdown = await Expense.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      },
      { $sort: { totalAmount: -1 } }
    ]);

    // Get monthly trends
    const monthlyTrends = await Expense.aggregate([
      { $match: matchQuery },
      {
        $group: {
          _id: {
            year: { $year: '$expenseDate' },
            month: { $month: '$expenseDate' }
          },
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' }
        }
      },
      { $sort: { '_id.year': -1, '_id.month': -1 } },
      { $limit: 12 }
    ]);

    res.json({
      totalExpenses: stats[0]?.totalExpenses || 0,
      totalAmount: stats[0]?.totalAmount || 0,
      pendingExpenses: stats[0]?.pendingExpenses || 0,
      paidExpenses: stats[0]?.paidExpenses || 0,
      reimbursedExpenses: stats[0]?.reimbursedExpenses || 0,
      averageAmount: stats[0]?.averageAmount || 0,
      categoryBreakdown,
      monthlyTrends
    });
  } catch (error) {
    console.error('Error fetching expense stats:', error);
    res.status(500).json({ message: 'Error fetching expense statistics', error: error.message });
  }
});

// Get single expense
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const expense = await Expense.findOne({
      _id: req.params.id,
      company: req.user.company
    })
      .populate('vendor', 'name email phone address')
      .populate('createdBy', 'firstName lastName email')
      .populate('approvedBy', 'firstName lastName email');

    if (!expense) {
      return res.status(404).json({ message: 'Expense not found' });
    }

    res.json(expense);
  } catch (error) {
    console.error('Error fetching expense:', error);
    res.status(500).json({ message: 'Error fetching expense', error: error.message });
  }
});

// Create new expense
router.post('/', authenticateToken, async (req, res) => {
  try {
    const {
      title,
      description,
      category,
      amount,
      currency,
      paymentMethod,
      paymentStatus,
      vendor,
      vendorName,
      vendorEmail,
      vendorPhone,
      expenseDate,
      receiptNumber,
      receiptImage,
      tags,
      notes
    } = req.body;

    // Generate expense number
    const expenseNumber = await Expense.generateExpenseNumber(req.user.company);

    const expense = new Expense({
      company: req.user.company,
      expenseNumber,
      title,
      description,
      category,
      amount,
      currency,
      paymentMethod,
      paymentStatus,
      vendor: vendor || null,
      vendorName,
      vendorEmail,
      vendorPhone,
      expenseDate: expenseDate ? new Date(expenseDate) : new Date(),
      receiptNumber,
      receiptImage,
      tags: tags || [],
      notes,
      createdBy: req.user.id
    });

    await expense.save();

    // Populate the expense with related data
    await expense.populate([
      { path: 'vendor', select: 'name email phone' },
      { path: 'createdBy', select: 'firstName lastName' }
    ]);

    res.status(201).json({
      message: 'Expense created successfully',
      expense
    });
  } catch (error) {
    console.error('Error creating expense:', error);
    res.status(500).json({ message: 'Error creating expense', error: error.message });
  }
});

// Update expense
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const {
      title,
      description,
      category,
      amount,
      currency,
      paymentMethod,
      paymentStatus,
      vendor,
      vendorName,
      vendorEmail,
      vendorPhone,
      expenseDate,
      receiptNumber,
      receiptImage,
      tags,
      notes
    } = req.body;

    const expense = await Expense.findOneAndUpdate(
      { _id: req.params.id, company: req.user.company },
      {
        title,
        description,
        category,
        amount,
        currency,
        paymentMethod,
        paymentStatus,
        vendor: vendor || null,
        vendorName,
        vendorEmail,
        vendorPhone,
        expenseDate: expenseDate ? new Date(expenseDate) : undefined,
        receiptNumber,
        receiptImage,
        tags: tags || [],
        notes
      },
      { new: true, runValidators: true }
    )
      .populate('vendor', 'name email phone')
      .populate('createdBy', 'firstName lastName')
      .populate('approvedBy', 'firstName lastName');

    if (!expense) {
      return res.status(404).json({ message: 'Expense not found' });
    }

    res.json({
      message: 'Expense updated successfully',
      expense
    });
  } catch (error) {
    console.error('Error updating expense:', error);
    res.status(500).json({ message: 'Error updating expense', error: error.message });
  }
});

// Approve expense
router.patch('/:id/approve', authenticateToken, async (req, res) => {
  try {
    const expense = await Expense.findOne({
      _id: req.params.id,
      company: req.user.company
    });

    if (!expense) {
      return res.status(404).json({ message: 'Expense not found' });
    }

    await expense.approve(req.user.id);

    await expense.populate([
      { path: 'vendor', select: 'name email phone' },
      { path: 'createdBy', select: 'firstName lastName' },
      { path: 'approvedBy', select: 'firstName lastName' }
    ]);

    res.json({
      message: 'Expense approved successfully',
      expense
    });
  } catch (error) {
    console.error('Error approving expense:', error);
    res.status(500).json({ message: 'Error approving expense', error: error.message });
  }
});

// Delete expense
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const expense = await Expense.findOneAndDelete({
      _id: req.params.id,
      company: req.user.company
    });

    if (!expense) {
      return res.status(404).json({ message: 'Expense not found' });
    }

    res.json({ message: 'Expense deleted successfully' });
  } catch (error) {
    console.error('Error deleting expense:', error);
    res.status(500).json({ message: 'Error deleting expense', error: error.message });
  }
});

module.exports = router;
