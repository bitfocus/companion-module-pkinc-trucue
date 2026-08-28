# TRUCUE

Controls the **TRUCUE** video playout app for macOS over OSC (UDP).

## TRUCUE setup

1. In TRUCUE open **Settings → OSC** and enable **OSC remote control**.
2. Match the **Port** (default `8017`) and **Address prefix** (default
   `trucue`) in this connection's settings.
3. For variables, countdowns and the Load Clip list, also enable
   **Companion feedback** in the same panel (host = the machine running
   Companion, port default `9017`) and keep **Enable feedback** on in
   this connection.
4. While testing commands, **Show Logs** displays every incoming packet.

Notes:

- TRUCUE ignores all OSC while the license gate is locked.
- On a Primary/Backup pair, point this connection at the **Primary**.

## Actions

**Transport** — Play, Pause, Play/Pause, Fast Forward (2–32× or Off),
Rewind (−2 to −32× or Off), Jump to Start (trim IN), Jump to End (trim OUT).

**Playlist** — Next/Previous Clip, Load Clip (dropdown of the current
playlist, fed by TRUCUE), Load Clip by Index (1-based, counts clips only),
Load Clip by Name (exact, case-insensitive), Move Selection Up/Down,
Load Selected Row.

**Seek** — Jog (± seconds, relative), Go to Time (seconds from file start),
Go to Percent, Go to Last N Seconds, Go to Bookmark by Index. Seeks keep
the current play/pause state.

**Trim** — Set Mark IN / OUT at playhead, Clear IN/OUT.

**Modes & Audio** — Loop (toggle/on/off), Auto-Advance (Off / Auto-Next /
Auto-First; setting a mode also clears Loop), Mute All (spares LTC channels),
Clip Volume ± dB (fractions OK; assign to a rotary dial's rotate left/right
for a volume knob — the *Volume knob* preset is pre-wired).

**Send Custom OSC Command** — raw address + optional argument, sent as typed
(prefix not applied).

## Variables

- `clip_name`, `clip_index` — currently loaded clip (1-based, clips only)
- `next_clip_name`, `prev_clip_name` — playlist neighbors (next follows the
  armed auto mode)
- `clip_volume` — loaded clip's gain, e.g. `-3.5 dB`
- `time_remaining`, `time_remaining_s` — countdown to the trim-aware OUT
  (`m:ss` / whole seconds)
- `bookmark_name`, `bookmark_remaining`, `bookmark_remaining_s` — next
  bookmark ahead of the playhead (empty when none)

Use them in button text, e.g. `$(trucue:time_remaining)` (the prefix is
your connection label). Clip-name variables carry the clip's mode symbols:
`↻` loop, `→` auto-next, `↺` auto-first, `■` cue in black.

## Feedbacks

- **Countdown to OUT is under N seconds** — button turns red (default 10 s).
- **Countdown to next bookmark is under N seconds** — button turns amber
  (default 5 s).

The *Status & Countdown* preset category has ready-made buttons for the
countdown, next bookmark, and current clip.

## Tips

- Prefer **Load Clip / by Index / by Name** over Selection + Load Selected
  for deterministic show control.
- Fast Forward, Rewind, and Auto-Advance send a short OSC bundle that
  TRUCUE executes in order, so they set the target state from any
  current state.
