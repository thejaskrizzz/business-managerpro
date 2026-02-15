const mongoose = require('mongoose');

const taxSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Tax name is required'],
    trim: true,
    maxlength: [100, 'Tax name cannot exceed 100 characters']
  },
  percentage: {
    type: Number,
    required: [true, 'Tax percentage is required'],
    min: [0, 'Tax percentage cannot be negative'],
    max: [100, 'Tax percentage cannot exceed 100%']
  },
  description: {
    type: String,
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  isActive: {
    type: Boolean,
    default: true
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
  timestamps: true
});

// Index for company and active status
taxSchema.index({ company: 1, isActive: 1 });

// Ensure unique tax name per company
taxSchema.index({ name: 1, company: 1 }, { unique: true });

module.exports = mongoose.model('Tax', taxSchema);
