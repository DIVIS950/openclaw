# iPhone app: missing permission prompts (documented fix, not applied)

The OpenClaw iPhone app declares calendar, reminders, contacts, photos and motion commands.
On the current build none of them can ever succeed. Each service only reads the current
authorization status and never asks for access, and `Info.plist` has no usage strings for
these data types. iOS therefore leaves the status at "not determined" forever, and every call
returns `*_PERMISSION_REQUIRED`.

Evidence in this repo:

- `apps/ios/Sources/EventKit/EventKitAuthorization.swift`: `.notDetermined` returns `false`
  with the comment "Don't prompt during node.invoke".
- `apps/ios/Sources/Contacts/ContactsService.swift` (`ensureAuthorization`),
  `apps/ios/Sources/Media/PhotoLibraryService.swift` (`ensureAuthorization`),
  `apps/ios/Sources/Motion/MotionService.swift`: same pattern, status check only.
- `apps/ios/project.yml` and `apps/ios/Sources/Info.plist`: no `NSCalendars*`, `NSReminders*`,
  `NSContactsUsageDescription`, `NSPhotoLibraryUsageDescription` or `NSMotionUsageDescription`.

Not prompting during a gateway call is the right call, because a system dialog would block the
invoke until it times out. The missing piece is a place where the owner grants access ahead of
time. This change was not applied here because it cannot be compiled or tested without Xcode
on a Mac.

## Proposed change

### 1. Usage strings (`apps/ios/project.yml`, `info.properties`, then regenerate with `xcodegen`)

```yaml
NSCalendarsFullAccessUsageDescription: OpenClaw reads and adds calendar events when you ask your assistant to.
NSRemindersFullAccessUsageDescription: OpenClaw reads and adds reminders when you ask your assistant to.
NSContactsUsageDescription: OpenClaw looks up and adds contacts when you ask your assistant to.
NSPhotoLibraryUsageDescription: OpenClaw shares recent photos with your assistant when you ask it to.
NSMotionUsageDescription: OpenClaw shares step counts and activity with your assistant when you ask it to.
```

### 2. A requester the Settings screen can call (new file `apps/ios/Sources/Settings/PhoneAccess.swift`)

```swift
import Contacts
import CoreMotion
import EventKit
import Photos

/// Asks iOS for data access from an explicit button tap, never from inside node.invoke.
enum PhoneAccess {
    static func requestCalendar() async -> Bool {
        (try? await EKEventStore().requestFullAccessToEvents()) ?? false
    }

    static func requestReminders() async -> Bool {
        (try? await EKEventStore().requestFullAccessToReminders()) ?? false
    }

    static func requestContacts() async -> Bool {
        (try? await CNContactStore().requestAccess(for: .contacts)) ?? false
    }

    static func requestPhotos() async -> Bool {
        let status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
        return status == .authorized || status == .limited
    }

    /// Core Motion has no explicit request call; the first query shows the system prompt.
    static func requestMotion() {
        guard CMMotionActivityManager.isActivityAvailable() else { return }
        let now = Date()
        CMMotionActivityManager().queryActivityStarting(
            from: now.addingTimeInterval(-60), to: now, to: .main) { _, _ in }
    }
}
```

### 3. Buttons in `SettingsTab.swift`, inside `Section("Device")` next to the "Features" group

```swift
DisclosureGroup("Phone Access") {
    Button("Allow Calendar") { Task { _ = await PhoneAccess.requestCalendar(); self.gatewayController.refreshActiveGatewayRegistrationFromSettings() } }
    Button("Allow Reminders") { Task { _ = await PhoneAccess.requestReminders(); self.gatewayController.refreshActiveGatewayRegistrationFromSettings() } }
    Button("Allow Contacts") { Task { _ = await PhoneAccess.requestContacts(); self.gatewayController.refreshActiveGatewayRegistrationFromSettings() } }
    Button("Allow Photos") { Task { _ = await PhoneAccess.requestPhotos(); self.gatewayController.refreshActiveGatewayRegistrationFromSettings() } }
    Button("Allow Motion & Fitness") { PhoneAccess.requestMotion() }
}
```

`refreshActiveGatewayRegistrationFromSettings()` is the hook the tab already calls after the
location setting changes (`SettingsTab.swift`, defined in `GatewayConnectionController.swift`).
Calling it makes the node re-declare its permissions to the gateway.

### 4. Gateway side

`calendar.add`, `reminders.add` and `contacts.add` are still blocked by default
(`src/gateway/node-command-policy.ts`, `DEFAULT_DANGEROUS_NODE_COMMANDS`). Allow them on
purpose, either permanently in `gateway.nodes.allowCommands` or for a while with the
`/phone arm writes 1h` chat command from the bundled `phone-control` plugin.

## How to verify on a device

1. Build and install from Xcode, pair with the gateway, open Settings, Device, Phone Access.
2. Tap each button and accept the iOS prompt.
3. From the gateway host: `openclaw nodes invoke --node "<iPhone>" --command calendar.events --params '{}'`
   should return events instead of `CALENDAR_PERMISSION_REQUIRED`.
