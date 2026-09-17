require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Static files for the frontend dashboard
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api', apiRoutes);

// Fallback to index.html for SPA/Dashboard
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// MongoDB Connection Logic
async function connectDatabase() {
  if (!MONGODB_URI || MONGODB_URI.trim() === '') {
    console.log('\n=============================================================');
    console.log('🌱 SMART AGRI IOT SERVER STARTED');
    console.log('⚠️  MongoDB Atlas URI not configured yet in .env');
    console.log('⚡ Running in In-Memory Local Cache mode.');
    console.log('💡 You can enter your MongoDB Atlas URI anytime in the web dashboard!');
    console.log('=============================================================\n');
    return;
  }

  try {
    console.log('📡 Connecting to MongoDB Atlas...');
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000
    });
    console.log('✅ Connected to MongoDB Atlas successfully!');
  } catch (error) {
    console.error('❌ MongoDB Atlas connection error:', error.message);
    console.log('⚠️  Operating in in-memory fallback mode while you verify credentials.');
  }
}

// Start Server (0.0.0.0 allows LAN ESP32 and localhost access)
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`🚀 SmartAgri Server is running at http://localhost:${PORT} (and on LAN IP)`);
  await connectDatabase();
});
