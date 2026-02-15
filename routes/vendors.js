const express = require('express');
const router = express.Router();
const Vendor = require('../models/Vendor');
const { authenticateToken, requireSameCompany } = require('../middleware/auth');

// Get all vendors for a company
router.get('/', authenticateToken, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      status = '',
      tags = '',
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const companyId = req.user.company;
    const query = { company: companyId };

    // Add search filter
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { 'contactPerson.name': { $regex: search, $options: 'i' } },
        { 'businessInfo.industry': { $regex: search, $options: 'i' } }
      ];
    }

    // Add status filter
    if (status) {
      query.status = status;
    }

    // Add tags filter
    if (tags) {
      const tagArray = tags.split(',').map(tag => tag.trim());
      query.tags = { $in: tagArray };
    }

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const vendors = await Vendor.find(query)
      .populate('createdBy', 'name email')
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const total = await Vendor.countDocuments(query);

    res.json({
      vendors,
      pagination: {
        page: parseInt(page),
        pages: Math.ceil(total / limit),
        limit: parseInt(limit),
        total
      }
    });
  } catch (error) {
    console.error('Error fetching vendors:', error);
    res.status(500).json({ message: 'Error fetching vendors', error: error.message });
  }
});

// Get vendor by ID
router.get('/:id', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id)
      .populate('createdBy', 'name email')
      .lean();

    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found' });
    }

    res.json(vendor);
  } catch (error) {
    console.error('Error fetching vendor:', error);
    res.status(500).json({ message: 'Error fetching vendor', error: error.message });
  }
});

// Create new vendor
router.post('/', authenticateToken, async (req, res) => {
  try {
    const vendorData = {
      ...req.body,
      company: req.user.company,
      createdBy: req.user.id
    };

    const vendor = new Vendor(vendorData);
    await vendor.save();

    await vendor.populate('createdBy', 'name email');

    res.status(201).json({
      message: 'Vendor created successfully',
      vendor
    });
  } catch (error) {
    console.error('Error creating vendor:', error);
    
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ 
        message: 'Validation error', 
        errors 
      });
    }

    res.status(500).json({ message: 'Error creating vendor', error: error.message });
  }
});

// Update vendor
router.put('/:id', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const vendor = await Vendor.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate('createdBy', 'name email');

    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found' });
    }

    res.json({
      message: 'Vendor updated successfully',
      vendor
    });
  } catch (error) {
    console.error('Error updating vendor:', error);
    
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ 
        message: 'Validation error', 
        errors 
      });
    }

    res.status(500).json({ message: 'Error updating vendor', error: error.message });
  }
});

// Delete vendor
router.delete('/:id', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const vendor = await Vendor.findByIdAndDelete(req.params.id);

    if (!vendor) {
      return res.status(404).json({ message: 'Vendor not found' });
    }

    res.json({ message: 'Vendor deleted successfully' });
  } catch (error) {
    console.error('Error deleting vendor:', error);
    res.status(500).json({ message: 'Error deleting vendor', error: error.message });
  }
});

// Get vendor statistics
router.get('/stats/overview', authenticateToken, async (req, res) => {
  try {
    const companyId = req.user.company;
    const stats = await Vendor.getStats(companyId);

    res.json(stats);
  } catch (error) {
    console.error('Error fetching vendor stats:', error);
    res.status(500).json({ message: 'Error fetching vendor statistics', error: error.message });
  }
});

// Get vendor tags
router.get('/tags/list', authenticateToken, async (req, res) => {
  try {
    const companyId = req.user.company;
    const tags = await Vendor.distinct('tags', { company: companyId });
    
    res.json({ tags: tags.filter(tag => tag && tag.trim()) });
  } catch (error) {
    console.error('Error fetching vendor tags:', error);
    res.status(500).json({ message: 'Error fetching vendor tags', error: error.message });
  }
});

module.exports = router;
