const mongoose = require('mongoose');

const invoiceSchema = new mongoose.Schema({
  invoiceNumber: {
    type: String,
    unique: true,
    sparse: true // Allows multiple null values but ensures uniqueness when set
  },
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    trim: true
  },
  items: [{
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: [200, 'Item name cannot exceed 200 characters']
    },
    description: {
      type: String,
      required: true,
      trim: true
    },
    quantity: {
      type: Number,
      required: true,
      min: 0
    },
    unitPrice: {
      type: Number,
      default: 0,
      min: 0
    },
    total: {
      type: Number,
      default: 0,
      min: 0
    }
  }],
  subtotal: {
    type: Number,
    required: true,
    min: 0
  },
  tax: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tax',
    default: null
  },
  taxRate: {
    type: Number,
    required: true,
    min: 0,
    max: 100,
    default: 0
  },
  taxAmount: {
    type: Number,
    required: true,
    min: 0,
    default: 0
  },
  total: {
    type: Number,
    required: true,
    min: 0
  },
  status: {
    type: String,
    enum: ['draft', 'sent', 'paid', 'overdue', 'cancelled'],
    default: 'draft'
  },
  dueDate: {
    type: Date,
    required: true
  },
  terms: {
    type: String,
    default: 'Payment due within 30 days of invoice date.'
  },
  notes: {
    type: String,
    trim: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  // Reference to original quote if converted from quote
  originalQuote: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Quote'
  },
  // Payment tracking
  payments: [{
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    paymentDate: {
      type: Date,
      required: true,
      default: Date.now
    },
    paymentMethod: {
      type: String,
      enum: ['cash', 'check', 'bank_transfer', 'credit_card', 'other'],
      default: 'bank_transfer'
    },
    notes: {
      type: String,
      trim: true
    }
  }],
  paidAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  // Signature fields
  companySignature: {
    type: String,
    trim: true
  },
  customerSignature: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

// Calculate totals and generate invoice number before saving
invoiceSchema.pre('save', async function(next) {
  try {
    // Calculate item totals
    this.items.forEach(item => {
      item.total = item.quantity * item.unitPrice;
    });
    
    // Calculate subtotal
    this.subtotal = this.items.reduce((sum, item) => sum + item.total, 0);
    
    // Calculate tax amount
    this.taxAmount = (this.subtotal * this.taxRate) / 100;
    
    // Calculate total
    this.total = this.subtotal + this.taxAmount;
    
    // Calculate paid amount
    this.paidAmount = this.payments.reduce((sum, payment) => sum + payment.amount, 0);
    
    // Generate invoice number if this is a new invoice
    if (this.isNew && !this.invoiceNumber) {
      console.log('Generating invoice number for new invoice...');
      const Company = mongoose.model('Company');
      const company = await Company.findById(this.company);
      
      if (company) {
        // Ensure settings exist and have default values
        if (!company.settings) {
          company.settings = {};
        }
        if (!company.settings.invoicePrefix) {
          company.settings.invoicePrefix = 'INV';
        }
        if (!company.settings.nextInvoiceNumber) {
          company.settings.nextInvoiceNumber = 1;
        }
        
        console.log('Company found:', company.name, 'Next invoice number:', company.settings.nextInvoiceNumber);
        
        // Use atomic operation to get and increment the invoice number
        const updatedCompany = await Company.findByIdAndUpdate(
          this.company,
          { $inc: { 'settings.nextInvoiceNumber': 1 } },
          { new: true }
        );
        
        this.invoiceNumber = `${company.settings.invoicePrefix}-${company.settings.nextInvoiceNumber.toString().padStart(5, '0')}`;
        console.log('Generated invoice number:', this.invoiceNumber);
      } else {
        console.error('Company not found for invoice numbering');
        return next(new Error('Company not found for invoice numbering'));
      }
    }
    
    next();
  } catch (error) {
    next(error);
  }
});

// Handle updates to recalculate totals
invoiceSchema.pre('findOneAndUpdate', async function(next) {
  try {
    const update = this.getUpdate();
    const docToUpdate = await this.model.findOne(this.getQuery());

    if (!docToUpdate) {
      return next(new Error('Invoice not found'));
    }

    // Recalculate totals if items or taxRate changed
    if (update.items || update.taxRate !== undefined) {
      const items = update.items || docToUpdate.items;
      const taxRate = update.taxRate !== undefined ? update.taxRate : docToUpdate.taxRate;

      // Calculate item totals
      items.forEach(item => {
        item.total = item.quantity * item.unitPrice;
      });

      const subtotal = items.reduce((acc, item) => acc + item.total, 0);
      const taxAmount = subtotal * (taxRate / 100);
      const total = subtotal + taxAmount;

      this.set({ subtotal, taxAmount, total });
    }

    // Update status based on payments if payments changed
    if (update.payments) {
      const newPayments = update.payments;
      const existingPayments = docToUpdate.payments;
      const allPayments = [...existingPayments, ...newPayments];
      const paidAmount = allPayments.reduce((acc, payment) => acc + payment.amount, 0);
      
      this.set({ paidAmount });

      // Update status based on paid amount
      const total = update.total !== undefined ? update.total : docToUpdate.total;
      if (paidAmount >= total) {
        this.set({ status: 'paid' });
      } else if (paidAmount > 0 && paidAmount < total) {
        this.set({ status: 'sent' });
      }
    }

    next();
  } catch (error) {
    next(error);
  }
});

// Index for better query performance
invoiceSchema.index({ company: 1, createdAt: -1 });
invoiceSchema.index({ customer: 1, createdAt: -1 });
invoiceSchema.index({ status: 1 });
invoiceSchema.index({ invoiceNumber: 1 });

module.exports = mongoose.model('Invoice', invoiceSchema);
