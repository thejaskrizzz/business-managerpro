require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const userEmail = process.argv[2];
const newPassword = process.argv[3];

if (!userEmail || !newPassword) {
  console.log('Usage: node changeAdminPassword.js <admin-email> <new-password>');
  process.exit(1);
}

const changePassword = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const user = await User.findOne({ email: userEmail });

    if (!user) {
      console.log(`User with email ${userEmail} not found`);
      process.exit(1);
    }

    // Set the new password - Mongoose will automatically hash it
    // because of the pre('save') hook in models/User.js
    user.password = newPassword;
    await user.save();

    console.log(`Successfully changed password for ${userEmail}`);
    process.exit(0);
  } catch (err) {
    console.error('Error changing password:', err);
    process.exit(1);
  }
};

changePassword();

//old pass $2b$12$9.EK3JIPpHlRnVSRQJVkheqWvE6LZtG/G9R/7Kb7kNrMt.YHE/1L6
