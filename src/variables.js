// Variable definitions + the mapping from a status snapshot to values.

const { fmtCountdown } = require('./status')

function getVariableDefinitions() {
	return [
		{ variableId: 'clip_name', name: 'Current clip name' },
		{ variableId: 'clip_index', name: 'Current clip index (1-based)' },
		{ variableId: 'next_clip_name', name: 'Next clip name' },
		{ variableId: 'prev_clip_name', name: 'Previous clip name' },
		{ variableId: 'clip_volume', name: 'Current clip volume (dB)' },
		{ variableId: 'time_remaining', name: 'Countdown to OUT (m:ss)' },
		{ variableId: 'time_remaining_s', name: 'Countdown to OUT (whole seconds)' },
		{ variableId: 'bookmark_name', name: 'Next bookmark name' },
		{ variableId: 'bookmark_remaining', name: 'Countdown to next bookmark (m:ss)' },
		{ variableId: 'bookmark_remaining_s', name: 'Countdown to next bookmark (whole seconds)' },
	]
}

/** "-3.5 dB" / "0 dB" / "+2 dB" — whole numbers drop the decimal. */
function fmtDb(v) {
	const n = Number.isInteger(v) ? String(v) : v.toFixed(1)
	return (v > 0 ? '+' + n : n) + ' dB'
}

/** @param {object} st normalized status (see status.js EMPTY_STATUS) */
function variablesForStatus(st) {
	const hasClip = st.clip !== '' || st.index > 0
	const hasBm = st.bmRemaining >= 0
	return {
		clip_name: st.clip,
		clip_index: hasClip && st.index > 0 ? st.index : '',
		next_clip_name: st.next,
		prev_clip_name: st.prev,
		clip_volume: hasClip && st.vol !== null ? fmtDb(st.vol) : '',
		time_remaining: hasClip ? fmtCountdown(st.remaining) : '',
		time_remaining_s: hasClip ? Math.ceil(st.remaining) : '',
		bookmark_name: hasBm ? st.bmName : '',
		bookmark_remaining: hasBm ? fmtCountdown(st.bmRemaining) : '',
		bookmark_remaining_s: hasBm ? Math.ceil(st.bmRemaining) : '',
	}
}

module.exports = { getVariableDefinitions, variablesForStatus, fmtDb }
