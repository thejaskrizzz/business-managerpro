const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema({
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  expenseNumber: {
    type: String,
    required: true,
    unique: true
  },
  title: {
    type: String,
    required: [true, 'Expense title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  category: {
    type: String,
    enum: [
      'office_supplies',
      'utilities',
      'rent',
      'marketing',
      'travel',
      'equipment',
      'maintenance',
      'professional_services',
      'insurance',
      'other'
    ],
    required: [true, 'Expense category is required']
  },
  amount: {
    type: Number,
    required: [true, 'Amount is required'],
    min: [0.01, 'Amount must be greater than 0']
  },
  currency: {
    type: String,
    enum: ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'AED', 'INR'],
    default: 'USD'
  },
  paymentMethod: {
    type: String,
    enum: ['cash', 'card', 'bank_transfer', 'cheque', 'other'],
    default: 'cash'
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'reimbursed'],
    default: 'pending'
  },
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor'
  },
  vendorName: {
    type: String,
    trim: true,
    maxlength: [200, 'Vendor name cannot exceed 200 characters']
  },
  vendorEmail: {
    type: String,
    trim: true,
    lowercase: true
  },
  vendorPhone: {
    type: String,
    trim: true
  },
  expenseDate: {
    type: Date,
    required: true,
    default: Date.now
  },
  receiptNumber: {
    type: String,
    trim: true,
    maxlength: [100, 'Receipt number cannot exceed 100 characters']
  },
  receiptImage: {
    type: String,
    trim: true
  },
  tags: [{
    type: String,
    trim: true
  }],
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
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedAt: {
    type: Date
  }
}, {
  timestamps: true
});

// Indexes for better query performance
expenseSchema.index({ company: 1, expenseNumber: 1 });
expenseSchema.index({ company: 1, expenseDate: -1 });
expenseSchema.index({ company: 1, category: 1 });
expenseSchema.index({ company: 1, paymentStatus: 1 });
expenseSchema.index({ company: 1, vendor: 1 });

// Method to generate expense number
expenseSchema.statics.generateExpenseNumber = async function(companyId) {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  
  const prefix = `EXP-${year}${month}${day}`;
  
  const lastExpense = await this.findOne({
    company: companyId,
    expenseNumber: new RegExp(`^${prefix}`)
  }).sort({ expenseNumber: -1 });
  
  let sequence = 1;
  if (lastExpense) {
    const lastSequence = parseInt(lastExpense.expenseNumber.split('-')[2]) || 0;
    sequence = lastSequence + 1;
  }
  
  return `${prefix}-${String(sequence).padStart(4, '0')}`;
};

// Method to approve expense
expenseSchema.methods.approve = function(approvedBy) {
  this.approvedBy = approvedBy;
  this.approvedAt = new Date();
  return this.save();
};

// Virtual for formatted amount
expenseSchema.virtual('formattedAmount').get(function() {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: this.currency
  }).format(this.amount);
});

// Ensure virtual fields are serialized
expenseSchema.set('toJSON', { virtuals: true });
expenseSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Expense', expenseSchema);
