const mongoose = require('mongoose');

const creditNoteItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product'
  },
  productName: {
    type: String,
    required: true,
    trim: true
  },
  productSku: {
    type: String,
    trim: true
  },
  quantity: {
    type: Number,
    required: [true, 'Return quantity is required'],
    min: [0.01, 'Return quantity must be greater than 0']
  },
  unitPrice: {
    type: Number,
    required: true,
    min: [0, 'Unit price cannot be negative']
  },
  total: {
    type: Number,
    required: true,
    min: [0, 'Total cannot be negative']
  }
});

const redemptionSchema = new mongoose.Schema({
  invoice: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Invoice'
  },
  sale: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Sale'
  },
  amount: {
    type: Number,
    required: true,
    min: [0.01, 'Redemption amount must be greater than 0']
  },
  date: {
    type: Date,
    required: true,
    default: Date.now
  },
  notes: {
    type: String,
    trim: true
  }
});

const creditNoteSchema = new mongoose.Schema({
  creditNoteNumber: {
    type: String,
    unique: true,
    sparse: true
  },
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
  // Source can be either an Invoice or a Sale
  originalInvoice: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Invoice'
  },
  originalSale: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Sale'
  },
  sourceType: {
    type: String,
    enum: ['invoice', 'sale'],
    required: true
  },
  returnedItems: [creditNoteItemSchema],
  subtotal: {
    type: Number,
    min: [0, 'Subtotal cannot be negative']
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
  creditAmount: {
    type: Number,
    min: [0, 'Credit amount cannot be negative']
  },
  usedAmount: {
    type: Number,
    default: 0,
    min: [0, 'Used amount cannot be negative']
  },
  remainingBalance: {
    type: Number,
    min: [0, 'Remaining balance cannot be negative']
  },
  status: {
    type: String,
    enum: ['unused', 'partially_used', 'fully_used', 'expired'],
    default: 'unused'
  },
  returnReason: {
    type: String,
    trim: true,
    maxlength: [1000, 'Return reason cannot exceed 1000 characters']
  },
  redemptions: [redemptionSchema],
  expiryDate: {
    type: Date,
    default: null
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
  }
}, {
  timestamps: true
});

// Pre-save middleware: auto-generate CN number, recalculate balances
creditNoteSchema.pre('save', async function(next) {
  try {
    // Calculate item totals
    this.returnedItems.forEach(item => {
      item.total = item.quantity * item.unitPrice;
    });

    // Calculate subtotal
    this.subtotal = this.returnedItems.reduce((sum, item) => sum + item.total, 0);

    // Calculate tax amount
    this.taxAmount = (this.subtotal * this.taxRate) / 100;

    // Calculate credit amount
    this.creditAmount = this.subtotal + this.taxAmount;

    // Calculate used amount from redemptions
    this.usedAmount = this.redemptions.reduce((sum, r) => sum + r.amount, 0);

    // Calculate remaining balance
    this.remainingBalance = this.creditAmount - this.usedAmount;

    // Update status
    if (this.remainingBalance <= 0) {
      this.status = 'fully_used';
      this.remainingBalance = 0;
    } else if (this.usedAmount > 0) {
      this.status = 'partially_used';
    } else {
      this.status = 'unused';
    }

    // Check expiry
    if (this.expiryDate && new Date() > this.expiryDate && this.status !== 'fully_used') {
      this.status = 'expired';
    }

    // Generate credit note number if new
    if (this.isNew && !this.creditNoteNumber) {
      const Company = mongoose.model('Company');
      const company = await Company.findById(this.company);

      if (company) {
        if (!company.settings) company.settings = {};
        if (!company.settings.creditNotePrefix) company.settings.creditNotePrefix = 'CN';
        if (!company.settings.nextCreditNoteNumber) company.settings.nextCreditNoteNumber = 1;

        // Atomic increment
        const updatedCompany = await Company.findByIdAndUpdate(
          this.company,
          { $inc: { 'settings.nextCreditNoteNumber': 1 } },
          { new: true }
        );

        this.creditNoteNumber = `${company.settings.creditNotePrefix}-${company.settings.nextCreditNoteNumber.toString().padStart(6, '0')}`;
      } else {
        return next(new Error('Company not found for credit note numbering'));
      }
    }

    next();
  } catch (error) {
    next(error);
  }
});

// Indexes
creditNoteSchema.index({ company: 1, creditNoteNumber: 1 });
creditNoteSchema.index({ company: 1, customer: 1 });
creditNoteSchema.index({ company: 1, status: 1 });
creditNoteSchema.index({ company: 1, originalInvoice: 1 });
creditNoteSchema.index({ company: 1, originalSale: 1 });
creditNoteSchema.index({ company: 1, createdAt: -1 });

module.exports = mongoose.model('CreditNote', creditNoteSchema);
