import Foundation

/// Sunrise and sunset for a place and day, worked out on the iPad (NOAA's simplified
/// equations, accurate to about a minute), so "at sunset" schedules need no internet.
enum Sun {
    struct Times: Hashable {
        let sunrise: Date
        let sunset: Date
    }

    /// `date` is any time on the local day wanted. nil during polar day or night.
    static func times(on date: Date, lat: Double, lon: Double, calendar: Calendar = .current) -> Times? {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        var utc = Calendar(identifier: .gregorian)
        utc.timeZone = TimeZone(identifier: "UTC") ?? TimeZone(secondsFromGMT: 0) ?? .current
        guard let midnightUTC = utc.date(from: DateComponents(year: parts.year, month: parts.month, day: parts.day)),
              let localStart = calendar.date(from: DateComponents(year: parts.year, month: parts.month, day: parts.day))
        else { return nil }
        let dayOfYear = utc.ordinality(of: .day, in: .year, for: midnightUTC) ?? 1

        // Split into small steps so the type checker stays quick.
        let rad = Double.pi / 180
        let g: Double = 2 * Double.pi / 365 * Double(dayOfYear - 1)
        let eq1: Double = 0.000075 + 0.001868 * cos(g) - 0.032077 * sin(g)
        let eq2: Double = 0.014615 * cos(2 * g) + 0.040849 * sin(2 * g)
        let eqTime: Double = 229.18 * (eq1 - eq2)
        let d1: Double = 0.006918 - 0.399912 * cos(g) + 0.070257 * sin(g)
        let d2: Double = -0.006758 * cos(2 * g) + 0.000907 * sin(2 * g)
        let d3: Double = -0.002697 * cos(3 * g) + 0.00148 * sin(3 * g)
        let decl: Double = d1 + d2 + d3
        let cosH: Double = cos(90.833 * rad) / (cos(lat * rad) * cos(decl)) - tan(lat * rad) * tan(decl)
        guard cosH >= -1, cosH <= 1 else { return nil }
        let hourAngle: Double = acos(cosH) / rad

        // Minutes after midnight UTC on that date; the local day can start on the UTC day before.
        let dayEnd = calendar.date(byAdding: .day, value: 1, to: localStart) ?? localStart.addingTimeInterval(86400)
        func toDate(_ minutes: Double) -> Date {
            var t = midnightUTC.addingTimeInterval(minutes * 60)
            while t < localStart { t = t.addingTimeInterval(86400) }
            while t >= dayEnd { t = t.addingTimeInterval(-86400) }
            return t
        }
        let sunrise: Double = 720 - 4 * (lon + hourAngle) - eqTime
        let sunset: Double = 720 - 4 * (lon - hourAngle) - eqTime
        return Times(sunrise: toDate(sunrise), sunset: toDate(sunset))
    }
}
