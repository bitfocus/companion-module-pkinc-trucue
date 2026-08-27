const { InstanceBase, Regex, runEntrypoint, InstanceStatus } = require('@companion-module/base')
const UpgradeScripts = require('./upgrades')
const getActionDefinitions = require('./actions')
const getFeedbackDefinitions = require('./feedbacks')
const getPresetDefinitions = require('./presets')
const { getVariableDefinitions, variablesForStatus } = require('./variables')
const { EMPTY_STATUS, StatusListener } = require('./status')
const { encodeMessage, encodeBundle, buildAddress, OscUdpClient } = require('./osc')

class TrucueInstance extends InstanceBase {
	async init(config) {
		this.status = { ...EMPTY_STATUS }
		this.playlistNames = []
		this.playlistJSON = ''
		this.sendOk = false
		this.sendErr = null
		this.listenOk = false
		this.listenErr = null

		this.osc = new OscUdpClient(
			(level, msg) => this.log(level, msg),
			(ok, msg) => {
				this.sendOk = ok
				this.sendErr = ok ? null : (msg ?? 'Send socket error')
				this.refreshInstanceStatus()
			},
		)
		this.listener = new StatusListener(
			(level, msg) => this.log(level, msg),
			(st) => {
				this.lastStatusAt = Date.now()
				this.stale = false
				this.applyStatus(st)
			},
			(names) => this.applyPlaylist(names),
			(ok, msg) => {
				this.listenOk = ok
				this.listenErr = ok ? null : (msg ?? 'Feedback listener error')
				this.refreshInstanceStatus()
			},
		)

		// Staleness watchdog: the app heartbeats status every second, so
		// >3.5 s of silence means the feed is gone — blank the variables
		// and release the feedbacks instead of freezing a live-looking
		// (possibly red) countdown on the surface.
		this.lastStatusAt = 0
		this.stale = false
		this.staleTimer = setInterval(() => {
			if (!this.stale && this.lastStatusAt > 0 && Date.now() - this.lastStatusAt > 3500) {
				this.stale = true
				this.log('info', 'TRUCUE status feed stopped — clearing variables')
				this.applyStatus({ ...EMPTY_STATUS })
			}
		}, 1000)

		this.setActionDefinitions(getActionDefinitions(this))
		this.setFeedbackDefinitions(getFeedbackDefinitions(this))
		this.setVariableDefinitions(getVariableDefinitions())
		this.setPresetDefinitions(getPresetDefinitions())
		this.setVariableValues(variablesForStatus(this.status))
		await this.configUpdated(config)
	}

	async destroy() {
		if (this.staleTimer) {
			clearInterval(this.staleTimer)
			this.staleTimer = null
		}
		this.osc?.destroy()
		this.listener?.close()
	}

	get listenEnabled() {
		return this.config?.listen !== false
	}

	async configUpdated(config) {
		this.config = config
		this.listener.close()
		this.listenOk = false
		this.listenErr = null
		this.sendOk = false
		this.sendErr = null
		this.lastStatusAt = 0
		this.stale = false

		// Validate everything BEFORE acting, so a BadConfig verdict can't
		// be overwritten by a late async callback from a partial setup.
		const host = String(config.host ?? '').trim()
		const port = Number(config.port)
		const fp = Number(config.feedbackPort ?? 9001)
		if (host === '' || !Number.isInteger(port) || port < 1 || port > 65535) {
			this.badConfig = 'Host and port are required'
		} else if (this.listenEnabled && (!Number.isInteger(fp) || fp < 1 || fp > 65535)) {
			this.badConfig = 'Feedback port must be 1–65535'
		} else {
			this.badConfig = null
		}
		if (this.badConfig) {
			this.osc.clearDestination() // don't keep firing at the previous destination
			this.updateStatus(InstanceStatus.BadConfig, this.badConfig)
			return
		}

		this.updateStatus(InstanceStatus.Connecting)
		this.osc.configure(host, port)
		if (this.listenEnabled) {
			this.listener.open(fp)
		} else {
			// Listening off: clear stale state so buttons don't show old data.
			this.applyStatus({ ...EMPTY_STATUS })
		}
	}

	/** Roll the send + listen halves up into one instance status. */
	refreshInstanceStatus() {
		if (this.badConfig) {
			this.updateStatus(InstanceStatus.BadConfig, this.badConfig)
		} else if (!this.sendOk) {
			if (this.sendErr) this.updateStatus(InstanceStatus.ConnectionFailure, this.sendErr)
			else this.updateStatus(InstanceStatus.Connecting)
		} else if (this.listenEnabled && !this.listenOk) {
			if (this.listenErr) this.updateStatus(InstanceStatus.ConnectionFailure, this.listenErr)
			else this.updateStatus(InstanceStatus.Connecting)
		} else {
			this.updateStatus(InstanceStatus.Ok)
		}
	}

	/** New status snapshot from TRUCUE → variables + feedbacks. */
	applyStatus(st) {
		this.status = st
		this.setVariableValues(variablesForStatus(st))
		this.checkFeedbacks('countdown_under', 'bookmark_under')
	}

	/** New playlist listing → refresh the Load Clip dropdown (event-driven). */
	applyPlaylist(names) {
		const json = JSON.stringify(names)
		if (json === this.playlistJSON) return
		this.playlistJSON = json
		this.playlistNames = names
		this.setActionDefinitions(getActionDefinitions(this))
	}

	getConfigFields() {
		return [
			{
				type: 'static-text',
				id: 'info',
				width: 12,
				label: 'TRUCUE setup',
				value:
					'Enable OSC remote control in TRUCUE (Settings → OSC) and match the port and prefix below. ' +
					'For variables, countdowns and the Load Clip list, also enable "Companion feedback" there ' +
					'and match the feedback port.',
			},
			{
				type: 'textinput',
				id: 'host',
				label: 'TRUCUE Hostname or IP',
				tooltip: 'Use 127.0.0.1 when Companion runs on the same Mac.',
				width: 8,
				regex: Regex.HOSTNAME,
				default: '127.0.0.1',
				required: true,
			},
			{
				type: 'textinput',
				id: 'port',
				label: 'UDP Port',
				width: 4,
				regex: Regex.PORT,
				default: '8000',
				required: true,
			},
			{
				type: 'textinput',
				id: 'prefix',
				label: 'Address prefix',
				tooltip: "Must match TRUCUE's Address prefix.",
				width: 4,
				default: 'trucue',
			},
			{
				type: 'checkbox',
				id: 'listen',
				label: 'Enable feedback',
				tooltip: 'Listen for TRUCUE status: variables, countdowns, playlist.',
				width: 4,
				default: true,
			},
			{
				type: 'textinput',
				id: 'feedbackPort',
				label: 'Feedback port',
				tooltip: "Must match TRUCUE's Companion feedback port.",
				width: 4,
				regex: Regex.PORT,
				default: '9001',
				isVisible: (options) => options.listen !== false,
				isVisibleExpression: '$(options:listen) !== false',
			},
		]
	}

	/** Send a TRUCUE command (prefix applied). */
	sendOsc(cmd, args) {
		this.sendOscRaw(buildAddress(this.config?.prefix, cmd), args)
	}

	/**
	 * Send a sequence of TRUCUE commands as one OSC bundle (prefix
	 * applied to each). TRUCUE executes bundle contents in order.
	 * @param {Array<{cmd: string, args: Array}>} seq
	 */
	sendOscSeq(seq) {
		const messages = seq.map(({ cmd, args }) => ({ address: buildAddress(this.config?.prefix, cmd), args }))
		let packet
		try {
			packet = encodeBundle(messages)
		} catch (err) {
			this.log('error', `OSC bundle encode failed: ${err.message}`)
			return
		}
		this.log('debug', `OSC → bundle: ${messages.map((m) => m.address).join(' ')}`)
		this.osc.send(packet)
	}

	/** Send any OSC message verbatim (no prefix). */
	sendOscRaw(address, args) {
		let packet
		try {
			packet = encodeMessage(address, args)
		} catch (err) {
			this.log('error', `OSC encode failed for ${address}: ${err.message}`)
			return
		}
		this.log('debug', `OSC → ${address}${args.length ? ' ' + args.map((a) => `${a.type}:${a.value}`).join(' ') : ''}`)
		this.osc.send(packet)
	}
}

runEntrypoint(TrucueInstance, UpgradeScripts)
