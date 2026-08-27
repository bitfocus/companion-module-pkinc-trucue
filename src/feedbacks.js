// Boolean feedbacks driven by the TRUCUE status feed.

const { combineRgb } = require('@companion-module/base')

module.exports = function getFeedbackDefinitions(self) {
	return {
		countdown_under: {
			type: 'boolean',
			name: 'Countdown to OUT is under N seconds',
			defaultStyle: { bgcolor: combineRgb(200, 0, 0), color: combineRgb(255, 255, 255) },
			options: [
				{ type: 'number', id: 'seconds', label: 'Seconds', default: 10, min: 0, max: 86400 },
			],
			callback: (feedback) => {
				const st = self.status
				return st.clip !== '' && st.remaining <= Number(feedback.options.seconds)
			},
		},
		bookmark_under: {
			type: 'boolean',
			name: 'Countdown to next bookmark is under N seconds',
			defaultStyle: { bgcolor: combineRgb(170, 110, 0), color: combineRgb(255, 255, 255) },
			options: [
				{ type: 'number', id: 'seconds', label: 'Seconds', default: 5, min: 0, max: 86400 },
			],
			callback: (feedback) => {
				const st = self.status
				return st.bmRemaining >= 0 && st.bmRemaining <= Number(feedback.options.seconds)
			},
		},
	}
}
