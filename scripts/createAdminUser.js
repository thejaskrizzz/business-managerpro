const mongoose = require('mongoose');
const User = require('../models/User');
const Company = require('../models/Company');
require('dotenv').config();

// Connect to MongoDB
const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/royalserve';
mongoose.connect(uri)
  .then(() => console.log('Connected to MongoDB:', uri))
  .catch(err => {
    console.error('Failed to connect to MongoDB:', err);
    process.exit(1);
  });

async function createAdminUser() {
  try {
    // 1. Create a default Company if none exists
    let company = await Company.findOne();
    if (!company) {
      company = new Company({
        name: 'Royal Serve Local',
        industry: 'Services',
        email: 'info@royalserve.com',
        settings: {
          currency: 'USD',
          timezone: 'UTC',
          dateFormat: 'MM/DD/YYYY',
          quotePrefix: 'Q',
          quoteNumber: 1,
          taxRate: 0,
          creditNotePrefix: 'CN',
          nextCreditNoteNumber: 1,
          creditNoteExpiryEnabled: false,
          creditNoteExpiryDays: 365
        }
      });
      await company.save();
      console.log('✅ Created company:', company.name);
    } else {
      console.log('Found existing company:', company.name);
    }

    // 2. Create the Admin User
    const adminEmail = 'admin@royalserve.com';
    let admin = await User.findOne({ email: adminEmail });
    if (!admin) {
      admin = new User({
        firstName: 'System',
        lastName: 'Administrator',
        email: adminEmail,
        password: 'AdminPassword123!',
        role: 'admin',
        company: company._id,
        isActive: true
      });
      await admin.save();
      console.log('✅ Admin user created successfully!');
      console.log('   Email:', admin.email);
      console.log('   Password: AdminPassword123!');
    } else {
      console.log('Admin user already exists with email:', adminEmail);
    }

  } catch (error) {
    console.error('❌ Error creating company or admin user:', error);
  } finally {
    mongoose.connection.close();
  }
}

createAdminUser();
