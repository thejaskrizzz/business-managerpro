const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/royalserve', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

async function addUserDirect() {
  try {
    // Get your company ID
    const Company = mongoose.model('Company', new mongoose.Schema({}, { strict: false }));
    const company = await Company.findOne();
    
    if (!company) {
      console.log('No company found. Please create a company first.');
      return;
    }

    console.log('Found company:', company.name);

    // Hash password
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash('password123', salt);

    // User data
    const userData = {
      firstName: 'Mike',
      lastName: 'Wilson',
      email: 'mike.wilson@company.com',
      password: hashedPassword,
      role: 'employee',
      company: company._id,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Insert directly into database
    const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
    const result = await User.create(userData);

    console.log('User created successfully:');
    console.log('- Name:', result.firstName, result.lastName);
    console.log('- Email:', result.email);
    console.log('- Role:', result.role);
    console.log('- Company:', company.name);

  } catch (error) {
    console.error('Error creating user:', error);
  } finally {
    mongoose.connection.close();
  }
}

// Run the script
addUserDirect();
