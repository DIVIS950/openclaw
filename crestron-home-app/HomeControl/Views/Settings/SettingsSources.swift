import SwiftUI
import UIKit
import UniformTypeIdentifiers

// Settings for the systems next to the main one: the join map file for the custom program,
// Apple Home (Matter) accessories, and Samsung TVs.

/// Custom program: import the installer's joinmap.json, or paste it, and a one-line summary.
@MainActor
struct JoinMapRows: View {
    @Environment(AppSettings.self) private var settings
    @State private var importing = false
    @State private var message: String?
    @State private var messageIsError = false

    var body: some View {
        Button {
            importing = true
        } label: {
            Label(L("Import join map file"), systemImage: "square.and.arrow.down")
        }
        .fileImporter(isPresented: $importing, allowedContentTypes: [.json, .plainText]) { result in load(result) }
        NavigationLink {
            JoinMapEditor()
        } label: {
            Label(L("Paste join map"), systemImage: "doc.on.clipboard")
        }
        Text(summary)
            .font(.footnote)
            .foregroundStyle(.secondary)
        if let message {
            Label(message, systemImage: messageIsError ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                .font(.footnote)
                .foregroundStyle(messageIsError ? Theme.alert : Theme.secure)
        }
    }

    /// "Join map: 48 devices · 12 rooms", or what's wrong with it.
    private var summary: String {
        let json = settings.joinMapJSON.trimmingCharacters(in: .whitespacesAndNewlines)
        if json.isEmpty { return L("No join map yet. Ask your installer for joinmap.json and open it here from Files or AirDrop.") }
        do {
            let map = try JoinMap.parse(json)
            var count = map.lights.count + map.shades.count + map.scenes.count + map.media.count
            count += map.locks.count + map.security.count + map.gates.count + map.doorbells.count
            count += map.climate.count + map.modes.count + map.switches.count
            return L("Join map: {devices} · {rooms}", ["devices": Ln(count, "{n} device", "{n} devices"),
                                                      "rooms": Ln(map.rooms.count, "{n} room", "{n} rooms")])
        } catch {
            return error.localizedDescription
        }
    }

    /// Reads the chosen file, checks it with the join map parser, and keeps it.
    private func load(_ result: Result<URL, Error>) {
        switch result {
        case let .success(url):
            let secured = url.startAccessingSecurityScopedResource()
            defer { if secured { url.stopAccessingSecurityScopedResource() } }
            do {
                let text = try String(contentsOf: url, encoding: .utf8)
                _ = try JoinMap.parse(text)
                settings.joinMapJSON = text
                settings.save()
                message = L("Join map imported.")
                messageIsError = false
            } catch {
                message = error.localizedDescription
                messageIsError = true
            }
        case let .failure(error):
            message = error.localizedDescription
            messageIsError = true
        }
    }
}

/// Apple Home: a switch, and how the connection is doing.
@MainActor
struct AppleHomeSection: View {
    @Environment(AppSettings.self) private var settings
    @Environment(HomeStore.self) private var store

    var body: some View {
        @Bindable var settings = settings
        Section {
            Toggle(L("Show Apple Home accessories"), isOn: $settings.homeKitEnabled)
                .onChange(of: settings.homeKitEnabled) {
                    settings.save()
                    store.reconnectExtras(using: settings)
                }
            if settings.homeKitEnabled {
                status
            }
        } header: {
            Text(verbatim: "Apple Home / Matter")
        } footer: {
            Text(L("Matter and HomeKit accessories you added in the Home app appear next to the Crestron devices, in rooms of the same name. If nothing shows up, allow Home Control in Settings › Privacy & Security › Home, or open the Home app to add accessories."))
        }
    }

    @ViewBuilder
    private var status: some View {
        switch store.extraStatus[HomeKitSource.sourceName] ?? .idle {
        case .idle:
            Label(L("Not connected"), systemImage: "circle.dashed").foregroundStyle(.secondary)
        case .connecting:
            Label(L("Connecting…"), systemImage: "arrow.triangle.2.circlepath").foregroundStyle(Theme.light)
        case .connected:
            Label(L("Connected"), systemImage: "checkmark.circle.fill").foregroundStyle(Theme.secure)
        case let .failed(message):
            Label(message, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Theme.alert)
            Text(L("Open the Home app to add Matter and HomeKit accessories; they then show up here."))
                .font(.footnote).foregroundStyle(.secondary)
        }
    }
}

/// Samsung TVs: the list, with each one's pairing state, and adding more.
@MainActor
struct SamsungTVSection: View {
    @Environment(AppSettings.self) private var settings
    @Environment(HomeStore.self) private var store
    @State private var editing: SamsungTVConfig?

    var body: some View {
        Section {
            ForEach(settings.samsungTVs) { tv in
                Button {
                    editing = tv
                } label: {
                    LabeledContent {
                        Text(status(tv)).foregroundStyle(.secondary)
                    } label: {
                        Text(tv.name.isEmpty ? "Samsung TV" : tv.name)
                        Text(tv.host).font(.footnote).foregroundStyle(.secondary)
                    }
                }
                .foregroundStyle(.primary)
            }
            .onDelete { offsets in
                for i in offsets { settings.samsungTVs[i].token = "" }
                settings.samsungTVs.remove(atOffsets: offsets)
                settings.save()
                store.reconnectExtras(using: settings)
            }
            Button(L("Add TV"), systemImage: "plus") {
                editing = SamsungTVConfig(name: "Samsung TV", host: "")
            }
            .sheet(item: $editing) { tv in
                NavigationStack { SamsungTVEditor(tv: tv) }
            }
        } header: {
            Text(L("Samsung TVs"))
        } footer: {
            Text(L("Each TV is controlled directly over Wi-Fi: inputs, apps, channels and the remote. Turning on from standby needs the MAC address (on the TV: Settings › General › Network › Network Status)."))
        }
    }

    private func status(_ tv: SamsungTVConfig) -> String {
        store.tvStatus[tv.host.trimmingCharacters(in: .whitespacesAndNewlines)] ?? L("Not connected")
    }
}

/// One TV: name, address, MAC, room, and Pair.
@MainActor
struct SamsungTVEditor: View {
    @Environment(AppSettings.self) private var settings
    @Environment(HomeStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var tv: SamsungTVConfig

    init(tv: SamsungTVConfig) {
        _tv = State(initialValue: tv)
    }

    private var host: String { tv.host.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        // Rooms of the main system; a TV sits in one of them.
        let rooms = store.home.rooms.filter { $0.origin != HomeKitSource.origin }
        Form {
            Section(L("Television")) {
                TextField(L("Name"), text: $tv.name)
                TextField(L("IP address"), text: $tv.host, prompt: Text(verbatim: "192.168.1.80"))
                    .keyboardType(.numbersAndPunctuation).textInputAutocapitalization(.never).autocorrectionDisabled()
                TextField(L("MAC address (optional, for turning on)"), text: $tv.mac, prompt: Text(verbatim: "AA:BB:CC:DD:EE:FF"))
                    .textInputAutocapitalization(.characters).autocorrectionDisabled()
                Picker(L("Room"), selection: $tv.roomId) {
                    Text(L("No room")).tag(String?.none)
                    ForEach(rooms) { room in
                        Text(room.name).tag(Optional(room.id))
                    }
                }
            }
            Section {
                LabeledContent(L("Status"), value: store.tvStatus[host] ?? L("Not connected"))
                Button {
                    keep()
                } label: {
                    Label(L("Pair"), systemImage: "link")
                }
                .disabled(host.isEmpty)
            } footer: {
                Text(L("Pair opens the connection once; the TV then asks whether to allow Home Control. Tap Allow on the TV with its own remote. The TV must be on."))
            }
        }
        .navigationTitle(tv.name.isEmpty ? "Samsung TV" : tv.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button(L("Save")) {
                    keep()
                    dismiss()
                }
                .disabled(host.isEmpty)
            }
        }
    }

    /// Saves this TV and reconnects the TVs, which opens its socket (and the Allow prompt).
    private func keep() {
        tv.host = host
        if let i = settings.samsungTVs.firstIndex(where: { $0.id == tv.id }) {
            settings.samsungTVs[i] = tv
        } else {
            settings.samsungTVs.append(tv)
        }
        settings.save()
        store.reconnectExtras(using: settings)
    }
}
