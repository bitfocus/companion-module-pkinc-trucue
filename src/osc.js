// Minimal OSC 1.0 encoder + UDP client for the TRUCUE Companion module.
//
// TRUCUE's receiver (OSCSender.swift / OSCDecode) is a strict OSC 1.0
// decoder: big-endian, 4-byte aligned, NUL-terminated padded strings.
// We only ever need to SEND messages (no args / one int32 / one float32 /
// one string) and in-order bundles of them — so a dependency-free encoder
// keeps the module pure JS (the `osc` npm package drags in an optional
// native serialport build we don't want in a dev-loaded module).

const dgram = require('dgram')
const dns = require('dns')
const net = require('net')

/** OSC string: UTF-8 bytes + NUL, zero-padded to a 4-byte boundary. */
function oscString(s) {
	const raw = Buffer.from(String(s), 'utf8')
	const len = raw.length + 1 // + NUL
	const padded = Buffer.alloc(Math.ceil(len / 4) * 4) // zero-filled
	raw.copy(padded)
	return padded
}

/**
 * Encode one OSC message.
 * @param {string} address  e.g. '/trucue/play'
 * @param {Array<{type:'i'|'f'|'s', value:any}>} args
 * @returns {Buffer}
 */
function encodeMessage(address, args = []) {
	const parts = [oscString(address), oscString(',' + args.map((a) => a.type).join(''))]
	for (const a of args) {
		switch (a.type) {
			case 'i': {
				const b = Buffer.alloc(4)
				b.writeInt32BE(Math.trunc(a.value))
				parts.push(b)
				break
			}
			case 'f': {
				const b = Buffer.alloc(4)
				b.writeFloatBE(a.value)
				parts.push(b)
				break
			}
			case 's':
				parts.push(oscString(a.value))
				break
			default:
				throw new Error(`Unsupported OSC arg type "${a.type}"`)
		}
	}
	return Buffer.concat(parts)
}

/**
 * Fire-and-forget UDP sender. Resolves the destination host once per
 * configure() (IPv4, like generic-osc does) so per-packet sends carry
 * no DNS cost and failures surface once with a clear status instead of
 * spamming the log on every button press.
 */
class OscUdpClient {
	/**
	 * @param {(level: string, msg: string) => void} log
	 * @param {(ok: boolean, msg?: string) => void} onStatus
	 */
	constructor(log, onStatus) {
		this.log = log
		this.onStatus = onStatus
		this.socket = null
		this.destIp = null
		this.destPort = 0
		this.generation = 0 // guards stale async DNS results after reconfigure
	}

	configure(host, port) {
		const gen = ++this.generation
		this.destIp = null
		this.destPort = port

		if (!this.socket) {
			this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
			this.socket.on('error', (err) => {
				this.log('error', `UDP socket error: ${err.message}`)
			})
		}

		if (net.isIPv4(host)) {
			this.destIp = host
			this.onStatus(true)
			return
		}
		dns.lookup(host, { family: 4 }, (err, address) => {
			if (gen !== this.generation) return // superseded by a newer configure()
			if (err) {
				this.log('error', `Cannot resolve "${host}": ${err.message}`)
				this.onStatus(false, `Cannot resolve "${host}"`)
				return
			}
			this.destIp = address
			this.onStatus(true)
		})
	}

	/** Forget the destination so nothing sends until a valid configure(). */
	clearDestination() {
		this.generation++
		this.destIp = null
		this.destPort = 0
	}

	/** @param {Buffer} packet */
	send(packet) {
		if (!this.socket || !this.destIp || !this.destPort) {
			this.log('warn', 'OSC send skipped — destination not configured/resolved yet')
			return
		}
		this.socket.send(packet, 0, packet.length, this.destPort, this.destIp, (err) => {
			if (err) this.log('error', `OSC send failed: ${err.message}`)
		})
	}

	destroy() {
		this.generation++
		if (this.socket) {
			try {
				this.socket.close()
			} catch (_e) {
				// already closed
			}
			this.socket = null
		}
		this.destIp = null
	}
}

/**
 * Encode an OSC 1.0 bundle with an "immediate" time tag. TRUCUE unpacks
 * bundles recursively, ignores the time tag, and executes the contained
 * messages in order — which lets one UDP packet run a short command
 * sequence atomically (used for absolute shuttle speed and auto-mode).
 * @param {Array<{address: string, args: Array}>} messages
 * @returns {Buffer}
 */
function encodeBundle(messages) {
	const parts = [oscString('#bundle'), Buffer.from([0, 0, 0, 0, 0, 0, 0, 1])]
	for (const m of messages) {
		const enc = encodeMessage(m.address, m.args)
		const size = Buffer.alloc(4)
		size.writeInt32BE(enc.length)
		parts.push(size, enc)
	}
	return Buffer.concat(parts)
}

/**
 * Apply the connection's address prefix to a flat command path.
 * '' → flat ('/play'); 'trucue' or '/trucue' or 'trucue/' → '/trucue/play'.
 * TRUCUE matches case-insensitively and requires the prefix to be
 * followed by '/', which this always produces.
 */
function buildAddress(prefix, cmd) {
	let p = String(prefix ?? '').trim()
	if (p === '') return cmd
	p = p.replace(/^\/+/, '').replace(/\/+$/, '')
	return p === '' ? cmd : `/${p}${cmd}`
}

module.exports = { oscString, encodeMessage, encodeBundle, buildAddress, OscUdpClient }
