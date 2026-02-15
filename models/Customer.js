const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: true
  },
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true,
    maxlength: [50, 'First name cannot exceed 50 characters']
  },
  lastName: {
    type: String,
    required: [true, 'Last name is required'],
    trim: true,
    maxlength: [50, 'Last name cannot exceed 50 characters']
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
    maxlength: [20, 'Phone number cannot exceed 20 characters']
  },
  companyName: {
    type: String,
    trim: true,
    maxlength: [100, 'Company name cannot exceed 100 characters']
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
  notes: {
    type: String,
    trim: true,
    maxlength: [1000, 'Notes cannot exceed 1000 characters']
  },
  tags: [{
    type: String,
    trim: true,
    maxlength: [30, 'Tag cannot exceed 30 characters']
  }],
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  lastContactDate: {
    type: Date
  },
  totalQuotes: {
    type: Number,
    default: 0
  },
  totalValue: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

// Index for better query performance
customerSchema.index({ company: 1, email: 1 });
customerSchema.index({ company: 1, lastName: 1 });
customerSchema.index({ company: 1, tags: 1 });

// Get full name
customerSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// Get full address
customerSchema.virtual('fullAddress').get(function() {
  const addr = this.address;
  if (!addr.street) return null;
  
  const parts = [addr.street];
  if (addr.city) parts.push(addr.city);
  if (addr.state) parts.push(addr.state);
  if (addr.zipCode) parts.push(addr.zipCode);
  if (addr.country) parts.push(addr.country);
  
  return parts.join(', ');
});

// Update total quotes and value when quotes are added/updated
customerSchema.methods.updateStats = async function() {
  const Quote = mongoose.model('Quote');
  const stats = await Quote.aggregate([
    { $match: { customer: this._id, company: this.company } },
    { $group: { 
      _id: null, 
      totalQuotes: { $sum: 1 },
      totalValue: { $sum: '$total' }
    }}
  ]);
  
  if (stats.length > 0) {
    this.totalQuotes = stats[0].totalQuotes;
    this.totalValue = stats[0].totalValue;
    await this.save();
  }
};

module.exports = mongoose.model('Customer', customerSchema);
