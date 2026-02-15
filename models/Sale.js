const mongoose = require('mongoose');

const saleItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: false
  },
  productName: {
    type: String,
    required: true,
    trim: true
  },
  productSku: {
    type: String,
    required: false,
    trim: true
  },
  quantity: {
    type: Number,
    required: [true, 'Quantity is required'],
    min: [0.01, 'Quantity must be greater than 0']
  },
  unitPrice: {
    type: Number,
    required: [true, 'Unit price is required'],
    min: [0, 'Unit price cannot be negative']
  },
  total: {
    type: Number,
    required: true,
    min: [0, 'Total cannot be negative']
  },
  costPrice: {
    type: Number,
    min: [0, 'Cost price cannot be negative']
  },
  profit: {
    type: Number,
    default: 0
  }
});

const saleSchema = new mongoose.Schema({
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  saleNumber: {
    type: String,
    required: true,
    unique: true
  },
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer'
  },
  customerName: {
    type: String,
    trim: true,
    maxlength: [200, 'Customer name cannot exceed 200 characters']
  },
  customerEmail: {
    type: String,
    trim: true,
    lowercase: true
  },
  customerPhone: {
    type: String,
    trim: true
  },
  items: [saleItemSchema],
  subtotal: {
    type: Number,
    required: true,
    min: [0, 'Subtotal cannot be negative']
  },
  tax: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tax',
    default: null
  },
  taxRate: {
    type: Number,
    default: 0,
    min: [0, 'Tax rate cannot be negative'],
    max: [100, 'Tax rate cannot exceed 100%']
  },
  taxAmount: {
    type: Number,
    default: 0,
    min: [0, 'Tax amount cannot be negative']
  },
  discount: {
    type: Number,
    default: 0,
    min: [0, 'Discount cannot be negative']
  },
  discountType: {
    type: String,
    enum: ['percentage', 'fixed'],
    default: 'fixed'
  },
  total: {
    type: Number,
    required: true,
    min: [0, 'Total cannot be negative']
  },
  totalCost: {
    type: Number,
    default: 0,
    min: [0, 'Total cost cannot be negative']
  },
  totalProfit: {
    type: Number,
    default: 0
  },
  paymentMethod: {
    type: String,
    enum: ['cash', 'card', 'bank_transfer', 'cheque', 'credit', 'other'],
    default: 'cash'
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'partial', 'paid', 'refunded'],
    default: 'paid'
  },
  status: {
    type: String,
    enum: ['completed', 'cancelled', 'returned'],
    default: 'completed'
  },
  saleDate: {
    type: Date,
    required: true,
    default: Date.now
  },
  notes: {
    type: String,
    trim: true,
    maxlength: [1000, 'Notes cannot exceed 1000 characters']
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // For returns/refunds
  isReturn: {
    type: Boolean,
    default: false
  },
  originalSale: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Sale'
  },
  returnReason: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

// Indexes for better query performance
saleSchema.index({ company: 1, saleNumber: 1 });
saleSchema.index({ company: 1, saleDate: -1 });
saleSchema.index({ company: 1, customer: 1 });
saleSchema.index({ company: 1, status: 1 });
saleSchema.index({ company: 1, paymentStatus: 1 });

// Pre-save middleware to calculate totals
saleSchema.pre('save', function(next) {
  // Calculate item totals
  this.items.forEach(item => {
    item.total = item.quantity * item.unitPrice;
    if (item.costPrice) {
      item.profit = (item.unitPrice - item.costPrice) * item.quantity;
    }
  });

  // Calculate subtotal
  this.subtotal = this.items.reduce((sum, item) => sum + item.total, 0);

  // Calculate discount
  let discountAmount = 0;
  if (this.discount > 0) {
    if (this.discountType === 'percentage') {
      discountAmount = (this.subtotal * this.discount) / 100;
    } else {
      discountAmount = this.discount;
    }
  }

  // Calculate tax
  this.taxAmount = (this.subtotal - discountAmount) * (this.taxRate / 100);

  // Calculate final total
  this.total = this.subtotal - discountAmount + this.taxAmount;

  // Calculate total cost and profit
  this.totalCost = this.items.reduce((sum, item) => sum + (item.costPrice * item.quantity), 0);
  this.totalProfit = this.total - this.totalCost;

  next();
});

// Method to generate sale number
saleSchema.statics.generateSaleNumber = async function(companyId) {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  
  const prefix = `SALE-${year}${month}${day}`;
  
  const lastSale = await this.findOne({
    company: companyId,
    saleNumber: new RegExp(`^${prefix}`)
  }).sort({ saleNumber: -1 });
  
  let sequence = 1;
  if (lastSale) {
    const lastSequence = parseInt(lastSale.saleNumber.split('-')[2]) || 0;
    sequence = lastSequence + 1;
  }
  
  return `${prefix}-${String(sequence).padStart(4, '0')}`;
};

// Method to update stock after sale
saleSchema.methods.updateStock = async function() {
  const Product = mongoose.model('Product');
  
  for (const item of this.items) {
    const product = await Product.findById(item.product);
    if (product && product.isTrackable) {
      if (this.isReturn) {
        // Add stock back for returns
        await product.updateStock(item.quantity, 'add');
      } else {
        // Subtract stock for sales
        await product.updateStock(item.quantity, 'subtract');
      }
    }
  }
};

// Pre-save middleware to update stock
saleSchema.pre('save', async function(next) {
  if (this.isNew || this.isModified('items') || this.isModified('isReturn')) {
    try {
      await this.updateStock();
    } catch (error) {
      return next(error);
    }
  }
  next();
});

module.exports = mongoose.model('Sale', saleSchema);
