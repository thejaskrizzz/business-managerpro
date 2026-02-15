const express = require('express');
const router = express.Router();
const Tax = require('../models/Tax');
const { authenticateToken, requireSameCompany } = require('../middleware/auth');

// Get all taxes for company
router.get('/', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const taxes = await Tax.find({ 
      company: req.user.company._id,
      isActive: true 
    }).sort({ name: 1 });

    res.json(taxes);
  } catch (error) {
    console.error('Get taxes error:', error);
    res.status(500).json({ message: 'Failed to fetch taxes' });
  }
});

// Create new tax
router.post('/', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const { name, percentage, description } = req.body;

    // Check if tax name already exists for this company
    const existingTax = await Tax.findOne({ 
      name: name.trim(), 
      company: req.user.company._id 
    });

    if (existingTax) {
      return res.status(400).json({ 
        message: 'Tax with this name already exists' 
      });
    }

    const tax = new Tax({
      name: name.trim(),
      percentage,
      description: description?.trim(),
      company: req.user.company._id,
      createdBy: req.user._id
    });

    await tax.save();
    res.status(201).json(tax);
  } catch (error) {
    console.error('Create tax error:', error);
    if (error.code === 11000) {
      res.status(400).json({ message: 'Tax with this name already exists' });
    } else {
      res.status(500).json({ message: 'Failed to create tax' });
    }
  }
});

// Update tax
router.put('/:id', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const { name, percentage, description, isActive } = req.body;

    const tax = await Tax.findOne({ 
      _id: req.params.id, 
      company: req.user.company._id 
    });

    if (!tax) {
      return res.status(404).json({ message: 'Tax not found' });
    }

    // Check if new name conflicts with existing tax
    if (name && name.trim() !== tax.name) {
      const existingTax = await Tax.findOne({ 
        name: name.trim(), 
        company: req.user.company._id,
        _id: { $ne: req.params.id }
      });

      if (existingTax) {
        return res.status(400).json({ 
          message: 'Tax with this name already exists' 
        });
      }
    }

    tax.name = name?.trim() || tax.name;
    tax.percentage = percentage !== undefined ? percentage : tax.percentage;
    tax.description = description?.trim() || tax.description;
    tax.isActive = isActive !== undefined ? isActive : tax.isActive;

    await tax.save();
    res.json(tax);
  } catch (error) {
    console.error('Update tax error:', error);
    if (error.code === 11000) {
      res.status(400).json({ message: 'Tax with this name already exists' });
    } else {
      res.status(500).json({ message: 'Failed to update tax' });
    }
  }
});

// Delete tax (soft delete)
router.delete('/:id', authenticateToken, requireSameCompany, async (req, res) => {
  try {
    const tax = await Tax.findOne({ 
      _id: req.params.id, 
      company: req.user.company._id 
    });

    if (!tax) {
      return res.status(404).json({ message: 'Tax not found' });
    }

    // Soft delete by setting isActive to false
    tax.isActive = false;
    await tax.save();

    res.json({ message: 'Tax deleted successfully' });
  } catch (error) {
    console.error('Delete tax error:', error);
    res.status(500).json({ message: 'Failed to delete tax' });
  }
});

module.exports = router;
