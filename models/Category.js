const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Category name is required'],
    trim: true,
    maxlength: [100, 'Category name cannot exceed 100 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  parentCategory: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    default: null
  },
  color: {
    type: String,
    trim: true,
    match: [/^#[0-9A-F]{6}$/i, 'Color must be a valid hex color code'],
    default: '#1976d2'
  },
  icon: {
    type: String,
    trim: true,
    maxlength: [50, 'Icon name cannot exceed 50 characters']
  },
  isActive: {
    type: Boolean,
    default: true
  },
  sortOrder: {
    type: Number,
    default: 0
  },
  tags: [{
    type: String,
    trim: true,
    maxlength: [20, 'Tag cannot exceed 20 characters']
  }],
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better performance
categorySchema.index({ company: 1, name: 1 }, { unique: true });
categorySchema.index({ company: 1, parentCategory: 1 });
categorySchema.index({ company: 1, isActive: 1 });
categorySchema.index({ company: 1, sortOrder: 1 });

// Virtual for subcategories
categorySchema.virtual('subcategories', {
  ref: 'Category',
  localField: '_id',
  foreignField: 'parentCategory'
});

// Virtual for product count
categorySchema.virtual('productCount', {
  ref: 'Product',
  localField: '_id',
  foreignField: 'category',
  count: true
});

// Pre-save middleware to ensure unique category names per company
categorySchema.pre('save', async function(next) {
  if (this.isModified('name')) {
    const existingCategory = await this.constructor.findOne({
      company: this.company,
      name: this.name,
      _id: { $ne: this._id }
    });
    
    if (existingCategory) {
      return next(new Error('Category name already exists in this company'));
    }
  }
  next();
});

// Static method to get category statistics
categorySchema.statics.getStats = async function(companyId) {
  const stats = await this.aggregate([
    { $match: { company: mongoose.Types.ObjectId(companyId) } },
    {
      $group: {
        _id: null,
        totalCategories: { $sum: 1 },
        activeCategories: {
          $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] }
        },
        inactiveCategories: {
          $sum: { $cond: [{ $eq: ['$isActive', false] }, 1, 0] }
        },
        parentCategories: {
          $sum: { $cond: [{ $eq: ['$parentCategory', null] }, 1, 0] }
        },
        subcategories: {
          $sum: { $cond: [{ $ne: ['$parentCategory', null] }, 1, 0] }
        }
      }
    }
  ]);

  return stats[0] || {
    totalCategories: 0,
    activeCategories: 0,
    inactiveCategories: 0,
    parentCategories: 0,
    subcategories: 0
  };
};

// Static method to get category tree
categorySchema.statics.getCategoryTree = async function(companyId) {
  const categories = await this.find({ company: companyId, isActive: true })
    .sort({ sortOrder: 1, name: 1 })
    .populate('subcategories')
    .lean();

  const buildTree = (parentId = null) => {
    return categories
      .filter(cat => {
        if (parentId === null) return !cat.parentCategory;
        return cat.parentCategory && cat.parentCategory.toString() === parentId.toString();
      })
      .map(cat => ({
        ...cat,
        subcategories: buildTree(cat._id)
      }));
  };

  return buildTree();
};

module.exports = mongoose.model('Category', categorySchema);
