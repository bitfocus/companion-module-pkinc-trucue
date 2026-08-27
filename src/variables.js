// Variable definitions + the mapping from a status snapshot to values.

const { fmtCountdown } = require('./status')

function getVariableDefinitions() {
	return [
		{ variableId: 'clip_name', name: 'Current clip name' },
		{ variableId: 'clip_index', name: 'Current clip index (1-based)' },
		{ variableId: 'time_remaining', name: 'Countdown to OUT (m:ss)' },
		{ variableId: 'time_remaining_s', name: 'Countdown to OUT (whole seconds)' },
		{ variableId: 'bookmark_name', name: 'Next bookmark name' },
		{ variableId: 'bookmark_remaining', name: 'Countdown to next bookmark (m:ss)' },
		{ variableId: 'bookmark_remaining_s', name: 'Countdown to next bookmark (whole seconds)' },
	]
}

/** @param {object} st normalized status (see status.js EMPTY_STATUS) */
function variablesForStatus(st) {
	const hasClip = st.clip !== '' || st.index > 0
	const hasBm = st.bmRemaining >= 0
	return {
		clip_name: st.clip,
		clip_index: hasClip && st.index > 0 ? st.index : '',
		time_remaining: hasClip ? fmtCountdown(st.remaining) : '',
		time_remaining_s: hasClip ? Math.ceil(st.remaining) : '',
		bookmark_name: hasBm ? st.bmName : '',
		bookmark_remaining: hasBm ? fmtCountdown(st.bmRemaining) : '',
		bookmark_remaining_s: hasBm ? Math.ceil(st.bmRemaining) : '',
	}
}

module.exports = { getVariableDefinitions, variablesForStatus }
