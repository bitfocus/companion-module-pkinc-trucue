// Action definitions — one action per TRUCUE OSC command, plus a raw
// custom-command escape hatch.
//
// TRUCUE trigger rule: trigger commands treat an explicit numeric 0 as a
// button-release and IGNORE it, so triggers are sent with NO arguments.
//
// The app has no native "set shuttle speed" / "set auto mode" commands,
// only step/cycle ones — but it executes OSC bundles in order, so those
// actions send a short deterministic sequence in one packet:
//   FF N×:       [/play, /ff × log2(N)]     (ladder 1→2→4→8→16→32)
//   RW N×:       [/pause, /rewind × log2(N)]
//   auto mode:   [/loop 1, /loop 0]         (clears every mode)
//                + [/autonext 1]            (→ Auto-Next)
//                + [/autonext 0]            (→ Auto-First)
//
// FF must NOT normalize with /pause: the app's play/pause flags settle
// asynchronously, so /ff right after /pause reads stale "playing" state,
// skips its play() call, and the clip ends up paused. /play only changes
// rate while playing (no pause in flight), which is race-free. Rewind's
// own app path pauses internally before starting the reverse engine
// (same as the J key), so /pause first is the app-tested route there.

const SET_MODE_CHOICES = [
	{ id: 'toggle', label: 'Toggle' },
	{ id: 'on', label: 'On' },
	{ id: 'off', label: 'Off' },
]

const AUTO_CHOICES = [
	{ id: 'off', label: 'Off' },
	{ id: 'next', label: 'Auto-Next' },
	{ id: 'first', label: 'Auto-First' },
]

const FF_CHOICES = [
	{ id: 'off', label: 'Off (pause)' },
	{ id: '2', label: '2×' },
	{ id: '4', label: '4×' },
	{ id: '8', label: '8×' },
	{ id: '16', label: '16×' },
	{ id: '32', label: '32×' },
]

const RW_CHOICES = [
	{ id: 'off', label: 'Off (pause)' },
	{ id: '2', label: '−2×' },
	{ id: '4', label: '−4×' },
	{ id: '8', label: '−8×' },
	{ id: '16', label: '−16×' },
	{ id: '32', label: '−32×' },
]

module.exports = function getActionDefinitions(self) {
	// Trigger command: fire-and-forget, no arguments (see note above).
	const trigger = (cmd) => async () => {
		self.sendOsc(cmd, [])
	}

	// Absolute shuttle speed: normalize to a known state, then step the
	// ladder (2→4→8→16→32) the right number of times, all in one bundle.
	// See the header note for why FF normalizes with /play, not /pause.
	const shuttleTo = (normalizer, cmd) => async (event) => {
		const v = String(event.options.speed)
		if (v === 'off') return self.sendOsc('/pause', [])
		const steps = Math.log2(parseInt(v, 10))
		const seq = [{ cmd: normalizer, args: [] }]
		for (let i = 0; i < steps; i++) seq.push({ cmd, args: [] })
		self.sendOscSeq(seq)
	}

	// Toggle/on/off command: no args = toggle, int 1 = on, int 0 = off.
	const setOrToggle = (cmd) => async (event) => {
		if (event.options.mode === 'toggle') {
			self.sendOsc(cmd, [])
		} else {
			self.sendOsc(cmd, [{ type: 'i', value: event.options.mode === 'on' ? 1 : 0 }])
		}
	}

	// Resolve a text option (may contain $(vars)) to a finite number,
	// or null (logged, command skipped).
	const parseNum = async (context, raw, what) => {
		const s = String(await context.parseVariablesInString(String(raw ?? ''))).trim()
		const n = Number(s)
		if (s === '' || !Number.isFinite(n)) {
			self.log('warn', `${what}: "${s}" is not a number — command not sent`)
			return null
		}
		return n
	}

	const numField = (id, label, def) => ({
		type: 'textinput',
		id,
		label,
		default: def,
		useVariables: true,
	})

	return {
		// ── Transport ────────────────────────────────────────────────
		play: {
			name: 'Transport: Play',
			options: [],
			callback: trigger('/play'),
		},
		pause: {
			name: 'Transport: Pause',
			options: [],
			callback: trigger('/pause'),
		},
		play_pause: {
			name: 'Transport: Play/Pause',
			options: [],
			callback: trigger('/playpause'),
		},
		ff: {
			name: 'Transport: Fast Forward',
			description: 'Sets the speed directly; Off pauses.',
			options: [
				{ type: 'dropdown', id: 'speed', label: 'Speed', choices: FF_CHOICES, default: '2' },
			],
			callback: shuttleTo('/play', '/ff'),
		},
		rewind: {
			name: 'Transport: Rewind',
			description: 'Sets the speed directly; Off pauses.',
			options: [
				{ type: 'dropdown', id: 'speed', label: 'Speed', choices: RW_CHOICES, default: '2' },
			],
			callback: shuttleTo('/pause', '/rewind'),
		},
		jump_to_start: {
			name: 'Transport: Jump to Start',
			description: 'Pause and cue at trim IN.',
			options: [],
			callback: trigger('/jumptostart'),
		},
		jump_to_end: {
			name: 'Transport: Jump to End',
			description: 'Pause and park at trim OUT.',
			options: [],
			callback: trigger('/jumptoend'),
		},

		// ── Playlist ─────────────────────────────────────────────────
		clip_next: {
			name: 'Playlist: Next Clip',
			description: 'Skips folders; no wraparound.',
			options: [],
			callback: trigger('/clip/next'),
		},
		clip_prev: {
			name: 'Playlist: Previous Clip',
			options: [],
			callback: trigger('/clip/prev'),
		},
		load_clip: {
			name: 'Playlist: Load Clip',
			description: 'Pick from the playlist; stores the position, like Load by Index (needs feedback enabled).',
			options: [
				{
					type: 'dropdown',
					id: 'clip',
					label: 'Clip',
					choices: self.playlistNames && self.playlistNames.length
						? self.playlistNames.map((n, i) => ({ id: i + 1, label: `${i + 1}: ${n}` }))
						: [{ id: 0, label: '— no playlist received yet —' }],
					default: self.playlistNames && self.playlistNames.length ? 1 : 0,
					minChoicesForSearch: 5,
				},
			],
			callback: async (event) => {
				const n = Math.round(Number(event.options.clip))
				if (!(n >= 1)) {
					self.log('warn', 'Load Clip: no clip selected — command not sent')
					return
				}
				self.sendOsc('/load/index', [{ type: 'i', value: n }])
			},
		},
		load_index: {
			name: 'Playlist: Load Clip by Index',
			description: '1-based, counts clips only.',
			options: [numField('index', 'Index', '1')],
			callback: async (event, context) => {
				const n = await parseNum(context, event.options.index, 'Load clip by index')
				if (n === null) return
				self.sendOsc('/load/index', [{ type: 'i', value: Math.round(n) }])
			},
		},
		load_name: {
			name: 'Playlist: Load Clip by Name',
			description: 'Exact match, case-insensitive.',
			options: [
				{ type: 'textinput', id: 'name', label: 'Name', default: '', useVariables: true },
			],
			callback: async (event, context) => {
				const name = String(await context.parseVariablesInString(String(event.options.name ?? ''))).trim()
				if (name === '') {
					self.log('warn', 'Load clip by name: empty name — command not sent')
					return
				}
				self.sendOsc('/load/name', [{ type: 's', value: name }])
			},
		},
		select_next: {
			name: 'Playlist: Move Selection Down',
			description: 'Moves the highlight only.',
			options: [],
			callback: trigger('/select/next'),
		},
		select_prev: {
			name: 'Playlist: Move Selection Up',
			options: [],
			callback: trigger('/select/prev'),
		},
		load_selected: {
			name: 'Playlist: Load Selected Row',
			description: 'Loads the highlighted row.',
			options: [],
			callback: trigger('/load'),
		},

		// ── Seek ─────────────────────────────────────────────────────
		jump: {
			name: 'Seek: Jog',
			description: 'Relative seek; negative = back.',
			options: [numField('seconds', 'Seconds (±)', '5')],
			callback: async (event, context) => {
				const n = await parseNum(context, event.options.seconds, 'Jog')
				if (n === null) return
				self.sendOsc('/jump', [{ type: 'f', value: n }])
			},
		},
		goto_seconds: {
			name: 'Seek: Go to Time',
			description: 'Seconds from file start.',
			options: [numField('seconds', 'Seconds', '0')],
			callback: async (event, context) => {
				const n = await parseNum(context, event.options.seconds, 'Go to time')
				if (n === null) return
				self.sendOsc('/goto/seconds', [{ type: 'f', value: n }])
			},
		},
		goto_percent: {
			name: 'Seek: Go to Percent',
			options: [numField('percent', 'Percent (0–100)', '50')],
			callback: async (event, context) => {
				const n = await parseNum(context, event.options.percent, 'Go to percent')
				if (n === null) return
				self.sendOsc('/goto/percent', [{ type: 'f', value: n }])
			},
		},
		jump_to_last: {
			name: 'Seek: Go to Last N Seconds',
			description: 'Seeks to N seconds before the end.',
			options: [numField('seconds', 'Seconds', '10')],
			callback: async (event, context) => {
				const n = await parseNum(context, event.options.seconds, 'Go to last N seconds')
				if (n === null) return
				self.sendOsc('/jumptolast', [{ type: 'f', value: n }])
			},
		},
		jump_to_mark: {
			name: 'Seek: Go to Bookmark by Index',
			description: '1-based, in time order.',
			options: [numField('mark', 'Bookmark', '1')],
			callback: async (event, context) => {
				const n = await parseNum(context, event.options.mark, 'Go to bookmark')
				if (n === null) return
				self.sendOsc('/jumptomark', [{ type: 'i', value: Math.round(n) }])
			},
		},

		// ── Trim ─────────────────────────────────────────────────────
		mark_in: {
			name: 'Trim: Set Mark IN at Playhead',
			options: [],
			callback: trigger('/markin'),
		},
		mark_out: {
			name: 'Trim: Set Mark OUT at Playhead',
			options: [],
			callback: trigger('/markout'),
		},
		clear_trim: {
			name: 'Trim: Clear IN/OUT',
			options: [],
			callback: trigger('/cleartrim'),
		},

		// ── Modes & audio ────────────────────────────────────────────
		loop: {
			name: 'Mode: Loop Current Clip',
			description: 'On clears auto-advance.',
			options: [
				{ type: 'dropdown', id: 'mode', label: 'Mode', choices: SET_MODE_CHOICES, default: 'toggle' },
			],
			callback: setOrToggle('/loop'),
		},
		autonext: {
			name: 'Mode: Auto-Advance',
			description: 'Sets the mode directly; also clears Loop.',
			options: [
				{ type: 'dropdown', id: 'mode', label: 'Mode', choices: AUTO_CHOICES, default: 'next' },
			],
			callback: async (event) => {
				const seq = [
					{ cmd: '/loop', args: [{ type: 'i', value: 1 }] },
					{ cmd: '/loop', args: [{ type: 'i', value: 0 }] },
				]
				if (event.options.mode === 'next' || event.options.mode === 'first') {
					seq.push({ cmd: '/autonext', args: [{ type: 'i', value: 1 }] })
				}
				if (event.options.mode === 'first') {
					seq.push({ cmd: '/autonext', args: [{ type: 'i', value: 0 }] })
				}
				self.sendOscSeq(seq)
			},
		},
		volume_adjust: {
			name: 'Audio: Clip Volume ± dB',
			description: 'Nudges the loaded clip’s volume; fractions OK (−60…+20 dB). Rotary-friendly.',
			options: [numField('db', 'dB (±)', '1')],
			callback: async (event, context) => {
				const n = await parseNum(context, event.options.db, 'Clip volume')
				if (n === null) return
				self.sendOsc('/volume/adjust', [{ type: 'f', value: n }])
			},
		},
		mute_all: {
			name: 'Audio: Mute All',
			description: 'Spares channels carrying LTC.',
			options: [
				{ type: 'dropdown', id: 'mode', label: 'Mode', choices: SET_MODE_CHOICES, default: 'toggle' },
			],
			callback: setOrToggle('/muteall'),
		},

		// ── Escape hatch ─────────────────────────────────────────────
		custom: {
			name: 'Send Custom OSC Command',
			description: 'Sent as typed; the prefix is not applied.',
			options: [
				{
					type: 'textinput',
					id: 'address',
					label: 'OSC address',
					default: '/trucue/play',
					useVariables: true,
				},
				{
					type: 'dropdown',
					id: 'argtype',
					label: 'Argument',
					choices: [
						{ id: 'none', label: 'None' },
						{ id: 'int', label: 'Integer' },
						{ id: 'float', label: 'Float' },
						{ id: 'string', label: 'String' },
					],
					default: 'none',
				},
				{
					type: 'textinput',
					id: 'value',
					label: 'Value',
					default: '',
					useVariables: true,
					isVisible: (options) => options.argtype !== 'none',
				},
			],
			callback: async (event, context) => {
				const address = String(await context.parseVariablesInString(String(event.options.address ?? ''))).trim()
				if (!address.startsWith('/')) {
					self.log('warn', `Custom OSC: address "${address}" must start with "/" — not sent`)
					return
				}
				let args = []
				if (event.options.argtype === 'string') {
					const v = String(await context.parseVariablesInString(String(event.options.value ?? '')))
					args = [{ type: 's', value: v }]
				} else if (event.options.argtype === 'int' || event.options.argtype === 'float') {
					const n = await parseNum(context, event.options.value, 'Custom OSC argument')
					if (n === null) return
					args = [{ type: event.options.argtype === 'int' ? 'i' : 'f', value: event.options.argtype === 'int' ? Math.round(n) : n }]
				}
				self.sendOscRaw(address, args)
			},
		},
	}
}
