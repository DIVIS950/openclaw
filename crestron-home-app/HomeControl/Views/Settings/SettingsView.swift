import SwiftUI
import UIKit

struct SettingsView: View {
    @Environment(AppSettings.self) private var settings
    @Environment(HomeStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    /// Shown as a sheet on iPhone (needs a Done button); a sidebar page on iPad.
    var isSheet = false
    @State private var editingCamera: CameraConfig?

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
                TextField("Home name", text: $settings.homeName)
                Toggle("Wall panel mode", isOn: $settings.kioskMode)
                if settings.kioskMode {
                    Stepper("Screensaver after \(settings.screensaverMinutes) min", value: $settings.screensaverMinutes, in: 1...60)
                }
            } header: {
                Text("This device")
            } footer: {
                Text("Wall panel mode keeps the screen on and shows a clock screensaver when idle. For a mounted iPad also turn on Guided Access (Settings › Accessibility) to lock it to this app.")
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.background.ignoresSafeArea())
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
                + map.locks.count + map.security.count + map.gates.count
            result = "Looks good: \(map.rooms.count) rooms, \(count) controls."
            resultIsError = false
        } catch {
            result = error.localizedDescription
            resultIsError = true
        }
    }
}

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
                CameraSnapshotView(camera: camera)
                    .aspectRatio(16 / 9, contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .id(camera.snapshotURL + camera.username + password)
            }
        }
        .navigationTitle(camera.name)
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: password) { _, value in camera.password = value }
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
