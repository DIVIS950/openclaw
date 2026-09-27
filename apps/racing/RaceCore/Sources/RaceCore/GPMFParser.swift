import Foundation

/// Minimal GoPro GPMF (General Purpose Metadata Format) parser for GPS data.
///
/// GoPro MP4s carry a timed metadata track (handler `meta`, format `gpmd`). Each sample is a
/// KLV tree: 4-char key, 1-byte type, 1-byte struct size, 2-byte big-endian repeat count,
/// payload padded to 4 bytes. Type 0 means "nested KLV". We read:
///   DEVC ▸ STRM ▸ SCAL (divisors), GPSU (UTC), GPSF (fix), GPSP (DOP×100),
///                 GPS5 (lat, lon, alt, speed2D, speed3D) — HERO5…HERO10
///                 GPS9 (+ days since 2000, secs of day, DOP, fix) — HERO11+
public enum GPMFParser {
    public struct GPSPoint: Sendable, Equatable {
        /// Seconds from the start of the video.
        public var videoTime: Double
        public var position: GeoPoint
        public var altitude: Double
        public var speed: Double // 2D, m/s
        /// Absolute UTC time if known (GPS9 per-sample or GPSU per-payload).
        public var utc: Date?
    }

    struct KLV {
        var key: String
        var type: UInt8
        var size: Int
        var repeatCount: Int
        var payload: ArraySlice<UInt8>
    }

    static func parse(_ bytes: ArraySlice<UInt8>) -> [KLV] {
        var out: [KLV] = []
        var i = bytes.startIndex
        while i + 8 <= bytes.endIndex {
            let keyBytes = bytes[i..<(i + 4)]
            let key = String(decoding: keyBytes, as: UTF8.self)
            let type = bytes[i + 4]
            let size = Int(bytes[i + 5])
            let rep = Int(bytes[i + 6]) << 8 | Int(bytes[i + 7])
            let len = size * rep
            let padded = (len + 3) & ~3
            let start = i + 8
            guard start + len <= bytes.endIndex else { break }
            out.append(KLV(key: key, type: type, size: size, repeatCount: rep, payload: bytes[start..<(start + len)]))
            i = start + padded
            if key == "\0\0\0\0" { break }
        }
        return out
    }

    static func i32(_ p: ArraySlice<UInt8>, _ o: Int) -> Int32 {
        let b = p.startIndex + o
        return Int32(bitPattern: UInt32(p[b]) << 24 | UInt32(p[b + 1]) << 16 | UInt32(p[b + 2]) << 8 | UInt32(p[b + 3]))
    }

    static func u16(_ p: ArraySlice<UInt8>, _ o: Int) -> UInt16 {
        let b = p.startIndex + o
        return UInt16(p[b]) << 8 | UInt16(p[b + 1])
    }

    static func scalars(_ k: KLV) -> [Double] {
        let n = k.size * k.repeatCount
        switch k.type {
        case UInt8(ascii: "l"):
            return stride(from: 0, to: n, by: 4).map { Double(i32(k.payload, $0)) }
        case UInt8(ascii: "L"):
            return stride(from: 0, to: n, by: 4).map { Double(UInt32(bitPattern: i32(k.payload, $0))) }
        case UInt8(ascii: "s"):
            return stride(from: 0, to: n, by: 2).map { Double(Int16(bitPattern: u16(k.payload, $0))) }
        case UInt8(ascii: "S"):
            return stride(from: 0, to: n, by: 2).map { Double(u16(k.payload, $0)) }
        case UInt8(ascii: "f"):
            return stride(from: 0, to: n, by: 4).map { Double(Float(bitPattern: UInt32(bitPattern: i32(k.payload, $0)))) }
        default:
            return []
        }
    }

    /// yymmddhhmmss.sss
    static func utc(_ k: KLV) -> Date? {
        let s = String(decoding: k.payload.prefix(16), as: UTF8.self)
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyMMddHHmmss.SSS"
        return f.date(from: s)
    }

    /// Extract GPS points from one GPMF payload (= one MP4 metadata sample).
    /// - Parameters:
    ///   - payload: raw sample bytes
    ///   - sampleStart: presentation time of this sample in the video (s)
    ///   - sampleDuration: duration of this sample (s), usually ~1.001
    public static func gps(from payload: [UInt8], sampleStart: Double, sampleDuration: Double) -> [GPSPoint] {
        var out: [GPSPoint] = []
        for devc in parse(payload[...]) where devc.key == "DEVC" && devc.type == 0 {
            for strm in parse(devc.payload) where strm.key == "STRM" && strm.type == 0 {
                let items = parse(strm.payload)
                guard let data = items.first(where: { $0.key == "GPS5" || $0.key == "GPS9" }) else { continue }
                let scal = items.first { $0.key == "SCAL" }.map(scalars) ?? []
                let fix = items.first { $0.key == "GPSF" }.map(scalars)?.first ?? 3
                if data.key == "GPS5", fix < 2 { continue }
                let payloadUTC = items.first { $0.key == "GPSU" }.flatMap(utc)
                let n = data.repeatCount
                let structSize = data.size
                func scale(_ idx: Int) -> Double { idx < scal.count && scal[idx] != 0 ? scal[idx] : 1 }
                for r in 0..<n {
                    let o = r * structSize
                    let lat = Double(i32(data.payload, o)) / scale(0)
                    let lon = Double(i32(data.payload, o + 4)) / scale(1)
                    let alt = Double(i32(data.payload, o + 8)) / scale(2)
                    let sp = Double(i32(data.payload, o + 12)) / scale(3)
                    let vt = sampleStart + sampleDuration * Double(r) / Double(max(n, 1))
                    var date: Date? = payloadUTC?.addingTimeInterval(sampleDuration * Double(r) / Double(max(n, 1)))
                    if data.key == "GPS9", structSize >= 32 {
                        // days since 2000-01-01, seconds of day, DOP, fix
                        let days = Double(i32(data.payload, o + 20)) / scale(5)
                        let secs = Double(i32(data.payload, o + 24)) / scale(6)
                        let fix9 = Double(u16(data.payload, o + 30)) / scale(8)
                        if fix9 < 2 { continue }
                        date = Date(timeIntervalSince1970: 946_684_800 + days * 86400 + secs)
                    }
                    guard abs(lat) > 0.0001 || abs(lon) > 0.0001 else { continue }
                    out.append(GPSPoint(
                        videoTime: vt, position: GeoPoint(lat: lat, lon: lon),
                        altitude: alt, speed: sp, utc: date
                    ))
                }
            }
        }
        return out
    }
}
