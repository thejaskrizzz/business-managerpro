const mongoose = require('mongoose');

const companySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Company name is required'],
    trim: true,
    maxlength: [100, 'Company name cannot exceed 100 characters']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  industry: {
    type: String,
    trim: true,
    maxlength: [50, 'Industry cannot exceed 50 characters']
  },
  website: {
    type: String,
    trim: true,
    validate: {
      validator: function(v) {
        if (!v) return true; // Allow empty values
        // Check if it's a valid URL format (with or without protocol)
        const urlPattern = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/;
        return urlPattern.test(v);
      },
      message: 'Please enter a valid website URL'
    }
  },
  email: {
    type: String,
    required: [true, 'Company email is required'],
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  phone: {
    type: String,
    trim: true,
    maxlength: [20, 'Phone number cannot exceed 20 characters']
  },
  address: {
    street: {
      type: String,
      trim: true,
      maxlength: [100, 'Street address cannot exceed 100 characters']
    },
    city: {
      type: String,
      trim: true,
      maxlength: [50, 'City cannot exceed 50 characters']
    },
    state: {
      type: String,
      trim: true,
      maxlength: [50, 'State cannot exceed 50 characters']
    },
    zipCode: {
      type: String,
      trim: true,
      maxlength: [20, 'ZIP code cannot exceed 20 characters']
    },
    country: {
      type: String,
      trim: true,
      maxlength: [50, 'Country cannot exceed 50 characters']
    }
  },
  logo: {
    type: String,
    default: null
  },
  settings: {
    currency: {
      type: String,
      default: 'INR',
      enum: ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'AED', 'INR']
    },
    timezone: {
      type: String,
      default: 'UTC'
    },
    dateFormat: {
      type: String,
      default: 'MM/DD/YYYY'
    },
    quotePrefix: {
      type: String,
      default: 'Q',
      maxlength: [10, 'Quote prefix cannot exceed 10 characters']
    },
    quoteNumber: {
      type: Number,
      default: 1
    },
    nextQuoteNumber: {
      type: Number,
      default: 1
    },
    invoicePrefix: {
      type: String,
      default: 'INV',
      maxlength: [10, 'Invoice prefix cannot exceed 10 characters']
    },
    nextInvoiceNumber: {
      type: Number,
      default: 1
    },
    poPrefix: {
      type: String,
      default: 'PO',
      maxlength: [10, 'PO prefix cannot exceed 10 characters']
    },
    nextPONumber: {
      type: Number,
      default: 1
    },
    taxRate: {
      type: Number,
      default: 0,
      min: [0, 'Tax rate cannot be negative'],
      max: [100, 'Tax rate cannot exceed 100%']
    },
    terms: {
      type: String,
      default: 'Payment due within 30 days of invoice date.'
    },
    quoteValidityDays: {
      type: Number,
      default: 14,
      min: [1, 'Quote validity must be at least 1 day'],
      max: [365, 'Quote validity cannot exceed 365 days']
    }
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Pre-save middleware to format website URL
companySchema.pre('save', function(next) {
  if (this.website && !this.website.startsWith('http://') && !this.website.startsWith('https://')) {
    this.website = 'https://' + this.website;
  }
  next();
});

// Pre-update middleware to format website URL
companySchema.pre(['updateOne', 'findOneAndUpdate'], function(next) {
  if (this.getUpdate().website && !this.getUpdate().website.startsWith('http://') && !this.getUpdate().website.startsWith('https://')) {
    this.getUpdate().website = 'https://' + this.getUpdate().website;
  }
  next();
});

// Index for better query performance
companySchema.index({ name: 1 });
companySchema.index({ email: 1 });

// Get full address
companySchema.virtual('fullAddress').get(function() {
  const addr = this.address;
  if (!addr.street) return null;
  
  const parts = [addr.street];
  if (addr.city) parts.push(addr.city);
  if (addr.state) parts.push(addr.state);
  if (addr.zipCode) parts.push(addr.zipCode);
  if (addr.country) parts.push(addr.country);
  
  return parts.join(', ');
});

// Generate next quote number
companySchema.methods.generateQuoteNumber = function() {
  this.settings.quoteNumber += 1;
  return `${this.settings.quotePrefix}-${String(this.settings.quoteNumber).padStart(4, '0')}`;
};

// Generate next PO number
companySchema.methods.generatePONumber = function() {
  this.settings.nextPONumber += 1;
  return `${this.settings.poPrefix}-${String(this.settings.nextPONumber).padStart(4, '0')}`;
};

module.exports = mongoose.model('Company', companySchema);
