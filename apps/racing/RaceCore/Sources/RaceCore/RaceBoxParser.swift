import Foundation

/// Parser for the RaceBox Mini / Mini S / Micro BLE protocol ("RaceBox Data Message").
///
/// Packets use a UBX-style frame: 0xB5 0x62, class, id, little-endian u16 length, payload,
/// 2-byte Fletcher checksum over class..payload. The live data message is class 0xFF id 0x01
/// with an 80-byte payload at up to 25 Hz, delivered over the Nordic UART service
/// (6E400001-B5A3-F393-E0A9-E50E24DCCA9E, TX notify characteristic 6E400003-...).
public final class RaceBoxParser {
    public static let serviceUUID = "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
    public static let txCharacteristicUUID = "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"
    public static let rxCharacteristicUUID = "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"

    public struct Frame: Sendable, Equatable {
        public var date: Date?
        public var fixType: Int          // 0 none, 2 2D, 3 3D
        public var fixOK: Bool
        public var satellites: Int
        public var position: GeoPoint
        public var altitudeMSL: Double   // m
        public var horizontalAccuracy: Double // m
        public var speed: Double         // m/s
        public var heading: Double       // deg
        public var speedAccuracy: Double // m/s
        public var batteryPercent: Int
        /// Device-frame acceleration in g (x forward, y left, z up when mounted per manual)
        public var gX: Double, gY: Double, gZ: Double
        /// Rotation rates deg/s
        public var rotX: Double, rotY: Double, rotZ: Double
    }

    private var buf = [UInt8]()

    public init() {}

    public func push(_ data: Data) -> [Frame] {
        buf.append(contentsOf: data)
        var out: [Frame] = []
        while true {
            // Sync to header
            guard let start = findHeader() else {
                // keep last byte in case it's the first half of a header
                if let last = buf.last { buf = last == 0xB5 ? [0xB5] : [] }
                break
            }
            if start > 0 { buf.removeFirst(start) }
            guard buf.count >= 8 else { break }
            let len = Int(buf[4]) | Int(buf[5]) << 8
            let total = 6 + len + 2
            guard len <= 512 else { buf.removeFirst(2); continue }
            guard buf.count >= total else { break }
            let packet = Array(buf[0..<total])
            buf.removeFirst(total)
            guard Self.checksumOK(packet) else { continue }
            if packet[2] == 0xFF, packet[3] == 0x01, len == 80,
               let f = Self.decode(Array(packet[6..<(6 + 80)]))
            {
                out.append(f)
            }
        }
        return out
    }

    private func findHeader() -> Int? {
        guard buf.count >= 2 else { return nil }
        for i in 0..<(buf.count - 1) where buf[i] == 0xB5 && buf[i + 1] == 0x62 {
            return i
        }
        return nil
    }

    static func checksumOK(_ p: [UInt8]) -> Bool {
        var a: UInt8 = 0, b: UInt8 = 0
        for byte in p[2..<(p.count - 2)] {
            a = a &+ byte
            b = b &+ a
        }
        return a == p[p.count - 2] && b == p[p.count - 1]
    }

    static func decode(_ p: [UInt8]) -> Frame? {
        func u16(_ o: Int) -> UInt16 { UInt16(p[o]) | UInt16(p[o + 1]) << 8 }
        func i16(_ o: Int) -> Int16 { Int16(bitPattern: u16(o)) }
        func u32(_ o: Int) -> UInt32 {
            UInt32(p[o]) | UInt32(p[o + 1]) << 8 | UInt32(p[o + 2]) << 16 | UInt32(p[o + 3]) << 24
        }
        func i32(_ o: Int) -> Int32 { Int32(bitPattern: u32(o)) }

        let fixStatus = Int(p[20])
        let fixFlags = p[21]
        var comps = DateComponents()
        comps.timeZone = TimeZone(identifier: "UTC")
        comps.year = Int(u16(4)); comps.month = Int(p[6]); comps.day = Int(p[7])
        comps.hour = Int(p[8]); comps.minute = Int(p[9]); comps.second = Int(p[10])
        comps.nanosecond = Int(i32(16))
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let validDate = (p[11] & 0x03) == 0x03 // validDate + validTime
        return Frame(
            date: validDate ? cal.date(from: comps) : nil,
            fixType: fixStatus,
            fixOK: fixFlags & 0x01 == 1,
            satellites: Int(p[23]),
            position: GeoPoint(lat: Double(i32(28)) * 1e-7, lon: Double(i32(24)) * 1e-7),
            altitudeMSL: Double(i32(36)) / 1000,
            horizontalAccuracy: Double(u32(40)) / 1000,
            speed: Double(i32(48)) / 1000,
            heading: Double(i32(52)) * 1e-5,
            speedAccuracy: Double(u32(56)) / 1000,
            batteryPercent: Int(p[67] & 0x7F),
            gX: Double(i16(68)) / 1000, gY: Double(i16(70)) / 1000, gZ: Double(i16(72)) / 1000,
            rotX: Double(i16(74)) / 100, rotY: Double(i16(76)) / 100, rotZ: Double(i16(78)) / 100
        )
    }
}
