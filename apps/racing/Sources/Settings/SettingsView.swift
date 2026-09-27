import RaceCore
import SwiftUI

struct SettingsView: View {
    @Environment(AppModel.self) private var app
    @State private var apiKey = ""
    @State private var gps = ExternalGPSService()
    @State private var editingVehicle: Vehicle?

    var body: some View {
        @Bindable var app = app
        NavigationStack {
            Form {
                Section {
                    Picker("Source", selection: $app.settings.gpsSource) {
                        ForEach(GPSSourceMode.allCases) { Text($0.title).tag($0) }
                    }
                    if app.settings.gpsSource != .phone {
                        Button("Scan for receivers") { gps.scan(mode: app.settings.gpsSource) }
                        ForEach(gps.discovered, id: \.identifier) { p in
                            Button(p.name ?? p.identifier.uuidString) { gps.connect(p) }
                        }
                        if case let .connected(name) = gps.state {
                            Label("\(name) · \(Int(gps.rateHz)) Hz" + (gps.battery.map { " · \($0)%" } ?? ""), systemImage: "checkmark.circle.fill")
                                .foregroundStyle(Theme.gain)
                        }
                    }
                } header: { Text("GPS") } footer: {
                    Text("iPhone GPS is fused with the motion sensors (Kalman filter, 100 Hz) for smooth delta. For karting and the most precise lap times use a 10–25 Hz receiver such as a RaceBox Mini.")
                }

                Section {
                    HStack {
                        Text(goProStatus)
                        Spacer()
                        if app.goPro.isReady {
                            Button("Disconnect") { app.goPro.disconnect() }
                        } else {
                            Button("Connect") { app.goPro.connect() }
                        }
                    }
                    Toggle("Auto record with session", isOn: $app.settings.goProAutoRecord)
                    if app.goPro.isReady {
                        Button(app.goPro.isRecording ? "Stop recording" : "Test record") { app.goPro.setRecording(!app.goPro.isRecording) }
                    }
                } header: { Text("GoPro") } footer: {
                    Text("HERO9 or newer. First time: on the camera open Connections ▸ Connect Device ▸ Quik App, then tap Connect. After a session, open it in Sessions ▸ From GoPro to download and auto-sync the video.")
                }

                Section("Live") {
                    Toggle("Voice lap times", isOn: $app.settings.voiceLapTimes)
                    Toggle("Voice delta callouts", isOn: $app.settings.voiceDelta)
                    Stepper(String(format: "Delta bar full scale ±%.1f s", app.settings.deltaBarRange),
                            value: $app.settings.deltaBarRange, in: 0.2...3, step: 0.1)
                }

                Section {
                    ForEach(app.vehicles) { v in
                        Button { editingVehicle = v } label: {
                            HStack {
                                Text(v.name)
                                Spacer()
                                Text(v.vehicleClass.displayName).foregroundStyle(Theme.textSecondary)
                            }
                        }
                    }
                    .onDelete { app.vehicles.remove(atOffsets: $0) }
                    Button("Add vehicle") { editingVehicle = Vehicle(name: "", vehicleClass: .car) }
                } header: { Text("Vehicles") } footer: {
                    Text("Describe the setup (power, drive, tyres, ABS…): the coach uses it.")
                }

                Section {
                    SecureField("sk-ant-…", text: $apiKey)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onSubmit { app.coach.apiKey = apiKey }
                    Button("Save key") { app.coach.apiKey = apiKey }
                    if app.coach.hasKey { Label("Key stored in Keychain", systemImage: "lock.fill").foregroundStyle(Theme.gain) }
                } header: { Text("AI Coach (Claude)") } footer: {
                    Text("Create a key at console.anthropic.com. It never leaves this device except to call the Anthropic API.")
                }
            }
            .navigationTitle("Settings")
            .onAppear { apiKey = app.coach.apiKey }
            .onDisappear { gps.disconnect() }
            .sheet(item: $editingVehicle) { v in VehicleEditor(vehicle: v) }
        }
    }

    private var goProStatus: String {
        switch app.goPro.state {
        case .off: "Not connected"
        case .scanning: "Searching…"
        case .connecting: "Connecting…"
        case let .ready(n): n
        case let .failed(m): m
        }
    }
}

struct VehicleEditor: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State var vehicle: Vehicle

    var body: some View {
        NavigationStack {
            Form {
                TextField("Name", text: $vehicle.name)
                Picker("Class", selection: $vehicle.vehicleClass) {
                    ForEach(VehicleClass.allCases, id: \.self) { Text($0.displayName).tag($0) }
                }
                TextField("Setup: power, drive, tyres, aids…", text: $vehicle.setup, axis: .vertical).lineLimit(3...6)
            }
            .navigationTitle(vehicle.name.isEmpty ? "New vehicle" : vehicle.name)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        if let i = app.vehicles.firstIndex(where: { $0.id == vehicle.id }) {
                            app.vehicles[i] = vehicle
                        } else {
                            app.vehicles.append(vehicle)
                        }
                        dismiss()
                    }
                    .disabled(vehicle.name.isEmpty)
                }
            }
        }
    }
}
