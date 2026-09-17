#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <DHT.h>

// ==========================================
// SMART FARMING SYSTEM
// ESP32 + RENDER SERVER + MONGODB
// ==========================================

// ---------- WIFI ----------

const char* WIFI_SSID = "hofis123";
const char* WIFI_PASSWORD = "hofis123";

// ---------- SERVER ----------

const char* SERVER_URL = "https://smartagri-xxq4.onrender.com";

const char* DEVICE_ID = "smartfarm-01";

// ---------- PINS ----------

#define DHTPIN 4
#define DHTTYPE DHT11

#define SOIL_PIN 34
#define LDR_PIN 35
#define RELAY_PIN 26

// ---------- RELAY ----------

#define RELAY_ON LOW
#define RELAY_OFF HIGH

DHT dht(DHTPIN, DHTTYPE);

// ---------- CONTROL ----------

bool autoMode = true;
bool manualMotorCommand = false;
bool motorState = false;

// Higher reading = drier soil (CALIBRATE)
#define DRY_THRESHOLD 3000

// ---------- TIMING ----------

unsigned long lastSensorRead = 0;
unsigned long lastDataSend = 0;
unsigned long lastCommandCheck = 0;
unsigned long lastWiFiCheck = 0;

const unsigned long SENSOR_INTERVAL = 2000;
const unsigned long SERVER_INTERVAL = 10000;
const unsigned long COMMAND_INTERVAL = 1000;

// ---------- SENSOR VALUES ----------

float temperature = NAN;
float humidity = NAN;

int soilValue = 0;
int ldrValue = 0;

// ==========================================
// MOTOR FUNCTION
// ==========================================

void setMotor(bool state) {

  motorState = state;

  if (motorState) {

    digitalWrite(RELAY_PIN, RELAY_ON);
    Serial.println("MOTOR: ON");

  } else {

    digitalWrite(RELAY_PIN, RELAY_OFF);
    Serial.println("MOTOR: OFF");
  }
}

// ==========================================
// WIFI CONNECTION
// ==========================================

void connectWiFi() {

  if (WiFi.status() == WL_CONNECTED) return;

  Serial.print("Connecting WiFi...");

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long startTime = millis();

  while (WiFi.status() != WL_CONNECTED &&
         millis() - startTime < 20000) {

    delay(500);
    Serial.print(".");
  }

  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {

    Serial.println("WiFi Connected!");
    Serial.print("IP: ");
    Serial.println(WiFi.localIP());

  } else {

    Serial.println("WiFi connection failed");
  }
}

// ==========================================
// AUTOMATIC MOTOR CONTROL
// ==========================================

void automaticControl() {

  if (!autoMode) return;

  if (soilValue > DRY_THRESHOLD) {

    // DRY SOIL → MOTOR ON

    if (!motorState) {
      setMotor(true);
    }

  } else {

    // WET SOIL → MOTOR OFF

    if (motorState) {
      setMotor(false);
    }
  }
}

// ==========================================
// READ SENSORS
// ==========================================

void readSensors() {

  temperature = dht.readTemperature();
  humidity = dht.readHumidity();

  soilValue = analogRead(SOIL_PIN);
  ldrValue = analogRead(LDR_PIN);

  Serial.println();
  Serial.println("---------- SENSOR DATA ----------");

  if (isnan(temperature) || isnan(humidity)) {

    Serial.println("DHT11: ERROR");

  } else {

    Serial.print("Temperature: ");
    Serial.print(temperature);
    Serial.println(" °C");

    Serial.print("Humidity: ");
    Serial.print(humidity);
    Serial.println(" %");
  }

  Serial.print("Soil Value: ");
  Serial.println(soilValue);

  Serial.print("LDR Value: ");
  Serial.println(ldrValue);

  Serial.print("Mode: ");
  Serial.println(autoMode ? "AUTO" : "MANUAL");

  Serial.print("Motor: ");
  Serial.println(motorState ? "ON" : "OFF");

  automaticControl();
}

// ==========================================
// SEND SENSOR DATA
// ==========================================

void sendSensorData() {

  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure client;
  client.setInsecure(); // TESTING ONLY

  HTTPClient http;

  String url = String(SERVER_URL) + "/api/sensors";

  if (!http.begin(client, url)) {

    Serial.println("HTTP begin failed");
    return;
  }

  http.addHeader("Content-Type", "application/json");

  String temp = isnan(temperature)
                  ? "null"
                  : String(temperature, 2);

  String hum = isnan(humidity)
                 ? "null"
                 : String(humidity, 2);

  String json = "{";

  json += "\"deviceId\":\"" + String(DEVICE_ID) + "\",";
  json += "\"temperature\":" + temp + ",";
  json += "\"humidity\":" + hum + ",";
  json += "\"soilMoisture\":" + String(soilValue) + ",";
  json += "\"ldrValue\":" + String(ldrValue) + ",";
  json += "\"motorState\":\"";
  json += motorState ? "ON" : "OFF";
  json += "\",";
  json += "\"autoMode\":";
  json += autoMode ? "true" : "false";
  json += "}";

  Serial.println("Sending sensor data...");

  int responseCode = http.POST(json);

  Serial.print("Response: ");
  Serial.println(responseCode);

  if (responseCode > 0) {

    Serial.println(http.getString());

  } else {

    Serial.println(http.errorToString(responseCode));
  }

  http.end();
}

// ==========================================
// CHECK WEBSITE COMMAND
// ==========================================

void checkServerCommand() {

  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure client;
  client.setInsecure(); // TESTING ONLY

  HTTPClient http;

  String url = String(SERVER_URL) +
               "/api/control/" + String(DEVICE_ID);

  if (!http.begin(client, url)) {

    Serial.println("Command connection failed");
    return;
  }

  int responseCode = http.GET();

  if (responseCode == 200) {

    String response = http.getString();

    Serial.println("Command Response:");
    Serial.println(response);

    // Expected response:
    // {
    //   "autoMode": true,
    //   "motorCommand": "OFF"
    // }

    bool newAutoMode = response.indexOf("\"autoMode\":true") >= 0;

    bool newManualCommand =
      response.indexOf("\"motorCommand\":\"ON\"") >= 0;

    autoMode = newAutoMode;

    if (autoMode) {

      // Automatic mode always follows soil moisture

      automaticControl();

    } else {

      // Manual mode follows website command

      manualMotorCommand = newManualCommand;

      setMotor(manualMotorCommand);
    }

  } else {

    Serial.print("Command HTTP Error: ");
    Serial.println(responseCode);
  }

  http.end();
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
  Serial.println("       SMART FARMING SYSTEM");
  Serial.println("======================================");

  connectWiFi();

  Serial.println("DHT11 Ready");
  Serial.println("Soil Sensor Ready");
  Serial.println("LDR Ready");
  Serial.println("Relay Ready");

  // Start in safe OFF state
  setMotor(false);

  // Read initial sensors
  readSensors();
}

// ==========================================
// LOOP
// ==========================================

void loop() {

  unsigned long currentMillis = millis();

  // ---------- WIFI RECONNECT ----------

  if (WiFi.status() != WL_CONNECTED &&
      currentMillis - lastWiFiCheck >= 10000) {

    lastWiFiCheck = currentMillis;

    connectWiFi();
  }

  // ---------- SENSOR READING ----------

  if (currentMillis - lastSensorRead >= SENSOR_INTERVAL) {

    lastSensorRead = currentMillis;

    readSensors();
  }

  // ---------- SEND DATA ----------

  if (currentMillis - lastDataSend >= SERVER_INTERVAL) {

    lastDataSend = currentMillis;

    sendSensorData();
  }

  // ---------- CHECK COMMAND ----------

  if (currentMillis - lastCommandCheck >= COMMAND_INTERVAL) {

    lastCommandCheck = currentMillis;

    checkServerCommand();
  }
}
