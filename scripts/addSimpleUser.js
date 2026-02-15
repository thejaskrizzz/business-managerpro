const mongoose = require('mongoose');
const User = require('../models/User');
const Company = require('../models/Company');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/royalserve', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// 👇 EDIT THESE VALUES TO ADD YOUR USER 👇
const NEW_USER = {
  firstName: 'Suhel',
  lastName: 'TP', 
  role: 'manager' // admin, manager, or employee
};
// 👆 EDIT THESE VALUES ABOVE 👆

async function addSimpleUser() {
  try {
    // Get company
    const company = await Company.findOne();
    if (!company) {
      console.log('❌ No company found. Please create a company first.');
      return;
    }

    console.log('🏢 Company:', company.name);

    // Check if user already exists
    const existingUser = await User.findOne({ 
      firstName: NEW_USER.firstName, 
      lastName: NEW_USER.lastName,
      company: company._id 
    });
    
    if (existingUser) {
      console.log('⚠️  User already exists:', NEW_USER.firstName, NEW_USER.lastName);
      return;
    }

    // Create user with dummy email and password
    const userData = {
      firstName: NEW_USER.firstName,
      lastName: NEW_USER.lastName,
      email: `${NEW_USER.firstName.toLowerCase()}.${NEW_USER.lastName.toLowerCase()}@company.com`,
      password: 'dummy123', // Dummy password
      role: NEW_USER.role,
      company: company._id,
      isActive: true
    };

    const user = new User(userData);
    await user.save();

    console.log('✅ User added successfully!');
    console.log('   👤 Name:', user.firstName, user.lastName);
    console.log('   🎯 Role:', user.role);
    console.log('   🏢 Company:', company.name);
    console.log('');
    console.log('🎉 This user will now appear in the Purchase Order approval dropdown!');

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    mongoose.connection.close();
  }
}

// Run the script
addSimpleUser();
