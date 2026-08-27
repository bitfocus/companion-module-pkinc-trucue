# companion-module-pkinc-trucue

[Bitfocus Companion](https://bitfocus.io/companion) module for
**[TRUCUE](https://trucue.io)** — a video playout app for macOS. 
Drives TRUCUE's OSC remote-control API over UDP.

## Features

- **Transport** — Play, Pause, Play/Pause, Fast Forward (2–32×),
  Rewind (−2 to −32×), Jump to Start/End
- **Playlist** — Next/Previous Clip, Load by Index or Name, Selection
  control
- **Seek** — relative jog, absolute time/percent, last-N-seconds,
  bookmarks
- **Trim** — Mark IN/OUT, Clear
- **Modes & Audio** — Loop, Auto-Advance (Off / Auto-Next / Auto-First),
  Mute All
- **Live feedback** — variables for clip name/index, countdown to OUT and
  to the next bookmark, threshold feedbacks (button turns red/amber), and
  a Load Clip dropdown fed by the playlist
- ~50 ready-made button presets, plus a raw custom-OSC escape hatch

See [companion/HELP.md](companion/HELP.md) for setup and usage.

## Development

```
corepack yarn install
corepack yarn test        # offline round-trip tests against TRUCUE's OSC grammar
```

Load it as a Companion dev module: point the launcher's *Developer
modules path* at the folder **containing** this repo's folder.

## License

MIT
