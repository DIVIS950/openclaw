import SwiftUI
import UIKit

/// Home View: the iPad app. Sidebar and one scrolling column over the wallpaper; the
/// sidebar slides in over the page when the window is narrow (split view).
@MainActor
struct HVRoot: View {
    @Environment(HomeStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @Environment(RoomPhotos.self) private var photos
    @Environment(AutomationStore.self) private var automations
    @Environment(WeatherStore.self) private var weather
    @Environment(HomeLayout.self) private var layout
    @State private var nav = HVNav()
    @State private var ask = HVAskModel()
    /// The newest ring already handled per doorbell, and whether the first list has been seen.
    @State private var seenRings: [String: Date] = [:]
    @State private var ringsPrimed = false

    var body: some View {
        GeometryReader { geo in
            let compact = geo.size.width < 760
            ZStack {
                TimelineView(.periodic(from: .now, by: 300)) { context in
                    HVWallpaper(hues: HV.hues(for: nav.route, home: store.home, date: context.date), photo: roomPhoto)
                }

                HStack(spacing: 0) {
                    if !compact {
                        HVSidebar()
                            .frame(width: geo.size.width > 1060 ? 268 : 238)
                            .padding([.leading, .vertical], 14)
                    }
                    content(compact: compact)
                }

                HVRippleLayer(ripple: nav.ripple)

                if compact && nav.sidebarOpen {
                    Color.black.opacity(0.25)
                        .ignoresSafeArea()
                        .onTapGesture { withAnimation { nav.sidebarOpen = false } }
                        .transition(.opacity)
                    HStack {
                        HVSidebar().frame(width: min(300, geo.size.width - 40)).padding(12)
                        Spacer(minLength: 0)
                    }
                    .transition(.move(edge: .leading))
                }

                if nav.askOpen {
                    HVGlow(busy: ask.busy).transition(.opacity)
                    VStack {
                        Spacer()
                        HVAskPanel()
                    }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                }

                if let alert = nav.doorbell {
                    HVDoorbellCard(alert: alert)
                        .transition(.opacity.combined(with: .scale(scale: 0.96)))
                }
            }
            .overlay(alignment: .top) { island }
            .environment(\.hvCompact, compact)
            .animation(.spring(response: 0.45, dampingFraction: 0.85), value: nav.askOpen)
            .animation(.spring(response: 0.4, dampingFraction: 0.9), value: nav.sidebarOpen)
            .animation(.spring(response: 0.45, dampingFraction: 0.85), value: nav.doorbell)
        }
        .environment(nav)
        .environment(ask)
        .sheet(item: $nav.sheet) { sheet in
            sheetView(sheet)
        }
        .fullScreenCover(isPresented: $nav.cameraWall) {
            HVCameraWall(cameras: settings.cameras) { nav.cameraWall = false }
        }
        .onChange(of: store.commandError) { _, message in
            if let message { nav.notify(message, symbol: "exclamationmark.triangle.fill", color: .red, seconds: 4) }
        }
        .onChange(of: store.home.doorbells, initial: true) { _, bells in checkDoorbells(bells) }
        // The doorbell card closes by itself after 90 seconds.
        .task(id: nav.doorbell) {
            guard nav.doorbell != nil else { return }
            try? await Task.sleep(for: .seconds(90))
            guard !Task.isCancelled else { return }
            nav.doorbell = nil
        }
        // Weather for Home, every 15 minutes; starts over when the location changes.
        .task(id: settings.effectiveLocation) {
            await weather.run(location: settings.effectiveLocation, sample: settings.usesSamplePlace)
        }
    }

    /// Shows the doorbell card for a ring newer than the last one seen, if it is under a
    /// minute old. Rings that were there when the app connected are old news.
    private func checkDoorbells(_ bells: [Doorbell]) {
        guard !bells.isEmpty else {
            ringsPrimed = false
            return
        }
        let first = !ringsPrimed
        ringsPrimed = true
        for bell in bells {
            guard let ringAt = bell.ringAt else { continue }
            if let seen = seenRings[bell.id], ringAt <= seen { continue }
            seenRings[bell.id] = ringAt
            guard !first, Date().timeIntervalSince(ringAt) < 60 else { continue }
            // Over everything: close whatever card or camera wall is open.
            nav.sheet = nil
            nav.cameraWall = false
            nav.sidebarOpen = false
            nav.doorbell = HVNav.DoorbellAlert(id: bell.id, ringAt: ringAt)
            store.wakeScreen()
            UIAccessibility.post(notification: .announcement, argument: L("{name}: someone is at the door", ["name": bell.name]))
        }
    }

    private var roomPhoto: UIImage? {
        if case let .room(id) = nav.route { return photos.image(for: id) }
        return nil
    }

    @ViewBuilder
    private func content(compact: Bool) -> some View {
        if nav.route == .home {
            // Home has its own pages, each scrolling by itself.
            HVHomePager(compact: compact)
                .id(nav.route)
                .transition(.opacity.combined(with: .offset(y: 12)))
        } else {
            page(compact: compact)
        }
    }

    private func page(compact: Bool) -> some View {
        ScrollView {
            Group {
                switch nav.route {
                case .home: EmptyView()
                case let .room(id): HVRoomPage(roomId: id)
                case .lights: HVLightsPage()
                case .heating: HVHeatingPage()
                case .shades: HVShadesPage()
                case .media: HVMediaPage()
                case .security: HVSecurityPage()
                case .cameras: HVCamerasPage()
                case .automations: HVAutomationsPage()
                }
            }
            .frame(maxWidth: 1180, alignment: .leading)
            .padding(.horizontal, compact ? 16 : 28)
            .padding(.top, 14)
            .padding(.bottom, 120)
            .frame(maxWidth: .infinity)
        }
        .scrollIndicators(.hidden)
        .id(nav.route)
        .transition(.opacity.combined(with: .offset(y: 12)))
    }

    @ViewBuilder
    private func sheetView(_ sheet: HVNav.Sheet) -> some View {
        let card = HVSheetContent(sheet: sheet)
            .environment(store)
            .environment(settings)
            .environment(photos)
            .environment(automations)
            .environment(weather)
            .environment(layout)
            .environment(nav)
            .preferredColorScheme(settings.appearance.colorScheme)
        if case .settings = sheet {
            card
        } else if sheet.isList {
            card
                .presentationBackground(.regularMaterial)
                .presentationCornerRadius(36)
        } else {
            card
                .presentationBackground(.regularMaterial)
                .presentationCornerRadius(36)
                .hvSheetSizing()
        }
    }

    /// The black pill at the top that confirms what just happened, like the Dynamic Island.
    @ViewBuilder
    private var island: some View {
        if let notice = nav.notice {
            HStack(spacing: 10) {
                Image(systemName: notice.symbol)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 32, height: 32)
                    .background(Circle().fill(notice.color))
                Text(notice.text)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                    .lineLimit(2)
            }
            .padding(.leading, 8)
            .padding(.trailing, 20)
            .padding(.vertical, 8)
            .background(Capsule().fill(Color.black))
            .shadow(color: .black.opacity(0.3), radius: 16, y: 8)
            .padding(.top, 6)
            .id(notice.id)
            .transition(.scale(scale: 0.5, anchor: .top).combined(with: .opacity))
            .onAppear { UIAccessibility.post(notification: .announcement, argument: notice.text) }
        }
    }
}

@MainActor
struct HVSidebar: View {
    @Environment(HomeStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @Environment(AutomationStore.self) private var automations
    @Environment(HVNav.self) private var nav
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let home = store.home
        ScrollView {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 12) {
                    Image(systemName: "house.fill")
                        .font(.system(size: 19, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 40, height: 40)
                        .background(RoundedRectangle(cornerRadius: 11, style: .continuous)
                            .fill(LinearGradient(colors: [.orange, .pink], startPoint: .topLeading, endPoint: .bottomTrailing)))
                    VStack(alignment: .leading, spacing: 1) {
                        Text(settings.homeName).font(.title3.weight(.bold)).lineLimit(1)
                        HStack(spacing: 6) {
                            Circle().fill(statusColor).frame(width: 7, height: 7)
                            Text(statusText).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                }
                .padding(.horizontal, 8)
                .padding(.bottom, 14)

                item(.home, L("Home"), "house.fill", .orange)

                heading(L("Controls"))
                if !home.lights.isEmpty {
                    item(.lights, L("Lights"), "lightbulb.fill", HV.light,
                         count: home.lightsOnCount > 0 ? L("{n} on", ["n": String(home.lightsOnCount)]) : L("Off"))
                }
                if home.hasHeating {
                    item(.heating, L("Heating"), "thermometer.medium", HV.heat, count: home.averageTemp.map { L10n.temp($0) })
                }
                if !home.shades.isEmpty {
                    let open = home.shades.filter { $0.position > 0.02 }.count
                    item(.shades, L("Shades"), "blinds.horizontal.closed", HV.shade, count: open > 0 ? L("{n} open", ["n": String(open)]) : L("Closed"))
                }
                if !home.media.isEmpty {
                    let playing = home.media.filter(\.isOn).count
                    item(.media, L("Media"), "music.note", HV.media, count: playing > 0 ? L("{n} playing", ["n": String(playing)]) : nil)
                }
                if !(home.security.isEmpty && home.locks.isEmpty && home.gates.isEmpty) {
                    item(.security, L("Security"), "checkmark.shield.fill", .indigo, count: securityCount(home), attention: home.unlockedCount > 0)
                }
                if !settings.cameras.isEmpty {
                    item(.cameras, L("Cameras"), "video.fill", HV.camera, count: "\(settings.cameras.count)")
                }
                let active = automations.activeCount
                item(.automations, L("Automations"), "calendar", .green, count: active > 0 ? "\(active)" : nil)

                // With floors (1.NP, 2.NP…), each floor gets its own heading; otherwise one "Rooms" list.
                if home.hasFloors {
                    ForEach(home.floors) { floor in
                        heading(floor.name.isEmpty ? L("Other") : floor.name)
                        ForEach(floor.rooms) { roomItem($0, home) }
                    }
                } else if !home.rooms.isEmpty {
                    heading(L("Rooms"))
                    ForEach(home.rooms) { roomItem($0, home) }
                }
            }
            .padding(12)
        }
        .scrollIndicators(.hidden)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 2) {
                footButton(L("Ask Home")) { nav.askOpen = true; nav.sidebarOpen = false } icon: { HVOrb(size: 28) }
                footButton(L("Settings")) { nav.sheet = .settings; nav.sidebarOpen = false } icon: {
                    Image(systemName: "gearshape.fill").font(.system(size: 15, weight: .semibold)).foregroundStyle(.gray)
                        .frame(width: 30, height: 30).background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(Color.gray.opacity(0.16)))
                }
            }
            .padding(12)
        }
        .frame(maxHeight: .infinity)
        .hvGlass(30)
    }

    private var statusText: String {
        switch store.connection {
        case .connected: store.mode.title
        case .connecting: L("Connecting…")
        case .idle: L("Not connected")
        case .failed: L("Connection problem")
        }
    }

    private func roomItem(_ room: Room, _ home: HomeSnapshot) -> some View {
        let on = home.lights(in: room.id).filter(\.isOn).count
        return item(.room(room.id), room.name, Theme.roomSymbol(room.name), HV.roomColor(home, room.id),
                    count: on > 0 ? L("{n} on", ["n": String(on)]) : nil)
    }

    /// "2 unlocked", "1/4" armed zones, or the alarm's state.
    private func securityCount(_ home: HomeSnapshot) -> String? {
        let unlocked = home.unlockedCount
        if unlocked > 0 { return L("{n} unlocked", ["n": String(unlocked)]) }
        if home.security.count > 1 { return "\(home.armedZoneCount)/\(home.security.count)" }
        return home.security.first?.mode.label
    }

    private var statusColor: Color {
        switch store.connection {
        case .connected: .green
        case .connecting: .orange
        case .idle, .failed: .red
        }
    }

    private func heading(_ title: String) -> some View {
        Text(title)
            .font(.footnote.weight(.bold))
            .foregroundStyle(.secondary)
            .padding(.horizontal, 10)
            .padding(.top, 16)
            .padding(.bottom, 6)
            .accessibilityAddTraits(.isHeader)
    }

    private func item(_ route: HVNav.Route, _ title: String, _ symbol: String, _ color: Color, count: String? = nil, attention: Bool = false) -> some View {
        let selected = nav.route == route
        return Button { nav.go(route) } label: {
            HStack(spacing: 12) {
                Image(systemName: symbol)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(selected ? Color.white : color)
                    .frame(width: 30, height: 30)
                    .background(RoundedRectangle(cornerRadius: 9, style: .continuous).fill(selected ? color : color.opacity(0.16)))
                Text(title).font(.body.weight(.medium)).lineLimit(1)
                Spacer(minLength: 4)
                if let count {
                    Text(count)
                        .font(.footnote.weight(attention ? .semibold : .regular))
                        .foregroundStyle(attention ? Color.orange : Color.secondary)
                        .monospacedDigit()
                        .lineLimit(1)
                }
            }
            .foregroundStyle(.primary)
            .padding(.horizontal, 10)
            .frame(minHeight: 44)
            .background {
                if selected {
                    RoundedRectangle(cornerRadius: 13, style: .continuous).fill(Color.white.opacity(0.96)).shadow(color: .black.opacity(0.08), radius: 6, y: 2)
                }
            }
            .environment(\.colorScheme, selected ? .light : scheme)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func footButton<Icon: View>(_ title: String, action: @escaping () -> Void, @ViewBuilder icon: () -> Icon) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                icon()
                Text(title).font(.body.weight(.medium))
                Spacer(minLength: 0)
            }
            .foregroundStyle(.primary)
            .padding(.horizontal, 10)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
