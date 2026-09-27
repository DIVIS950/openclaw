import CoreBluetooth
import Foundation
import Observation
import RaceCore

/// Connects to high-rate Bluetooth LE GNSS receivers.
///  - RaceBox Mini / Mini S / Micro: binary 25 Hz over Nordic UART.
///  - Generic NMEA receivers exposing Nordic UART (many BLE GPS pucks and DIY ESP32 + u-blox units).
@Observable
final class ExternalGPSService: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    enum State: Equatable { case off, scanning, connecting(String), connected(String), failed(String) }

    struct Fix {
        var receivedUptime: TimeInterval
        var position: GeoPoint
        var speed: Double
        var course: Double
        var accuracy: Double
        var speedAccuracy: Double
        var altitude: Double
        var satellites: Int
        var longG: Double?
        var latG: Double?
    }

    private(set) var state: State = .off
    private(set) var discovered: [CBPeripheral] = []
    private(set) var rateHz: Double = 0
    private(set) var battery: Int?
    @ObservationIgnored var onFix: ((Fix) -> Void)?

    @ObservationIgnored private var central: CBCentralManager!
    @ObservationIgnored private var peripheral: CBPeripheral?
    private let raceBox = RaceBoxParser()
    private let nmea = NMEAParser()
    @ObservationIgnored private var fixTimes: [TimeInterval] = []
    @ObservationIgnored private var mode: GPSSourceMode = .raceBox

    private static let rememberedKey = "externalGPSDevice"
    private let uart = CBUUID(string: RaceBoxParser.serviceUUID)
    private let tx = CBUUID(string: RaceBoxParser.txCharacteristicUUID)

    override init() {
        super.init()
        central = CBCentralManager(delegate: self, queue: .main)
    }

    func scan(mode: GPSSourceMode) {
        self.mode = mode
        discovered = []
        guard central.state == .poweredOn else { state = .failed("Bluetooth is off"); return }
        state = .scanning
        central.scanForPeripherals(withServices: [uart])
    }

    func connect(_ p: CBPeripheral) {
        central.stopScan()
        UserDefaults.standard.set(p.identifier.uuidString, forKey: Self.rememberedKey)
        peripheral = p
        p.delegate = self
        state = .connecting(p.name ?? "GPS")
        central.connect(p)
    }

    func disconnect() {
        if let p = peripheral { central.cancelPeripheralConnection(p) }
        peripheral = nil
        state = .off
    }

    // MARK: CBCentralManagerDelegate

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if central.state != .poweredOn, state != .off { state = .failed("Bluetooth unavailable") }
    }

    func centralManager(_ central: CBCentralManager, didDiscover p: CBPeripheral, advertisementData: [String: Any], rssi: NSNumber) {
        guard !discovered.contains(where: { $0.identifier == p.identifier }) else { return }
        discovered.append(p)
        // Auto-connect to the receiver picked in Settings, or any RaceBox when that's the source.
        let remembered = UserDefaults.standard.string(forKey: Self.rememberedKey)
        if p.identifier.uuidString == remembered
            || (mode == .raceBox && remembered == nil && (p.name ?? "").lowercased().hasPrefix("racebox"))
        {
            connect(p)
        }
    }

    func centralManager(_ central: CBCentralManager, didConnect p: CBPeripheral) {
        state = .connected(p.name ?? "GPS")
        p.discoverServices([uart])
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect p: CBPeripheral, error: Error?) {
        state = .failed(error?.localizedDescription ?? "Connection failed")
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral p: CBPeripheral, error: Error?) {
        guard peripheral?.identifier == p.identifier else { return }
        // Auto-reconnect: signal drops happen at speed / behind the helmet.
        state = .connecting(p.name ?? "GPS")
        central.connect(p)
    }

    // MARK: CBPeripheralDelegate

    func peripheral(_ p: CBPeripheral, didDiscoverServices error: Error?) {
        for s in p.services ?? [] where s.uuid == uart { p.discoverCharacteristics([tx], for: s) }
    }

    func peripheral(_ p: CBPeripheral, didDiscoverCharacteristicsFor s: CBService, error: Error?) {
        for c in s.characteristics ?? [] where c.uuid == tx { p.setNotifyValue(true, for: c) }
    }

    func peripheral(_ p: CBPeripheral, didUpdateValueFor c: CBCharacteristic, error: Error?) {
        guard let data = c.value else { return }
        let now = ProcessInfo.processInfo.systemUptime
        if mode == .raceBox || (p.name ?? "").lowercased().hasPrefix("racebox") {
            for f in raceBox.push(data) where f.fixOK && f.fixType >= 2 {
                battery = f.batteryPercent
                emit(Fix(
                    receivedUptime: now, position: f.position, speed: f.speed, course: f.heading,
                    accuracy: f.horizontalAccuracy, speedAccuracy: f.speedAccuracy, altitude: f.altitudeMSL,
                    satellites: f.satellites, longG: f.gX, latG: f.gY
                ))
            }
        } else {
            for f in nmea.push(data) {
                emit(Fix(
                    receivedUptime: now, position: f.position, speed: f.speed, course: f.course,
                    accuracy: f.accuracy, speedAccuracy: 0.3, altitude: f.altitude, satellites: f.satellites,
                    longG: nil, latG: nil
                ))
            }
        }
    }

    private func emit(_ f: Fix) {
        fixTimes.append(f.receivedUptime)
        fixTimes.removeAll { f.receivedUptime - $0 > 2 }
        rateHz = Double(fixTimes.count) / 2
        onFix?(f)
    }
}
