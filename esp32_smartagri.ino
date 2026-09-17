#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <DHT.h>

// ==========================================
// SMART FARMING SYSTEM (ESP32)
// Render Server: https://smartagri-xxq4.onrender.com
// Features:
// 1. Senses and sends full telemetry to MongoDB every 2 MINUTES.
// 2. Polls commands every 500ms with persistent TLS for INSTANT manual Motor ON/OFF!
// 3. Real-time soil moisture monitoring (every 500ms in AUTO mode) prevents overwatering!
// ==========================================

// ---------- WIFI CONFIGURATION ----------

const char* WIFI_SSID = "hofis123";
const char* WIFI_PASSWORD = "hofis123";

// ---------- SERVER CONFIGURATION ----------

const char* SERVER_URL = "https://smartagri-xxq4.onrender.com";
const char* DEVICE_ID = "smartfarm-01";

// ---------- PIN DEFINITIONS ----------

#define DHTPIN 4
#define DHTTYPE DHT11

#define SOIL_PIN 34
#define LDR_PIN 35
#define RELAY_PIN 26

// Relay logic (Active LOW)
#define RELAY_ON LOW
#define RELAY_OFF HIGH

DHT dht(DHTPIN, DHTTYPE);

// ---------- CONTROL & STATE ----------

bool autoMode = true;
bool manualMotorCommand = false;
bool motorState = false;

// Higher reading = drier soil (0 - 4095)
// Dry trigger: When soilValue > DRY_THRESHOLD, pump turns ON
#define DRY_THRESHOLD 3000

// Hysteresis buffer to avoid rapid relay clicking (chatter) and prevent overwatering.
// Turn pump OFF when soilValue <= WET_THRESHOLD (e.g. 2850).
#define MOISTURE_HYSTERESIS 150
#define WET_THRESHOLD (DRY_THRESHOLD - MOISTURE_HYSTERESIS)

// Safety shutoff: Maximum continuous pump runtime in AUTO mode (e.g. 45 seconds).
// Prevents flooding and motor burnout if water tank is empty or sensor is misplaced.
const unsigned long MAX_PUMP_RUN_TIME = 45000;
unsigned long pumpStartTime = 0;

// ---------- TIMING INTERVALS ----------

unsigned long lastSensorRead = 0;
unsigned long lastDataSend = 0;
unsigned long lastCommandCheck = 0;
unsigned long lastWiFiCheck = 0;
unsigned long lastAutoSoilCheck = 0;

// Every 2 minutes (120,000 milliseconds) for full sensing and database storage
const unsigned long SENSOR_INTERVAL = 120000;
const unsigned long SERVER_INTERVAL = 120000;

// Every 500ms for INSTANT website button reaction
const unsigned long COMMAND_INTERVAL = 500;

// Every 500ms for real-time automatic soil moisture monitoring & instant shutoff
const unsigned long AUTO_SOIL_CHECK_INTERVAL = 500;

// ---------- SENSOR VALUES ----------

float temperature = NAN;
float humidity = NAN;
int soilValue = 0;
int ldrValue = 0;

// Reusable HTTP client for fast command checking without TLS renegotiation
WiFiClientSecure cmdClient;
HTTPClient cmdHttp;
bool isCmdInitialized = false;
String lastCmdUrl = "";

// Forward declarations
void sendMotorAck(bool state);
int readSoilMoisture();
void automaticControl();

// ==========================================
// FAST SOIL MOISTURE SENSOR READ
// Multi-sample smoothing to eliminate ADC electrical noise
// ==========================================

int readSoilMoisture() {
  long sum = 0;
  for (int i = 0; i < 5; i++) {
    sum += analogRead(SOIL_PIN);
    delayMicroseconds(200);
  }
  soilValue = sum / 5;
  return soilValue;
}

// ==========================================
// MOTOR SWITCH FUNCTION
// ==========================================

void setMotor(bool state) {
  motorState = state;

  if (motorState) {
    pumpStartTime = millis();
    digitalWrite(RELAY_PIN, RELAY_ON);
    Serial.println("===============================");
    Serial.println(">>> MOTOR: ON (PUMP RUNNING) <<<");
    Serial.println("===============================");
  } else {
    digitalWrite(RELAY_PIN, RELAY_OFF);
    Serial.println("===============================");
    Serial.println(">>> MOTOR: OFF (STANDBY)    <<<");
    Serial.println("===============================");
  }
}

// ==========================================
// IMMEDIATE HARDWARE CONFIRMATION (ACK)
// ==========================================

void sendMotorAck(bool state) {
  if (WiFi.status() != WL_CONNECTED) return;

  Serial.println("[ACK] Sending immediate hardware confirmation to server...");
  WiFiClientSecure ackClient;
  ackClient.setInsecure();
  HTTPClient ackHttp;
  String url = String(SERVER_URL) + "/api/control/" + String(DEVICE_ID) + "/ack";

  if (ackHttp.begin(ackClient, url)) {
    ackHttp.addHeader("Content-Type", "application/json");
    ackHttp.setTimeout(3000);
    String json = "{\"deviceId\":\"" + String(DEVICE_ID) + "\",\"motorState\":\"" + (state ? "ON" : "OFF") + "\"}";
    int code = ackHttp.POST(json);
    Serial.print("[ACK] Confirmation Response Code: ");
    Serial.println(code);
    ackHttp.end();
  }
}

// ==========================================
// WIFI CONNECTION
// ==========================================

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  Serial.print("Connecting to WiFi...");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long startTime = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startTime < 20000) {
    delay(500);
    Serial.print(".");
  }

  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("WiFi Connected Successfully!");
    Serial.print("ESP32 IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("WiFi connection failed. Retrying in background...");
  }
}

// ==========================================
// AUTOMATIC MOTOR CONTROL (AUTO MODE)
// Fast real-time check to prevent overwatering
// ==========================================

void automaticControl() {
  if (!autoMode) return;

  // Always read the latest real-time soil moisture directly from the pin
  readSoilMoisture();

  if (motorState) {
    // PUMP IS CURRENTLY RUNNING:
    // Check continuously if the soil has received enough water
    if (soilValue <= WET_THRESHOLD) {
      Serial.println();
      Serial.println("==================================================");
      Serial.print("[AUTO] Soil is now MOIST (Reading: ");
      Serial.print(soilValue);
      Serial.print(" <= Threshold: ");
      Serial.print(WET_THRESHOLD);
      Serial.println(").");
      Serial.println(">>> PUMP STOPPED IMMEDIATELY (PREVENTED OVERWATERING) <<<");
      Serial.println("==================================================");
      setMotor(false);
      sendMotorAck(false);
    } 
    // Safety guard: prevent endless watering if sensor is displaced or water empty
    else if (millis() - pumpStartTime >= MAX_PUMP_RUN_TIME) {
      Serial.println();
      Serial.println("==================================================");
      Serial.print("[AUTO SAFETY] Max pump duration (");
      Serial.print(MAX_PUMP_RUN_TIME / 1000);
      Serial.println("s) reached!");
      Serial.println(">>> PUMP STOPPED FOR SAFETY <<<");
      Serial.println("==================================================");
      setMotor(false);
      sendMotorAck(false);
    }
  } else {
    // PUMP IS CURRENTLY STANDBY (OFF):
    // Check if soil has dried out and needs watering
    if (soilValue > DRY_THRESHOLD) {
      Serial.println();
      Serial.println("==================================================");
      Serial.print("[AUTO] Soil is DRY (Reading: ");
      Serial.print(soilValue);
      Serial.print(" > Threshold: ");
      Serial.print(DRY_THRESHOLD);
      Serial.println(").");
      Serial.println(">>> PUMP STARTED (AUTOMATIC IRRIGATION) <<<");
      Serial.println("==================================================");
      setMotor(true);
      sendMotorAck(true);
    }
  }
}

// ==========================================
// READ SENSORS (EVERY 2 MINUTES)
// ==========================================

void readSensors() {
  temperature = dht.readTemperature();
  humidity = dht.readHumidity();

  soilValue = readSoilMoisture();
  ldrValue = analogRead(LDR_PIN);

  Serial.println();
  Serial.println("---------- [2-MIN SENSOR READING] ----------");

  if (isnan(temperature) || isnan(humidity)) {
    Serial.println("DHT11: Read Error");
  } else {
    Serial.print("Temperature : ");
    Serial.print(temperature);
    Serial.println(" °C");

    Serial.print("Humidity    : ");
    Serial.print(humidity);
    Serial.println(" %");
  }

  Serial.print("Soil Value  : ");
  Serial.println(soilValue);

  Serial.print("LDR Value   : ");
  Serial.println(ldrValue);

  Serial.print("Mode        : ");
  Serial.println(autoMode ? "AUTO" : "MANUAL");

  Serial.print("Motor       : ");
  Serial.println(motorState ? "ON" : "OFF");
  Serial.println("--------------------------------------------");

  if (autoMode) {
    automaticControl();
  }
}

// ==========================================
// SEND SENSOR DATA TO DATABASE (EVERY 2 MINS)
// ==========================================

void sendSensorData() {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure dataClient;
  dataClient.setInsecure(); // Disable SSL certificate verification

  HTTPClient dataHttp;
  String url = String(SERVER_URL) + "/api/sensors";

  if (!dataHttp.begin(dataClient, url)) {
    Serial.println("Failed to connect to /api/sensors");
    return;
  }

  dataHttp.addHeader("Content-Type", "application/json");

  String temp = isnan(temperature) ? "null" : String(temperature, 2);
  String hum = isnan(humidity) ? "null" : String(humidity, 2);

  String json = "{";
  json += "\"deviceId\":\"" + String(DEVICE_ID) + "\",";
  json += "\"temperature\":" + temp + ",";
  json += "\"humidity\":" + hum + ",";
  json += "\"soilMoisture\":" + String(soilValue) + ",";
  json += "\"ldrValue\":" + String(ldrValue) + ",";
  json += "\"motorState\":\"" + String(motorState ? "ON" : "OFF") + "\",";
  json += "\"autoMode\":" + String(autoMode ? "true" : "false");
  json += "}";

  Serial.println("Sending 2-minute telemetry to MongoDB Atlas...");
  int responseCode = dataHttp.POST(json);

  Serial.print("Database Save HTTP Response: ");
  Serial.println(responseCode);

  if (responseCode > 0) {
    Serial.println(dataHttp.getString());
  } else {
    Serial.println(dataHttp.errorToString(responseCode));
  }

  dataHttp.end();
}

// ==========================================
// CHECK WEBSITE COMMAND (EVERY 500MS - INSTANT)
// ==========================================

void checkServerCommand() {
  if (WiFi.status() != WL_CONNECTED) return;

  // Append current actual motor state so the server always knows real hardware status
  String targetUrl = String(SERVER_URL) + "/api/control/" + String(DEVICE_ID) + "?motorState=" + (motorState ? "ON" : "OFF");

  if (!isCmdInitialized || targetUrl != lastCmdUrl) {
    if (isCmdInitialized) {
      cmdHttp.end();
    }
    cmdHttp.begin(cmdClient, targetUrl);
    cmdHttp.setReuse(true);       // Re-use TLS connection for fast response!
    cmdHttp.setTimeout(2500);
    isCmdInitialized = true;
    lastCmdUrl = targetUrl;
  }

  int responseCode = cmdHttp.GET();

  if (responseCode == 200) {
    String response = cmdHttp.getString();

    // Parse commands
    bool newAutoMode = response.indexOf("\"autoMode\":true") >= 0;
    bool newManualCommand = response.indexOf("\"motorCommand\":\"ON\"") >= 0;

    autoMode = newAutoMode;

    if (autoMode) {
      automaticControl();
    } else {
      // In MANUAL mode, check if website commanded motor state change
      if (motorState != newManualCommand) {
        manualMotorCommand = newManualCommand;
        setMotor(manualMotorCommand);
        Serial.print("INSTANT COMMAND TRIGGERED: Motor is now ");
        Serial.println(motorState ? "ON" : "OFF");

        // Immediately send hardware ACK confirmation to server
        sendMotorAck(motorState);
      }
    }

  } else {
    // On error, reset connection so it reconnects on next tick
    cmdHttp.end();
    isCmdInitialized = false;
  }
}

// ==========================================
// SETUP
// ==========================================

void setup() {
  Serial.begin(115200);

  dht.begin();

  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, RELAY_OFF);

  analogReadResolution(12);

  Serial.println();
  Serial.println("======================================");
  Serial.println("     SMART FARMING SYSTEM (ESP32)");
  Serial.println("   2-MIN LOGGING + INSTANT CONTROL");
  Serial.println("======================================");

  // Configure command client
  cmdClient.setInsecure();

  connectWiFi();

  Serial.println("Sensors Initialized.");
  setMotor(false);

  // Initial read and send on boot
  readSensors();
  sendSensorData();

  unsigned long now = millis();
  lastSensorRead = now;
  lastDataSend = now;
  lastCommandCheck = now;
  lastAutoSoilCheck = now;
}

// ==========================================
// LOOP
// ==========================================

void loop() {
  unsigned long currentMillis = millis();

  // ---------- WIFI RECONNECT CHECK ----------
  if (WiFi.status() != WL_CONNECTED && currentMillis - lastWiFiCheck >= 10000) {
    lastWiFiCheck = currentMillis;
    connectWiFi();
  }

  // ---------- REAL-TIME AUTO SOIL CHECK (EVERY 500MS) ----------
  // In AUTO mode, continuously monitors soil moisture directly from the pin.
  // When pump is ON, it immediately detects moisture and stops the pump!
  if (currentMillis - lastAutoSoilCheck >= AUTO_SOIL_CHECK_INTERVAL) {
    lastAutoSoilCheck = currentMillis;
    if (autoMode) {
      automaticControl();
    }
  }

  // ---------- SENSOR READING (EVERY 2 MINUTES) ----------
  if (currentMillis - lastSensorRead >= SENSOR_INTERVAL) {
    lastSensorRead = currentMillis;
    readSensors();
  }

  // ---------- SEND DATA TO DATABASE (EVERY 2 MINUTES) ----------
  if (currentMillis - lastDataSend >= SERVER_INTERVAL) {
    lastDataSend = currentMillis;
    sendSensorData();
  }

  // ---------- CHECK COMMAND FOR INSTANT MOTOR ON/OFF (EVERY 500MS) ----------
  if (currentMillis - lastCommandCheck >= COMMAND_INTERVAL) {
    lastCommandCheck = currentMillis;
    checkServerCommand();
  }
}
