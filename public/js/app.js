/**
 * AgriPulse IoT - Frontend Application Logic
 * ESP32 + Node.js + MongoDB Atlas
 */

// Application State
const state = {
  deviceId: 'smartfarm-01',
  autoMode: true,
  motorCommand: 'OFF',
  dryThreshold: 3000,
  currentMotorState: 'OFF',
  isOnline: false,
  lastSeen: null,
  activeChartTab: 'soil', // 'soil' | 'climate' | 'light'
  historyData: [],
  autoSimInterval: null,
  sseConnected: false
};

// DOM Elements Cache
const el = {
  // Device & Connection Info
  currentDeviceId: document.getElementById('currentDeviceId'),
  deviceDot: document.getElementById('deviceDot'),
  lastSeenText: document.getElementById('lastSeenText'),
  mongoPill: document.getElementById('mongoPill'),
  mongoStatusText: document.getElementById('mongoStatusText'),
  liveClock: document.getElementById('liveClock'),

  // Hero Strip
  heroSystemState: document.getElementById('heroSystemState'),
  heroModeTag: document.getElementById('heroModeTag'),
  heroPumpTag: document.getElementById('heroPumpTag'),
  heroSoilCondition: document.getElementById('heroSoilCondition'),

  // Vital Displays
  soilMoistureDisplay: document.getElementById('soilMoistureDisplay'),
  soilMoistureBar: document.getElementById('soilMoistureBar'),
  soilWetnessPercent: document.getElementById('soilWetnessPercent'),
  soilStatusBadge: document.getElementById('soilStatusBadge'),
  thresholdDisplay: document.getElementById('thresholdDisplay'),

  temperatureDisplay: document.getElementById('temperatureDisplay'),
  tempBar: document.getElementById('tempBar'),
  tempFahrenheit: document.getElementById('tempFahrenheit'),
  tempStatusBadge: document.getElementById('tempStatusBadge'),

  humidityDisplay: document.getElementById('humidityDisplay'),
  humidityBar: document.getElementById('humidityBar'),
  comfortLevel: document.getElementById('comfortLevel'),
  dewPointDisplay: document.getElementById('dewPointDisplay'),
  humidityStatusBadge: document.getElementById('humidityStatusBadge'),

  ldrValueDisplay: document.getElementById('ldrValueDisplay'),
  ldrBar: document.getElementById('ldrBar'),
  lightIntensityLabel: document.getElementById('lightIntensityLabel'),
  ldrStatusBadge: document.getElementById('ldrStatusBadge'),

  // Pump Visualizer & Controls
  pumpVisualCard: document.getElementById('pumpVisualCard'),
  pumpStateHeadline: document.getElementById('pumpStateHeadline'),
  pumpStateSubtext: document.getElementById('pumpStateSubtext'),
  btnSetAutoMode: document.getElementById('btnSetAutoMode'),
  btnSetManualMode: document.getElementById('btnSetManualMode'),
  modeHintText: document.getElementById('modeHintText'),
  manualLockBadge: document.getElementById('manualLockBadge'),
  btnMotorOn: document.getElementById('btnMotorOn'),
  btnMotorOff: document.getElementById('btnMotorOff'),
  thresholdSlider: document.getElementById('thresholdSlider'),
  sliderValueText: document.getElementById('sliderValueText'),
  btnEmergencyStop: document.getElementById('btnEmergencyStop'),

  // Alert Banner
  systemAlertBanner: document.getElementById('systemAlertBanner'),
  systemAlertMessage: document.getElementById('systemAlertMessage'),
  btnDismissAlert: document.getElementById('btnDismissAlert'),

  // Modals & Navigation
  btnOpenSimulator: document.getElementById('btnOpenSimulator'),
  btnCloseSimulator: document.getElementById('btnCloseSimulator'),
  simulatorModal: document.getElementById('simulatorModal'),
  footerSimLink: document.getElementById('footerSimLink'),

  btnOpenSetupGuide: document.getElementById('btnOpenSetupGuide'),
  btnCloseSetupGuide: document.getElementById('btnCloseSetupGuide'),
  setupGuideModal: document.getElementById('setupGuideModal'),
  footerSetupLink: document.getElementById('footerSetupLink'),

  btnOpenMongoModal: document.getElementById('btnOpenMongoModal'),
  btnCloseMongoModal: document.getElementById('btnCloseMongoModal'),
  btnCancelMongo: document.getElementById('btnCancelMongo'),
  mongoModal: document.getElementById('mongoModal'),
  footerAtlasLink: document.getElementById('footerAtlasLink'),

  // Mongo Config Form
  mongoUriInput: document.getElementById('mongoUriInput'),
  btnSaveMongoUri: document.getElementById('btnSaveMongoUri'),
  btnToggleMongoVisibility: document.getElementById('btnToggleMongoVisibility'),
  mongoConnectStatusBox: document.getElementById('mongoConnectStatusBox'),
  mongoConnectStatusMsg: document.getElementById('mongoConnectStatusMsg'),

  // Simulator Controls
  simSoilSlider: document.getElementById('simSoilSlider'),
  simSoilValueText: document.getElementById('simSoilValueText'),
  simTempSlider: document.getElementById('simTempSlider'),
  simTempValueText: document.getElementById('simTempValueText'),
  simHumSlider: document.getElementById('simHumSlider'),
  simHumValueText: document.getElementById('simHumValueText'),
  simLdrSlider: document.getElementById('simLdrSlider'),
  simLdrValueText: document.getElementById('simLdrValueText'),
  btnSimulateSend: document.getElementById('btnSimulateSend'),
  btnSimulateAutoToggle: document.getElementById('btnSimulateAutoToggle'),
  simAutoText: document.getElementById('simAutoText'),
  setSoilWet: document.getElementById('setSoilWet'),
  setSoilOptimal: document.getElementById('setSoilOptimal'),
  setSoilDry: document.getElementById('setSoilDry'),

  // Logs & Toasts
  logsContainer: document.getElementById('logsContainer'),
  btnClearLogs: document.getElementById('btnClearLogs'),
  toastContainer: document.getElementById('toastContainer'),
  dataPointsCount: document.getElementById('dataPointsCount'),
  chartLegendText: document.getElementById('chartLegendText')
};

// Global Chart Instance
let telemetryChartInstance = null;

// ==========================================================
// 1. INITIALIZATION
// ==========================================================
document.addEventListener('DOMContentLoaded', async () => {
  // Update live clock
  setInterval(updateLiveClock, 1000);
  updateLiveClock();

  // Initialize UI Event Listeners
  setupEventListeners();

  // Initialize Chart
  initChart();

  // Check Database & Initial Telemetry
  await checkDatabaseStatus();
  await fetchLatestTelemetry();
  await loadTelemetryHistory();

  // Establish SSE Stream (with polling fallback)
  connectSSE();
  setInterval(pollStatusFallback, 5000);
});

function updateLiveClock() {
  const now = new Date();
  el.liveClock.textContent = now.toTimeString().split(' ')[0];
}

// ==========================================================
// 2. SERVER-SENT EVENTS & FALLBACK POLLING
// ==========================================================
function connectSSE() {
  if (typeof EventSource === 'undefined') {
    addLog('SSE not supported by browser. Falling back to HTTP polling.', 'log-info');
    return;
  }

  try {
    const evtSource = new EventSource('/api/stream');

    evtSource.addEventListener('connected', () => {
      state.sseConnected = true;
      addLog('Connected to real-time live telemetry stream (SSE).', 'log-info');
    });

    evtSource.addEventListener('telemetry', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.deviceId === state.deviceId) {
          handleIncomingTelemetry(data.reading, data.online);
        }
      } catch (err) {
        console.error('SSE JSON error', err);
      }
    });

    evtSource.addEventListener('control_change', (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.deviceId === state.deviceId) {
          updateControlStateUI(data.autoMode, data.motorCommand, data.dryThreshold);
        }
      } catch (err) {
        console.error('SSE control parse error', err);
      }
    });

    evtSource.onerror = () => {
      state.sseConnected = false;
      evtSource.close();
      // Retry in 6 seconds
      setTimeout(connectSSE, 6000);
    };
  } catch (err) {
    console.error('SSE initialization error:', err);
  }
}

async function pollStatusFallback() {
  if (!state.sseConnected) {
    await fetchLatestTelemetry();
  }
  await checkDatabaseStatus();
}

// ==========================================================
// 3. TELEMETRY HANDLING & UI UPDATES
// ==========================================================
function handleIncomingTelemetry(reading, online = true) {
  if (!reading) return;

  state.isOnline = true;
  state.lastSeen = reading.timestamp || new Date();
  state.currentMotorState = reading.motorState || 'OFF';

  // Update online dot & text
  el.deviceDot.className = 'status-indicator-dot online';
  el.lastSeenText.textContent = 'Live • Just now';

  // Update Hero Strip
  updateHeroStrip(reading);

  // Update Vital Cards
  updateSoilMoisture(reading.soilMoisture);
  updateTemperature(reading.temperature);
  updateHumidity(reading.humidity);
  updateSunlight(reading.ldrValue);

  // Update Pump visual
  updatePumpVisual(reading.motorState);

  // Update Control Mode if passed in telemetry
  if (reading.autoMode !== undefined && reading.autoMode !== state.autoMode) {
    updateControlStateUI(reading.autoMode, state.motorCommand, state.dryThreshold);
  }

  // Append to Chart
  appendTelemetryToChart(reading);

  // System alert for Dry Soil
  if (reading.soilMoisture > state.dryThreshold) {
    showSystemAlert(`Warning: Soil moisture ADC ${reading.soilMoisture} exceeds dry threshold ${state.dryThreshold}! Irrigation pump active.`);
    addLog(`[ALERT] Soil is DRY (ADC: ${reading.soilMoisture}). Pump triggered.`, 'log-alert');
  } else {
    hideSystemAlert();
  }

  addLog(`Telemetry received: Soil ${reading.soilMoisture}, Temp ${reading.temperature}°C, Hum ${reading.humidity}%, Pump ${reading.motorState}`, 'log-telemetry');
}

function updateHeroStrip(reading) {
  const isPumping = reading.motorState === 'ON';
  el.heroSystemState.textContent = isPumping ? 'IRRIGATING' : 'MONITORING';
  el.heroSystemState.style.color = isPumping ? '#22d3ee' : '#34d399';

  el.heroPumpTag.textContent = reading.motorState;
  el.heroPumpTag.className = isPumping ? 'pump-tag on' : 'pump-tag off';

  const isDry = reading.soilMoisture > state.dryThreshold;
  el.heroSoilCondition.textContent = isDry ? 'Dry (Needs Water)' : (reading.soilMoisture < 2000 ? 'Saturated' : 'Optimal Hydration');
  el.heroSoilCondition.style.color = isDry ? '#f87171' : '#34d399';
}

function updateSoilMoisture(soilVal) {
  if (soilVal === null || soilVal === undefined) return;
  const val = Number(soilVal);
  el.soilMoistureDisplay.textContent = val;

  // Wetness % calculation: 1000 = 100% wet, 3800 = 0% wet
  let wetPercent = Math.round(100 - ((val - 1200) / (3800 - 1200) * 100));
  wetPercent = Math.max(0, Math.min(100, wetPercent));
  el.soilWetnessPercent.textContent = `${wetPercent} %`;
  el.soilMoistureBar.style.width = `${wetPercent}%`;

  if (val > state.dryThreshold) {
    el.soilStatusBadge.textContent = 'Dry (Action Required)';
    el.soilStatusBadge.className = 'sensor-badge badge-orange';
  } else if (val < 2000) {
    el.soilStatusBadge.textContent = 'High Wetness';
    el.soilStatusBadge.className = 'sensor-badge badge-cyan';
  } else {
    el.soilStatusBadge.textContent = 'Optimal Moisture';
    el.soilStatusBadge.className = 'sensor-badge badge-cyan';
  }
}

function updateTemperature(tempVal) {
  if (tempVal === null || tempVal === undefined || isNaN(tempVal)) {
    el.temperatureDisplay.textContent = '--';
    el.tempFahrenheit.textContent = '-- °F';
    el.tempStatusBadge.textContent = 'Sensor Error';
    el.tempStatusBadge.className = 'sensor-badge badge-orange';
    return;
  }
  const temp = Number(tempVal);
  el.temperatureDisplay.textContent = temp.toFixed(1);
  const fahrenheit = ((temp * 9) / 5 + 32).toFixed(1);
  el.tempFahrenheit.textContent = `${fahrenheit} °F`;

  const barPercent = Math.min(100, Math.max(0, (temp / 50) * 100));
  el.tempBar.style.width = `${barPercent}%`;

  if (temp > 35) {
    el.tempStatusBadge.textContent = 'High Heat';
    el.tempStatusBadge.className = 'sensor-badge badge-orange';
  } else if (temp < 15) {
    el.tempStatusBadge.textContent = 'Cool';
    el.tempStatusBadge.className = 'sensor-badge badge-blue';
  } else {
    el.tempStatusBadge.textContent = 'Optimal (Normal)';
    el.tempStatusBadge.className = 'sensor-badge badge-cyan';
  }
}

function updateHumidity(humVal) {
  if (humVal === null || humVal === undefined || isNaN(humVal)) {
    el.humidityDisplay.textContent = '--';
    el.dewPointDisplay.textContent = '-- °C';
    el.humidityStatusBadge.textContent = 'Sensor Error';
    return;
  }
  const hum = Number(humVal);
  el.humidityDisplay.textContent = hum.toFixed(1);
  el.humidityBar.style.width = `${Math.min(100, Math.max(0, hum))}%`;

  // Estimate Dew Point: T - ((100 - RH) / 5)
  const temp = parseFloat(el.temperatureDisplay.textContent) || 25;
  const dewPoint = (temp - ((100 - hum) / 5)).toFixed(1);
  el.dewPointDisplay.textContent = `${dewPoint} °C`;

  if (hum > 75) {
    el.comfortLevel.textContent = 'Humid / Muggy';
    el.humidityStatusBadge.textContent = 'Humid';
    el.humidityStatusBadge.className = 'sensor-badge badge-blue';
  } else if (hum < 35) {
    el.comfortLevel.textContent = 'Dry Air';
    el.humidityStatusBadge.textContent = 'Dry';
    el.humidityStatusBadge.className = 'sensor-badge badge-orange';
  } else {
    el.comfortLevel.textContent = 'Comfortable';
    el.humidityStatusBadge.textContent = 'Optimal';
    el.humidityStatusBadge.className = 'sensor-badge badge-cyan';
  }
}

function updateSunlight(ldrVal) {
  if (ldrVal === null || ldrVal === undefined) return;
  const ldr = Number(ldrVal);
  el.ldrValueDisplay.textContent = ldr;

  const percent = Math.min(100, Math.max(0, (ldr / 4095) * 100));
  el.ldrBar.style.width = `${percent}%`;

  if (ldr > 2800) {
    el.lightIntensityLabel.textContent = 'Bright Direct Sunlight';
    el.ldrStatusBadge.textContent = 'Full Sun';
  } else if (ldr > 1600) {
    el.lightIntensityLabel.textContent = 'Diffused Daylight';
    el.ldrStatusBadge.textContent = 'Daylight';
  } else if (ldr > 700) {
    el.lightIntensityLabel.textContent = 'Shaded / Twilight';
    el.ldrStatusBadge.textContent = 'Dusk';
  } else {
    el.lightIntensityLabel.textContent = 'Dark / Night';
    el.ldrStatusBadge.textContent = 'Night';
  }
}

function updatePumpVisual(motorState) {
  const isOn = motorState === 'ON';
  if (isOn) {
    el.pumpVisualCard.classList.add('active');
    el.pumpStateHeadline.textContent = 'MOTOR IS RUNNING (ON)';
    el.pumpStateHeadline.style.color = '#22d3ee';
    el.pumpStateSubtext.textContent = 'Relay active (Pin 26 LOW). Water is flowing to irrigation lines.';
  } else {
    el.pumpVisualCard.classList.remove('active');
    el.pumpStateHeadline.textContent = 'MOTOR IS OFF (STANDBY)';
    el.pumpStateHeadline.style.color = '#ffffff';
    el.pumpStateSubtext.textContent = 'Standby. Soil moisture is within safe limit.';
  }
}

function updateControlStateUI(autoMode, motorCommand, dryThreshold) {
  state.autoMode = Boolean(autoMode);
  if (motorCommand !== undefined) state.motorCommand = motorCommand;
  if (dryThreshold !== undefined) state.dryThreshold = Number(dryThreshold);

  // Update Hero Tag
  el.heroModeTag.textContent = state.autoMode ? 'AUTO' : 'MANUAL';
  el.heroModeTag.className = state.autoMode ? 'mode-tag auto' : 'mode-tag manual';

  // Mode Buttons
  if (state.autoMode) {
    el.btnSetAutoMode.classList.add('active');
    el.btnSetManualMode.classList.remove('active');
    el.modeHintText.textContent = 'ESP32 automatically triggers motor when soil goes above threshold. Click START or STOP anytime for instant manual control.';
    
    // Keep buttons clickable for instant override!
    if (el.manualLockBadge) el.manualLockBadge.style.display = 'none';
    el.btnMotorOn.disabled = false;
    el.btnMotorOff.disabled = false;
    el.btnMotorOn.classList.remove('active');
    el.btnMotorOff.classList.remove('active');
  } else {
    el.btnSetAutoMode.classList.remove('active');
    el.btnSetManualMode.classList.add('active');
    el.modeHintText.textContent = 'Manual mode active! Remote dashboard commands directly control the relay.';

    if (el.manualLockBadge) el.manualLockBadge.style.display = 'none';
    el.btnMotorOn.disabled = false;
    el.btnMotorOff.disabled = false;

    // Highlight active button based on motorCommand
    if (state.motorCommand === 'ON') {
      el.btnMotorOn.classList.add('active');
      el.btnMotorOff.classList.remove('active');
    } else {
      el.btnMotorOn.classList.remove('active');
      el.btnMotorOff.classList.add('active');
    }
  }

  // Threshold Slider & Display
  el.thresholdSlider.value = state.dryThreshold;
  el.sliderValueText.textContent = state.dryThreshold;
  el.thresholdDisplay.textContent = `> ${state.dryThreshold} (Dry)`;
}

// ==========================================================
// 4. API ACTIONS (SEND COMMANDS)
// ==========================================================
async function sendControlUpdate(updates) {
  try {
    const res = await fetch(`/api/control/${state.deviceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    const json = await res.json();
    if (json.success) {
      updateControlStateUI(
        json.device.autoMode,
        json.device.motorCommand,
        json.device.dryThreshold
      );
      return true;
    }
  } catch (err) {
    console.error('Failed to send control command:', err);
    showToast('Failed to reach server to update command', 'alert');
    return false;
  }
}

async function fetchLatestTelemetry() {
  try {
    const res = await fetch(`/api/sensors/latest/${state.deviceId}`);
    const data = await res.json();

    if (data.control) {
      updateControlStateUI(
        data.control.autoMode,
        data.control.motorCommand,
        data.control.dryThreshold
      );
    }

    if (data.reading) {
      handleIncomingTelemetry(data.reading, data.online);
    }

    if (data.lastSeen) {
      const diffSec = Math.round((Date.now() - new Date(data.lastSeen).getTime()) / 1000);
      if (diffSec < 30) {
        el.deviceDot.className = 'status-indicator-dot online';
        el.lastSeenText.textContent = `Live • ${diffSec}s ago`;
      } else {
        el.deviceDot.className = 'status-indicator-dot offline';
        el.lastSeenText.textContent = `Offline • ${Math.round(diffSec / 60)}m ago`;
      }
    }
  } catch (err) {
    console.error('Fetch latest telemetry error:', err);
  }
}

async function loadTelemetryHistory() {
  try {
    const res = await fetch(`/api/sensors/history/${state.deviceId}?limit=30`);
    const data = await res.json();
    if (data.history && Array.isArray(data.history)) {
      state.historyData = data.history;
      renderChartData();
    }
  } catch (err) {
    console.error('Fetch history error:', err);
  }
}

async function checkDatabaseStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.database) {
      if (data.database.connected) {
        el.mongoStatusText.textContent = 'Atlas: Connected';
        el.mongoPill.style.borderColor = 'rgba(16, 185, 129, 0.4)';
        el.mongoPill.style.color = '#34d399';
      } else {
        el.mongoStatusText.textContent = 'Atlas: Disconnected (In-Memory Active)';
        el.mongoPill.style.borderColor = 'rgba(234, 179, 8, 0.3)';
        el.mongoPill.style.color = '#fbbf24';
      }
    }
  } catch (err) {
    el.mongoStatusText.textContent = 'Atlas: Offline';
  }
}

// ==========================================================
// 5. CHART.JS CONFIGURATION & RENDERING
// ==========================================================
function initChart() {
  const ctx = document.getElementById('telemetryChart').getContext('2d');
  
  telemetryChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: []
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0f172a',
          titleColor: '#fff',
          bodyColor: '#cbd5e1',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          padding: 10
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.04)' },
          ticks: { color: '#64748b', font: { size: 10 } }
        },
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.06)' },
          ticks: { color: '#94a3b8', font: { size: 11 } }
        }
      }
    }
  });

  renderChartData();
}

function renderChartData() {
  if (!telemetryChartInstance) return;

  const labels = state.historyData.map(d => {
    const t = new Date(d.timestamp);
    return `${t.getHours().toString().padStart(2, '0')}:${t.getMinutes().toString().padStart(2, '0')}:${t.getSeconds().toString().padStart(2, '0')}`;
  });

  el.dataPointsCount.textContent = `${state.historyData.length} samples loaded`;

  if (state.activeChartTab === 'soil') {
    el.chartLegendText.textContent = 'Soil ADC Moisture (Dry threshold marked at 3000)';
    telemetryChartInstance.data.labels = labels;
    telemetryChartInstance.data.datasets = [
      {
        label: 'Soil ADC',
        data: state.historyData.map(d => d.soilMoisture),
        borderColor: '#06b6d4',
        backgroundColor: 'rgba(6, 182, 212, 0.1)',
        borderWidth: 2,
        fill: true,
        tension: 0.35,
        pointRadius: 3
      },
      {
        label: 'Threshold',
        data: state.historyData.map(() => state.dryThreshold),
        borderColor: '#ef4444',
        borderWidth: 1.5,
        borderDash: [5, 5],
        pointRadius: 0,
        fill: false
      }
    ];
  } else if (state.activeChartTab === 'climate') {
    el.chartLegendText.textContent = 'Temperature (°C) and Relative Humidity (% RH)';
    telemetryChartInstance.data.labels = labels;
    telemetryChartInstance.data.datasets = [
      {
        label: 'Temperature (°C)',
        data: state.historyData.map(d => d.temperature),
        borderColor: '#f97316',
        backgroundColor: 'rgba(249, 115, 22, 0.08)',
        borderWidth: 2,
        fill: false,
        tension: 0.35,
        pointRadius: 3
      },
      {
        label: 'Humidity (% RH)',
        data: state.historyData.map(d => d.humidity),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.08)',
        borderWidth: 2,
        fill: false,
        tension: 0.35,
        pointRadius: 3
      }
    ];
  } else if (state.activeChartTab === 'light') {
    el.chartLegendText.textContent = 'Sunlight LDR ADC Intensity';
    telemetryChartInstance.data.labels = labels;
    telemetryChartInstance.data.datasets = [
      {
        label: 'Sunlight (ADC)',
        data: state.historyData.map(d => d.ldrValue),
        borderColor: '#eab308',
        backgroundColor: 'rgba(234, 179, 8, 0.15)',
        borderWidth: 2,
        fill: true,
        tension: 0.35,
        pointRadius: 3
      }
    ];
  }

  telemetryChartInstance.update();
}

function appendTelemetryToChart(reading) {
  state.historyData.push(reading);
  if (state.historyData.length > 40) {
    state.historyData.shift();
  }
  renderChartData();
}

// ==========================================================
// 6. EVENT LISTENERS
// ==========================================================
function setupEventListeners() {
  // Mode Selection
  el.btnSetAutoMode.addEventListener('click', async () => {
    const success = await sendControlUpdate({ autoMode: true });
    if (success) {
      showToast('Switched to AUTOMATIC Mode (Soil-driven pump)', 'success');
      addLog('Control mode set to AUTO. Pump follows soil moisture threshold.', 'log-pump');
    }
  });

  el.btnSetManualMode.addEventListener('click', async () => {
    const success = await sendControlUpdate({ autoMode: false });
    if (success) {
      showToast('Switched to MANUAL Mode (Remote control unlocked)', 'info');
      addLog('Control mode set to MANUAL. Dashboard override active.', 'log-pump');
    }
  });

  // Direct Motor Controls - Instant Action
  el.btnMotorOn.addEventListener('click', async () => {
    // Instant optimistic UI response
    updatePumpVisual('ON');
    updateControlStateUI(false, 'ON', state.dryThreshold);
    showToast('Starting Motor Immediately (Manual Mode)...', 'success');
    addLog('⚡ Direct Motor Command sent: ON', 'log-pump');

    await sendControlUpdate({ autoMode: false, motorCommand: 'ON' });
  });

  el.btnMotorOff.addEventListener('click', async () => {
    // Instant optimistic UI response
    updatePumpVisual('OFF');
    updateControlStateUI(false, 'OFF', state.dryThreshold);
    showToast('Stopping Motor Immediately...', 'info');
    addLog('⚡ Direct Motor Command sent: OFF', 'log-pump');

    await sendControlUpdate({ autoMode: false, motorCommand: 'OFF' });
  });

  // Dry Threshold Slider
  el.thresholdSlider.addEventListener('input', (e) => {
    el.sliderValueText.textContent = e.target.value;
  });

  el.thresholdSlider.addEventListener('change', async (e) => {
    const newVal = Number(e.target.value);
    await sendControlUpdate({ dryThreshold: newVal });
    showToast(`Dry threshold calibrated to ${newVal}`, 'info');
    addLog(`Dry Threshold updated to ${newVal}`, 'log-info');
    renderChartData();
  });

  // Emergency Stop
  el.btnEmergencyStop.addEventListener('click', async () => {
    await sendControlUpdate({ autoMode: false, motorCommand: 'OFF' });
    showToast('EMERGENCY SHUTOFF TRIGGERED! Motor stopped & switched to manual.', 'alert');
    addLog('[EMERGENCY] Motor shut off immediately.', 'log-alert');
  });

  // Chart Tab Buttons
  document.querySelectorAll('.chart-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      document.querySelectorAll('.chart-tab').forEach(t => t.classList.remove('active'));
      e.target.classList.add('active');
      state.activeChartTab = e.target.getAttribute('data-chart');
      renderChartData();
    });
  });

  // Alert Banner Dismiss
  el.btnDismissAlert.addEventListener('click', hideSystemAlert);

  // Clear Logs
  el.btnClearLogs.addEventListener('click', () => {
    el.logsContainer.innerHTML = '';
  });

  // Simulator Modal Open/Close
  el.btnOpenSimulator.addEventListener('click', () => openModal(el.simulatorModal));
  el.btnCloseSimulator.addEventListener('click', () => closeModal(el.simulatorModal));
  el.footerSimLink.addEventListener('click', (e) => { e.preventDefault(); openModal(el.simulatorModal); });

  // Setup Guide Modal Open/Close
  el.btnOpenSetupGuide.addEventListener('click', () => openModal(el.setupGuideModal));
  el.btnCloseSetupGuide.addEventListener('click', () => closeModal(el.setupGuideModal));
  el.footerSetupLink.addEventListener('click', (e) => { e.preventDefault(); openModal(el.setupGuideModal); });

  // MongoDB Atlas Modal Open/Close
  el.btnOpenMongoModal.addEventListener('click', () => openModal(el.mongoModal));
  el.mongoPill.addEventListener('click', () => openModal(el.mongoModal));
  el.btnCloseMongoModal.addEventListener('click', () => closeModal(el.mongoModal));
  el.btnCancelMongo.addEventListener('click', () => closeModal(el.mongoModal));
  el.footerAtlasLink.addEventListener('click', (e) => { e.preventDefault(); openModal(el.mongoModal); });

  // MongoDB Connection Testing
  el.btnSaveMongoUri.addEventListener('click', handleSaveMongoUri);
  el.btnToggleMongoVisibility.addEventListener('click', () => {
    if (el.mongoUriInput.type === 'password') {
      el.mongoUriInput.type = 'text';
      el.btnToggleMongoVisibility.textContent = 'Hide Password';
    } else {
      el.mongoUriInput.type = 'password';
      el.btnToggleMongoVisibility.textContent = 'Show Password';
    }
  });

  // Simulator Sliders & Presets
  setupSimulatorControls();
}

function openModal(modalEl) {
  modalEl.classList.add('open');
}

function closeModal(modalEl) {
  modalEl.classList.remove('open');
}

// ==========================================================
// 7. SIMULATOR LOGIC
// ==========================================================
function setupSimulatorControls() {
  el.simSoilSlider.addEventListener('input', (e) => {
    el.simSoilValueText.textContent = e.target.value;
  });

  el.simTempSlider.addEventListener('input', (e) => {
    el.simTempValueText.textContent = `${e.target.value} °C`;
  });

  el.simHumSlider.addEventListener('input', (e) => {
    el.simHumValueText.textContent = `${e.target.value} %`;
  });

  el.simLdrSlider.addEventListener('input', (e) => {
    el.simLdrValueText.textContent = e.target.value;
  });

  // Preset Buttons
  el.setSoilWet.addEventListener('click', () => {
    el.simSoilSlider.value = 1800;
    el.simSoilValueText.textContent = '1800';
    highlightPreset(el.setSoilWet);
  });
  el.setSoilOptimal.addEventListener('click', () => {
    el.simSoilSlider.value = 2600;
    el.simSoilValueText.textContent = '2600';
    highlightPreset(el.setSoilOptimal);
  });
  el.setSoilDry.addEventListener('click', () => {
    el.simSoilSlider.value = 3400;
    el.simSoilValueText.textContent = '3400';
    highlightPreset(el.setSoilDry);
  });

  // Single Simulation Packet
  el.btnSimulateSend.addEventListener('click', async () => {
    await sendSimulatedPacket();
  });

  // Continuous Auto Simulation Toggle
  el.btnSimulateAutoToggle.addEventListener('click', () => {
    if (state.autoSimInterval) {
      clearInterval(state.autoSimInterval);
      state.autoSimInterval = null;
      el.simAutoText.textContent = 'Start Auto Simulation (every 2s)';
      el.btnSimulateAutoToggle.classList.remove('active');
      showToast('Simulator stopped', 'info');
    } else {
      state.autoSimInterval = setInterval(async () => {
        // Add tiny natural sensor fluctuation
        const soilBase = Number(el.simSoilSlider.value);
        const randJitter = Math.floor(Math.random() * 40) - 20;
        const sendSoil = Math.max(1000, Math.min(4095, soilBase + randJitter));

        await sendSimulatedPacket(sendSoil);
      }, 2000);

      el.simAutoText.textContent = 'Stop Auto Simulation';
      el.btnSimulateAutoToggle.classList.add('active');
      showToast('Continuous ESP32 Simulation Running (2s)', 'success');
    }
  });
}

function highlightPreset(btn) {
  [el.setSoilWet, el.setSoilOptimal, el.setSoilDry].forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

async function sendSimulatedPacket(overrideSoil = null) {
  const soil = overrideSoil !== null ? overrideSoil : Number(el.simSoilSlider.value);
  const temp = Number(el.simTempSlider.value);
  const hum = Number(el.simHumSlider.value);
  const ldr = Number(el.simLdrSlider.value);

  try {
    const res = await fetch('/api/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: state.deviceId,
        temperature: temp,
        humidity: hum,
        soilMoisture: soil,
        ldrValue: ldr
      })
    });
    const result = await res.json();
    if (result.success) {
      showToast(`Packet sent: Soil=${soil}, Temp=${temp}°C`, 'info');
    }
  } catch (err) {
    showToast('Failed to send simulation packet', 'alert');
  }
}

// ==========================================================
// 8. MONGODB ATLAS CONNECT HANDLER
// ==========================================================
async function handleSaveMongoUri() {
  const uri = el.mongoUriInput.value.trim();
  if (!uri) {
    showMongoStatus('Please paste your MongoDB connection string.', 'error');
    return;
  }

  el.btnSaveMongoUri.disabled = true;
  showMongoStatus('Connecting to MongoDB Atlas Cluster...', 'info');

  try {
    const res = await fetch('/api/config/mongo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mongoUri: uri })
    });
    const result = await res.json();

    if (result.success) {
      showMongoStatus('Connected to MongoDB Atlas successfully!', 'success');
      showToast('MongoDB Atlas Connected & Saved to .env', 'success');
      addLog('MongoDB Atlas connection established.', 'log-pump');
      await checkDatabaseStatus();
      setTimeout(() => closeModal(el.mongoModal), 1500);
    } else {
      showMongoStatus(result.message || 'Connection failed', 'error');
    }
  } catch (err) {
    showMongoStatus(`Connection error: ${err.message}`, 'error');
  } finally {
    el.btnSaveMongoUri.disabled = false;
  }
}

function showMongoStatus(msg, type) {
  el.mongoConnectStatusBox.style.display = 'block';
  el.mongoConnectStatusBox.className = `status-box ${type}`;
  el.mongoConnectStatusMsg.textContent = msg;
}

// ==========================================================
// 9. LOGS & TOAST NOTIFICATIONS
// ==========================================================
function addLog(msg, type = 'log-info') {
  const now = new Date();
  const timeStr = `[${now.toTimeString().split(' ')[0]}]`;

  const item = document.createElement('div');
  item.className = `log-entry ${type}`;
  item.innerHTML = `<span class="log-time">${timeStr}</span><span class="log-msg">${msg}</span>`;

  el.logsContainer.appendChild(item);
  el.logsContainer.scrollTop = el.logsContainer.scrollHeight;

  // Keep log size bounded
  while (el.logsContainer.children.length > 100) {
    el.logsContainer.removeChild(el.logsContainer.firstChild);
  }
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${message}</span>`;

  el.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function showSystemAlert(msg) {
  el.systemAlertMessage.textContent = msg;
  el.systemAlertBanner.style.display = 'flex';
}

function hideSystemAlert() {
  el.systemAlertBanner.style.display = 'none';
}
