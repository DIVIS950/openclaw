import SwiftUI
import UIKit

/// The card for a TV that takes remote keys: power and inputs, what's on, a D-pad with Back,
/// Home and Menu, volume and channel, play/pause/stop, a number pad and the apps.
@MainActor
struct HVTVRemoteSheet: View {
    let zone: MediaZone
    @Environment(HomeStore.self) private var store
    @Environment(HVNav.self) private var nav
    @State private var digits = ""

    var body: some View {
        let room = store.home.room(zone.roomId)?.name
        let subtitle = [room, zone.isOn ? HVText.tvState(zone) : L("Off")].compactMap { $0 }.joined(separator: " · ")
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HVSheetHeader(symbol: "tv", color: HV.media, title: zone.name, subtitle: subtitle, favorite: FavoriteKind.media.key(zone.id))
                inputs
                Text(zone.isOn ? HVText.tvState(zone) : L("Off"))
                    .font(.title3.weight(.bold))
                    .contentTransition(.numericText())
                    .animation(.snappy, value: zone.channel?.number)
                HStack(alignment: .top, spacing: 28) {
                    VStack(spacing: 18) {
                        dpad
                        volumeAndChannel
                        transport
                    }
                    .frame(width: 340)
                    VStack(alignment: .leading, spacing: 18) {
                        numberPad
                        if !zone.apps.isEmpty { apps }
                    }
                    .frame(minWidth: 280, maxWidth: 360)
                }
                if zone.isOn {
                    HVTimerPills(verb: L("Sleep timer: off"), label: L("{name} off", ["name": zone.name]), command: .mediaPower(id: zone.id, on: false))
                }
            }
            .hvCard()
        }
        .frame(minWidth: 720)
    }

    // MARK: Power and inputs

    private var inputs: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Text(L("Input").uppercased()).font(.caption2.weight(.semibold)).tracking(0.6).foregroundStyle(.secondary)
                HVPill(title: zone.isOn ? L("Turn off") : L("Turn on"), symbol: "power", selected: zone.isOn) {
                    store.perform(.mediaPower(zoneId: zone.id, on: !zone.isOn))
                }
                ForEach(zone.sources) { source in
                    HVPill(title: source.name, selected: zone.isOn && zone.currentSourceId == source.id) {
                        store.perform(.mediaSource(zoneId: zone.id, sourceId: source.id))
                    }
                }
            }
        }
    }

    // MARK: The D-pad

    private var dpad: some View {
        VStack(spacing: 8) {
            Text(L("Remote").uppercased()).font(.caption2.weight(.semibold)).tracking(0.6).foregroundStyle(.secondary)
            dpadKeys
        }
    }

    private var dpadKeys: some View {
        HStack(spacing: 16) {
            VStack(spacing: 12) {
                roundKey(.back, "arrow.uturn.backward", L("Back"))
                roundKey(.exit, "xmark", L("Exit"))
            }
            ZStack {
                Circle().fill(Color.primary.opacity(0.08)).frame(width: 220, height: 220)
                arrow(.up, "chevron.up").offset(y: -78)
                arrow(.down, "chevron.down").offset(y: 78)
                arrow(.left, "chevron.left").offset(x: -78)
                arrow(.right, "chevron.right").offset(x: 78)
                Button { press(.ok) } label: {
                    Text("OK")
                        .font(.title3.weight(.bold))
                        .foregroundStyle(Color(uiColor: .systemBackground))
                        .frame(width: 78, height: 78)
                        .background(Circle().fill(Color.primary))
                }
                .buttonStyle(HVPress())
                .accessibilityLabel("OK")
            }
            VStack(spacing: 12) {
                roundKey(.home, "house.fill", L("Home"))
                roundKey(.menu, "line.3.horizontal", L("Menu"))
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func arrow(_ key: TVKey, _ symbol: String) -> some View {
        Button { press(key) } label: {
            Image(systemName: symbol)
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(.primary)
                .frame(width: 56, height: 56)
                .contentShape(Circle())
        }
        .buttonStyle(HVPress())
        .accessibilityLabel(key.rawValue)
    }

    private func roundKey(_ key: TVKey, _ symbol: String, _ label: String) -> some View {
        Button { press(key) } label: {
            VStack(spacing: 3) {
                Image(systemName: symbol).font(.system(size: 17, weight: .semibold))
                Text(label).font(.caption2.weight(.semibold))
            }
            .foregroundStyle(.primary)
            .frame(width: 60, height: 60)
            .background(Circle().fill(Color.primary.opacity(0.08)))
        }
        .buttonStyle(HVPress())
        .accessibilityLabel(label)
    }

    // MARK: Volume, channel and play

    private var volumeAndChannel: some View {
        HStack(spacing: 12) {
            group(L("Volume")) {
                keyButton(.volDown, "minus", L("Volume") + " −")
                keyButton(.mute, zone.isMuted ? "speaker.slash.fill" : "speaker.wave.2.fill", zone.isMuted ? L("Unmute") : L("Mute"), lit: zone.isMuted)
                keyButton(.volUp, "plus", L("Volume") + " +")
            }
            group(L("Channel")) {
                keyButton(.chDown, "minus", L("Channel") + " −")
                keyButton(.chUp, "plus", L("Channel") + " +")
            }
        }
    }

    private var transport: some View {
        HStack(spacing: 14) {
            keyButton(.play, "play.fill", L("Play"), lit: zone.isOn && zone.isPlaying)
            keyButton(.pause, "pause.fill", L("Pause"), lit: zone.isOn && !zone.isPlaying)
            keyButton(.stop, "stop.fill", L("Stop"))
            keyButton(.guide, "list.bullet.rectangle", L("Guide"))
            keyButton(.info, "info.circle", L("Info"))
        }
        .frame(maxWidth: .infinity)
    }

    private func group<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(spacing: 6) {
            Text(title.uppercased()).font(.caption2.weight(.semibold)).tracking(0.6).foregroundStyle(.secondary)
            HStack(spacing: 4, content: content)
                .padding(4)
                .background(Capsule().fill(Color.primary.opacity(0.07)))
        }
    }

    private func keyButton(_ key: TVKey, _ symbol: String, _ label: String, lit: Bool = false) -> some View {
        Button { press(key) } label: {
            Image(systemName: symbol)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(lit ? Color(uiColor: .systemBackground) : Color.primary)
                .frame(width: 48, height: 44)
                .background(Capsule().fill(lit ? Color.primary : Color.clear))
                .contentShape(Capsule())
        }
        .buttonStyle(HVPress())
        .accessibilityLabel(label)
    }

    // MARK: Numbers

    private var numberPad: some View {
        VStack(spacing: 10) {
            HStack {
                Text(L("Channel").uppercased()).font(.caption2.weight(.semibold)).tracking(0.6).foregroundStyle(.secondary)
                Spacer()
                Text(digits.isEmpty ? (zone.channel.map { String($0.number) } ?? "–") : digits)
                    .font(.title3.weight(.bold)).monospacedDigit()
                    .foregroundStyle(digits.isEmpty ? Color.secondary : Color.primary)
            }
            LazyVGrid(columns: Array(repeating: GridItem(.fixed(64), spacing: 10), count: 3), spacing: 10) {
                ForEach(1...9, id: \.self) { number in digitKey(number) }
                Button {
                    if digits.isEmpty { press(.back) } else { digits.removeLast() }
                } label: {
                    Image(systemName: "delete.left").font(.title3).foregroundStyle(.primary).frame(width: 64, height: 54)
                        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.primary.opacity(0.07)))
                }
                .buttonStyle(HVPress())
                .accessibilityLabel(L("Delete"))
                digitKey(0)
                Button { sendDigits() } label: {
                    Text("OK").font(.body.weight(.bold)).foregroundStyle(Color(uiColor: .systemBackground)).frame(width: 64, height: 54)
                        .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.primary))
                }
                .buttonStyle(HVPress())
                .accessibilityLabel("OK")
            }
        }
    }

    private func digitKey(_ number: Int) -> some View {
        Button {
            if digits.count < 4 { digits.append(String(number)) }
        } label: {
            Text(String(number)).font(.system(size: 24)).foregroundStyle(.primary).frame(width: 64, height: 54)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.primary.opacity(0.07)))
        }
        .buttonStyle(HVPress())
    }

    /// The typed number tunes the TV; with nothing typed, OK is the OK key.
    private func sendDigits() {
        guard let number = Int(digits), number > 0 else {
            digits = ""
            press(.ok)
            return
        }
        digits = ""
        store.perform(.mediaChannel(zoneId: zone.id, channel: number))
        nav.notify(L("Channel {n}", ["n": String(number)]), symbol: "tv", color: HV.media)
    }

    // MARK: Apps

    private var apps: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(L("Apps").uppercased()).font(.caption2.weight(.semibold)).tracking(0.6).foregroundStyle(.secondary)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 76), spacing: 10)], spacing: 12) {
                ForEach(zone.apps) { app in
                    let current = zone.isOn && zone.nowPlaying?.title == app.name && zone.channel == nil
                    Button {
                        store.perform(.tvApp(zoneId: zone.id, appId: app.id))
                        nav.notify(L("Opening {name}", ["name": app.name]), symbol: "tv", color: HV.media)
                    } label: {
                        VStack(spacing: 6) {
                            Text(Self.initials(app.name))
                                .font(.system(size: 20, weight: .bold))
                                .foregroundStyle(.white)
                                .frame(width: 60, height: 60)
                                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Self.color(for: app.name)))
                                .overlay {
                                    if current {
                                        RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(Color.primary, lineWidth: 2.5)
                                    }
                                }
                            Text(app.name).font(.caption.weight(.semibold)).foregroundStyle(.primary).lineLimit(1)
                        }
                        .frame(width: 76)
                    }
                    .buttonStyle(HVPress())
                    .accessibilityLabel(L("Open {name}", ["name": app.name]))
                    .accessibilityAddTraits(current ? .isSelected : [])
                }
            }
        }
    }

    private func press(_ key: TVKey) {
        store.perform(.tvKey(zoneId: zone.id, key: key))
    }

    /// "Prime Video" -> "PV", "Netflix" -> "N", "Disney+" -> "D+".
    static func initials(_ name: String) -> String {
        let words = name.split(whereSeparator: \.isWhitespace)
        if words.count >= 2, let a = words[0].first, let b = words[1].first { return String([a, b]).uppercased() }
        let first = name.prefix(1).uppercased()
        return name.hasSuffix("+") ? first + "+" : first
    }

    /// A steady color per app name, so Netflix is always the same red-ish tile.
    static func color(for name: String) -> Color {
        let lower = name.lowercased()
        if lower.contains("netflix") { return Color(red: 0.89, green: 0.11, blue: 0.14) }
        if lower.contains("youtube") { return Color(red: 0.95, green: 0.2, blue: 0.2) }
        if lower.contains("disney") { return Color(red: 0.07, green: 0.22, blue: 0.56) }
        if lower.contains("prime") { return Color(red: 0.0, green: 0.66, blue: 0.88) }
        if lower.contains("spotify") { return Color(red: 0.11, green: 0.73, blue: 0.33) }
        if lower.contains("apple") { return Color(white: 0.2) }
        if lower.contains("max") || lower.contains("hbo") { return Color(red: 0.0, green: 0.1, blue: 0.55) }
        let hue = name.utf16.reduce(11) { ($0 * 31 + Int($1)) % 360 }
        return HV.hsl(Double(hue), 0.7, 0.5)
    }
}

extension HVText {
    /// What a TV is showing: the channel, the app, or the input.
    static func tvState(_ zone: MediaZone) -> String {
        if let channel = zone.channel {
            let number = L("Channel {n}", ["n": String(channel.number)])
            return channel.name.isEmpty ? number : "\(number) · \(channel.name)"
        }
        if let title = zone.nowPlaying?.title, !title.isEmpty { return title }
        return zone.currentSource?.name ?? L("On")
    }
}
