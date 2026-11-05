import SwiftUI

// Home is a few pages you swipe between: Home (the Edit Home layout), Rooms, Heating,
// Security, Music and Cameras. Each page scrolls by itself; the header and tabs stay on top.
// Like HOME_PAGES in web/public/ipad/views.js.

enum HVHomePageKind: String, CaseIterable, Identifiable, Hashable {
    case overview, rooms, heating, security, music, cameras

    var id: String { rawValue }

    var name: String {
        switch self {
        case .overview: L("Home")
        case .rooms: L("Rooms")
        case .heating: L("Heating")
        case .security: L("Security")
        case .music: L("Music")
        case .cameras: L("Cameras")
        }
    }

    var symbol: String {
        switch self {
        case .overview: "house.fill"
        case .rooms: "square.grid.2x2.fill"
        case .heating: "thermometer.medium"
        case .security: "checkmark.shield.fill"
        case .music: "music.note"
        case .cameras: "video.fill"
        }
    }

    /// The pages that have something to show; Home is always there.
    static func available(home: HomeSnapshot, cameraCount: Int) -> [HVHomePageKind] {
        allCases.filter { page in
            switch page {
            case .overview: true
            case .rooms: !home.rooms.isEmpty
            case .heating: home.hasHeating
            case .security: !(home.security.isEmpty && home.locks.isEmpty && home.gates.isEmpty)
            case .music: !home.media.isEmpty
            case .cameras: cameraCount > 0
            }
        }
    }
}

/// Header, page tabs, the pages themselves and page dots.
@MainActor
struct HVHomePager: View {
    let compact: Bool
    @Environment(HomeStore.self) private var store
    @Environment(AppSettings.self) private var settings
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The page this iPad shows, remembered per device. A page that has nothing to show
    /// (for example before the house has loaded) shows Home but keeps the choice.
    @AppStorage("home.page") private var page: HVHomePageKind = .overview

    var body: some View {
        let home = store.home
        let pages = HVHomePageKind.available(home: home, cameraCount: settings.cameras.count)
        let shown = pages.contains(page) ? page : .overview
        let nothing = home.rooms.isEmpty && home.lights.isEmpty && home.scenes.isEmpty
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 16) {
                TimelineView(.everyMinute) { context in
                    HVHeader(eyebrow: L10n.longDate(context.date),
                             title: Self.greeting(context.date), subtitle: nothing ? nil : Self.summary(home), isHome: true)
                }
                HVConnectionNotice()
                if pages.count > 1 { tabs(pages, shown: shown) }
            }
            .frame(maxWidth: 1180, alignment: .leading)
            .padding(.horizontal, compact ? 16 : 28)
            .padding(.top, 14)
            .frame(maxWidth: .infinity)

            TabView(selection: selection(pages)) {
                ForEach(pages) { kind in
                    ScrollView {
                        pageBody(kind)
                            .frame(maxWidth: 1180, alignment: .leading)
                            .padding(.horizontal, compact ? 16 : 28)
                            .padding(.top, 10)
                            .padding(.bottom, 120)
                            .frame(maxWidth: .infinity)
                    }
                    .scrollIndicators(.hidden)
                    .tag(kind)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
        }
        .overlay(alignment: .bottom) {
            if pages.count > 1 { dots(pages, shown: shown) }
        }
    }

    /// Swiping sets the page; a page that isn't there reads as Home.
    private func selection(_ pages: [HVHomePageKind]) -> Binding<HVHomePageKind> {
        Binding {
            pages.contains(page) ? page : .overview
        } set: { newValue in
            page = newValue
        }
    }

    @ViewBuilder
    private func pageBody(_ kind: HVHomePageKind) -> some View {
        switch kind {
        case .overview: HVOverviewBody()
        case .rooms: HVRoomsBody()
        case .heating: HVHeatingBody()
        case .security: HVSecurityBody()
        case .music: HVMediaBody()
        case .cameras: HVCamerasBody()
        }
    }

    /// Capsule tabs, like a segmented control.
    private func tabs(_ pages: [HVHomePageKind], shown: HVHomePageKind) -> some View {
        ScrollView(.horizontal) {
            HStack(spacing: 4) {
                ForEach(pages) { kind in
                    let selected = kind == shown
                    Button {
                        if reduceMotion {
                            page = kind
                        } else {
                            withAnimation(.spring(response: 0.4, dampingFraction: 0.86)) { page = kind }
                        }
                    } label: {
                        Label(kind.name, systemImage: kind.symbol)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(selected ? Color.black : Color.secondary)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 9)
                            .background {
                                if selected {
                                    Capsule().fill(Color.white.opacity(0.96)).shadow(color: .black.opacity(0.1), radius: 4, y: 2)
                                }
                            }
                            .contentShape(Capsule())
                    }
                    .buttonStyle(HVPress())
                    .accessibilityAddTraits(selected ? .isSelected : [])
                    .accessibilityHint(L("Shows the {name} page", ["name": kind.name]))
                }
            }
            .padding(4)
            .hvGlass(30)
            .padding(.vertical, 2)
        }
        .scrollIndicators(.hidden)
        .scrollBounceBehavior(.basedOnSize)
    }

    private func dots(_ pages: [HVHomePageKind], shown: HVHomePageKind) -> some View {
        HStack(spacing: 7) {
            ForEach(pages) { kind in
                let on = kind == shown
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(on ? Color.primary : Color.primary.opacity(0.3))
                    .frame(width: on ? 20 : 7, height: 7)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(.ultraThinMaterial, in: Capsule())
        .padding(.bottom, 10)
        .animation(.easeOut(duration: 0.3), value: shown)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    static func greeting(_ date: Date) -> String {
        switch Calendar.current.component(.hour, from: date) {
        case 5..<12: L("Good morning")
        case 12..<17: L("Good afternoon")
        default: L("Good evening")
        }
    }

    static func summary(_ home: HomeSnapshot) -> String {
        var parts: [String] = []
        let on = home.lightsOnCount
        parts.append(on == 0 ? L("All lights off") : Ln(on, "{n} light on", "{n} lights on"))
        let unlocked = home.locks.filter { $0.isLocked == false }
        let and = L(" and ")
        if !unlocked.isEmpty {
            let names = unlocked.map(\.name).joined(separator: and)
            parts.append(unlocked.count == 1 ? L("{names} is unlocked", ["names": names]) : L("{names} are unlocked", ["names": names]))
        } else if !home.locks.isEmpty {
            parts.append(L("Doors locked"))
        }
        let playing = home.media.filter(\.isOn)
        if !playing.isEmpty {
            parts.append(L("Playing in {rooms}", ["rooms": playing.map { home.room($0.roomId)?.name ?? $0.name }.joined(separator: and)]))
        }
        return parts.joined(separator: " · ")
    }
}
