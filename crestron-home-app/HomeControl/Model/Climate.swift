import Foundation

// Heating: room thermostats, house modes (the heating mode "Topení v domě") and switches
// (the sauna, motion-sensor lights). Mirrors climate/modes/switches in
// web/public/shared/model.js.

/// One room thermostat. Temperatures are °C.
struct Climate: Identifiable, Hashable {
    let id: String
    var name: String
    var roomId: String?
    /// The room temperature, nil when the system sends none.
    var current: Double?
    /// The set temperature.
    var target: Double?
    var minimum = 5.0
    var maximum = 30.0
    /// Target steps, 0.5 °C by default.
    var step = 0.5
    /// True while it heats; nil without feedback.
    var heating: Bool? = nil
    var isOnline = true

    var isHeating: Bool { heating == true }

    /// Keeps a target inside the range, on the step. Same as clampTarget in model.js.
    func clampTarget(_ value: Double) -> Double {
        let size = step > 0 ? step : 0.5
        let low = Swift.min(minimum, maximum)
        let high = Swift.max(minimum, maximum)
        let snapped = (value / size).rounded() * size
        let safe = snapped.isFinite ? snapped : low
        return Swift.min(high, Swift.max(low, safe))
    }
}

struct ModeOption: Identifiable, Hashable {
    let id: String
    var name: String
}

/// A whole-house mode, such as the heating mode (Zapnuto / Individuální / Útlum / Vypnuto).
struct HomeMode: Identifiable, Hashable {
    let id: String
    var name: String
    /// "heating" for the house heating mode.
    var kind: String
    /// The id of the current option; nil when the system doesn't say.
    var value: String?
    var options: [ModeOption]

    var current: ModeOption? { options.first { $0.id == value } }
}

/// Something that is on or off: the sauna, motion-sensor lights, a pump.
struct HomeSwitch: Identifiable, Hashable {
    let id: String
    var name: String
    var roomId: String?
    /// "sauna", "motion" or anything else.
    var kind: String
    var isOn: Bool
    /// A temperature that goes with it (the sauna), °C.
    var current: Double? = nil

    var isSauna: Bool { kind == "sauna" }
}

/// Rooms on one floor, in the order the system lists them.
struct HomeFloor: Identifiable, Hashable {
    /// "" for rooms without a floor.
    let name: String
    let rooms: [Room]

    var id: String { name }
}

extension HomeSnapshot {
    /// Floors in the order their rooms appear; rooms without a floor go last under "".
    var floors: [HomeFloor] {
        var order: [String] = []
        for room in rooms {
            let name = room.floor ?? ""
            if !order.contains(name) { order.append(name) }
        }
        let named = order.filter { !$0.isEmpty }
        let sorted = order.contains("") ? named + [""] : named
        return sorted.map { name in HomeFloor(name: name, rooms: rooms.filter { ($0.floor ?? "") == name }) }
    }

    /// True when the rooms have floors worth showing as headings.
    var hasFloors: Bool {
        let list = floors
        return list.count > 1 || !(list.first?.name.isEmpty ?? true)
    }

    func climate(in roomId: String) -> [Climate] { climate.filter { $0.roomId == roomId } }
    func switches(in roomId: String) -> [HomeSwitch] { switches.filter { $0.roomId == roomId } }

    /// The room's thermostat, if it has one.
    func roomClimate(_ roomId: String) -> Climate? { climate.first { $0.roomId == roomId } }

    /// The house heating mode, if there is one.
    var heatingMode: HomeMode? { modes.first { $0.kind == "heating" } }

    /// True when the heating mode is "off" for the whole house.
    var heatingOff: Bool { heatingMode?.value == "off" }

    /// Average room temperature, for the sidebar, chips and StandBy.
    var averageTemp: Double? {
        let temps = climate.compactMap(\.current)
        guard !temps.isEmpty else { return nil }
        return temps.reduce(0, +) / Double(temps.count)
    }

    var sauna: HomeSwitch? { switches.first(where: \.isSauna) }

    /// True when there is anything for the Heating page.
    var hasHeating: Bool { !(climate.isEmpty && modes.isEmpty && switches.isEmpty) }

    var armedZoneCount: Int { security.filter(\.mode.isArmed).count }
}
