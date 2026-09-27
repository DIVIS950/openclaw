import CoreBluetooth
import Foundation
import NetworkExtension
import Observation

/// GoPro control via the Open GoPro API (HERO9 and newer).
///  - BLE: start/stop recording in sync with the timing session, keep-alive, enable Wi-Fi AP.
///  - Wi-Fi: join the camera hotspot and download the last video for syncing.
@Observable
final class GoProService: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    enum State: Equatable { case off, scanning, connecting, ready(String), failed(String) }

    private(set) var state: State = .off
    private(set) var isRecording = false
    private(set) var downloadProgress: Double?
    private(set) var lastMessage: String?
    /// Wall-clock time when the shutter command was acknowledged (fallback video sync).
    private(set) var recordingStartedAt: Date?

    // Open GoPro UUIDs
    private static func gp(_ s: String) -> CBUUID { CBUUID(string: "b5f9\(s)-aa8d-11e3-9046-0002a5d5c51b") }
    private let advertisedService = CBUUID(string: "FEA6")
    private let wifiService = GoProService.gp("0001")
    private let wifiSSID = GoProService.gp("0002")
    private let wifiPassword = GoProService.gp("0003")
    private let commandChar = GoProService.gp("0072")
    private let commandResponse = GoProService.gp("0073")
    private let settingChar = GoProService.gp("0074")

    @ObservationIgnored private var central: CBCentralManager!
    @ObservationIgnored private var peripheral: CBPeripheral?
    @ObservationIgnored private var chars: [CBUUID: CBCharacteristic] = [:]
    @ObservationIgnored private var ssid: String?
    @ObservationIgnored private var password: String?
    @ObservationIgnored private var keepAlive: Timer?
    @ObservationIgnored private var pendingShutter: Bool?

    override init() {
        super.init()
        central = CBCentralManager(delegate: self, queue: .main)
    }

    var isReady: Bool { if case .ready = state { true } else { false } }

    func connect() {
        guard central.state == .poweredOn else { state = .failed("Bluetooth is off"); return }
        state = .scanning
        central.scanForPeripherals(withServices: [advertisedService])
    }

    func disconnect() {
        keepAlive?.invalidate()
        if let p = peripheral { central.cancelPeripheralConnection(p) }
        peripheral = nil
        state = .off
    }

    func setRecording(_ on: Bool) {
        guard let c = chars[commandChar], let p = peripheral else { return }
        pendingShutter = on
        p.writeValue(Data([0x03, 0x01, 0x01, on ? 0x01 : 0x00]), for: c, type: .withResponse)
    }

    private func enableWiFiAP() {
        guard let c = chars[commandChar], let p = peripheral else { return }
        p.writeValue(Data([0x03, 0x17, 0x01, 0x01]), for: c, type: .withResponse)
    }

    // MARK: BLE

    func centralManagerDidUpdateState(_ central: CBCentralManager) {}

    func centralManager(_ central: CBCentralManager, didDiscover p: CBPeripheral, advertisementData: [String: Any], rssi: NSNumber) {
        central.stopScan()
        peripheral = p
        p.delegate = self
        state = .connecting
        central.connect(p)
    }

    func centralManager(_ central: CBCentralManager, didConnect p: CBPeripheral) {
        p.discoverServices(nil)
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect p: CBPeripheral, error: Error?) {
        state = .failed("Put the GoPro in pairing mode (Connections ▸ Connect Device ▸ Quik App)")
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral p: CBPeripheral, error: Error?) {
        keepAlive?.invalidate()
        if peripheral?.identifier == p.identifier {
            state = .connecting
            central.connect(p) // camera sleeps / goes out of range briefly
        }
    }

    func peripheral(_ p: CBPeripheral, didDiscoverServices error: Error?) {
        for s in p.services ?? [] { p.discoverCharacteristics(nil, for: s) }
    }

    func peripheral(_ p: CBPeripheral, didDiscoverCharacteristicsFor s: CBService, error: Error?) {
        for c in s.characteristics ?? [] {
            chars[c.uuid] = c
            if c.uuid == commandResponse { p.setNotifyValue(true, for: c) } // triggers pairing/bonding
            if c.uuid == wifiSSID || c.uuid == wifiPassword { p.readValue(for: c) }
        }
        if chars[commandChar] != nil, chars[settingChar] != nil {
            state = .ready(p.name ?? "GoPro")
            startKeepAlive()
        }
    }

    func peripheral(_ p: CBPeripheral, didUpdateValueFor c: CBCharacteristic, error: Error?) {
        guard let v = c.value else { return }
        switch c.uuid {
        case wifiSSID: ssid = String(data: v, encoding: .utf8)
        case wifiPassword: password = String(data: v, encoding: .utf8)
        case commandResponse:
            // [len, commandID, status] ; status 0 = success
            if v.count >= 3, v[v.startIndex + 1] == 0x01 {
                let ok = v[v.startIndex + 2] == 0x00
                if ok, let on = pendingShutter {
                    isRecording = on
                    if on { recordingStartedAt = Date() }
                }
                lastMessage = ok ? nil : "GoPro rejected shutter command"
                pendingShutter = nil
            }
        default: break
        }
    }

    /// The camera powers down its BLE after ~ a few minutes idle without keep-alive.
    private func startKeepAlive() {
        keepAlive?.invalidate()
        keepAlive = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
            guard let self, let c = self.chars[self.settingChar], let p = self.peripheral else { return }
            p.writeValue(Data([0x03, 0x5B, 0x01, 0x42]), for: c, type: .withResponse)
        }
    }

    // MARK: Wi-Fi media

    private struct MediaList: Decodable {
        struct Dir: Decodable { var d: String; var fs: [File] }
        struct File: Decodable { var n: String; var cre: String?; var s: String? }
        var media: [Dir]
    }

    /// Joins the camera's Wi-Fi and downloads the most recent MP4 into `directory`.
    @MainActor
    func downloadLatestVideo(to directory: URL) async throws -> URL {
        enableWiFiAP()
        guard let ssid, let password else {
            throw NSError(domain: "GoPro", code: 1, userInfo: [NSLocalizedDescriptionKey: "Connect the GoPro over Bluetooth first"])
        }
        let config = NEHotspotConfiguration(ssid: ssid, passphrase: password, isWEP: false)
        config.joinOnce = true
        do {
            try await NEHotspotConfigurationManager.shared.apply(config)
        } catch let e as NSError where e.domain == NEHotspotConfigurationErrorDomain
            && e.code == NEHotspotConfigurationError.alreadyAssociated.rawValue {
            // fine
        }
        defer { NEHotspotConfigurationManager.shared.removeConfiguration(forSSID: ssid) }

        let base = URL(string: "http://10.5.5.9:8080")!
        var listData = Data()
        for attempt in 0..<10 { // AP takes a few seconds to route
            do {
                (listData, _) = try await URLSession.shared.data(from: base.appendingPathComponent("gopro/media/list"))
                break
            } catch {
                if attempt == 9 { throw error }
                try await Task.sleep(nanoseconds: 1_000_000_000)
            }
        }
        let list = try JSONDecoder().decode(MediaList.self, from: listData)
        let files = list.media.flatMap { dir in dir.fs.map { (dir.d, $0) } }
            .filter { $0.1.n.uppercased().hasSuffix(".MP4") }
        guard let newest = files.max(by: { (Int($0.1.cre ?? "0") ?? 0) < (Int($1.1.cre ?? "0") ?? 0) }) else {
            throw NSError(domain: "GoPro", code: 2, userInfo: [NSLocalizedDescriptionKey: "No videos on the camera"])
        }
        let (dir, file) = newest
        let src = base.appendingPathComponent("videos/DCIM/\(dir)/\(file.n)")
        let dest = directory.appendingPathComponent("\(UUID().uuidString)-\(file.n)")
        downloadProgress = 0
        defer { downloadProgress = nil }
        let (tmp, _) = try await URLSession.shared.download(from: src, delegate: ProgressDelegate { [weak self] p in
            Task { @MainActor in self?.downloadProgress = p }
        })
        try FileManager.default.moveItem(at: tmp, to: dest)
        return dest
    }
}

private final class ProgressDelegate: NSObject, URLSessionTaskDelegate {
    let onProgress: (Double) -> Void
    private var observation: NSKeyValueObservation?

    init(onProgress: @escaping (Double) -> Void) { self.onProgress = onProgress }

    func urlSession(_ session: URLSession, didCreateTask task: URLSessionTask) {
        observation = task.progress.observe(\.fractionCompleted) { [onProgress] p, _ in onProgress(p.fractionCompleted) }
    }
}
