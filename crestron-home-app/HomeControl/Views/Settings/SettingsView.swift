import SwiftUI
import UIKit

@MainActor
struct SettingsView: View {
    @Environment(AppSettings.self) private var settings
    @Environment(HomeStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    /// Shown as a sheet on iPhone (needs a Done button); a sidebar page on iPad.
    var isSheet = false
    /// Opened from Home View (the iPad design): use the system's own light/dark styling.
    var homeView = false
    /// Home View only: open Edit Home or the favorites picker.
    var openEditHome: (() -> Void)? = nil
    var openFavorites: (() -> Void)? = nil
    @State private var editingCamera: CameraConfig?
    @State private var placeQuery = ""
    @State private var placeBusy = false
    @State private var placeMessage: String?

    var body: some View {
        @Bindable var settings = settings
        Form {
            Section {
                Picker(L("System type"), selection: $settings.mode) {
                    ForEach(ConnectionMode.allCases) { Text($0.title).tag($0) }
                }
            } header: {
                Text(L("Connection"))
            } footer: {
                Text(settings.mode.explanation)
            }

            switch settings.mode {
            case .demo:
                EmptyView()
            case .crestronHome:
                Section {
                    TextField(L("Processor IP address"), text: $settings.host, prompt: Text(verbatim: "192.168.1.50"))
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField(L("Web API token"), text: $settings.apiToken)
                } header: {
                    Text(verbatim: "Crestron Home")
                } footer: {
                    Text(L("Get the token in the Crestron Home setup app: Installer Settings › System Control Options › Web API Settings › Update Token. Your installer can do this if you don't have the installer password."))
                }
            case .customProgram:
                Section {
                    TextField(L("Processor IP address"), text: $settings.host, prompt: Text(verbatim: "192.168.1.50"))
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField(L("IP ID (hex)"), text: $settings.cipIpId, prompt: Text(verbatim: "03"))
                        .textInputAutocapitalization(.characters).autocorrectionDisabled()
                    TextField(L("Port"), value: $settings.cipPort, format: .number.grouping(.never))
                        .keyboardType(.numberPad)
                    NavigationLink(L("Join map")) { JoinMapEditor() }
                } header: {
                    Text(L("Custom program (touch panel)"))
                } footer: {
                    Text(L("Ask your installer for a free XPanel IP ID in the program and the join numbers your Crestron Go panel uses. Don't reuse the IP ID of a panel that's in use."))
                }
            }

            Section {
                Button {
                    settings.save()
                    store.connect(using: settings)
                } label: {
                    Label(L("Save & Connect"), systemImage: "bolt.horizontal.circle.fill")
                }
                connectionStatus
            }

            Section {
                ForEach(settings.cameras) { camera in
                    Button {
                        editingCamera = camera
                    } label: {
                        LabeledContent(camera.name, value: URL(string: camera.snapshotURL)?.host() ?? "")
                    }
                    .foregroundStyle(.primary)
                }
                .onDelete { offsets in
                    for i in offsets { settings.cameras[i].password = "" }
                    settings.cameras.remove(atOffsets: offsets)
                    settings.save()
                }
                Button(L("Add Camera"), systemImage: "plus") {
                    editingCamera = CameraConfig(name: L("Camera {n}", ["n": String(settings.cameras.count + 1)]), snapshotURL: "http://")
                }
            } header: {
                Text(L("Cameras"))
            } footer: {
                Text(L("Use the camera's JPEG snapshot URL. Hikvision: /ISAPI/Streaming/channels/101/picture · Dahua: /cgi-bin/snapshot.cgi · Axis: /axis-cgi/jpg/image.cgi"))
            }

            Section {
                SecureField(L("Anthropic API key"), text: $settings.assistantKey, prompt: Text(verbatim: "sk-ant-…"))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            } header: {
                Text(L("AI assistant"))
            } footer: {
                Text(L("Ask Home uses Claude to understand requests like “turn off the kitchen lights” or “good night”. Create a key at console.anthropic.com; each request costs a fraction of a cent. The key stays in this iPad's Keychain. Unlocking doors and opening the gate always need a tap to confirm, and the assistant can't disarm the alarm."))
            }

            Section {
                TextField(L("Home name"), text: $settings.homeName)
                // Changing the language rebuilds the app's screens (see HomeControlApp).
                Picker(L("Language"), selection: Binding(get: { settings.language }, set: { settings.setLanguage($0) })) {
                    ForEach(AppLanguage.allCases) { Text($0.title).tag($0) }
                }
                Picker(L("Appearance"), selection: $settings.appearance) {
                    ForEach(Appearance.allCases) { Text($0.title).tag($0) }
                }
                Toggle(L("Wall panel mode"), isOn: $settings.kioskMode)
                if settings.kioskMode {
                    Stepper(L("Screensaver after {n} min", ["n": String(settings.screensaverMinutes)]), value: $settings.screensaverMinutes, in: 1...60)
                }
            } header: {
                Text(L("This device"))
            } footer: {
                Text(L("Wall panel mode keeps the screen on and shows StandBy (a big clock with the house at a glance) when idle. For a mounted iPad also turn on Guided Access (Settings › Accessibility) to lock it to this app."))
            }

            if homeView {
                homeViewSections
            }
        }
        .scrollContentBackground(homeView ? .automatic : .hidden)
        .background { if !homeView { Theme.background.ignoresSafeArea() } }
        .navigationTitle(L("Settings"))
        .toolbar {
            if isSheet {
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Done")) {
                        settings.save()
                        dismiss()
                    }
                }
            }
        }
        .onDisappear { settings.save() }
        .sheet(item: $editingCamera) { camera in
            NavigationStack { CameraEditor(camera: camera) }
        }
    }

    /// Home screen, location and doorbell settings for the iPad design.
    @ViewBuilder
    private var homeViewSections: some View {
        if let openEditHome, let openFavorites {
            Section {
                Button(action: openEditHome) {
                    Label(L("Edit Home"), systemImage: "square.and.pencil")
                }
                Button(action: openFavorites) {
                    Label(L("Favorites"), systemImage: "star.fill")
                }
            } header: {
                Text(L("Home screen"))
            } footer: {
                Text(L("Add, remove and reorder what Home shows on this iPad, and pick your favorite lights, shades, music rooms and scenes."))
            }
        }

        Section {
            HStack(spacing: 10) {
                TextField(L("Town or city"), text: $placeQuery, prompt: Text(L("Town or city, for weather and sunset")))
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                    .onSubmit { findPlace() }
                if placeBusy {
                    ProgressView()
                } else {
                    Button(L("Save")) { findPlace() }
                        .disabled(placeQuery.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            if let location = settings.location {
                LabeledContent(L("Location"), value: location.place)
                Button(L("Remove location"), role: .destructive) {
                    settings.location = nil
                    settings.save()
                    placeMessage = nil
                }
            } else if settings.usesSamplePlace {
                Text(L("The demo house uses a sample place and sample weather."))
                    .foregroundStyle(.secondary)
            }
            if let placeMessage {
                Text(placeMessage).font(.footnote).foregroundStyle(.secondary)
            }
        } header: {
            Text(L("Location"))
        } footer: {
            Text(L("Used for the weather on Home and for schedules at sunrise or sunset. Weather comes from Open-Meteo every 15 minutes."))
        }

        if !store.home.doorbells.isEmpty {
            Section {
                ForEach(store.home.doorbells) { bell in
                    Button {
                        settings.save()
                        dismiss()
                        store.testDoorbell(bell.id)
                    } label: {
                        Label(L("Test {name} doorbell", ["name": bell.name]), systemImage: "bell.fill")
                    }
                }
            } header: {
                Text(L("Doorbell"))
            } footer: {
                Text(L("Shows the doorbell pop-up on this iPad, as if someone pressed the button."))
            }
        }
    }

    /// Looks the town up with Open-Meteo and saves it.
    private func findPlace() {
        let query = placeQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty, !placeBusy else { return }
        placeBusy = true
        placeMessage = nil
        Task {
            defer { placeBusy = false }
            do {
                if let found = try await WeatherService.findPlace(query) {
                    settings.location = found
                    settings.save()
                    placeQuery = ""
                    placeMessage = L("Location set to {place}.", ["place": found.place])
                } else {
                    placeMessage = L("Couldn't find “{query}”. Try the nearest town or city.", ["query": query])
                }
            } catch {
                placeMessage = error.localizedDescription
            }
        }
    }

    @ViewBuilder
    private var connectionStatus: some View {
        switch store.connection {
        case .idle:
            Label(L("Not connected"), systemImage: "circle.dashed").foregroundStyle(.secondary)
        case .connecting:
            Label(L("Connecting…"), systemImage: "arrow.triangle.2.circlepath").foregroundStyle(Theme.light)
        case .connected:
            Label(store.mode == .demo ? L("Demo house running") : L("Connected"), systemImage: "checkmark.circle.fill")
                .foregroundStyle(Theme.secure)
        case let .failed(message):
            Label(message, systemImage: "exclamationmark.triangle.fill").foregroundStyle(Theme.alert)
        }
    }
}

@MainActor
struct JoinMapEditor: View {
    @Environment(AppSettings.self) private var settings
    @State private var result: String?
    @State private var resultIsError = false

    var body: some View {
        @Bindable var settings = settings
        VStack(alignment: .leading, spacing: 12) {
            TextEditor(text: $settings.joinMapJSON)
                .font(.system(.footnote, design: .monospaced))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .scrollContentBackground(.hidden)
                .padding(8)
                .background(.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
            if let result {
                Label(result, systemImage: resultIsError ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                    .foregroundStyle(resultIsError ? Theme.alert : Theme.secure)
                    .font(.subheadline)
            }
        }
        .padding()
        .background(Theme.background.ignoresSafeArea())
        .navigationTitle(L("Join map"))
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Menu {
                    Button(L("Load Example"), systemImage: "doc.text") { settings.joinMapJSON = JoinMap.example }
                    Button(L("Paste"), systemImage: "doc.on.clipboard") {
                        if let text = UIPasteboard.general.string { settings.joinMapJSON = text }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                Button(L("Check")) { validate() }
            }
        }
        .onDisappear { settings.save() }
    }

    private func validate() {
        do {
            let map = try JoinMap.parse(settings.joinMapJSON)
            var count = map.lights.count + map.shades.count + map.scenes.count + map.media.count
            count += map.locks.count + map.security.count + map.gates.count + map.doorbells.count
            count += map.climate.count + map.modes.count + map.switches.count
            result = L("Looks good: {rooms}, {controls}.", ["rooms": Ln(map.rooms.count, "{n} room", "{n} rooms"),
                                                           "controls": Ln(count, "{n} control", "{n} controls")])
            resultIsError = false
        } catch {
            result = error.localizedDescription
            resultIsError = true
        }
    }
}

@MainActor
struct CameraEditor: View {
    @Environment(AppSettings.self) private var settings
    @Environment(\.dismiss) private var dismiss
    @State private var camera: CameraConfig
    @State private var password: String

    init(camera: CameraConfig) {
        _camera = State(initialValue: camera)
        _password = State(initialValue: camera.password)
    }

    var body: some View {
        Form {
            Section(L("Camera")) {
                TextField(L("Name"), text: $camera.name)
                TextField(L("Snapshot URL"), text: $camera.snapshotURL)
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
            }
            Section(L("Login (if the camera needs one)")) {
                TextField(L("Username"), text: $camera.username)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                SecureField(L("Password"), text: $password)
            }
            Section(L("Preview")) {
                CameraSnapshotView(camera: camera, password: password)
                    .aspectRatio(16 / 9, contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .id(camera.snapshotURL + camera.username + password)
            }
        }
        .navigationTitle(camera.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button(L("Save")) {
                    camera.password = password
                    if let i = settings.cameras.firstIndex(where: { $0.id == camera.id }) {
                        settings.cameras[i] = camera
                    } else {
                        settings.cameras.append(camera)
                    }
                    settings.save()
                    dismiss()
                }
            }
        }
    }
}
