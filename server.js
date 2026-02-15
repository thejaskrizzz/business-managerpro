const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

// Load environment variables
dotenv.config();

// Fallback for JWT_SECRET if not loaded from .env
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'your-super-secret-jwt-key-change-this-in-production';
  console.log('⚠️  Using fallback JWT_SECRET - this should be set in production!');
} else {
  console.log('✅ JWT_SECRET is configured from environment');
}

const app = express();
const PORT = process.env.PORT || 5000;

console.log('🚀 Starting server on port:', PORT);
console.log('🌐 Server will be available at:', `http://localhost:${PORT}`);
console.log('📊 Health check:', `http://localhost:${PORT}/api/health`);
console.log('🔧 Cloudinary configured:', !!process.env.CLOUDINARY_CLOUD_NAME);

// Middleware
app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://business-manager-pro.onrender.com',
    'https://royalbusinessappuae.vercel.app',
    process.env.FRONTEND_URL
  ].filter(Boolean), // Remove any undefined values
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));


// MongoDB connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/business-manager-pro', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => {
  console.log('✅ Connected to MongoDB');
  console.log('Database URL:', process.env.MONGODB_URI ? 'Using environment MONGODB_URI' : 'Using local MongoDB');
})
.catch((error) => {
  console.error('❌ MongoDB connection error:', error);
  console.error('MongoDB URI:', process.env.MONGODB_URI || 'mongodb://localhost:27017/business-manager-pro');
  process.exit(1);
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/companies', require('./routes/companies'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/quotes', require('./routes/quotes'));
app.use('/api/invoices', require('./routes/invoices'));
app.use('/api/vendors', require('./routes/vendors'));
app.use('/api/purchase-orders', require('./routes/purchaseOrders'));
app.use('/api/images', require('./routes/images'));
app.use('/api/taxes', require('./routes/taxes'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/products', require('./routes/products'));
app.use('/api/sales', require('./routes/sales'));
app.use('/api/expenses', require('./routes/expenses'));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Business Manager Pro API is running',
    timestamp: new Date().toISOString(),
    environment: {
      nodeEnv: process.env.NODE_ENV,
      hasJwtSecret: !!process.env.JWT_SECRET,
      hasMongoUri: !!process.env.MONGODB_URI,
      port: process.env.PORT
    }
  });
});

// Debug endpoint to check authentication setup
app.get('/api/debug/auth', (req, res) => {
  res.json({
    jwtSecretConfigured: !!process.env.JWT_SECRET,
    jwtSecretLength: process.env.JWT_SECRET ? process.env.JWT_SECRET.length : 0,
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    message: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
});

module.exports = app;
