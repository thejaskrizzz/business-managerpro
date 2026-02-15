const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const { authenticateToken } = require('../middleware/auth');

// Get all products for a company
router.get('/', authenticateToken, async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      category = '',
      status = '',
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const query = { company: req.user.company };

    // Add search filter
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { sku: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { category: { $regex: search, $options: 'i' } }
      ];
    }

    // Add category filter
    if (category) {
      query.category = category;
    }

    // Add status filter
    if (status) {
      if (status === 'low_stock') {
        query.$expr = { $lte: ['$stockQuantity', '$minStockLevel'] };
      } else if (status === 'out_of_stock') {
        query.stockQuantity = 0;
      } else if (status === 'in_stock') {
        query.stockQuantity = { $gt: 0 };
      }
    }

    // Add active filter
    if (status !== 'all') {
      query.isActive = status !== 'inactive';
    }

    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const products = await Product.find(query)
      .populate('supplier', 'name email')
      .populate('createdBy', 'firstName lastName')
      .sort(sortOptions)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const total = await Product.countDocuments(query);

    res.json({
      products,
      pagination: {
        current: parseInt(page),
        pages: Math.ceil(total / limit),
        total,
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error('Error fetching products:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get product by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const product = await Product.findOne({
      _id: req.params.id,
      company: req.user.company
    })
      .populate('supplier', 'name email phone')
      .populate('createdBy', 'firstName lastName');

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.json(product);
  } catch (error) {
    console.error('Error fetching product:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Create new product
router.post('/', authenticateToken, async (req, res) => {
  try {
    const productData = {
      ...req.body,
      company: req.user.company,
      createdBy: req.user.id
    };

    // Check if SKU already exists
    const existingProduct = await Product.findOne({
      sku: productData.sku,
      company: req.user.company
    });

    if (existingProduct) {
      return res.status(400).json({ message: 'SKU already exists' });
    }

    const product = new Product(productData);
    await product.save();

    const populatedProduct = await Product.findById(product._id)
      .populate('supplier', 'name email')
      .populate('createdBy', 'firstName lastName');

    res.status(201).json(populatedProduct);
  } catch (error) {
    console.error('Error creating product:', error);
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ message: errors.join(', ') });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// Update product
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const product = await Product.findOne({
      _id: req.params.id,
      company: req.user.company
    });

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Check if SKU is being changed and if it already exists
    if (req.body.sku && req.body.sku !== product.sku) {
      const existingProduct = await Product.findOne({
        sku: req.body.sku,
        company: req.user.company,
        _id: { $ne: req.params.id }
      });

      if (existingProduct) {
        return res.status(400).json({ message: 'SKU already exists' });
      }
    }

    Object.assign(product, req.body);
    await product.save();

    const populatedProduct = await Product.findById(product._id)
      .populate('supplier', 'name email')
      .populate('createdBy', 'firstName lastName');

    res.json(populatedProduct);
  } catch (error) {
    console.error('Error updating product:', error);
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ message: errors.join(', ') });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete product (soft delete)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const product = await Product.findOne({
      _id: req.params.id,
      company: req.user.company
    });

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Soft delete by setting isActive to false
    product.isActive = false;
    await product.save();

    res.json({ message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Error deleting product:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update stock quantity
router.patch('/:id/stock', authenticateToken, async (req, res) => {
  try {
    const { quantity, operation = 'set' } = req.body;

    if (typeof quantity !== 'number' || quantity < 0) {
      return res.status(400).json({ message: 'Invalid quantity' });
    }

    const product = await Product.findOne({
      _id: req.params.id,
      company: req.user.company
    });

    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    await product.updateStock(quantity, operation);

    const updatedProduct = await Product.findById(product._id)
      .populate('supplier', 'name email')
      .populate('createdBy', 'firstName lastName');

    res.json(updatedProduct);
  } catch (error) {
    console.error('Error updating stock:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get product categories
router.get('/categories/list', authenticateToken, async (req, res) => {
  try {
    const categories = await Product.distinct('category', {
      company: req.user.company,
      isActive: true
    });

    res.json(categories.sort());
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get low stock products
router.get('/alerts/low-stock', authenticateToken, async (req, res) => {
  try {
    const products = await Product.find({
      company: req.user.company,
      isActive: true,
      isTrackable: true,
      $expr: { $lte: ['$stockQuantity', '$minStockLevel'] }
    })
      .populate('supplier', 'name email')
      .sort({ stockQuantity: 1 })
      .lean();

    res.json(products);
  } catch (error) {
    console.error('Error fetching low stock products:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Get out of stock products
router.get('/alerts/out-of-stock', authenticateToken, async (req, res) => {
  try {
    const products = await Product.find({
      company: req.user.company,
      isActive: true,
      isTrackable: true,
      stockQuantity: 0
    })
      .populate('supplier', 'name email')
      .sort({ name: 1 })
      .lean();

    res.json(products);
  } catch (error) {
    console.error('Error fetching out of stock products:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Bulk update products
router.patch('/bulk-update', authenticateToken, async (req, res) => {
  try {
    const { productIds, updateData } = req.body;

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return res.status(400).json({ message: 'Product IDs are required' });
    }

    const result = await Product.updateMany(
      {
        _id: { $in: productIds },
        company: req.user.company
      },
      updateData
    );

    res.json({
      message: `${result.modifiedCount} products updated successfully`,
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    console.error('Error bulk updating products:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
