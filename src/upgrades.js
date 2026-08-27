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
]
