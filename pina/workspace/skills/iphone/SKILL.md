---
name: iphone
description: "Use the owner's iPhone through the paired OpenClaw iPhone app (a node): location, calendar and reminders on the phone, contacts, recent photos, battery, steps, notifications, camera. Use when: the owner asks where they are, what is on the phone, to ping or notify their phone, or to take a photo. NOT for: Gmail or Google Calendar (use the gog skill), tapping buttons or opening other apps (iOS does not allow it)."
metadata: { "openclaw": { "emoji": "📱" } }
---

# iPhone (node) skill

The owner can pair the OpenClaw iPhone app with this gateway. The phone then shows up as a
**node**, and you reach it with the `nodes` tool. If no iPhone node is connected, say so in
one sentence and continue without it.

## Find the phone first

```json
{ "action": "status" }
```

Use the iPhone's name or id from that result as `node` in every call below.

## What works by default on iPhone

| Ask | Tool call |
| --- | --- |
| Where am I? | `{ "action": "location_get", "node": "<iPhone>", "desiredAccuracy": "balanced" }` |
| Ping my phone | `{ "action": "notify", "node": "<iPhone>", "title": "Piña", "body": "Your 15:00 call starts in 10 minutes", "priority": "timeSensitive" }` |
| Battery, storage, network | `{ "action": "invoke", "node": "<iPhone>", "invokeCommand": "device.status", "invokeParamsJson": "{}" }` |
| Phone calendar this week | `{ "action": "invoke", "node": "<iPhone>", "invokeCommand": "calendar.events", "invokeParamsJson": "{\"limit\":20}" }` |
| Open reminders | `{ "action": "invoke", "node": "<iPhone>", "invokeCommand": "reminders.list", "invokeParamsJson": "{\"status\":\"incomplete\"}" }` |
| Find a contact | `{ "action": "invoke", "node": "<iPhone>", "invokeCommand": "contacts.search", "invokeParamsJson": "{\"query\":\"Anna\",\"limit\":5}" }` |
| Latest photo | `{ "action": "invoke", "node": "<iPhone>", "invokeCommand": "photos.latest", "invokeParamsJson": "{\"limit\":1}" }` |
| Steps today | `{ "action": "invoke", "node": "<iPhone>", "invokeCommand": "motion.pedometer", "invokeParamsJson": "{}" }` |

Rules that come from the app itself:

- `notify` needs both a non-empty `title` and `body` on iPhone.
- Camera, canvas, screen recording and push-to-talk only work while the app is open in the
  foreground. If you get `NODE_BACKGROUND_UNAVAILABLE`, ask the owner to open the app.
- Location only works after the owner sets Location to "While Using" or "Always" in the app's
  Settings. `LOCATION_DISABLED` means it is still off.
- `CALENDAR_PERMISSION_REQUIRED`, `REMINDERS_PERMISSION_REQUIRED`,
  `CONTACTS_PERMISSION_REQUIRED`, `PHOTOS_PERMISSION_REQUIRED` and
  `MOTION_PERMISSION_REQUIRED` mean iOS never granted access. The current app build has no
  button to ask for it (see `ios-phone-access.md` in the setup package). Tell the owner once;
  do not retry in a loop.

## Things that need the owner to switch them on

These commands are blocked by the gateway until the owner allows them, either in
`gateway.nodes.allowCommands` or for a limited time with the `/phone arm` chat command:

- `camera.snap`, `camera.clip`: `/phone arm camera 10m`
- `screen.record`: `/phone arm screen 10m`
- `calendar.add`, `reminders.add`, `contacts.add`: `/phone arm writes 1h`

Example once armed (phone calendar, times in UTC ISO format):

```json
{ "action": "invoke", "node": "<iPhone>", "invokeCommand": "calendar.add",
  "invokeParamsJson": "{\"title\":\"Dentist\",\"startISO\":\"2026-10-20T07:00:00Z\",\"endISO\":\"2026-10-20T08:00:00Z\"}" }
```

Arming changes gateway config, so the gateway restarts and the phone reconnects. Wait a few
seconds before the first call. If you get "command not declared by node", the phone has not
reconnected yet; ask the owner to open the app.

## What you cannot do on an iPhone

iOS does not let any app tap buttons, read other apps' screens, open other apps or run
Shortcuts on another app's behalf. If the owner asks for that, say so briefly and offer what
you can do instead: a notification, a reminder, a calendar event, or doing the task yourself
on your own computer.
