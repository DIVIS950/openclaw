// PITWALL telemetry box — ESP32-S3 firmware
// Sends one 42-byte BLE notification per GPS fix (25 Hz) to the PITWALL app.
// Parts, wiring and flashing: see firmware/README.md
//
// Libraries (Arduino Library Manager):
//   NimBLE-Arduino 2.x                       (h2zero)
//   SparkFun u-blox GNSS v3                  (SparkFun)
//   Adafruit MLX90614 Library                (Adafruit)
//   Adafruit ADS1X15                         (Adafruit)
//   Adafruit MAX31855 library                (Adafruit)

#include <Adafruit_ADS1X15.h>
#include <Adafruit_MAX31855.h>
#include <Adafruit_MLX90614.h>
#include <NimBLEDevice.h>
#include <SparkFun_u-blox_GNSS_v3.h>
#include <Wire.h>

#include "packet.h"

// ── Pins (ESP32-S3-DevKitC-1) ────────────────────────────────────────────
static const int PIN_GPS_RX = 18;  // ESP32 RX  <- GPS TX
static const int PIN_GPS_TX = 17;  // ESP32 TX  -> GPS RX
static const int PIN_SDA = 8;
static const int PIN_SCL = 9;
static const int PIN_TC_SCK = 12;  // MAX31855 (EGT)
static const int PIN_TC_MISO = 13;
static const int PIN_TC_CS = 10;
static const int PIN_BATT = 4;     // 100k / 22k divider from 12 V
static const int PIN_LED = 48;     // on-board RGB LED (status)

// ── Bluetooth: must match src/telemetry/blePacket.ts ────────────────────
static const char* DEVICE_NAME = "PITWALL-FABIA";
static const char* SERVICE_UUID = "7a1f0001-5c3e-4b8a-9f2d-0b1e2c3d4e5f";
static const char* FRAME_CHAR_UUID = "7a1f0002-5c3e-4b8a-9f2d-0b1e2c3d4e5f";
static const char* CONFIG_CHAR_UUID = "7a1f0003-5c3e-4b8a-9f2d-0b1e2c3d4e5f";

// ── Sensors ──────────────────────────────────────────────────────────────
static const uint8_t MUX_ADDR = 0x70;     // TCA9548A I2C mux: tyre IR sensors on channels 0-3
static const uint8_t MLX_ADDR = 0x5A;     // all four MLX90614 keep the default address
static const uint8_t ADS_ADDR = 0x48;     // ADS1115: A0 coolant, A1 oil, A2 brake FL, A3 brake FR

// NTC sensors (Bosch 0 280 130 026 style) with a 1 kΩ pull-up to 3.3 V.
// Resistance (Ω) vs °C — check against YOUR sensor's datasheet and adjust.
static const float NTC_PULLUP_OHM = 1000.0f;
static const float NTC_T[] = {-10, 0, 20, 40, 60, 80, 100, 120, 140};
static const float NTC_R[] = {9397, 5896, 2500, 1175, 596, 323, 186, 113, 72};

// Brake pyrometers with a 0-5 V output for 0-1000 °C, through a 10k/10k divider (so 0-2.5 V at the ADC).
static const float BRAKE_DIVIDER = 2.0f;
static const float BRAKE_C_PER_V = 1000.0f / 5.0f;

// Battery divider: 100 kΩ top, 22 kΩ bottom.
static const float BATT_SCALE = (100.0f + 22.0f) / 22.0f;

SFE_UBLOX_GNSS_SERIAL gnss;
Adafruit_MLX90614 mlx;
Adafruit_ADS1115 ads;
Adafruit_MAX31855 thermocouple(PIN_TC_SCK, PIN_TC_CS, PIN_TC_MISO);

NimBLECharacteristic* frameChar = nullptr;
volatile bool phoneConnected = false;
volatile uint8_t gpsHz = 25;
volatile bool rateChanged = false;

// Latest sensor values, updated round-robin between GPS fixes.
float tyre[4] = {NAN, NAN, NAN, NAN};
float brake[2] = {NAN, NAN};
float coolant = NAN, oil = NAN, egt = NAN, battV = NAN;
bool haveMux = false, haveAds = false;
uint16_t seq = 0;

// ── BLE callbacks ────────────────────────────────────────────────────────
class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* server, NimBLEConnInfo& info) override {
    phoneConnected = true;
    // Short connection interval (7.5-15 ms) so 25 notifications/s get through easily.
    server->updateConnParams(info.getConnHandle(), 6, 12, 0, 200);
  }
  void onDisconnect(NimBLEServer*, NimBLEConnInfo&, int) override {
    phoneConnected = false;
    NimBLEDevice::startAdvertising();
  }
};

// Config writes from the app: [0x01, hz] = set GPS rate (1-25 Hz).
class ConfigCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* c, NimBLEConnInfo&) override {
    std::string v = c->getValue();
    if (v.size() >= 2 && (uint8_t)v[0] == 0x01) {
      uint8_t hz = (uint8_t)v[1];
      if (hz >= 1 && hz <= 25) {
        gpsHz = hz;
        rateChanged = true;
      }
    }
  }
};

// ── Sensor helpers ───────────────────────────────────────────────────────
bool muxSelect(uint8_t ch) {
  Wire.beginTransmission(MUX_ADDR);
  Wire.write(1 << ch);
  return Wire.endTransmission() == 0;
}

float ntcCelsius(float volts) {
  if (volts <= 0.01f || volts >= 3.29f) return NAN;  // open or shorted sensor
  float r = NTC_PULLUP_OHM * volts / (3.3f - volts);
  const int n = sizeof(NTC_R) / sizeof(NTC_R[0]);
  if (r >= NTC_R[0]) return NTC_T[0];
  if (r <= NTC_R[n - 1]) return NTC_T[n - 1];
  for (int i = 0; i < n - 1; i++) {
    if (r <= NTC_R[i] && r >= NTC_R[i + 1]) {
      // Interpolate on log(R): NTCs are close to exponential.
      float f = (logf(NTC_R[i]) - logf(r)) / (logf(NTC_R[i]) - logf(NTC_R[i + 1]));
      return NTC_T[i] + f * (NTC_T[i + 1] - NTC_T[i]);
    }
  }
  return NAN;
}

float readTyre(uint8_t ch) {
  if (!haveMux || !muxSelect(ch)) return NAN;
  float c = mlx.readObjectTempC();
  return (c > -40 && c < 300) ? c : NAN;
}

float adsVolts(uint8_t ch) {
  if (!haveAds) return NAN;
  return ads.computeVolts(ads.readADC_SingleEnded(ch));
}

// One sensor per call, so a GPS fix is never kept waiting by slow I2C reads.
void readNextSensor() {
  static uint8_t step = 0;
  switch (step) {
    case 0: case 1: case 2: case 3:
      tyre[step] = readTyre(step);
      break;
    case 4: coolant = ntcCelsius(adsVolts(0)); break;
    case 5: oil = ntcCelsius(adsVolts(1)); break;
    case 6: case 7: {
      float v = adsVolts(step - 4) * BRAKE_DIVIDER;
      brake[step - 6] = (v > 0.05f && v < 5.05f) ? v * BRAKE_C_PER_V : NAN;
      break;
    }
    case 8: {
      double c = thermocouple.readCelsius();  // NAN on an open or shorted thermocouple
      egt = isnan(c) ? NAN : (float)c;
      break;
    }
    case 9:
      battV = analogReadMilliVolts(PIN_BATT) / 1000.0f * BATT_SCALE;
      break;
  }
  step = (step + 1) % 10;
}

// ── GPS ──────────────────────────────────────────────────────────────────
void setupGnss() {
  // u-blox modules start at 38400 baud; switch to 230400 so 25 Hz PVT fits.
  Serial1.begin(38400, SERIAL_8N1, PIN_GPS_RX, PIN_GPS_TX);
  if (gnss.begin(Serial1)) {
    gnss.setSerialRate(230400);
    delay(100);
  }
  Serial1.updateBaudRate(230400);
  while (!gnss.begin(Serial1)) {
    Serial.println("GPS not found, retrying…");
    delay(1000);
  }
  gnss.setUART1Output(COM_TYPE_UBX);           // UBX only, no NMEA text
  gnss.setDynamicModel(DYN_MODEL_AUTOMOTIVE);
  gnss.setMeasurementRate(1000 / gpsHz);       // 40 ms = 25 Hz
  gnss.setNavigationRate(1);
  gnss.setAutoPVT(true);
}

// ── Setup / loop ─────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  pinMode(PIN_BATT, INPUT);
  analogSetPinAttenuation(PIN_BATT, ADC_11db);

  Wire.begin(PIN_SDA, PIN_SCL, 400000);
  Wire.beginTransmission(MUX_ADDR);
  haveMux = Wire.endTransmission() == 0;
  if (haveMux) {
    muxSelect(0);
    mlx.begin(MLX_ADDR, &Wire);
  }
  haveAds = ads.begin(ADS_ADDR, &Wire);
  if (haveAds) {
    ads.setGain(GAIN_ONE);                     // ±4.096 V range
    ads.setDataRate(RATE_ADS1115_860SPS);
  }
  thermocouple.begin();

  NimBLEDevice::init(DEVICE_NAME);
  NimBLEDevice::setMTU(64);                    // packet is 42 bytes; default 23 is too small
  NimBLEDevice::setPower(9);                   // dBm, plenty inside a car
  NimBLEServer* server = NimBLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());
  NimBLEService* service = server->createService(SERVICE_UUID);
  frameChar = service->createCharacteristic(FRAME_CHAR_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  NimBLECharacteristic* config = service->createCharacteristic(CONFIG_CHAR_UUID, NIMBLE_PROPERTY::WRITE);
  config->setCallbacks(new ConfigCallbacks());
  service->start();
  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->setName(DEVICE_NAME);
  adv->addServiceUUID(SERVICE_UUID);
  adv->start();

  setupGnss();
  Serial.printf("PITWALL ready · mux %s · ADS1115 %s\n", haveMux ? "ok" : "missing", haveAds ? "ok" : "missing");
}

void loop() {
  if (rateChanged) {
    rateChanged = false;
    gnss.setMeasurementRate(1000 / gpsHz);
  }

  // A new position fix: send one packet with the latest sensor values.
  if (gnss.getPVT()) {
    PitwallFrame f = {};
    f.seq = seq++;
    f.tMs = millis();
    f.gpsFix = gnss.getFixType() >= 2 && gnss.getGnssFixOk();
    f.lat = gnss.getLatitude() / 1e7;
    f.lon = gnss.getLongitude() / 1e7;
    f.speedKmh = gnss.getGroundSpeed() * 0.0036f;  // mm/s -> km/h
    f.headingDeg = gnss.getHeading() / 1e5f;       // heading of motion
    f.sats = gnss.getSIV();
    f.gpsHz = gpsHz;
    for (int i = 0; i < 4; i++) f.tyre[i] = tyre[i];
    f.brake[0] = brake[0];
    f.brake[1] = brake[1];
    f.coolant = coolant;
    f.oil = oil;
    f.egt = egt;
    f.battV = battV;

    if (phoneConnected && frameChar) {
      uint8_t buf[PITWALL_PACKET_BYTES];
      encodePitwall(f, buf);
      frameChar->setValue(buf, sizeof(buf));
      frameChar->notify();
    }
    neopixelWrite(PIN_LED, 0, phoneConnected ? 24 : 0, f.gpsFix ? 0 : 24);  // green = linked, blue = no fix
  }

  readNextSensor();
}
