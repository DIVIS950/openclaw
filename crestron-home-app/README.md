# Home Control: a nicer iPhone and iPad app for your Crestron system

A native SwiftUI app for iPhone and iPad, made to replace Crestron Go with a design closer to the new Crestron Home look: big room cards, scene tiles, and controls you can drag.

It controls:

- **Lights & scenes:** dim with a big slider, plus All On / All Off and scene tiles.
- **Shades:** set the position, or use the open / stop / close buttons.
- **Media:** power, sources, volume and mute for each room.
- **Security:** arm away, arm home or disarm with a keypad, plus door locks (you confirm before unlocking).
- **Gate:** open, close, stop, or a single "trigger" button, with confirmation before opening.
- **Cameras:** live picture from any IP camera that has a snapshot URL.
- **Wall iPad mode:** keeps the screen on and shows a clock screensaver when nobody touches it.

## 1. Find out which kind of Crestron system you have

The app can talk to the house in two ways, and you pick one in **Settings**:

| You have… | Pick in the app | How the app connects |
|---|---|---|
| A system set up with the **Crestron Home** setup app (processor like CP4-R, MC4-R, PRO4). Usually you'd use the "Crestron Home" app, not Crestron Go. | **Crestron Home** | Built-in Web API (HTTPS) |
| A **custom program** your installer wrote in SIMPL. You use **Crestron Go** (or Crestron One) with a panel they designed. | **Custom program** | Connects like a touch panel (CIP, port 41794) |

**You use Crestron Go, so most likely you have a custom program.** Your installer can tell you for sure in one minute. Ask them:

> "Is my system Crestron Home OS, or a custom SIMPL program? And what's the processor model and IP address?"

You can also try the app first with **Demo house**, which needs no setup at all.

## 2. Build and install the app (needs a Mac)

1. Install **Xcode** (free, from the Mac App Store).
2. Install XcodeGen and generate the project:
   ```bash
   brew install xcodegen
   cd crestron-home-app
   xcodegen
   open HomeControl.xcodeproj
   ```
3. In Xcode, select the **HomeControl** target, then **Signing & Capabilities**:
   - Choose your Apple ID team. A free Apple ID works, but free installs expire every 7 days. A paid developer account ($99/year) lasts a year and allows TestFlight.
   - Change the **Bundle Identifier** to something unique, like `com.yourname.homecontrol`.
4. Plug in the iPad or iPhone, pick it at the top of Xcode, and press **Run** (▶).

## 3. Connect it to your house

### Option A: Crestron Home

1. Your installer (or you, with the installer password) opens the **Crestron Home setup app** and goes to
   **Installer Settings › System Control Options › Web API Settings**, turns the Web API on, and taps **Update Token**.
2. In this app, open **Settings**:
   - System type: **Crestron Home**
   - Processor IP address: for example `192.168.1.50`
   - Web API token: paste the token
3. Tap **Save & Connect**.

Rooms, lights, shades, scenes, media rooms and locks all load automatically. In Crestron Home, gates are usually **generic I/O scenes**, and the app shows those on the gate card.

### Option B: Custom program (Crestron Go systems)

The app joins the processor as an extra touch panel, so your installer has to do two small things:

1. **Add an XPanel (or any touch panel) on a free IP ID** in the SIMPL program, wired to the same signals as your current Crestron Go panel. Copying the existing panel's symbol to a new IP ID usually works. Don't share the IP ID of a panel that's already in use.
2. **Give you the join numbers.** The app needs to know, for example, that "Living room ceiling dimmer = analog join 11" and "Gate open = digital join 501".

Then, in this app:

- System type: **Custom program**
- Processor IP address, **IP ID** (in hex, like `03` or `1A`), port `41794`
- **Join map:** tap it and edit the JSON. **Load Example** shows the format; the same example is in [`joinmap.example.json`](joinmap.example.json).

Join map rules:

- `level`, `position` and `volume` are **analog** joins (0–65535).
- Every other number is a **digital** join. The app taps it like a button: press, then release.
- Feedback joins (`onFeedback`, `powerFeedback`, `lockedFeedback`, …) are what the program sends back. If you leave one out, the app listens on the same number it presses, which is the usual SIMPL habit.
- `security.code` is a **serial** join. The keypad code is sent there before the arm or disarm button is pressed.
- Rooms are optional, but they make the app look much better.

> If the processor has **authentication** turned on (common on 4-Series), the touch-panel connection may be refused. Your installer can allow it or turn it off for that IP ID.

## 4. Cameras

Go to **Settings › Cameras › Add Camera** and enter the camera's **snapshot URL** (a link that returns a JPEG image). The app refreshes the picture every second, and twice a second in full screen. Common URLs:

- Hikvision: `http://CAMERA-IP/ISAPI/Streaming/channels/101/picture`
- Dahua / Amcrest: `http://CAMERA-IP/cgi-bin/snapshot.cgi`
- Axis: `http://CAMERA-IP/axis-cgi/jpg/image.cgi`

Username and password are supported, with both Basic and Digest login. Passwords are stored in the iOS Keychain.

## 5. Set up the mounted iPad

1. In the app: **Settings › This device › Wall panel mode** turns on (the screen stays on and a clock screensaver appears).
2. On the iPad: **Settings › Accessibility › Guided Access**, turn it on and set a passcode. Then open the app and triple-click the side/top button to lock the iPad to it.
3. Keep the iPad on power, and on the same Wi-Fi as the processor.

Room photos: open a room, tap **⋯**, then **Choose Room Photo**.

## How the code is organized

```
HomeControl/
  App/            app entry, iPad sidebar / iPhone tabs, screensaver timer
  Model/          data types, HomeStore (state + optimistic updates), settings, Keychain
  Backends/
    DemoBackend.swift            pretend house
    CrestronHomeBackend.swift    Crestron Home Web API (/cws/api)
    CustomProgramBackend.swift   join map ↔ app model
    CIPClient.swift              touch-panel protocol (TCP 41794)
    JoinMap.swift                join map format + example
  Views/          dashboard, rooms, lights, shades, media, security/gate, cameras, settings
```

To add another kind of system, implement the small `HomeBackend` protocol in `Backends/HomeBackend.swift`.

## Honest notes and limits

- **Not yet tested on a real system.** It was written without access to your processor, so expect a round of small fixes the first time you connect. Testing with Demo mode first is the easiest start.
- **Crestron Home:** the endpoint paths and field names follow traffic captured from real processors by the open-source [CH2HA](https://github.com/jonahshem/CH2HA) integration. Arming and disarming security through the Web API is **not verified** anywhere, and some systems return no security devices at all. Climate isn't included because you didn't ask for it; it's easy to add.
- **Custom program:** the touch-panel protocol follows the open-source [python-cipclient](https://pypi.org/project/python-cipclient/) project. It isn't an official Crestron SDK, but it's the same connection Crestron Go uses.
- Crestron processors use self-signed HTTPS certificates. The app accepts the certificate **only for the processor address you type in**.
- Only use this on your own home network. For control away from home, use a VPN (for example WireGuard or Tailscale on your router) rather than opening ports on the router.
