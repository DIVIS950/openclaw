# Home Control: a nicer iPhone and iPad app for your Crestron system

Two apps with the same design, made to replace Crestron Go with something closer to the new Crestron Home look: big room cards, scene tiles, and controls you can drag.

- **Web app** (`web/`): works on every iPad, iPhone, Android phone and computer. Add it to the Home Screen and it runs full screen like an app. It needs a small home server running on any always-on computer at home. **This is the quickest way to start.**
- **Native iOS app** (`HomeControl/`): SwiftUI, built with Xcode on a Mac.

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

## 2a. Run the web app (any computer at home)

A browser can't talk to the Crestron processor directly, so a tiny home server does that part. It has no extra packages, only Node.js.

1. Pick a computer that stays on and is on the same network as the processor: a Mac mini, a PC, a Raspberry Pi, or a NAS that runs Docker.
2. Install **Node.js 22** from nodejs.org, then:
   ```bash
   cd crestron-home-app/web
   npm install
   npm start
   ```
   Or with Docker:
   ```bash
   cd crestron-home-app
   docker build -t home-control .
   docker run -d --name home-control --restart unless-stopped --network host -v home-control-data:/data home-control
   ```
3. On the iPad or phone, open `http://COMPUTER-IP:8080` in Safari, then **Share › Add to Home Screen**.
4. Open **Setup** in the app and connect (see section 3 below; the fields are the same).

Options (environment variables):

- `PORT`: the port to use (default `8080`).
- `ADMIN_PIN`: asks for a PIN before anyone can open Setup. It's a good idea, because Setup holds the Web API token.
- `DATA_DIR`: where settings are saved (default `web/data/`, which git ignores).
- `ANTHROPIC_API_KEY`: the key for the AI assistant. You can also paste it in **Setup › AI assistant**.

The server pushes live changes to every open screen at once, so the wall iPad and the phones always match. Camera pictures go through the server, so camera passwords never reach the browsers.

### Home View: the iPad design

The same server also has **Home View**, a version made for the iPad (especially a wall-mounted one), in the style of Apple's Home app. Open `http://COMPUTER-IP:8080/ipad/` and add it to the Home Screen.

- A sidebar with every room, and a soft background whose colors follow the time of day (each room has its own colors).
- Tiles like Apple Home: **tap the icon** to switch something on or off, **tap the name** for the big controls (brightness, shade position, volume and sources).
- The gate opens with **slide to open**, and doors unlock with **press and hold**, so a stray tap does nothing.
- **StandBy**: in wall panel mode the iPad shows a big clock with the house status when nobody touches it.
- **Ask Home**: the AI assistant, with the glowing screen edge while it listens.

Settings in Home View (the gear button) cover appearance and wall panel mode. Connection, cameras and the AI key are set up in **Setup** in the classic view; Home View links there.

## 2b. Build and install the native iOS app (needs a Mac)

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

## 4. AI assistant

Tap the black **Ask** button and type or speak, for example:

- "Turn off all the lights"
- "Good night"
- "Dim the living room to 30%"
- "Play Spotify in the kitchen"
- "Is the front door locked?"

The assistant uses Claude (model `claude-opus-5-5`, low effort, so answers come fast) and runs on the home server. To turn it on:

1. Create an API key at console.anthropic.com. Each request costs a fraction of a cent.
2. Paste the key in **Setup › AI assistant**. It's stored on the home server only; browsers never see it.

Safety rules are built into the code, not just the instructions to the AI:

- Lights, shades, scenes, media, locking doors and arming the alarm happen right away.
- **Unlocking a door and opening the gate** always show a **Confirm** button you have to tap.
- The assistant **can't disarm the alarm**; use the keypad for that.
- If Anthropic's safety system declines a request, it automatically retries on its recommended fallback model.

Voice uses the browser's own speech recognition, which works in Safari on iPhone and iPad and in Chrome. Allow the microphone when asked.

## 5. Cameras

Go to **Settings › Cameras › Add Camera** and enter the camera's **snapshot URL** (a link that returns a JPEG image). The app refreshes the picture every second, and twice a second in full screen. Common URLs:

- Hikvision: `http://CAMERA-IP/ISAPI/Streaming/channels/101/picture`
- Dahua / Amcrest: `http://CAMERA-IP/cgi-bin/snapshot.cgi`
- Axis: `http://CAMERA-IP/axis-cgi/jpg/image.cgi`

Username and password are supported, with both Basic and Digest login. Passwords are stored in the iOS Keychain.

## 6. Set up the mounted iPad

1. In the app: turn on **Wall panel mode** (native app: Settings › This device; web app: Setup › This device). The screen stays on and a clock screensaver appears when nobody touches it.
2. On the iPad: **Settings › Accessibility › Guided Access**, turn it on and set a passcode. Then open the app and triple-click the side/top button to lock the iPad to it.
3. Keep the iPad on power, and on the same Wi-Fi as the processor.

Room photos: open a room, tap **⋯**, then **Choose Room Photo**.

## How the code is organized

```
web/
  server/index.js                 home server: web app, live updates, setup, camera proxy
  server/backends/                Crestron Home Web API, touch-panel (CIP) client, join map
  server/assistant.js             AI assistant (Claude API, one control_home tool)
  public/                         the web app (no build step): app.js, app.css, icons.js
  public/ipad/                    Home View, the iPad design (views, sheets, Ask Home)
  public/shared/                  data model, demo house and assistant rules, shared by browser and server
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

To add another kind of system, implement the small `HomeBackend` protocol in `Backends/HomeBackend.swift` (iOS) and the matching class in `web/server/backends/` (web).

## Honest notes and limits

- **Not yet tested on a real system.** It was written without access to your processor, so expect a round of small fixes the first time you connect. Testing with Demo mode first is the easiest start.
- **Crestron Home:** the endpoint paths and field names follow traffic captured from real processors by the open-source [CH2HA](https://github.com/jonahshem/CH2HA) integration. Arming and disarming security through the Web API is **not verified** anywhere, and some systems return no security devices at all. Climate isn't included because you didn't ask for it; it's easy to add.
- **Custom program:** the touch-panel protocol follows the open-source [python-cipclient](https://pypi.org/project/python-cipclient/) project. It isn't an official Crestron SDK, but it's the same connection Crestron Go uses.
- **AI assistant:** tested against a simulated Claude API (there was no real key in my workspace). It checks the safety rules, the tool calls and the request settings, but not real answers. Try it with your key and tell me how it handles your phrasing.
- Crestron processors use self-signed HTTPS certificates. The app accepts the certificate **only for the processor address you type in**.
- Only use this on your own home network. For control away from home, use a VPN (for example WireGuard or Tailscale on your router) rather than opening ports on the router.
