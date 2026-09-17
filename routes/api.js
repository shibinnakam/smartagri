const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const SensorReading = require('../models/SensorReading');
const DeviceControl = require('../models/DeviceControl');

// In-memory fallback stores when MongoDB is not yet connected
const inMemoryStore = {
  readings: [],
  devices: {
    'smartfarm-01': {
      deviceId: 'smartfarm-01',
      autoMode: true,
      motorCommand: 'OFF',
      dryThreshold: 3000,
      actualMotorState: 'OFF',
      commandPending: false,
      commandSentAt: null,
      motorConfirmedAt: null,
      lastAckTimestamp: null,
      lastSeen: null,
      latestReading: {
        temperature: 26.5,
        humidity: 62.0,
        soilMoisture: 2850,
        ldrValue: 2100,
        motorState: 'OFF',
        autoMode: true,
        timestamp: new Date()
      }
    }
  }
};

// SSE Active Clients
let sseClients = [];

// Helper to check if MongoDB is connected
function isDbConnected() {
  return mongoose.connection.readyState === 1;
}

// Broadcast event to all SSE clients
function broadcastUpdate(eventType, data) {
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(client => {
    try {
      client.res.write(payload);
    } catch (err) {
      // client disconnected
    }
  });
}

// ----------------------------------------------------
// 1. ESP32 Sensor Data Ingestion
// URL: POST /api/sensors
// ----------------------------------------------------
router.post('/sensors', async (req, res) => {
  try {
    const {
      deviceId = 'smartfarm-01',
      temperature,
      humidity,
      soilMoisture,
      ldrValue,
      motorState = 'OFF',
      autoMode = true
    } = req.body;

    const parsedReading = {
      deviceId,
      temperature: temperature !== undefined && temperature !== null ? Number(temperature) : null,
      humidity: humidity !== undefined && humidity !== null ? Number(humidity) : null,
      soilMoisture: Number(soilMoisture || 0),
      ldrValue: Number(ldrValue || 0),
      motorState: motorState === 'ON' ? 'ON' : 'OFF',
      autoMode: Boolean(autoMode),
      timestamp: new Date()
    };

    let confirmedMatch = false;

    if (isDbConnected()) {
      // Save to MongoDB
      await SensorReading.create(parsedReading);

      // Check existing control state
      const currentControl = await DeviceControl.findOne({ deviceId });
      if (currentControl && currentControl.commandPending && currentControl.motorCommand === parsedReading.motorState) {
        confirmedMatch = true;
      }

      // Update or create DeviceControl state
      await DeviceControl.findOneAndUpdate(
        { deviceId },
        {
          $set: {
            actualMotorState: parsedReading.motorState,
            lastSeen: new Date(),
            lastAckTimestamp: new Date(),
            commandPending: confirmedMatch ? false : (currentControl ? currentControl.commandPending : false),
            motorConfirmedAt: confirmedMatch ? new Date() : (currentControl ? currentControl.motorConfirmedAt : null),
            latestReading: parsedReading
          }
        },
        { upsert: true, new: true }
      );
    } else {
      // In-memory fallback
      inMemoryStore.readings.push(parsedReading);
      if (inMemoryStore.readings.length > 500) {
        inMemoryStore.readings.shift();
      }

      if (!inMemoryStore.devices[deviceId]) {
        inMemoryStore.devices[deviceId] = {
          deviceId,
          autoMode: Boolean(autoMode),
          motorCommand: 'OFF',
          dryThreshold: 3000,
          actualMotorState: parsedReading.motorState,
          commandPending: false,
          commandSentAt: null,
          motorConfirmedAt: null,
          lastAckTimestamp: new Date()
        };
      }
      const dev = inMemoryStore.devices[deviceId];
      if (dev.commandPending && dev.motorCommand === parsedReading.motorState) {
        confirmedMatch = true;
        dev.commandPending = false;
        dev.motorConfirmedAt = new Date();
      }
      dev.actualMotorState = parsedReading.motorState;
      dev.lastSeen = new Date();
      dev.lastAckTimestamp = new Date();
      dev.latestReading = parsedReading;
    }

    // Broadcast live update to Web Dashboard via SSE
    broadcastUpdate('telemetry', {
      deviceId,
      reading: parsedReading,
      actualMotorState: parsedReading.motorState,
      online: true
    });

    if (confirmedMatch) {
      broadcastUpdate('motor_confirmed', {
        deviceId,
        actualMotorState: parsedReading.motorState,
        confirmed: true,
        timestamp: new Date(),
        message: `Motor turned ${parsedReading.motorState} successfully!`
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Sensor data recorded successfully',
      deviceId,
      actualMotorState: parsedReading.motorState,
      timestamp: parsedReading.timestamp
    });
  } catch (error) {
    console.error('Error saving sensor data:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ----------------------------------------------------
// 2. ESP32 Control Poll Endpoint
// URL: GET /api/control/:deviceId
// Returns JSON formatted strictly for ESP32 string matching:
// {"deviceId":"smartfarm-01","autoMode":true,"motorCommand":"OFF"}
// Optional query params from ESP32: ?motorState=ON or OFF
// ----------------------------------------------------
router.get('/control/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const rawReportedState = req.query.motorState || req.query.actualMotor || req.query.relay || req.query.state;
    const reportedState = rawReportedState ? ((rawReportedState.toUpperCase() === 'ON' || rawReportedState === '1' || rawReportedState.toLowerCase() === 'true') ? 'ON' : 'OFF') : null;

    let device;
    let confirmedMatch = false;
    const now = new Date();

    if (isDbConnected()) {
      device = await DeviceControl.findOne({ deviceId });
      if (!device) {
        device = await DeviceControl.create({
          deviceId,
          autoMode: true,
          motorCommand: 'OFF',
          dryThreshold: 3000,
          actualMotorState: reportedState || 'OFF',
          commandPending: false,
          commandSentAt: null,
          motorConfirmedAt: null,
          lastAckTimestamp: reportedState ? now : null,
          lastSeen: now
        });
      } else {
        device.lastSeen = now;
        if (reportedState) {
          device.actualMotorState = reportedState;
          device.lastAckTimestamp = now;
          if (device.latestReading) {
            device.latestReading.motorState = reportedState;
          }
          if (device.commandPending && device.motorCommand === reportedState) {
            confirmedMatch = true;
            device.commandPending = false;
            device.motorConfirmedAt = now;
          }
        }
        await device.save();
      }
    } else {
      if (!inMemoryStore.devices[deviceId]) {
        inMemoryStore.devices[deviceId] = {
          deviceId,
          autoMode: true,
          motorCommand: 'OFF',
          dryThreshold: 3000,
          actualMotorState: reportedState || 'OFF',
          commandPending: false,
          commandSentAt: null,
          motorConfirmedAt: null,
          lastAckTimestamp: reportedState ? now : null,
          lastSeen: now,
          latestReading: null
        };
      }
      device = inMemoryStore.devices[deviceId];
      device.lastSeen = now;
      if (reportedState) {
        device.actualMotorState = reportedState;
        device.lastAckTimestamp = now;
        if (device.latestReading) {
          device.latestReading.motorState = reportedState;
        }
        if (device.commandPending && device.motorCommand === reportedState) {
          confirmedMatch = true;
          device.commandPending = false;
          device.motorConfirmedAt = now;
        }
      }
    }

    // If pending command has just matched the hardware's reported state, broadcast confirmation!
    if (confirmedMatch) {
      broadcastUpdate('motor_confirmed', {
        deviceId,
        actualMotorState: device.actualMotorState,
        motorCommand: device.motorCommand,
        autoMode: device.autoMode,
        confirmed: true,
        timestamp: now,
        message: `Motor turned ${device.actualMotorState} successfully!`
      });
    }

    // Format response strictly so ESP32 code:
    // response.indexOf("\"autoMode\":true") >= 0
    // response.indexOf("\"motorCommand\":\"ON\"") >= 0
    // works 100% reliably
    const responsePayload = {
      deviceId: device.deviceId,
      autoMode: Boolean(device.autoMode),
      motorCommand: device.motorCommand === 'ON' ? 'ON' : 'OFF',
      dryThreshold: device.dryThreshold || 3000
    };

    return res.status(200).json(responsePayload);
  } catch (error) {
    console.error('Error in control poll:', error);
    return res.status(500).json({
      autoMode: true,
      motorCommand: 'OFF',
      error: error.message
    });
  }
});

// ----------------------------------------------------
// 3. Web Dashboard Control Endpoint
// URL: POST /api/control/:deviceId
// Allows website to change autoMode and motorCommand
// ----------------------------------------------------
router.post('/control/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { autoMode, motorCommand, dryThreshold } = req.body;

    const updates = {};
    const now = new Date();
    if (autoMode !== undefined) updates.autoMode = Boolean(autoMode);
    if (motorCommand !== undefined) {
      updates.motorCommand = motorCommand === 'ON' ? 'ON' : 'OFF';
      // Mark as pending hardware execution. Do NOT fake actualMotorState!
      updates.commandPending = true;
      updates.commandSentAt = now;
    }
    if (dryThreshold !== undefined) updates.dryThreshold = Number(dryThreshold);

    let updatedDevice;

    if (isDbConnected()) {
      updatedDevice = await DeviceControl.findOneAndUpdate(
        { deviceId },
        { $set: updates },
        { upsert: true, new: true }
      );
    } else {
      if (!inMemoryStore.devices[deviceId]) {
        inMemoryStore.devices[deviceId] = {
          deviceId,
          autoMode: true,
          motorCommand: 'OFF',
          dryThreshold: 3000,
          actualMotorState: 'OFF',
          commandPending: false,
          commandSentAt: null,
          motorConfirmedAt: null,
          lastAckTimestamp: null,
          lastSeen: null,
          latestReading: { motorState: 'OFF' }
        };
      }
      Object.assign(inMemoryStore.devices[deviceId], updates);
      updatedDevice = inMemoryStore.devices[deviceId];
    }

    // Broadcast control state change & pending status to web clients
    broadcastUpdate('control_change', {
      deviceId,
      autoMode: updatedDevice.autoMode,
      motorCommand: updatedDevice.motorCommand,
      dryThreshold: updatedDevice.dryThreshold,
      commandPending: updatedDevice.commandPending,
      actualMotorState: updatedDevice.actualMotorState
    });

    if (updates.motorCommand) {
      broadcastUpdate('command_pending', {
        deviceId,
        motorCommand: updatedDevice.motorCommand,
        autoMode: updatedDevice.autoMode,
        commandPending: true,
        actualMotorState: updatedDevice.actualMotorState,
        timestamp: now
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Device command queued for hardware execution',
      device: updatedDevice
    });
  } catch (error) {
    console.error('Error updating device control:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------------------------------------------
// 3b. Dedicated Hardware Acknowledgment Endpoint (Instant ACK)
// URL: POST /api/control/:deviceId/ack or POST /api/control/ack
// Used by ESP32 immediately after changing relay pin
// ----------------------------------------------------
router.post(['/control/:deviceId/ack', '/control/ack'], async (req, res) => {
  try {
    const deviceId = req.params.deviceId || req.body.deviceId || 'smartfarm-01';
    const rawState = req.body.motorState || req.body.actualMotor || req.body.state || 'OFF';
    const motorState = (rawState.toUpperCase() === 'ON' || rawState === '1' || rawState.toLowerCase() === 'true') ? 'ON' : 'OFF';
    const autoMode = req.body.autoMode !== undefined ? Boolean(req.body.autoMode) : undefined;
    const now = new Date();

    const updateFields = {
      actualMotorState: motorState,
      commandPending: false,
      motorConfirmedAt: now,
      lastAckTimestamp: now,
      lastSeen: now,
      'latestReading.motorState': motorState
    };
    if (autoMode !== undefined) updateFields.autoMode = autoMode;

    let device;

    if (isDbConnected()) {
      device = await DeviceControl.findOneAndUpdate(
        { deviceId },
        { $set: updateFields },
        { upsert: true, new: true }
      );
    } else {
      if (!inMemoryStore.devices[deviceId]) {
        inMemoryStore.devices[deviceId] = {
          deviceId,
          autoMode: autoMode !== undefined ? autoMode : true,
          motorCommand: motorState,
          dryThreshold: 3000,
          actualMotorState: motorState,
          commandPending: false,
          commandSentAt: null,
          motorConfirmedAt: now,
          lastAckTimestamp: now,
          lastSeen: now,
          latestReading: { motorState }
        };
      }
      Object.assign(inMemoryStore.devices[deviceId], {
        actualMotorState: motorState,
        commandPending: false,
        motorConfirmedAt: now,
        lastAckTimestamp: now,
        lastSeen: now
      });
      if (autoMode !== undefined) inMemoryStore.devices[deviceId].autoMode = autoMode;
      if (inMemoryStore.devices[deviceId].latestReading) {
        inMemoryStore.devices[deviceId].latestReading.motorState = motorState;
      }
      device = inMemoryStore.devices[deviceId];
    }

    // Broadcast instant hardware confirmation to all web clients
    broadcastUpdate('motor_confirmed', {
      deviceId,
      actualMotorState: motorState,
      motorCommand: device.motorCommand,
      autoMode: device.autoMode,
      confirmed: true,
      timestamp: now,
      message: `Motor turned ${motorState} successfully!`
    });

    return res.status(200).json({
      success: true,
      message: `Hardware confirmed motor ${motorState}`,
      deviceId,
      actualMotorState: motorState,
      confirmedAt: now
    });
  } catch (err) {
    console.error('Error handling motor ACK:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ----------------------------------------------------
// 4. Latest Telemetry & Device Info
// URL: GET /api/sensors/latest/:deviceId
// ----------------------------------------------------
router.get('/sensors/latest/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    let latestReading = null;
    let controlState = null;
    let lastSeen = null;

    if (isDbConnected()) {
      controlState = await DeviceControl.findOne({ deviceId });
      latestReading = await SensorReading.findOne({ deviceId }).sort({ timestamp: -1 });
      if (controlState) {
        lastSeen = controlState.lastSeen;
      }
    } else {
      const dev = inMemoryStore.devices[deviceId];
      if (dev) {
        controlState = dev;
        lastSeen = dev.lastSeen;
        latestReading = dev.latestReading;
      }
    }

    // Device is considered online if seen within last 25 seconds
    const isOnline = lastSeen ? (Date.now() - new Date(lastSeen).getTime() < 25000) : false;

    const actualMotor = controlState ? (controlState.actualMotorState || (latestReading ? latestReading.motorState : 'OFF')) : 'OFF';
    const motorCommand = controlState ? (controlState.motorCommand || 'OFF') : 'OFF';
    const isConfirmed = actualMotor === motorCommand;

    return res.status(200).json({
      deviceId,
      online: isOnline,
      lastSeen,
      reading: latestReading,
      control: controlState ? {
        autoMode: controlState.autoMode,
        motorCommand: controlState.motorCommand,
        dryThreshold: controlState.dryThreshold || 3000,
        actualMotorState: actualMotor,
        commandPending: Boolean(controlState.commandPending),
        motorConfirmedAt: controlState.motorConfirmedAt || null,
        isConfirmed
      } : {
        autoMode: true,
        motorCommand: 'OFF',
        dryThreshold: 3000,
        actualMotorState: 'OFF',
        commandPending: false,
        motorConfirmedAt: null,
        isConfirmed: true
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------------------------------------------
// 5. Sensor Telemetry History (for Charts)
// URL: GET /api/sensors/history/:deviceId?limit=50
// ----------------------------------------------------
router.get('/sensors/history/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const limit = Math.min(Number(req.query.limit) || 50, 200);

    let history = [];

    if (isDbConnected()) {
      history = await SensorReading.find({ deviceId })
        .sort({ timestamp: -1 })
        .limit(limit);
      history.reverse(); // ascending order for charts
    } else {
      const filtered = inMemoryStore.readings
        .filter(r => r.deviceId === deviceId)
        .slice(-limit);
      history = filtered;
    }

    return res.status(200).json({
      deviceId,
      count: history.length,
      history
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------------------------------------------
// 6. Server-Sent Events (SSE) Live Stream
// URL: GET /api/stream
// ----------------------------------------------------
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientId = Date.now() + Math.random().toString(36).substr(2, 9);
  const clientObj = { id: clientId, res };
  sseClients.push(clientObj);

  // Send initial handshake
  res.write(`event: connected\ndata: ${JSON.stringify({ clientId, timestamp: new Date() })}\n\n`);

  // Heartbeat to keep connection alive every 20s
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch (err) {
      clearInterval(heartbeat);
    }
  }, 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients = sseClients.filter(c => c.id !== clientId);
  });
});

// ----------------------------------------------------
// 7. Built-in Hardware Simulator
// URL: POST /api/simulate
// ----------------------------------------------------
router.post('/simulate', async (req, res) => {
  try {
    const {
      deviceId = 'smartfarm-01',
      temperature = 28.4,
      humidity = 64.2,
      soilMoisture = 3150,
      ldrValue = 1850,
      motorState = null,
      autoMode = null
    } = req.body;

    // Fetch current control state to determine motor if autoMode is active
    let currentAutoMode = autoMode;
    let currentMotor = motorState;

    let device;
    if (isDbConnected()) {
      device = await DeviceControl.findOne({ deviceId });
    } else {
      device = inMemoryStore.devices[deviceId];
    }

    const effectiveAutoMode = currentAutoMode !== null ? currentAutoMode : (device ? device.autoMode : true);
    const dryThreshold = device ? (device.dryThreshold || 3000) : 3000;

    if (currentMotor === null) {
      if (effectiveAutoMode) {
        // Soil > threshold = DRY -> Motor ON
        currentMotor = Number(soilMoisture) > dryThreshold ? 'ON' : 'OFF';
      } else {
        currentMotor = device ? device.motorCommand : 'OFF';
      }
    }

    const payload = {
      deviceId,
      temperature: Number(temperature),
      humidity: Number(humidity),
      soilMoisture: Number(soilMoisture),
      ldrValue: Number(ldrValue),
      motorState: currentMotor,
      autoMode: effectiveAutoMode,
      timestamp: new Date()
    };

    const now = new Date();
    let confirmedMatch = false;

    if (isDbConnected()) {
      await SensorReading.create(payload);
      const currentControl = await DeviceControl.findOne({ deviceId });
      if (currentControl && currentControl.commandPending && currentControl.motorCommand === currentMotor) {
        confirmedMatch = true;
      }
      await DeviceControl.findOneAndUpdate(
        { deviceId },
        {
          $set: {
            actualMotorState: currentMotor,
            commandPending: confirmedMatch ? false : (currentControl ? currentControl.commandPending : false),
            motorConfirmedAt: confirmedMatch ? now : (currentControl ? currentControl.motorConfirmedAt : null),
            lastAckTimestamp: now,
            lastSeen: now,
            latestReading: payload
          }
        },
        { upsert: true, new: true }
      );
    } else {
      inMemoryStore.readings.push(payload);
      if (!inMemoryStore.devices[deviceId]) {
        inMemoryStore.devices[deviceId] = {
          deviceId,
          autoMode: effectiveAutoMode,
          motorCommand: 'OFF',
          dryThreshold: 3000,
          actualMotorState: currentMotor,
          commandPending: false,
          commandSentAt: null,
          motorConfirmedAt: null,
          lastAckTimestamp: now,
          lastSeen: now
        };
      }
      const dev = inMemoryStore.devices[deviceId];
      if (dev.commandPending && dev.motorCommand === currentMotor) {
        confirmedMatch = true;
        dev.commandPending = false;
        dev.motorConfirmedAt = now;
      }
      dev.actualMotorState = currentMotor;
      dev.lastSeen = now;
      dev.lastAckTimestamp = now;
      dev.latestReading = payload;
    }

    broadcastUpdate('telemetry', {
      deviceId,
      reading: payload,
      actualMotorState: currentMotor,
      online: true
    });

    if (confirmedMatch) {
      broadcastUpdate('motor_confirmed', {
        deviceId,
        actualMotorState: currentMotor,
        confirmed: true,
        timestamp: now,
        message: `Motor turned ${currentMotor} successfully!`
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Simulated ESP32 packet processed',
      data: payload
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

// ----------------------------------------------------
// 8. System Status & MongoDB Atlas Info
// URL: GET /api/status
// ----------------------------------------------------
router.get('/status', (req, res) => {
  const dbState = mongoose.connection.readyState;
  const stateMap = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  };

  return res.status(200).json({
    database: {
      status: stateMap[dbState] || 'unknown',
      connected: dbState === 1,
      name: mongoose.connection.name || 'smartagri',
      host: mongoose.connection.host ? 'MongoDB Atlas' : 'In-Memory Cache (Active)'
    },
    uptime: Math.floor(process.uptime()),
    serverTime: new Date(),
    sseClientsCount: sseClients.length
  });
});

// ----------------------------------------------------
// 9. MongoDB Atlas Connection Configurator
// URL: POST /api/config/mongo
// Allows user to paste Atlas URI from web UI to connect live
// ----------------------------------------------------
router.post('/config/mongo', async (req, res) => {
  const { mongoUri } = req.body;
  if (!mongoUri || !mongoUri.startsWith('mongodb')) {
    return res.status(400).json({
      success: false,
      message: 'Invalid MongoDB connection URI. It must start with mongodb:// or mongodb+srv://'
    });
  }

  try {
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }

    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000
    });

    // Update .env file
    const envPath = path.join(__dirname, '..', '.env');
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
      if (envContent.includes('MONGODB_URI=')) {
        envContent = envContent.replace(/MONGODB_URI=.*/, `MONGODB_URI=${mongoUri}`);
      } else {
        envContent += `\nMONGODB_URI=${mongoUri}`;
      }
    } else {
      envContent = `PORT=3000\nMONGODB_URI=${mongoUri}\n`;
    }
    fs.writeFileSync(envPath, envContent, 'utf8');

    return res.status(200).json({
      success: true,
      message: 'Successfully connected to MongoDB Atlas and saved configuration!'
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: `Failed to connect to MongoDB Atlas: ${error.message}`
    });
  }
});

module.exports = router;
