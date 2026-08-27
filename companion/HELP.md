# TRUCUE

Controls the **TRUCUE** video playout app for macOS over OSC (UDP).

## TRUCUE setup

1. In TRUCUE open **Settings → OSC** and enable **OSC remote control**.
2. Match the **Port** (default `8000`) and **Address prefix** (default
   `trucue`) in this connection's settings.
3. While testing, **Show Logs** in the same panel displays every incoming
   packet.

Notes:

- TRUCUE ignores all OSC while the license gate is locked.
- On a Primary/Backup pair, point this connection at the **Primary**.

## Actions

**Transport** — Play, Pause, Play/Pause, Fast Forward (2–32× or Off),
Rewind (−2 to −32× or Off), Jump to Start (trim IN), Jump to End (trim OUT).

**Playlist** — Next/Previous Clip, Load Clip by Index (1-based, counts clips
only), Load Clip by Name (exact, case-insensitive), Move Selection Up/Down,
Load Selected Row.

**Seek** — Jog (± seconds, relative), Go to Time (seconds from file start),
Go to Percent, Go to Last N Seconds, Go to Bookmark. Seeks keep the current
play/pause state.

**Trim** — Set Mark IN / OUT at playhead, Clear IN/OUT.

**Modes & Audio** — Loop (toggle/on/off), Auto-Advance (Off / Auto-Next /
Auto-First; setting a mode also clears Loop), Mute All (spares LTC channels).

**Send Custom OSC Command** — raw address + optional argument, sent as typed
(prefix not applied).

## Tips

- Prefer **Load Clip by Index/Name** over Selection + Load Selected for
  deterministic show control.
- Text options accept Companion variables, e.g. `$(internal:custom_myclip)`.
- Fast Forward, Rewind, and Auto-Advance send a short OSC bundle that
  TRUCUE executes in order, so they set the target state from any
  current state.
