const mongoose = require('mongoose');

const sensorReadingSchema = new mongoose.Schema({
  deviceId: {
    type: String,
    required: true,
    index: true,
    default: 'smartfarm-01'
  },
  temperature: {
    type: Number,
    default: null
  },
  humidity: {
    type: Number,
    default: null
  },
  soilMoisture: {
    type: Number,
    required: true
  },
  ldrValue: {
    type: Number,
    default: 0
  },
  motorState: {
    type: String,
    enum: ['ON', 'OFF'],
    default: 'OFF'
  },
  autoMode: {
    type: Boolean,
    default: true
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  }
});

module.exports = mongoose.models.SensorReading || mongoose.model('SensorReading', sensorReadingSchema);
