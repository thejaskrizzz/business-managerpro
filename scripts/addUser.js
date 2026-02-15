const mongoose = require('mongoose');
const User = require('../models/User');
const Company = require('../models/Company');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/royalserve', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

async function addUser() {
  try {
    // Get company ID
    const company = await Company.findOne();
    if (!company) {
      console.log('No company found. Please create a company first.');
      return;
    }

    console.log('Found company:', company.name);

    // Simple user data - just name and role
    const userData = {
      firstName: 'John',
      lastName: 'Doe',
      email: 'john.doe@company.com', // Just for identification, not for login
      password: 'dummy123', // Dummy password since it's required by schema
      role: 'manager', // admin, manager, or employee
      company: company._id,
      isActive: true
    };

    // Check if user already exists
    const existingUser = await User.findOne({ 
      firstName: userData.firstName, 
      lastName: userData.lastName,
      company: company._id 
    });
    
    if (existingUser) {
      console.log('User already exists:', userData.firstName, userData.lastName);
      return;
    }

    // Create new user
    const user = new User(userData);
    await user.save();

    console.log('✅ User created successfully:');
    console.log('   Name:', user.firstName, user.lastName);
    console.log('   Role:', user.role);
    console.log('   Company:', company.name);
    console.log('   Status: Active');

  } catch (error) {
    console.error('❌ Error creating user:', error);
  } finally {
    mongoose.connection.close();
  }
}

// Run the script
addUser();
