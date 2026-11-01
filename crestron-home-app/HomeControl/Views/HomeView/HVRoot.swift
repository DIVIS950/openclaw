import SwiftUI
import UIKit

/// Home View: the iPad app. Sidebar and one scrolling column over the wallpaper; the
/// sidebar slides in over the page when the window is narrow (split view).
@MainActor
struct HVRoot: View {
    @Environment(HomeStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @Environment(RoomPhotos.self) private var photos
    @State private var nav = HVNav()
    @State private var ask = HVAskModel()

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
            }
            .overlay(alignment: .top) { island }
            .environment(\.hvCompact, compact)
            .animation(.spring(response: 0.45, dampingFraction: 0.85), value: nav.askOpen)
            .animation(.spring(response: 0.4, dampingFraction: 0.9), value: nav.sidebarOpen)
        }
        .environment(nav)
        .environment(ask)
        .sheet(item: $nav.sheet) { sheet in
            sheetView(sheet)
        }
        .onChange(of: store.commandError) { _, message in
            if let message { nav.notify(message, symbol: "exclamationmark.triangle.fill", color: .red, seconds: 4) }
        }
    }

    private var roomPhoto: UIImage? {
        if case let .room(id) = nav.route { return photos.image(for: id) }
        return nil
    }

    private func content(compact: Bool) -> some View {
        ScrollView {
            Group {
                switch nav.route {
                case .home: HVHomePage()
                case let .room(id): HVRoomPage(roomId: id)
                case .lights: HVLightsPage()
                case .shades: HVShadesPage()
                case .media: HVMediaPage()
                case .security: HVSecurityPage()
                case .cameras: HVCamerasPage()
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
            .environment(nav)
            .preferredColorScheme(settings.appearance.colorScheme)
        if case .settings = sheet {
            card
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

                item(.home, "Home", "house.fill", .orange)

                if !home.rooms.isEmpty {
                    heading("Rooms")
                    ForEach(home.rooms) { room in
                        let on = home.lights(in: room.id).filter(\.isOn).count
                        item(.room(room.id), room.name, Theme.roomSymbol(room.name), HV.roomColor(home, room.id), count: on > 0 ? "\(on) on" : nil)
                    }
                }

                heading("Controls")
                if !home.lights.isEmpty {
                    item(.lights, "Lights", "lightbulb.fill", HV.light, count: home.lightsOnCount > 0 ? "\(home.lightsOnCount) on" : "Off")
                }
                if !home.shades.isEmpty {
                    let open = home.shades.filter { $0.position > 0.02 }.count
                    item(.shades, "Shades", "blinds.horizontal.closed", HV.shade, count: open > 0 ? "\(open) open" : "Closed")
                }
                if !home.media.isEmpty {
                    let playing = home.media.filter(\.isOn).count
                    item(.media, "Media", "music.note", HV.media, count: playing > 0 ? "\(playing) playing" : nil)
                }
                if !(home.security.isEmpty && home.locks.isEmpty && home.gates.isEmpty) {
                    let unlocked = home.unlockedCount
                    item(.security, "Security", "checkmark.shield.fill", .indigo,
                         count: unlocked > 0 ? "\(unlocked) unlocked" : home.security.first?.mode.title, attention: unlocked > 0)
                }
                if !settings.cameras.isEmpty {
                    item(.cameras, "Cameras", "video.fill", HV.camera, count: "\(settings.cameras.count)")
                }
            }
            .padding(12)
        }
        .scrollIndicators(.hidden)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            VStack(spacing: 2) {
                footButton("Ask Home") { nav.askOpen = true; nav.sidebarOpen = false } icon: { HVOrb(size: 28) }
                footButton("Settings") { nav.sheet = .settings; nav.sidebarOpen = false } icon: {
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
        case .connected: store.mode == .demo ? "Demo house" : store.mode.title
        case .connecting: "Connecting…"
        case .idle: "Not connected"
        case .failed: "Connection problem"
        }
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
