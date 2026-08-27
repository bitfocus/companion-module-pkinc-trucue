const { InstanceBase, Regex, runEntrypoint, InstanceStatus } = require('@companion-module/base')
const UpgradeScripts = require('./upgrades')
const getActionDefinitions = require('./actions')
const getPresetDefinitions = require('./presets')
const { encodeMessage, encodeBundle, buildAddress, OscUdpClient } = require('./osc')

class TrucueInstance extends InstanceBase {
	async init(config) {
		this.osc = new OscUdpClient(
			(level, msg) => this.log(level, msg),
			(ok, msg) => this.updateStatus(ok ? InstanceStatus.Ok : InstanceStatus.ConnectionFailure, msg ?? null),
		)
		this.setActionDefinitions(getActionDefinitions(this))
		this.setPresetDefinitions(getPresetDefinitions())
		await this.configUpdated(config)
	}

	async destroy() {
		this.osc?.destroy()
	}

	async configUpdated(config) {
		this.config = config
		const host = String(config.host ?? '').trim()
		const port = Number(config.port)
		if (host === '' || !Number.isInteger(port) || port < 1 || port > 65535) {
			this.osc.clearDestination() // don't keep firing at the previous destination
			this.updateStatus(InstanceStatus.BadConfig, 'Host and port are required')
			return
		}
		this.updateStatus(InstanceStatus.Connecting)
		this.osc.configure(host, port)
	}

	getConfigFields() {
		return [
			{
				type: 'static-text',
				id: 'info',
				width: 12,
				label: 'TRUCUE setup',
				value: 'Enable OSC remote control in TRUCUE (Settings → OSC) and match the port and prefix below.',
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
