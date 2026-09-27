import Foundation

/// Streaming NMEA-0183 parser for Bluetooth GPS receivers (XGPS160, Garmin GLO 2, Qstarz, ...).
/// Handles RMC (position/speed/course/time), GGA (fix quality, sats, HDOP, altitude), VTG and GST.
/// Bytes can arrive in arbitrary BLE-sized chunks; feed them to `push` and collect fixes.
public final class NMEAParser {
    public struct Fix: Sendable, Equatable {
        public var utcSecondsOfDay: Double
        public var date: DateComponents?
        public var position: GeoPoint
        public var speed: Double      // m/s
        public var course: Double     // deg, NaN if unknown
        public var altitude: Double
        public var satellites: Int
        public var hdop: Double
        /// estimated 1-sigma horizontal error (m), from GST if available, else HDOP * 2.5
        public var accuracy: Double
    }

    private var buffer = ""
    private var gga: (t: Double, alt: Double, sats: Int, hdop: Double)?
    private var gstSigma: Double?

    public init() {}

    public func push(_ data: Data) -> [Fix] {
        guard let s = String(data: data, encoding: .ascii) else { return [] }
        return push(s)
    }

    public func push(_ text: String) -> [Fix] {
        buffer += text
        var fixes: [Fix] = []
        while let nl = buffer.firstIndex(where: { $0.isNewline }) {
            let line = String(buffer[..<nl])
            buffer.removeSubrange(...nl)
            if let f = parseLine(line) { fixes.append(f) }
        }
        if buffer.count > 4096 { buffer.removeAll() } // garbage guard
        return fixes
    }

    /// Validates the `*hh` checksum (XOR of all chars between `$` and `*`).
    public static func checksumOK(_ line: String) -> Bool {
        guard line.hasPrefix("$"), let star = line.lastIndex(of: "*") else { return false }
        let body = line[line.index(after: line.startIndex)..<star]
        let given = line[line.index(after: star)...].prefix(2)
        guard let expected = UInt8(given, radix: 16) else { return false }
        let x = body.utf8.reduce(UInt8(0)) { $0 ^ $1 }
        return x == expected
    }

    func parseLine(_ raw: String) -> Fix? {
        let line = raw.trimmingCharacters(in: .whitespaces)
        guard Self.checksumOK(line), let star = line.lastIndex(of: "*") else { return nil }
        let fields = line[line.index(after: line.startIndex)..<star]
            .split(separator: ",", omittingEmptySubsequences: false)
            .map(String.init)
        guard let tag = fields.first, tag.count >= 5 else { return nil }
        switch tag.suffix(3) {
        case "GGA":
            guard fields.count >= 10, let t = Self.time(fields[1]) else { return nil }
            gga = (t, Double(fields[9]) ?? 0, Int(fields[7]) ?? 0, Double(fields[8]) ?? 99)
            return nil
        case "GST":
            // $GPGST,time,rms,semiMajor,semiMinor,orient,latErr,lonErr,altErr
            if fields.count >= 8, let la = Double(fields[6]), let lo = Double(fields[7]) {
                gstSigma = (la * la + lo * lo).squareRoot()
            }
            return nil
        case "RMC":
            // $GPRMC,hhmmss.ss,A,llll.ll,a,yyyyy.yy,a,knots,course,ddmmyy,...
            guard fields.count >= 10, fields[2] == "A",
                  let t = Self.time(fields[1]),
                  let lat = Self.coord(fields[3], fields[4], degreeDigits: 2),
                  let lon = Self.coord(fields[5], fields[6], degreeDigits: 3)
            else { return nil }
            let knots = Double(fields[7]) ?? 0
            let course = Double(fields[8]) ?? .nan
            var date: DateComponents?
            let d = fields[9]
            if d.count == 6, let dd = Int(d.prefix(2)), let mm = Int(d.dropFirst(2).prefix(2)), let yy = Int(d.suffix(2)) {
                date = DateComponents(year: 2000 + yy, month: mm, day: dd)
            }
            var alt = 0.0, sats = 0, hdop = 99.0
            if let g = gga, abs(g.t - t) < 0.001 {
                alt = g.alt; sats = g.sats; hdop = g.hdop
            }
            let acc = gstSigma ?? (hdop < 99 ? hdop * 2.5 : 5)
            return Fix(
                utcSecondsOfDay: t, date: date, position: GeoPoint(lat: lat, lon: lon),
                speed: knots * 0.514444, course: course, altitude: alt,
                satellites: sats, hdop: hdop, accuracy: acc
            )
        default:
            return nil
        }
    }

    static func time(_ f: String) -> Double? {
        guard f.count >= 6, let hh = Double(f.prefix(2)), let mm = Double(f.dropFirst(2).prefix(2)),
              let ss = Double(f.dropFirst(4)) else { return nil }
        return hh * 3600 + mm * 60 + ss
    }

    /// ddmm.mmmm / dddmm.mmmm + hemisphere → signed degrees
    static func coord(_ v: String, _ hemi: String, degreeDigits: Int) -> Double? {
        guard v.count > degreeDigits, let deg = Double(v.prefix(degreeDigits)),
              let min = Double(v.dropFirst(degreeDigits)) else { return nil }
        let x = deg + min / 60
        return (hemi == "S" || hemi == "W") ? -x : x
    }
}
