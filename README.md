# SmartAgri IoT - ESP32 Smart Farming Hub

A complete IoT monitoring and control platform built with **ESP32**, **Node.js**, and **MongoDB Atlas**.

![Node.js](https://img.shields.io/badge/Node.js-v24+-green.svg)
![Express](https://img.shields.io/badge/Express-4.21-blue.svg)
![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-brightgreen.svg)
![ESP32](https://img.shields.io/badge/Hardware-ESP32-red.svg)

---

## 🌾 Features

- **Live Sensor Telemetry**: Real-time readings for Soil Moisture (ADC), Air Temperature (°C/°F), Humidity (% RH), and Sunlight (LDR).
- **Dual Control Modes**:
  - **AUTO**: Autonomous irrigation driven by ESP32 based on soil moisture threshold.
  - **MANUAL**: Direct remote control override from the dashboard to start or stop the water pump.
- **Dynamic Pump Visualizer**: Real-time impeller animation, pulse wave indicator, and relay state sync.
- **Real-Time Data Streaming**: Server-Sent Events (SSE) push updates to dashboard clients with zero latency.
- **Time-Series Charts**: Interactive multi-series historical trendlines powered by Chart.js.
- **Embedded Virtual Simulator**: Test sensor changes, dry soil alerts, and automated pump reactions without hardware.
- **Cloud-Ready**: Ready for deployment to Render, Railway, or VPS with MongoDB Atlas.

---

## 📌 Hardware Pinout

| Component | ESP32 Pin | Type | Notes |
|---|---|---|---|
| **DHT11 / DHT22** | GPIO 4 | Digital | Temperature & Humidity |
| **Soil Moisture Sensor** | GPIO 34 | Analog (ADC1) | Higher value = Drier soil (Trigger > 3000) |
| **LDR Light Sensor** | GPIO 35 | Analog (ADC1) | Ambient sunlight intensity |
| **Relay (Water Pump)** | GPIO 26 | Digital Output | Active LOW (LOW = ON, HIGH = OFF) |

---

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Copy `.env.example` to `.env`:
```env
PORT=3000
MONGODB_URI=your_mongodb_atlas_connection_string
DEFAULT_DEVICE_ID=smartfarm-01
DRY_THRESHOLD=3000
```
*(Note: If `MONGODB_URI` is left blank, the server operates in fast in-memory fallback mode).*

### 3. Run the Server
```bash
npm start
```
Access the dashboard at `http://localhost:3000`.

---

## 📡 ESP32 API Endpoints

- **`POST /api/sensors`**: Ingests telemetry packet from ESP32.
- **`GET /api/control/:deviceId`**: Poll endpoint for ESP32 commands (`autoMode`, `motorCommand`).
- **`POST /api/control/:deviceId`**: Updates device settings from web UI.
- **`GET /api/stream`**: SSE live stream for connected web clients.
- **`GET /api/sensors/history/:deviceId`**: Historical telemetry data for charts.

---

## 📜 License
MIT
