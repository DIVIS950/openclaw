# PITWALL box: ESP32 firmware and wiring

The box in the car reads a 25 Hz GPS and the temperature sensors, and sends
one 42-byte Bluetooth packet per GPS fix to the PITWALL app.

> **Status:** the packet encoder (`packet.h`) is tested against the app's decoder
> (`npm run packet:check`). The sketch itself has not been compiled or run on
> hardware yet. Expect to fix small library-version details the first time you build it.

## Parts

| Part | Suggested | Why |
|---|---|---|
| Microcontroller | ESP32-S3-DevKitC-1 (N8R2 or similar) | Bluetooth LE, fast I2C/UART, cheap |
| GPS | u-blox **NEO-M9N** breakout (e.g. SparkFun GPS-17285) + active patch antenna on the roof | 25 Hz position, the M9N is rated for it |
| Tyre temperature ×4 | **MLX90614** IR sensor, narrow field of view (BCF/DCI, 10° or 5°) | one per tyre, aimed at the middle of the tread |
| I2C mux | **TCA9548A** | the four MLX90614 share the same address |
| Brake disc temperature ×2 | IR pyrometer with 0–5 V output, 0–1000 °C (motorsport brake sensor) | normal MLX90614 stop at ~380 °C, discs reach 700 °C |
| Coolant + oil | Bosch NTC **0 280 130 026** (M12×1.5) or the car's own coolant sender | standard motorsport NTC |
| ADC | **ADS1115** 16-bit, 4 channels | ESP32's own ADC is too noisy for NTCs |
| EGT | K-type thermocouple probe (6 mm, exposed tip) + **MAX31855** board | up to 1350 °C |
| Power | 12 V → 5 V automotive buck (e.g. Pololu D36V28F5) + 1.5KE18A TVS diode + 2 A fuse | clean power from the car's 12 V |
| Battery sense | 100 kΩ + 22 kΩ resistors | 12–15 V scaled into the ESP32's ADC |
| Misc | 1 kΩ resistors ×2 (NTC pull-ups), 10 kΩ ×4 (brake divider), aluminium box, Deutsch DT connectors | |

## Wiring

```
12 V (switched, fused 2 A) ─┬─ TVS ─ GND
                            ├─ buck 5 V ── ESP32 5V pin
                            └─ 100k ─┬─ 22k ─ GND
                                     └─ GPIO4  (battery sense)

GPS NEO-M9N      TX ─ GPIO18     RX ─ GPIO17     3V3, GND
I2C bus          SDA ─ GPIO8     SCL ─ GPIO9     (3V3, 4.7k pull-ups if the boards have none)
  TCA9548A  0x70   ch0 tyre FL · ch1 tyre FR · ch2 tyre RL · ch3 tyre RR   (MLX90614 at 0x5A on each)
  ADS1115   0x48   A0 coolant NTC · A1 oil NTC · A2 brake FL · A3 brake FR
MAX31855 (EGT)   SCK ─ GPIO12    DO ─ GPIO13     CS ─ GPIO10     3V3, GND

NTC:          3V3 ─ 1 kΩ ─┬─ ADS A0/A1          Brake pyrometer 0–5 V: OUT ─ 10k ─┬─ ADS A2/A3
                          └─ NTC ─ GND                                          └─ 10k ─ GND
```

Tips:
- Run the IR sensor cables as shielded twisted pair and keep I2C runs short (under ~1.5 m).
  For the rear tyres, a second small box with its own mux, or I2C extenders (P82B715), is more reliable.
- Mount the tyre sensors 5–10 cm from the tread, aimed at the centre. With a 10° lens that reads a ~1–2 cm spot.
- Put the GPS antenna on the roof with a clear view of the sky, away from the roll cage tubes if you can.

## Flashing

1. Install the **Arduino IDE 2**, add the ESP32 boards (Boards Manager → "esp32" by Espressif).
2. Library Manager: install **NimBLE-Arduino** (2.x), **SparkFun u-blox GNSS v3**,
   **Adafruit MLX90614**, **Adafruit ADS1X15**, **Adafruit MAX31855**.
3. Open `pitwall-esp32/pitwall-esp32.ino`, board **ESP32S3 Dev Module**, then Upload.
4. Open the Serial Monitor (115200). It prints `PITWALL ready · mux ok · ADS1115 ok`.

## Testing before it goes in the car

1. Install **nRF Connect** on the iPhone, scan, and connect to `PITWALL-FABIA`.
   Subscribe to characteristic `7a1f0002…`; you should see 42-byte values about 25 times a second
   once the GPS has a fix (the LED turns from blue to off/green).
2. In the PITWALL app (development build, see the main README), go to **DEVICE → ESP32 · BLE →
   CONNECT & START**. GPS rate, satellites and battery should show live values.
3. Warm each sensor with your hand or a heat gun and watch TEMPS.

## Calibration

- **NTC table** (`NTC_T` / `NTC_R` in the sketch): the values are typical for a Bosch 0 280 130 026.
  If you use another sender, copy its resistance table from the datasheet.
- **Brake pyrometers**: set `BRAKE_C_PER_V` to your sensor's scale (°C per volt of its own output).
- **Battery**: if the reading is off, measure the real voltage and adjust `BATT_SCALE`.
- **Tyre emissivity**: MLX90614 default is 1.0; rubber is ~0.95. The library can write the
  emissivity to the sensor once if you want the last degree of accuracy.

## Packet

The byte layout is documented in `src/telemetry/blePacket.ts` (app) and implemented in
`pitwall-esp32/packet.h` (firmware). If you ever change one, change the other and run
`npm run packet:check`.
