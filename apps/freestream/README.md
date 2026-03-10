# FreeStream

A free, legal streaming platform built on public domain and Creative Commons content.

## Features

- **Free Movies** — 20+ public domain classics (Nosferatu, Metropolis, Night of the Living Dead, etc.) streamed directly from Internet Archive
- **Free Series** — Classic serials (Flash Gordon, Batman 1943, Buck Rogers, Zorro, etc.) with episode navigation
- **Live Sports** — F1, WRC, WEC 2025 full calendars with race status and standings
- **My Library** — Save titles to browser localStorage for later
- **Search** — Instant search across all titles

## Content Sources

All content is 100% legal:

| Source | What |
|--------|------|
| [Internet Archive](https://archive.org) | Public domain movies & serials (streamed via their embed API) |
| [YouTube — Official F1](https://youtube.com/@F1) | Race highlights, onboards |
| [YouTube — Official WRC](https://youtube.com/@WRC) | Rally highlights |
| [YouTube — FIA WEC](https://youtube.com/@FIAWEC) | Endurance race highlights |

## Usage

Open `index.html` in any modern browser — no build step, no server required.

```bash
open apps/freestream/index.html
# or
python3 -m http.server 8080 --directory apps/freestream
```

## Sports Data

- F1 2025 — 24-race calendar with live/upcoming/done status
- WRC 2025 — 14 rounds
- WEC 2025 — 10 rounds including 24 Hours of Le Mans
- F1 Driver Standings (updated manually)
