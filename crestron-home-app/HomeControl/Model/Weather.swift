import Foundation
import Observation

enum TemperatureUnit: String, Codable, Hashable {
    case fahrenheit = "F"
    case celsius = "C"
}

/// Where the house is: for the weather and for schedules at sunrise or sunset.
struct HomeLocation: Codable, Hashable {
    var place: String
    var lat: Double
    var lon: Double
    var unit: TemperatureUnit
}

/// Weather right now and today's range. `code` is a WMO weather code.
struct WeatherNow: Hashable {
    var temp: Int
    var code: Int
    var isDay: Bool
    var high: Int
    var low: Int
    var unit: TemperatureUnit

    var text: String { Self.describe(code).text }

    /// SF Symbol for the sky; clear and partly cloudy get a moon at night.
    var symbol: String {
        let symbol = Self.describe(code).symbol
        guard !isDay else { return symbol }
        switch symbol {
        case "sun.max.fill": return "moon.stars.fill"
        case "cloud.sun.fill": return "cloud.moon.fill"
        default: return symbol
        }
    }

    private static func describe(_ code: Int) -> (text: String, symbol: String) {
        switch code {
        case 0: return (text: "Clear sky", symbol: "sun.max.fill")
        case 1, 2: return (text: "Partly cloudy", symbol: "cloud.sun.fill")
        case 3: return (text: "Cloudy", symbol: "cloud.fill")
        case 45, 48: return (text: "Fog", symbol: "cloud.fog.fill")
        case 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82: return (text: "Rain", symbol: "cloud.rain.fill")
        case 71, 73, 75, 77, 85, 86: return (text: "Snow", symbol: "cloud.snow.fill")
        case 95, 96, 99: return (text: "Thunderstorms", symbol: "cloud.bolt.rain.fill")
        default: return (text: "Weather", symbol: "cloud.fill")
        }
    }

    /// Sample weather for the demo house.
    static func sample(unit: TemperatureUnit, date: Date = Date()) -> WeatherNow {
        let hour = Calendar.current.component(.hour, from: date)
        let isDay = hour >= 7 && hour < 18
        return unit == .fahrenheit
            ? WeatherNow(temp: 64, code: 2, isDay: isDay, high: 68, low: 55, unit: .fahrenheit)
            : WeatherNow(temp: 18, code: 2, isDay: isDay, high: 20, low: 13, unit: .celsius)
    }
}

/// Weather and place search from Open-Meteo (free, no key needed).
enum WeatherService {
    private static let fahrenheitCountries: Set<String> = ["US", "LR", "MM", "BS", "BZ", "KY", "PW", "FM", "MH"]

    /// Finds a town or city, or nil when there is no match.
    static func findPlace(_ query: String) async throws -> HomeLocation? {
        var components = URLComponents(string: "https://geocoding-api.open-meteo.com/v1/search")
        components?.queryItems = [
            URLQueryItem(name: "count", value: "1"),
            URLQueryItem(name: "language", value: "en"),
            URLQueryItem(name: "format", value: "json"),
            URLQueryItem(name: "name", value: query),
        ]
        guard let url = components?.url else { return nil }
        let json = try await getJSON(url)
        guard let hit = (json["results"] as? [[String: Any]])?.first,
              let lat = (hit["latitude"] as? NSNumber)?.doubleValue,
              let lon = (hit["longitude"] as? NSNumber)?.doubleValue
        else { return nil }
        let country = hit["country_code"] as? String
        let names: [String?] = [hit["name"] as? String, hit["admin1"] as? String, country]
        let place = names.compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: ", ")
        let fahrenheit = country.map { fahrenheitCountries.contains($0) } ?? false
        return HomeLocation(place: place.isEmpty ? query : place, lat: lat, lon: lon, unit: fahrenheit ? .fahrenheit : .celsius)
    }

    static func fetch(_ location: HomeLocation) async throws -> WeatherNow {
        var components = URLComponents(string: "https://api.open-meteo.com/v1/forecast")
        components?.queryItems = [
            URLQueryItem(name: "latitude", value: String(location.lat)),
            URLQueryItem(name: "longitude", value: String(location.lon)),
            URLQueryItem(name: "current", value: "temperature_2m,weather_code,is_day"),
            URLQueryItem(name: "daily", value: "temperature_2m_max,temperature_2m_min,weather_code"),
            URLQueryItem(name: "forecast_days", value: "1"),
            URLQueryItem(name: "timezone", value: "auto"),
            URLQueryItem(name: "temperature_unit", value: location.unit == .fahrenheit ? "fahrenheit" : "celsius"),
        ]
        guard let url = components?.url else { throw BackendError.badResponse(L("Bad weather address.")) }
        let json = try await getJSON(url)
        let current = json["current"] as? [String: Any] ?? [:]
        let daily = json["daily"] as? [String: Any] ?? [:]
        let firstNumber = { (key: String) -> Double? in ((daily[key] as? [Any])?.first as? NSNumber)?.doubleValue }
        guard let temp = (current["temperature_2m"] as? NSNumber)?.doubleValue,
              let code = (current["weather_code"] as? NSNumber)?.intValue,
              let high = firstNumber("temperature_2m_max"),
              let low = firstNumber("temperature_2m_min")
        else { throw BackendError.badResponse(L("The weather service sent something unexpected.")) }
        let isDay = (current["is_day"] as? NSNumber)?.intValue == 1
        return WeatherNow(temp: Int(temp.rounded()), code: code, isDay: isDay,
                          high: Int(high.rounded()), low: Int(low.rounded()), unit: location.unit)
    }

    private static func getJSON(_ url: URL) async throws -> [String: Any] {
        let request = URLRequest(url: url, timeoutInterval: 10)
        let (data, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw BackendError.badResponse(L("The weather service answered {code}.", ["code": String(http.statusCode)]))
        }
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw BackendError.badResponse(L("The weather service sent something unexpected."))
        }
        return json
    }
}

/// The weather Home shows, fetched by this iPad every 15 minutes.
@MainActor
@Observable
final class WeatherStore {
    private(set) var weather: WeatherNow?

    /// Keeps `weather` fresh for `location` until the task is cancelled (the location changed).
    func run(location: HomeLocation?, sample: Bool) async {
        weather = nil
        guard let location else { return }
        if sample {
            weather = WeatherNow.sample(unit: location.unit)
            return
        }
        while !Task.isCancelled {
            do {
                weather = try await WeatherService.fetch(location)
            } catch {
                // Keep the last reading; try again next time.
            }
            try? await Task.sleep(for: .seconds(15 * 60))
        }
    }
}
