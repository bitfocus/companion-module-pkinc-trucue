// Config/action migration scripts, run in order when a user upgrades the
// module. Once an entry ships it must NEVER be removed or reordered —
// Companion persists the executed index per connection.
module.exports = [
	// v1.1.0: the feedback listener added `listen` + `feedbackPort`.
	// Pre-1.1 configs get the defaults explicitly so the UI and the
	// runtime agree on them.
	function addFeedbackConfig(_context, props) {
		const result = { updatedConfig: null, updatedActions: [], updatedFeedbacks: [] }
		if (props.config && props.config.listen === undefined) {
			result.updatedConfig = { ...props.config, listen: true, feedbackPort: '9001' }
		}
		return result
	},
	// v1.2.0: default ports moved 8000→8017 and 9001→9017 (TRUCUE b244
	// moved in lockstep). Only the exact old defaults are migrated —
	// deliberately chosen ports are left alone.
	function migrateDefaultPorts(_context, props) {
		const result = { updatedConfig: null, updatedActions: [], updatedFeedbacks: [] }
		if (props.config) {
			const c = { ...props.config }
			let changed = false
			if (String(c.port) === '8000') {
				c.port = '8017'
				changed = true
			}
			if (String(c.feedbackPort) === '9001') {
				c.feedbackPort = '9017'
				changed = true
			}
			if (changed) result.updatedConfig = c
		}
		return result
	},
]
