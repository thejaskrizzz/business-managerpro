const mongoose = require('mongoose');

const quoteItemSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Item name is required'],
    trim: true,
    maxlength: [200, 'Item name cannot exceed 200 characters']
  },
  description: {
    type: String,
    required: [true, 'Item description is required'],
    trim: true,
    maxlength: [2000, 'Description cannot exceed 2000 characters']
  },
  quantity: {
    type: Number,
    required: [true, 'Quantity is required'],
    min: [0.01, 'Quantity must be greater than 0']
  },
  unitPrice: {
    type: Number,
    default: 0,
    min: [0, 'Unit price cannot be negative']
  },
  total: {
    type: Number,
    default: 0
  },
  image: {
    type: String,
    default: null
  }
});

// Calculate total before saving
quoteItemSchema.pre('save', function (next) {
  this.total = this.quantity * this.unitPrice;
  next();
});

const quoteSchema = new mongoose.Schema({
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  quoteNumber: {
    type: String,
    required: true,
    unique: true
  },
  title: {
    type: String,
    required: [true, 'Quote title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  items: [quoteItemSchema],
  subtotal: {
    type: Number,
    required: true,
    default: 0
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
    default: 0
  },
  total: {
    type: Number,
    required: true,
    default: 0
  },
  status: {
    type: String,
    enum: ['draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired'],
    default: 'draft'
  },
  validUntil: {
    type: Date,
    required: [true, 'Valid until date is required'],
    default: function () {
      const date = new Date();
      date.setDate(date.getDate() + 14); // 2 weeks from now
      return date;
    }
  },
  terms: {
    type: String,
    default: 'Payment due within 30 days of invoice date.'
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
  sentAt: {
    type: Date
  },
  viewedAt: {
    type: Date
  },
  acceptedAt: {
    type: Date
  },
  rejectedAt: {
    type: Date
  },
  rejectionReason: {
    type: String,
    trim: true,
    maxlength: [500, 'Rejection reason cannot exceed 500 characters']
  }
}, {
  timestamps: true
});

// Index for better query performance
quoteSchema.index({ company: 1, quoteNumber: 1 });
quoteSchema.index({ company: 1, customer: 1 });
quoteSchema.index({ company: 1, status: 1 });
quoteSchema.index({ company: 1, createdAt: -1 });

// Calculate totals before saving
quoteSchema.pre('save', function (next) {
  // Calculate subtotal
  this.subtotal = this.items.reduce((sum, item) => sum + item.total, 0);

  // Calculate tax amount
  this.taxAmount = (this.subtotal * this.taxRate) / 100;

  // Calculate total
  this.total = this.subtotal + this.taxAmount;

  next();
});

// Check if quote is expired
quoteSchema.methods.isExpired = function () {
  return new Date() > this.validUntil;
};

// Mark as sent
quoteSchema.methods.markAsSent = function () {
  this.status = 'sent';
  this.sentAt = new Date();
  return this.save();
};

// Mark as viewed
quoteSchema.methods.markAsViewed = function () {
  if (this.status === 'sent') {
    this.status = 'viewed';
    this.viewedAt = new Date();
    return this.save();
  }
};

// Accept quote
quoteSchema.methods.accept = function () {
  this.status = 'accepted';
  this.acceptedAt = new Date();
  return this.save();
};

// Reject quote
quoteSchema.methods.reject = function (reason) {
  this.status = 'rejected';
  this.rejectedAt = new Date();
  this.rejectionReason = reason;
  return this.save();
};

// Get formatted quote number
quoteSchema.virtual('formattedQuoteNumber').get(function () {
  return this.quoteNumber;
});

// Get days until expiry
quoteSchema.virtual('daysUntilExpiry').get(function () {
  const now = new Date();
  const diffTime = this.validUntil - now;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

module.exports = mongoose.model('Quote', quoteSchema);
