const express = require('express');
const router = express.Router();
const Category = require('../models/Category');
const Product = require('../models/Product');
const { authenticateToken } = require('../middleware/auth');

// Get all categories for a company
router.get('/', authenticateToken, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      isActive = '',
      parentCategory = '',
      sortBy = 'sortOrder',
      sortOrder = 'asc'
    } = req.query;

    const companyId = req.user.company;
    const query = { company: companyId };

    // Add search filter
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ];
    }

    // Add status filter
    if (isActive !== '') {
      query.isActive = isActive === 'true';
    }

    // Add parent category filter
    if (parentCategory !== '') {
      if (parentCategory === 'null') {
        query.parentCategory = null;
      } else {
        query.parentCategory = parentCategory;
      }
    }

    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const categories = await Category.find(query)
      .populate('parentCategory', 'name')
      .populate('subcategories', 'name isActive')
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const total = await Category.countDocuments(query);

    res.json({
      categories,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total
      }
    });
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ message: 'Error fetching categories' });
  }
});

// Get category tree
router.get('/tree', authenticateToken, async (req, res) => {
  try {
    const companyId = req.user.company;
    const categoryTree = await Category.getCategoryTree(companyId);
    res.json(categoryTree);
  } catch (error) {
    console.error('Error fetching category tree:', error);
    res.status(500).json({ message: 'Error fetching category tree' });
  }
});

// Get category by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const companyId = req.user.company;
    const category = await Category.findOne({ _id: req.params.id, company: companyId })
      .populate('parentCategory', 'name')
      .populate('subcategories', 'name isActive')
      .populate('productCount');

    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }

    res.json(category);
  } catch (error) {
    console.error('Error fetching category:', error);
    res.status(500).json({ message: 'Error fetching category' });
  }
});

// Create new category
router.post('/', authenticateToken, async (req, res) => {
  try {
    const companyId = req.user.company;
    const userId = req.user.id;

    const categoryData = {
      ...req.body,
      company: companyId,
      createdBy: userId
    };

    const category = new Category(categoryData);
    await category.save();

    await category.populate('parentCategory', 'name');
    res.status(201).json({ message: 'Category created successfully', category });
  } catch (error) {
    console.error('Error creating category:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Error creating category' });
  }
});

// Update category
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const companyId = req.user.company;
    const category = await Category.findOneAndUpdate(
      { _id: req.params.id, company: companyId },
      req.body,
      { new: true, runValidators: true }
    ).populate('parentCategory', 'name');

    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }

    res.json({ message: 'Category updated successfully', category });
  } catch (error) {
    console.error('Error updating category:', error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Error updating category' });
  }
});

// Delete category (soft delete)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const companyId = req.user.company;
    
    // Check if category has products
    const productCount = await Product.countDocuments({ 
      category: req.params.id, 
      company: companyId 
    });

    if (productCount > 0) {
      return res.status(400).json({ 
        message: `Cannot delete category. It has ${productCount} product(s) associated with it.` 
      });
    }

    // Check if category has subcategories
    const subcategoryCount = await Category.countDocuments({ 
      parentCategory: req.params.id, 
      company: companyId 
    });

    if (subcategoryCount > 0) {
      return res.status(400).json({ 
        message: `Cannot delete category. It has ${subcategoryCount} subcategory(ies).` 
      });
    }

    const category = await Category.findOneAndUpdate(
      { _id: req.params.id, company: companyId },
      { isActive: false },
      { new: true }
    );

    if (!category) {
      return res.status(404).json({ message: 'Category not found' });
    }

    res.json({ message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({ message: 'Error deleting category' });
  }
});

// Get category statistics
router.get('/stats/overview', authenticateToken, async (req, res) => {
  try {
    const companyId = req.user.company;
    const stats = await Category.getStats(companyId);
    res.json(stats);
  } catch (error) {
    console.error('Error fetching category stats:', error);
    res.status(500).json({ message: 'Error fetching category statistics' });
  }
});

// Bulk update categories
router.patch('/bulk-update', authenticateToken, async (req, res) => {
  try {
    const companyId = req.user.company;
    const { categoryIds, updateData } = req.body;

    if (!categoryIds || !Array.isArray(categoryIds) || categoryIds.length === 0) {
      return res.status(400).json({ message: 'Category IDs array is required' });
    }

    const result = await Category.updateMany(
      { _id: { $in: categoryIds }, company: companyId },
      updateData
    );

    res.json({ 
      message: 'Categories updated successfully', 
      modifiedCount: result.modifiedCount 
    });
  } catch (error) {
    console.error('Error bulk updating categories:', error);
    res.status(500).json({ message: 'Error bulk updating categories' });
  }
});

module.exports = router;
