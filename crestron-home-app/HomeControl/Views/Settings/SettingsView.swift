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
                Picker("System type", selection: $settings.mode) {
                    ForEach(ConnectionMode.allCases) { Text($0.title).tag($0) }
                }
            } header: {
                Text("Connection")
            } footer: {
                Text(settings.mode.explanation)
            }

            switch settings.mode {
            case .demo:
                EmptyView()
            case .crestronHome:
                Section {
                    TextField("Processor IP address", text: $settings.host, prompt: Text("192.168.1.50"))
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("Web API token", text: $settings.apiToken)
                } header: {
                    Text("Crestron Home")
                } footer: {
                    Text("Get the token in the Crestron Home setup app: Installer Settings › System Control Options › Web API Settings › Update Token. Your installer can do this if you don't have the installer password.")
                }
            case .customProgram:
                Section {
                    TextField("Processor IP address", text: $settings.host, prompt: Text("192.168.1.50"))
                        .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                    TextField("IP ID (hex)", text: $settings.cipIpId, prompt: Text("03"))
                        .textInputAutocapitalization(.characters).autocorrectionDisabled()
                    TextField("Port", value: $settings.cipPort, format: .number.grouping(.never))
                        .keyboardType(.numberPad)
                    NavigationLink("Join map") { JoinMapEditor() }
                } header: {
                    Text("Custom program (touch panel)")
                } footer: {
                    Text("Ask your installer for a free XPanel IP ID in the program and the join numbers your Crestron Go panel uses. Don't reuse the IP ID of a panel that's in use.")
                }
            }

            Section {
                Button {
                    settings.save()
                    store.connect(using: settings)
                } label: {
                    Label("Save & Connect", systemImage: "bolt.horizontal.circle.fill")
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
                Button("Add Camera", systemImage: "plus") {
                    editingCamera = CameraConfig(name: "Camera \(settings.cameras.count + 1)", snapshotURL: "http://")
                }
            } header: {
                Text("Cameras")
            } footer: {
                Text("Use the camera's JPEG snapshot URL. Hikvision: /ISAPI/Streaming/channels/101/picture · Dahua: /cgi-bin/snapshot.cgi · Axis: /axis-cgi/jpg/image.cgi")
            }

            Section {
                SecureField("Anthropic API key", text: $settings.assistantKey, prompt: Text("sk-ant-…"))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            } header: {
                Text("AI assistant")
            } footer: {
                Text("Ask Home uses Claude to understand requests like “turn off the kitchen lights” or “good night”. Create a key at console.anthropic.com; each request costs a fraction of a cent. The key stays in this iPad's Keychain. Unlocking doors and opening the gate always need a tap to confirm, and the assistant can't disarm the alarm.")
            }

            Section {
                TextField("Home name", text: $settings.homeName)
                Picker("Appearance", selection: $settings.appearance) {
                    ForEach(Appearance.allCases) { Text($0.title).tag($0) }
                }
                Toggle("Wall panel mode", isOn: $settings.kioskMode)
                if settings.kioskMode {
                    Stepper("Screensaver after \(settings.screensaverMinutes) min", value: $settings.screensaverMinutes, in: 1...60)
                }
            } header: {
                Text("This device")
            } footer: {
                Text("Wall panel mode keeps the screen on and shows StandBy (a big clock with the house at a glance) when idle. For a mounted iPad also turn on Guided Access (Settings › Accessibility) to lock it to this app.")
            }

            if homeView {
                homeViewSections
            }
        }
        .scrollContentBackground(homeView ? .automatic : .hidden)
        .background { if !homeView { Theme.background.ignoresSafeArea() } }
        .navigationTitle("Settings")
        .toolbar {
            if isSheet {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
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
                    Label("Edit Home", systemImage: "square.and.pencil")
                }
                Button(action: openFavorites) {
                    Label("Favorites", systemImage: "star.fill")
                }
            } header: {
                Text("Home screen")
            } footer: {
                Text("Add, remove and reorder what Home shows on this iPad, and pick your favorite lights, shades, music rooms and scenes.")
            }
        }

        Section {
            HStack(spacing: 10) {
                TextField("Town or city", text: $placeQuery, prompt: Text("Town or city, for weather and sunset"))
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                    .onSubmit { findPlace() }
                if placeBusy {
                    ProgressView()
                } else {
                    Button("Save") { findPlace() }
                        .disabled(placeQuery.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            if let location = settings.location {
                LabeledContent("Location", value: location.place)
                Button("Remove location", role: .destructive) {
                    settings.location = nil
                    settings.save()
                    placeMessage = nil
                }
            } else if settings.usesSamplePlace {
                Text("The demo house uses a sample place and sample weather.")
                    .foregroundStyle(.secondary)
            }
            if let placeMessage {
                Text(placeMessage).font(.footnote).foregroundStyle(.secondary)
            }
        } header: {
            Text("Location")
        } footer: {
            Text("Used for the weather on Home and for schedules at sunrise or sunset. Weather comes from Open-Meteo every 15 minutes.")
        }

        if !store.home.doorbells.isEmpty {
            Section {
                ForEach(store.home.doorbells) { bell in
                    Button {
                        settings.save()
                        dismiss()
                        store.testDoorbell(bell.id)
                    } label: {
                        Label("Test \(bell.name) doorbell", systemImage: "bell.fill")
                    }
                }
            } header: {
                Text("Doorbell")
            } footer: {
                Text("Shows the doorbell pop-up on this iPad, as if someone pressed the button.")
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
                    placeMessage = "Location set to \(found.place)."
                } else {
                    placeMessage = "Couldn't find “\(query)”. Try the nearest town or city."
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
            Label("Not connected", systemImage: "circle.dashed").foregroundStyle(.secondary)
        case .connecting:
            Label("Connecting…", systemImage: "arrow.triangle.2.circlepath").foregroundStyle(Theme.light)
        case .connected:
            Label(store.mode == .demo ? "Demo house running" : "Connected", systemImage: "checkmark.circle.fill")
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
        .navigationTitle("Join Map")
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Menu {
                    Button("Load Example", systemImage: "doc.text") { settings.joinMapJSON = JoinMap.example }
                    Button("Paste", systemImage: "doc.on.clipboard") {
                        if let text = UIPasteboard.general.string { settings.joinMapJSON = text }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                Button("Check") { validate() }
            }
        }
        .onDisappear { settings.save() }
    }

    private func validate() {
        do {
            let map = try JoinMap.parse(settings.joinMapJSON)
            let count = map.lights.count + map.shades.count + map.scenes.count + map.media.count
                + map.locks.count + map.security.count + map.gates.count + map.doorbells.count
            result = "Looks good: \(map.rooms.count) rooms, \(count) controls."
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
            Section("Camera") {
                TextField("Name", text: $camera.name)
                TextField("Snapshot URL", text: $camera.snapshotURL)
                    .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
            }
            Section("Login (if the camera needs one)") {
                TextField("Username", text: $camera.username)
                    .textInputAutocapitalization(.never).autocorrectionDisabled()
                SecureField("Password", text: $password)
            }
            Section("Preview") {
                CameraSnapshotView(camera: camera, password: password)
                    .aspectRatio(16 / 9, contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .id(camera.snapshotURL + camera.username + password)
            }
        }
        .navigationTitle(camera.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") {
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
