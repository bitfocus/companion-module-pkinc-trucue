// Ready-made buttons, grouped by category in Companion's preset browser.
// Preset option objects must supply every option id the target action reads.

const { combineRgb } = require('@companion-module/base')

const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)
const GREEN = combineRgb(0, 110, 0)
const AMBER = combineRgb(150, 100, 0)
const GRAY = combineRgb(45, 45, 45)
const BLUE = combineRgb(0, 60, 120)
const PURPLE = combineRgb(80, 40, 110)
const TEAL = combineRgb(0, 90, 90)
const RED = combineRgb(120, 0, 0)

module.exports = function getPresetDefinitions() {
	const presets = {}

	const button = (key, category, text, bgcolor, actionId, options = {}, size = '14') => {
		presets[key] = {
			type: 'button',
			category,
			name: text.replace(/\n/g, ' '),
			style: { text, size, color: WHITE, bgcolor },
			steps: [{ down: [{ actionId, options }], up: [] }],
			feedbacks: [],
		}
	}

	// Display-only button: no action, driven by variables + feedbacks.
	// The $(pkinc-trucue:...) prefix is rewritten by Companion to the
	// actual connection label when the preset is applied.
	const display = (key, category, name, text, bgcolor, feedbacks = []) => {
		presets[key] = {
			type: 'button',
			category,
			name,
			style: { text, size: '14', color: WHITE, bgcolor },
			steps: [{ down: [], up: [] }],
			feedbacks,
		}
	}

	// ── Transport ────────────────────────────────────────────────────
	button('play', 'Transport', 'PLAY', GREEN, 'play', {}, '18')
	button('pause', 'Transport', 'PAUSE', AMBER, 'pause', {}, '18')
	button('play_pause', 'Transport', 'PLAY\nPAUSE', GRAY, 'play_pause', {})
	for (const s of [2, 8, 32]) {
		button(`rw_${s}`, 'Transport', `◀◀\n−${s}×`, GRAY, 'rewind', { speed: String(s) })
		button(`ff_${s}`, 'Transport', `▶▶\n${s}×`, GRAY, 'ff', { speed: String(s) })
	}
	button('jump_to_start', 'Transport', 'TO\nSTART', GRAY, 'jump_to_start', {})
	button('jump_to_end', 'Transport', 'TO\nEND', GRAY, 'jump_to_end', {})

	// ── Playlist ─────────────────────────────────────────────────────
	button('clip_prev', 'Playlist', '◀ PREV\nCLIP', BLUE, 'clip_prev', {})
	button('clip_next', 'Playlist', 'NEXT ▶\nCLIP', BLUE, 'clip_next', {})
	button('select_prev', 'Playlist', 'SEL ▲', BLUE, 'select_prev', {})
	button('select_next', 'Playlist', 'SEL ▼', BLUE, 'select_next', {})
	button('load_selected', 'Playlist', 'LOAD\nSEL', BLUE, 'load_selected', {})
	button('load_index_1', 'Playlist', 'LOAD\nINDEX 1', BLUE, 'load_index', { index: '1' })
	button('load_name', 'Playlist', 'LOAD BY\nNAME', BLUE, 'load_name', { name: '' })

	// ── Seek ─────────────────────────────────────────────────────────
	for (const s of [5, 10, 15, 30]) {
		button(`jog_back_${s}`, 'Seek', `−${s}s`, GRAY, 'jump', { seconds: String(-s) })
		button(`jog_fwd_${s}`, 'Seek', `+${s}s`, GRAY, 'jump', { seconds: String(s) })
	}
	for (const s of [10, 20, 30]) {
		button(`last_${s}`, 'Seek', `LAST\n${s}s`, PURPLE, 'jump_to_last', { seconds: String(s) })
	}
	for (const p of [0, 25, 50, 75]) {
		button(`pct_${p}`, 'Seek', `${p}%`, PURPLE, 'goto_percent', { percent: String(p) })
	}
	for (const m of [1, 2, 3]) {
		button(`mark_${m}`, 'Seek', `BOOK\nMARK ${m}`, PURPLE, 'jump_to_mark', { mark: String(m) })
	}

	// ── Trim ─────────────────────────────────────────────────────────
	button('mark_in', 'Trim', 'MARK\nIN', TEAL, 'mark_in', {})
	button('mark_out', 'Trim', 'MARK\nOUT', TEAL, 'mark_out', {})
	button('clear_trim', 'Trim', 'CLEAR\nTRIM', TEAL, 'clear_trim', {})

	// ── Modes & Audio ────────────────────────────────────────────────
	button('loop_toggle', 'Modes & Audio', 'LOOP', GRAY, 'loop', { mode: 'toggle' })
	button('loop_on', 'Modes & Audio', 'LOOP\nON', GRAY, 'loop', { mode: 'on' })
	button('loop_off', 'Modes & Audio', 'LOOP\nOFF', GRAY, 'loop', { mode: 'off' })
	button('auto_off', 'Modes & Audio', 'AUTO\nOFF', GRAY, 'autonext', { mode: 'off' })
	button('auto_next', 'Modes & Audio', 'AUTO\nNEXT', GRAY, 'autonext', { mode: 'next' })
	button('auto_first', 'Modes & Audio', 'AUTO\nFIRST', GRAY, 'autonext', { mode: 'first' })
	button('mute_all', 'Modes & Audio', 'MUTE\nALL', RED, 'mute_all', { mode: 'toggle' })
	button('vol_down', 'Modes & Audio', 'VOL\n−1 dB', GRAY, 'volume_adjust', { db: '-1' })
	button('vol_up', 'Modes & Audio', 'VOL\n+1 dB', GRAY, 'volume_adjust', { db: '1' })
	// Rotary (Stream Deck + dial): turn = ±1 dB, display shows live level.
	presets['volume_knob'] = {
		type: 'button',
		category: 'Modes & Audio',
		name: 'Volume knob (rotary ±1 dB)',
		style: { text: 'VOL\n$(pkinc-trucue:clip_volume)', size: '14', color: WHITE, bgcolor: GRAY },
		options: { rotaryActions: true },
		steps: [
			{
				down: [],
				up: [],
				rotate_left: [{ actionId: 'volume_adjust', options: { db: '-1' } }],
				rotate_right: [{ actionId: 'volume_adjust', options: { db: '1' } }],
			},
		],
		feedbacks: [],
	}

	// ── Status & Countdown (needs feedback enabled in TRUCUE) ────────
	display('status_countdown', 'Status & Countdown', 'Countdown to OUT',
		'OUT\n$(pkinc-trucue:time_remaining)', BLACK,
		[{ feedbackId: 'countdown_under', options: { seconds: 10 },
			style: { bgcolor: combineRgb(200, 0, 0), color: WHITE } }])
	display('status_bookmark', 'Status & Countdown', 'Countdown to next bookmark',
		'$(pkinc-trucue:bookmark_name)\n$(pkinc-trucue:bookmark_remaining)', BLACK,
		[{ feedbackId: 'bookmark_under', options: { seconds: 5 },
			style: { bgcolor: combineRgb(170, 110, 0), color: WHITE } }])
	display('status_now_playing', 'Status & Countdown', 'Current clip',
		'$(pkinc-trucue:clip_index): $(pkinc-trucue:clip_name)', combineRgb(20, 20, 60))

	return presets
}
