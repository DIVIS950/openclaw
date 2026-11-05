import CoreLocation
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct SettingsView: View {
    @Environment(Store.self) private var store
    @State private var notificationsAllowed = false
    @State private var importing = false
    @State private var confirmWipe = false
    @State private var backupURL: URL?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        Label(L("Poloha", "Location"), systemImage: "location.fill")
                        Spacer()
                        Text(locationText).foregroundStyle(.secondary)
                    }
                    if store.locationStatus == .notDetermined {
                        Button(L("Zapnout polohu", "Turn on location")) {
                            LocationService.shared.requestWhenInUse()
                        }
                    } else if store.locationStatus == .authorizedWhenInUse {
                        Button(L("Povolit polohu „Vždy“ (připomínky i se zavřenou Kapsou)", "Allow location \"Always\" (reminders with Kapsa closed)")) {
                            LocationService.shared.requestAlways()
                        }
                    } else if store.locationStatus == .denied || store.locationStatus == .restricted {
                        Button(L("Otevřít nastavení iPhonu", "Open iPhone Settings")) {
                            openSystemSettings()
                        }
                    }
                    Picker(L("Kdy jsem v obchodě", "When I'm in the shop"), selection: setting(\.radius)) {
                        Text("50 m").tag(50.0)
                        Text("120 m").tag(120.0)
                        Text("250 m").tag(250.0)
                        Text("500 m").tag(500.0)
                    }
                } header: {
                    Text(L("Poloha", "Location"))
                } footer: {
                    Text(L("Jak blízko uloženého místa musíš být, aby karta vyskočila.", "How close to a saved place you need to be for the card to pop up."))
                }

                Section {
                    Toggle(L("Připomenout kartu v obchodě", "Remind me to use my card"), isOn: setting(\.dwellOn))
                    if store.settings.dwellOn {
                        Picker(L("Po kolika minutách", "After how many minutes"), selection: setting(\.dwellMinutes)) {
                            Text("1 min").tag(1)
                            Text("2 min").tag(2)
                            Text("5 min").tag(5)
                            Text("10 min").tag(10)
                        }
                    }
                    Toggle(L("Připomínky konce platnosti", "Expiry reminders"), isOn: setting(\.expiryReminders))
                    if store.settings.expiryReminders {
                        Picker(L("Kupóny předem", "Coupons ahead"), selection: setting(\.remindDays)) {
                            Text(L("1 den", "1 day")).tag(1)
                            Text(L("3 dny", "3 days")).tag(3)
                            Text(L("7 dní", "7 days")).tag(7)
                        }
                    }
                    if !notificationsAllowed {
                        Button(L("Povolit oznámení", "Allow notifications")) {
                            Task {
                                notificationsAllowed = await Notifier.requestPermission()
                                if !notificationsAllowed {
                                    openSystemSettings()
                                }
                            }
                        }
                    }
                } header: {
                    Text(L("Připomínky", "Reminders"))
                } footer: {
                    Text(L("Když jsi v obchodě, kde máš kartu, Kapsa ti po pár minutách připomene ji použít (i s kupóny a penězi na dárkové kartě). Se zavřenou Kapsou to funguje, když povolíš polohu „Vždy“.",
                           "When you're in a shop where you have a card, Kapsa reminds you after a few minutes to use it (with coupons and gift card money). With Kapsa closed, this works when location is set to \"Always\"."))
                }

                Section {
                    Toggle(L("Loga obchodů", "Shop logos"), isOn: setting(\.logos))
                    Picker(L("Měna", "Currency"), selection: setting(\.currency)) {
                        ForEach(["CZK", "EUR", "USD", "GBP", "PLN"], id: \.self) { code in
                            Text(code).tag(code)
                        }
                    }
                    Toggle(L("Tmavý režim podle iPhonu", "Dark mode like the iPhone"), isOn: setting(\.followSystemDarkMode))
                } header: {
                    Text(L("Vzhled", "Look"))
                } footer: {
                    Text(L("Loga se stahují z webu obchodu (přes Google). Vypni, pokud nechceš.", "Logos come from the shop's website (via Google). Turn off if you prefer."))
                }

                Section {
                    if let backupURL {
                        ShareLink(item: backupURL) {
                            Label(L("Poslat zálohu", "Share backup"), systemImage: "square.and.arrow.up")
                        }
                    } else {
                        Button {
                            backupURL = store.exportFile()
                        } label: {
                            Label(L("Vytvořit zálohu", "Create backup"), systemImage: "externaldrive")
                        }
                    }
                    Button {
                        importing = true
                    } label: {
                        Label(L("Načíst zálohu", "Load backup"), systemImage: "square.and.arrow.down")
                    }
                    if store.hasSamples {
                        Button(L("Smazat ukázkové karty", "Remove sample cards")) {
                            store.removeSamples()
                        }
                    } else {
                        Button(L("Přidat ukázkové karty", "Add sample cards")) {
                            store.addDemo()
                            store.confetti += 1
                        }
                    }
                    Button(L("Smazat všechno", "Delete everything"), role: .destructive) {
                        confirmWipe = true
                    }
                } header: {
                    Text(L("Data", "Data"))
                } footer: {
                    Text(L("Všechno zůstává jen v tomhle iPhonu. Záloha je soubor, který si uložíš třeba do Souborů nebo iCloudu.",
                           "Everything stays on this iPhone. A backup is a file you can keep in Files or iCloud."))
                }

                Section {
                    Text(L("Kapsa · věrnostní karty, dárkové karty a kupóny, které vyskočí samy v obchodě.",
                           "Kapsa · loyalty cards, gift cards and coupons that pop up by themselves in the shop."))
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle(L("Nastavení", "Settings"))
            .task {
                notificationsAllowed = await Notifier.isAllowed()
            }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) { result in
                if case let .success(url) = result {
                    if let count = store.importFile(url) {
                        store.show(L("Načteno: \(count)", "Loaded: \(count)"))
                    } else {
                        store.show(L("Tohle není záloha Kapsy.", "That's not a Kapsa backup."))
                    }
                }
            }
            .confirmationDialog(L("Smazat všechny karty, kupóny a útraty?", "Delete all cards, coupons and spending?"), isPresented: $confirmWipe, titleVisibility: .visible) {
                Button(L("Smazat všechno", "Delete everything"), role: .destructive) {
                    store.wipe()
                }
            }
        }
    }

    private var locationText: String {
        switch store.locationStatus {
        case .authorizedAlways: L("Vždy", "Always")
        case .authorizedWhenInUse: L("Při používání", "While using")
        case .denied, .restricted: L("Vypnutá", "Off")
        default: L("Nezapnutá", "Not set")
        }
    }

    /// A two-way binding to one setting.
    private func setting<Value>(_ keyPath: WritableKeyPath<AppSettings, Value>) -> Binding<Value> {
        Binding(
            get: { store.settings[keyPath: keyPath] },
            set: { newValue in store.updateSettings { $0[keyPath: keyPath] = newValue } }
        )
    }

    private func openSystemSettings() {
        if let url = URL(string: UIApplication.openSettingsURLString) {
            UIApplication.shared.open(url)
        }
    }
}
