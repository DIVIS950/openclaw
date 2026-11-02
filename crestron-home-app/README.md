# Home Control: a nicer iPhone and iPad app for your Crestron system

Two apps with the same design, made to replace Crestron Go with something closer to the new Crestron Home look: big room cards, scene tiles, and controls you can drag.

- **Web app** (`web/`): works on every iPad, iPhone, Android phone and computer. Add it to the Home Screen and it runs full screen like an app. It needs a small home server running on any always-on computer at home. **This is the quickest way to start.**
- **Native iOS app** (`HomeControl/`): SwiftUI, built with Xcode on a Mac. On iPad it opens in **Home View**, the same iPad design as the web version, with Ask Home built in. iPhone keeps the dark design.

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

A browser can't talk to the Crestron processor directly, so a small home server does that part. It needs one computer that **stays on** and is on the same network as the processor.

**Don't have one?** The cheapest good option is a **Raspberry Pi 5** (2 GB or 4 GB) with its official power supply, a case and a 32 GB microSD card, about US$80–100 in total. It uses about as much power as a night light. An old Mac or PC that stays on works too, and so does a Synology/QNAP NAS that runs Docker.

**Raspberry Pi (or any Debian/Ubuntu computer):**

1. Put **Raspberry Pi OS Lite** on the card with Raspberry Pi Imager. In its settings, turn on SSH, set a username and password, and enter your Wi-Fi (or plug the Pi into the router with a cable, which is more reliable).
2. Connect to it from a computer: `ssh yourname@raspberrypi.local`
3. Get the app and install it:
   ```bash
   sudo apt-get install -y git
   git clone -b claude/happy-gauss-heaew1 https://github.com/divis950/openclaw.git
   cd openclaw/crestron-home-app/web
   ./install-linux.sh
   ```
   (`-b …` picks the branch the app is on until it's merged into `main`. If the repository is private, GitHub asks you to sign in.) The script installs Node.js 22, sets the app to start by itself when the Pi turns on, and prints the address to open.

**Mac or PC:** install **Node.js 22** from nodejs.org, then:
```bash
cd crestron-home-app/web
npm install
npm start
```

**Docker (NAS):**
```bash
cd crestron-home-app
docker build -t home-control .
docker run -d --name home-control --restart unless-stopped --network host -v home-control-data:/data home-control
```

Then, on the iPad:

1. Open `http://COMPUTER-IP:8080` in Safari (on a Pi, `http://raspberrypi.local:8080` usually works too). **Home View** opens.
2. Tap **Share › Add to Home Screen**. It then opens full screen, like an app.
3. Open the gear button › **System setup** and connect (see section 3 below; the fields are the same).

The older design is still there at `http://COMPUTER-IP:8080/index.html` (the "classic view"); System setup lives there for now.

Options (environment variables):

- `PORT`: the port to use (default `8080`).
- `ADMIN_PIN`: asks for a PIN before anyone can open Setup. It's a good idea, because Setup holds the Web API token.
- `DATA_DIR`: where settings are saved (default `web/data/`, which git ignores).
- `ANTHROPIC_API_KEY`: the key for the AI assistant. You can also paste it in **Setup › AI assistant**.

The server pushes live changes to every open screen at once, so the wall iPad and the phones always match. Camera pictures go through the server, so camera passwords never reach the browsers.

### Home View: the iPad design

**Home View** is the main web app, made for the iPad (especially a wall-mounted one, in landscape or portrait), in the style of Apple's Home app.

- A sidebar with every room, and a soft background whose colors follow the time of day (each room has its own colors).
- Tiles like Apple Home: **tap the icon** to switch something on or off, **tap the name** for the big controls (brightness, shade position, volume and sources).
- The gate opens with **slide to open**, and doors unlock with **press and hold**, so a stray tap does nothing.
- **StandBy**: in wall panel mode the iPad shows a big clock with the house status when nobody touches it.
- **Ask Home**: the AI assistant, with the glowing screen edge while it listens.
- **Room photos**: open a room and tap **Room photo**; the photo becomes that room's background on every screen.
- **Edit Home and Favorites, weather, Automations (schedules, timers, vacation mode), richer music, camera wall and doorbell pop-up:** the same as in the iPad app, described under "More on the iPad" below. In the web app the **home server runs schedules and timers all the time**, even when no screen is open, and stores them for every screen. The Edit Home layout and favorites are kept per device. Set the town for weather in the gear button › **Location**.

Settings in Home View (the gear button) cover appearance and wall panel mode. Connection, cameras and the AI key are set up in **Setup** in the classic view; Home View links there.

## 2b. Build and install the native iOS app

**No Mac?** Follow [TESTFLIGHT.md](TESTFLIGHT.md): a Mac in the cloud builds the app and sends it to TestFlight, and you install it on the iPad from there. It needs the Apple Developer Program (US$99 per year).

**With a Mac:**


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

### Home View in the native app (iPad)

On iPad the native app opens straight into Home View: the room sidebar, the wallpaper that follows the time of day, Apple Home–style tiles (tap the icon to switch, tap the name for the big controls), slide to open the gate, press and hold to unlock, and StandBy in wall panel mode. Other touches:

- **Room photos:** open a room and tap **Room photo**; the photo becomes that room's background.
- **Appearance:** Settings › This device › Appearance (Automatic follows the iPad, or pick Light or Dark).
- **Ask Home:** paste an Anthropic API key in **Settings › AI assistant**. The app calls Claude directly (no home server needed), with the same safety rules as the web app. To speak instead of typing, use the microphone key on the iPad keyboard.

### Home pages, room cards and motion (iPad)

- **Home pages:** Home is now a few pages. Swipe left or right, or tap the tabs under the title: **Home** (your Edit Home layout), **Rooms**, **Security**, **Music** and **Cameras**. A page only shows when the house has something for it. Each page scrolls by itself, the dots at the bottom show where you are, and the iPad remembers the last page.
- **Rooms page:** a big card for every room, with its photo (or the room's colors). The card glows warmer when the lights are brighter. The round button at the top right switches the room's lights on or off. Small badges show shades, music and the door (orange when unlocked). Tap a card to open the room. At the top: **All lights off**, **Close all shades** and **All music off**.
- **Room page:** a large card at the top with the room photo, the lights, shades, music and door at a glance, and the quick buttons (lights, shades, room photo).
- **Motion:** light icons glow as bright as the light, a tile bounces with a small ring when you change it, a scene sends a wave of its color across the screen, and cards lean a little toward your finger. The weather widget has a small moving picture (sun, moon and stars, clouds, rain, snow, storm or fog), and the gate widget has a little gate that opens and closes with the real one. With **Reduce Motion** on (iPad Settings › Accessibility › Motion) all of this stays still.

### Ask Home on the iPad: timers, schedules, Undo

- Ask Home knows **which room is on screen**: in a room, "turn off the lights in here" means that room. A small "In Kitchen" label shows this.
- **Timers:** "turn off the kitchen lights in 30 minutes" or "sleep timer for an hour". Only lights, shades, scenes, music and locking can go on a timer, never unlocking, the gate or the alarm.
- **Schedules:** "every night at 11 close the shades" or "weekdays at sunset turn on the patio lights". The new schedule shows on the Automations page, where you can change or delete it.
- **Undo:** after Ask Home changes lights, shades or music, tap **Undo** to put them back as they were. Undo never touches locks, the gate or the alarm.
- **Read answers out loud:** tap the speaker button at the top of Ask Home. The iPad remembers this.
- Before you ask, Ask Home shows ideas that fit the house right now, for example "Lock the front door" when it is unlocked.

### More on the iPad: favorites, weather, schedules, doorbell

The iPad app has the same extras as the web Home View. Each iPad keeps its own choices.

- **Edit Home:** tap the pencil button at the top of Home, or **Edit Home** at the bottom. Remove a part with the red minus, add one with the green plus, and move parts up or down. **Reset to standard** puts everything back. Widgets that sit next to each other (weather, gate, alarm, Now Playing) share one row.
- **Favorites:** tap the star at the top of any light, shade, music room or lock card. You can also pick favorites (and scenes) from a list: **Edit Home › Choose favorites**. They show in the **Favorites** part of Home.
- **Weather:** in **Settings › Location**, type your town and tap **Save**. Home then shows the weather above the clock and in a weather widget, with sunrise and sunset. The weather comes from Open-Meteo (free, no key) every 15 minutes. The demo house uses a sample town and sample weather.
- **Automations** (in the sidebar, under Controls):
  - **Schedules:** run scenes, lights, shades, "all music off" or "lock all doors" at a time, or at sunrise or sunset (with minutes before or after), on the days you pick. Tap a schedule to change it; use the switch to turn it off. The **Ideas** buttons fill in common schedules for you.
  - **Timers:** open a light, shade or music room and tap **Turn off in 15 min / 30 min / 1 h / 2 h** (for music this is a sleep timer).
  - **Vacation mode:** lights go on and off at random through the evening, as if someone were home, and all go off at 11:30 PM.
  - **Coming up** on Home shows the next schedules and running timers. Tap the × to cancel a timer.
  - There is no home server in the native app, so **schedules and timers run on the iPad while the app is open**. A wall iPad in wall panel mode keeps the app open all day, so this works well there. If the iPad was off at that time, a schedule is skipped once it is more than 10 minutes late.
- **Music:** Now Playing shows the song, artist and artwork colors, with previous, play/pause and next buttons when the system has them. In a music card, **Play this in every room** starts the same source at the same volume in the other rooms. The Media page has **Turn all off**.
- **Camera wall:** on the Cameras page, tap **Camera wall** to see every camera at once on a black screen.
- **Doorbell:** when someone rings, a card pops up over everything (and wakes StandBy) with the door camera, **hold to unlock** for the door's lock, and **Dismiss**. It closes by itself after 90 seconds. The camera is the one whose name matches the doorbell's `camera` name, or the first camera. To try it, use **Settings › Doorbell › Test**. Doorbells come from the custom-program join map (see below) and from the demo house.

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
- Music rooms can also have `play`, `pause`, `next` and `previous` (digital, pressed like buttons). If you only have one play/pause button, map just `play` or just `pause` and it is used for both. `playingFeedback` is high while music plays (if you leave it out, "on" counts as playing).
- `title`, `artist` and `album` in a music room are **serial** joins that the program sends with the song or show name.
- `doorbells`: `ring` is the digital join that goes high when someone presses the doorbell. `camera` is the name of a camera from Settings › Cameras, and `lock` is the name of a lock from `locks`, for hold to unlock.
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

Room photos: open a room and tap **Room photo** (Home View on the web and in the iPad app).

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
  Model/          data types, HomeStore (state + optimistic updates), settings, Keychain,
                  AutomationStore + Automations (schedules, timers, vacation), Sun, Weather, HomeLayout
  Backends/
    DemoBackend.swift            pretend house
    CrestronHomeBackend.swift    Crestron Home Web API (/cws/api)
    CustomProgramBackend.swift   join map ↔ app model
    CIPClient.swift              touch-panel protocol (TCP 41794)
    JoinMap.swift                join map format + example
  Views/HomeView/ Home View, the iPad design: sidebar, wallpaper, Home pages, room cards, tiles, widgets, motion, detail cards, Ask Home
  Views/          iPhone screens: dashboard, rooms, media, security/gate, cameras, settings
  Assistant/      Ask Home: Claude API call, the control_home, set_timer and create_schedule tools and their safety rules
```

To add another kind of system, implement the small `HomeBackend` protocol in `Backends/HomeBackend.swift` (iOS) and the matching class in `web/server/backends/` (web).

## Honest notes and limits

- **Not yet tested on a real system.** It was written without access to your processor, so expect a round of small fixes the first time you connect. Testing with Demo mode first is the easiest start.
- **Crestron Home:** the endpoint paths and field names follow traffic captured from real processors by the open-source [CH2HA](https://github.com/jonahshem/CH2HA) integration. Arming and disarming security through the Web API is **not verified** anywhere, and some systems return no security devices at all. Climate isn't included because you didn't ask for it; it's easy to add.
- **Custom program:** the touch-panel protocol follows the open-source [python-cipclient](https://pypi.org/project/python-cipclient/) project. It isn't an official Crestron SDK, but it's the same connection Crestron Go uses.
- **Native app:** written without a Mac, so it hasn't been compiled yet. Expect a few small build fixes the first time you open it in Xcode; tell me the errors and I'll fix them.
- **AI assistant:** tested against a simulated Claude API (there was no real key in my workspace). It checks the safety rules, the tool calls and the request settings, but not real answers. Try it with your key and tell me how it handles your phrasing.
- Crestron processors use self-signed HTTPS certificates. The app accepts the certificate **only for the processor address you type in**.
- Only use this on your own home network. For control away from home, use a VPN (for example WireGuard or Tailscale on your router) rather than opening ports on the router.
