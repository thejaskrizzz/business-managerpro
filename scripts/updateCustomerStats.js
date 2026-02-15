const mongoose = require('mongoose');
const Customer = require('../models/Customer');
const Quote = require('../models/Quote');

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/royalserve', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

async function updateAllCustomerStats() {
  try {
    console.log('Starting customer stats update...');
    
    const customers = await Customer.find({ isActive: true });
    console.log(`Found ${customers.length} active customers`);
    
    let updatedCount = 0;
    
    for (const customer of customers) {
      try {
        await customer.updateStats();
        updatedCount++;
        console.log(`Updated stats for customer: ${customer.firstName} ${customer.lastName}`);
      } catch (error) {
        console.error(`Error updating stats for customer ${customer._id}:`, error.message);
      }
    }
    
    console.log(`Successfully updated ${updatedCount} customers`);
  } catch (error) {
    console.error('Error updating customer stats:', error);
  } finally {
    mongoose.connection.close();
  }
}

// Run the update
updateAllCustomerStats();

