const mongoose = require('mongoose');

const vendorSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Vendor name is required'],
    trim: true,
    maxlength: [100, 'Vendor name cannot exceed 100 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  phone: {
    type: String,
    trim: true,
    match: [/^[\+]?[1-9][\d]{0,15}$/, 'Please enter a valid phone number']
  },
  website: {
    type: String,
    trim: true,
    validate: {
      validator: function(v) {
        if (!v) return true; // Allow empty
        // Allow URLs with or without protocol
        return /^(https?:\/\/)?[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(v);
      },
      message: 'Please enter a valid website URL'
    }
  },
  address: {
    street: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    zipCode: { type: String, trim: true },
    country: { type: String, trim: true, default: 'United States' }
  },
  contactPerson: {
    name: { type: String, trim: true },
    title: { type: String, trim: true },
    email: { 
      type: String, 
      lowercase: true, 
      trim: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
    },
    phone: { 
      type: String, 
      trim: true,
      match: [/^[\+]?[1-9][\d]{0,15}$/, 'Please enter a valid phone number']
    }
  },
  businessInfo: {
    taxId: { type: String, trim: true },
    registrationNumber: { type: String, trim: true },
    industry: { type: String, trim: true },
    description: { type: String, trim: true, maxlength: [500, 'Description cannot exceed 500 characters'] }
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
  currency: {
    type: String,
    enum: ['USD', 'EUR', 'GBP', 'AED', 'CAD', 'AUD'],
    default: 'USD'
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'suspended'],
    default: 'active'
  },
  tags: [{
    type: String,
    trim: true,
    maxlength: [20, 'Tag cannot exceed 20 characters']
  }],
  notes: {
    type: String,
    trim: true,
    maxlength: [1000, 'Notes cannot exceed 1000 characters']
  },
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
vendorSchema.index({ company: 1, name: 1 });
vendorSchema.index({ company: 1, email: 1 });
vendorSchema.index({ company: 1, status: 1 });
vendorSchema.index({ company: 1, tags: 1 });

// Virtual for full address
vendorSchema.virtual('fullAddress').get(function() {
  const addr = this.address;
  if (!addr) return '';
  
  const parts = [addr.street, addr.city, addr.state, addr.zipCode, addr.country]
    .filter(part => part && part.trim());
  return parts.join(', ');
});

// Virtual for contact person full info
vendorSchema.virtual('contactPersonInfo').get(function() {
  const contact = this.contactPerson;
  if (!contact || !contact.name) return '';
  
  const parts = [contact.name];
  if (contact.title) parts.push(`(${contact.title})`);
  return parts.join(' ');
});

// Pre-save middleware to validate custom payment terms and format website
vendorSchema.pre('save', function(next) {
  if (this.paymentTerms === 'Custom' && !this.customPaymentTerms) {
    return next(new Error('Custom payment terms must be specified when payment terms is set to Custom'));
  }
  
  // Auto-add https:// if website doesn't have protocol
  if (this.website && !this.website.startsWith('http://') && !this.website.startsWith('https://')) {
    this.website = 'https://' + this.website;
  }
  
  next();
});

// Static method to get vendor statistics
vendorSchema.statics.getStats = async function(companyId) {
  const stats = await this.aggregate([
    { $match: { company: mongoose.Types.ObjectId(companyId) } },
    {
      $group: {
        _id: null,
        totalVendors: { $sum: 1 },
        activeVendors: {
          $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
        },
        inactiveVendors: {
          $sum: { $cond: [{ $eq: ['$status', 'inactive'] }, 1, 0] }
        },
        suspendedVendors: {
          $sum: { $cond: [{ $eq: ['$status', 'suspended'] }, 1, 0] }
        }
      }
    }
  ]);

  return stats[0] || {
    totalVendors: 0,
    activeVendors: 0,
    inactiveVendors: 0,
    suspendedVendors: 0
  };
};

module.exports = mongoose.model('Vendor', vendorSchema);

