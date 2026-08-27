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

	return presets
}
