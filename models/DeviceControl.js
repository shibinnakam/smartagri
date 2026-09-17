const mongoose = require('mongoose');

const deviceControlSchema = new mongoose.Schema({
  deviceId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  autoMode: {
    type: Boolean,
    default: true
  },
  motorCommand: {
    type: String,
    enum: ['ON', 'OFF'],
    default: 'OFF'
  },
  dryThreshold: {
    type: Number,
    default: 3000
  },
  actualMotorState: {
    type: String,
    enum: ['ON', 'OFF'],
    default: 'OFF'
  },
  commandPending: {
    type: Boolean,
    default: false
  },
  commandSentAt: {
    type: Date,
    default: null
  },
  motorConfirmedAt: {
    type: Date,
    default: null
  },
  lastAckTimestamp: {
    type: Date,
    default: null
  },
  lastSeen: {
    type: Date,
    default: null
  },
  latestReading: {
    temperature: { type: Number, default: null },
    humidity: { type: Number, default: null },
    soilMoisture: { type: Number, default: null },
    ldrValue: { type: Number, default: null },
    motorState: { type: String, default: 'OFF' },
    autoMode: { type: Boolean, default: true },
    timestamp: { type: Date, default: null }
  }
}, { timestamps: true });

module.exports = mongoose.models.DeviceControl || mongoose.model('DeviceControl', deviceControlSchema);
