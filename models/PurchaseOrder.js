const mongoose = require('mongoose');

const purchaseOrderSchema = new mongoose.Schema({
  poNumber: {
    type: String,
    unique: true,
    sparse: true
  },
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor',
    required: [true, 'Vendor is required']
  },
  client: {
    type: mongoose.Schema.Types.Mixed,
    required: [true, 'Client is required']
  },
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  title: {
    type: String,
    required: [true, 'Purchase order title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [1000, 'Description cannot exceed 1000 characters']
  },
  items: [{
    name: {
      type: String,
      required: [true, 'Item name is required'],
      trim: true
    },
    description: {
      type: String,
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
      min: [0, 'Unit price must be non-negative']
    },
    total: {
      type: Number,
      default: 0
    }
  }],
  subtotal: {
    type: Number,
    default: 0,
    min: [0, 'Subtotal must be non-negative']
  },
  tax: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Tax'
  },
  taxRate: {
    type: Number,
    default: 0,
    min: [0, 'Tax rate must be non-negative'],
    max: [100, 'Tax rate cannot exceed 100%']
  },
  taxAmount: {
    type: Number,
    default: 0,
    min: [0, 'Tax amount must be non-negative']
  },
  total: {
    type: Number,
    default: 0,
    min: [0, 'Total must be non-negative']
  },
  status: {
    type: String,
    enum: ['draft', 'sent', 'confirmed', 'in_progress', 'completed', 'cancelled'],
    default: 'draft'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  expectedDeliveryDate: {
    type: Date
  },
  actualDeliveryDate: {
    type: Date
  },
  paymentTerms: {
    type: String,
    enum: ['Net 15', 'Net 30', 'Net 45', 'Net 60', 'Due on Receipt', 'Custom'],
    default: 'Net 30'
  },
  customPaymentTerms: {
    type: String,
    trim: true
  },
  shippingAddress: {
    street: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    zipCode: { type: String, trim: true },
    country: { type: String, trim: true }
  },
  billingAddress: {
    street: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    zipCode: { type: String, trim: true },
    country: { type: String, trim: true }
  },
  terms: {
    type: String,
    trim: true,
    maxlength: [2000, 'Terms cannot exceed 2000 characters']
  },
  notes: {
    type: String,
    trim: true,
    maxlength: [1000, 'Notes cannot exceed 1000 characters']
  },
  attachments: [{
    name: { type: String, required: true },
    url: { type: String, required: true },
    size: { type: Number },
    type: { type: String }
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  approvedBy: {
    type: String,
    trim: true
  },
  approvedAt: {
    type: Date
  },
  sentAt: {
    type: Date
  },
  confirmedAt: {
    type: Date
  },
  completedAt: {
    type: Date
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for better performance
purchaseOrderSchema.index({ company: 1, poNumber: 1 });
purchaseOrderSchema.index({ company: 1, vendor: 1 });
purchaseOrderSchema.index({ company: 1, client: 1 });
purchaseOrderSchema.index({ company: 1, status: 1 });
purchaseOrderSchema.index({ company: 1, priority: 1 });
purchaseOrderSchema.index({ company: 1, createdAt: -1 });

// Virtual for full shipping address
purchaseOrderSchema.virtual('fullShippingAddress').get(function() {
  const addr = this.shippingAddress;
  if (!addr) return '';
  
  const parts = [addr.street, addr.city, addr.state, addr.zipCode, addr.country]
    .filter(part => part && part.trim());
  return parts.join(', ');
});

// Virtual for full billing address
purchaseOrderSchema.virtual('fullBillingAddress').get(function() {
  const addr = this.billingAddress;
  if (!addr) return '';
  
  const parts = [addr.street, addr.city, addr.state, addr.zipCode, addr.country]
    .filter(part => part && part.trim());
  return parts.join(', ');
});

// Pre-save middleware to generate PO number and calculate totals
purchaseOrderSchema.pre('save', async function(next) {
  try {
    // Generate PO number if not provided
    if (!this.poNumber) {
      const Company = mongoose.model('Company');
      const company = await Company.findById(this.company);
      
      if (company) {
        this.poNumber = company.generatePONumber();
        await company.save();
      }
    }

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

    next();
  } catch (error) {
    next(error);
  }
});

// Pre-update middleware to recalculate totals
purchaseOrderSchema.pre('findOneAndUpdate', function(next) {
  const update = this.getUpdate();
  
  if (update.items || update.taxRate) {
    // Calculate item totals
    if (update.items) {
      update.items.forEach(item => {
        item.total = item.quantity * item.unitPrice;
      });
    }

    // Calculate subtotal
    const subtotal = update.items ? 
      update.items.reduce((sum, item) => sum + item.total, 0) : 
      update.subtotal;

    // Calculate tax amount
    const taxRate = update.taxRate || 0;
    const taxAmount = (subtotal * taxRate) / 100;

    // Calculate total
    const total = subtotal + taxAmount;

    update.subtotal = subtotal;
    update.taxAmount = taxAmount;
    update.total = total;
  }

  next();
});

// Instance method to mark as sent
purchaseOrderSchema.methods.markAsSent = function() {
  this.status = 'sent';
  this.sentAt = new Date();
  return this.save();
};

// Instance method to confirm
purchaseOrderSchema.methods.confirm = function(approvedBy) {
  this.status = 'confirmed';
  this.confirmedAt = new Date();
  this.approvedBy = approvedBy; // Now a string instead of user ID
  this.approvedAt = new Date();
  return this.save();
};

// Instance method to complete
purchaseOrderSchema.methods.complete = function() {
  this.status = 'completed';
  this.completedAt = new Date();
  this.actualDeliveryDate = new Date();
  return this.save();
};

// Static method to get PO statistics
purchaseOrderSchema.statics.getStats = async function(companyId) {
  console.log('Getting PO stats for company:', companyId);
  
  const stats = await this.aggregate([
    { $match: { company: new mongoose.Types.ObjectId(companyId) } },
    {
      $group: {
        _id: null,
        totalPOs: { $sum: 1 },
        totalValue: { $sum: '$total' },
        draftPOs: {
          $sum: { $cond: [{ $eq: ['$status', 'draft'] }, 1, 0] }
        },
        sentPOs: {
          $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] }
        },
        confirmedPOs: {
          $sum: { $cond: [{ $eq: ['$status', 'confirmed'] }, 1, 0] }
        },
        inProgressPOs: {
          $sum: { $cond: [{ $eq: ['$status', 'in_progress'] }, 1, 0] }
        },
        completedPOs: {
          $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
        },
        cancelledPOs: {
          $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
        },
        averageValue: { $avg: '$total' }
      }
    }
  ]);

  console.log('PO stats aggregation result:', stats);

  return stats[0] || {
    totalPOs: 0,
    totalValue: 0,
    draftPOs: 0,
    sentPOs: 0,
    confirmedPOs: 0,
    inProgressPOs: 0,
    completedPOs: 0,
    cancelledPOs: 0,
    averageValue: 0
  };
};

module.exports = mongoose.model('PurchaseOrder', purchaseOrderSchema);
