const axios = require('axios');

// Configuration - Update these values
const API_BASE_URL = 'http://localhost:5000/api'; // Update with your backend URL
const ADMIN_TOKEN = 'YOUR_ADMIN_JWT_TOKEN'; // Get this from your admin login

async function addUserViaAPI() {
  try {
    const userData = {
      firstName: 'Sarah',
      lastName: 'Johnson',
      email: 'sarah.johnson@company.com',
      password: 'password123',
      role: 'manager'
    };

    const response = await axios.post(`${API_BASE_URL}/companies/users`, userData, {
      headers: {
        'Authorization': `Bearer ${ADMIN_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('User created successfully via API:');
    console.log('Response:', response.data);

  } catch (error) {
    console.error('Error creating user via API:', error.response?.data || error.message);
  }
}

// Run the script
addUserViaAPI();
