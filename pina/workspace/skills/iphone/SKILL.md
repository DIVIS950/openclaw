---
name: iphone
description: "Use the owner's iPhone through the paired OpenClaw iPhone app (a node): location, the phone's own calendar, reminders and contacts, recent photos, battery and steps, notifications, camera. Use when: the owner asks where they are, what is on the phone, to ping or notify their phone, or to take a photo. NOT for: Gmail or Google Calendar (use the gog skill), tapping buttons or opening other apps (iOS does not allow it)."
metadata: { "openclaw": { "emoji": "📱" } }
---

# iPhone (node) skill

The owner can pair the official OpenClaw iPhone app (App Store) with this gateway. The phone
then shows up as a **node**, and you reach it with the `nodes` tool. If no iPhone node is
connected, say so in one sentence and continue without it. Pairing needs the private
Tailscale step from the setup guide; until then there is simply no phone node.

## A new pairing code

If the owner asks for a new iPhone setup code (codes expire after 10 minutes), run this with
`exec` and send them the `setupCode` value as its own message:

```bash
node /app/dist/index.js qr --json
```

It only works after the iPhone step of the setup guide has run (it needs the private Tailscale
address). If it fails, tell the owner to run that step.

## Find the phone first

```json
{ "action": "status" }
```

Use the iPhone's name or id from that result as `node` in every call below.

## Allowed by default

| Ask | Tool call |
| --- | --- |
| Where am I? | `{ "action": "location_get", "node": "<iPhone>", "desiredAccuracy": "balanced" }` |
| Ping my phone | `{ "action": "notify", "node": "<iPhone>", "title": "Piña", "body": "Your 15:00 call starts in 10 minutes", "priority": "timeSensitive" }` |
| Battery, storage, network | `{ "action": "device_status", "node": "<iPhone>" }` |
| What can the phone do right now? | `{ "action": "device_permissions", "node": "<iPhone>" }` |
| Latest photo | `{ "action": "photos_latest", "node": "<iPhone>" }` |
| Phone calendar | `{ "action": "invoke", "node": "<iPhone>", "invokeCommand": "calendar.events", "invokeParamsJson": "{\"limit\":20}" }` |
| Open reminders | `{ "action": "invoke", "node": "<iPhone>", "invokeCommand": "reminders.list", "invokeParamsJson": "{\"status\":\"incomplete\"}" }` |
| Find a contact | `{ "action": "invoke", "node": "<iPhone>", "invokeCommand": "contacts.search", "invokeParamsJson": "{\"query\":\"Anna\",\"limit\":5}" }` |
| Steps today | `{ "action": "invoke", "node": "<iPhone>", "invokeCommand": "motion.pedometer", "invokeParamsJson": "{}" }` |

## Allowed only after the owner switches them on

These need the command listed in `gateway.nodes.commands.allow`, which only the owner can
change. Adding events and reminders is turned on when the owner runs the iPhone step with
`--allow-phone-writes`. Camera, screen recording and adding contacts stay off unless the owner
enables them.

```json
{ "action": "invoke", "node": "<iPhone>", "invokeCommand": "reminders.add",
  "invokeParamsJson": "{\"title\":\"Buy milk\",\"dueISO\":\"2026-10-20T16:00:00Z\"}" }
```

```json
{ "action": "invoke", "node": "<iPhone>", "invokeCommand": "calendar.add",
  "invokeParamsJson": "{\"title\":\"Dentist\",\"startISO\":\"2026-10-20T07:00:00Z\",\"endISO\":\"2026-10-20T08:00:00Z\"}" }
```

Write `*ISO` times in UTC with a `Z`, converted from the owner's local time. If a call says the
command is not allowed or not declared, tell the owner which command it was; they can enable it
with the setup guide and reopen the app.

## Rules that come from the app

- `notify` needs both a non-empty `title` and `body`.
- Camera, screen and push-to-talk only work while the app is open in the foreground. If you get
  `NODE_BACKGROUND_UNAVAILABLE`, ask the owner to open the app.
- Location only works after the owner sets Location to "While Using" or "Always" in the app.
- Errors ending in `_PERMISSION_REQUIRED` mean iOS has not granted that access yet. Ask the owner
  to open the app's Settings, This iPhone, Permissions, and tap Grant. Say it once; don't retry in
  a loop.
- After the owner grants a new permission, the gateway may hold the new command until it is
  approved. If a command keeps failing after they granted access, tell the owner to run
  `pina nodes pending` on the server (see the setup guide).

## What you cannot do on an iPhone

iOS does not let any app tap buttons, read other apps' screens, open other apps, read SMS or
other apps' notifications. Screen recording only captures the OpenClaw app itself. If the owner
asks for that kind of control, say so briefly and offer what you can do instead: a notification,
a reminder, a calendar event, or doing the task yourself on your own computer.
