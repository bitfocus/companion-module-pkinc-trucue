// Inbound status feed from TRUCUE (Settings → OSC → Companion feedback).
// The app sends single-string-arg OSC messages on FIXED addresses,
// independent of the command prefix:
//   /trucue/status           {"clip","index","remaining","playing","bmName","bmRemaining"}
//   /trucue/status/playlist  ["Clip 1","Clip 2",...]   (clips-only, /load/index order)
// ~10 Hz while values change, ~1 Hz heartbeat when idle, playlist every
// 5 s / on change.

const dgram = require('dgram')
const { decodePacket } = require('./osc')

const EMPTY_STATUS = Object.freeze({
	clip: '',
	index: 0,
	remaining: 0,
	playing: 0,
	next: '',
	prev: '',
	vol: null, // dB of the loaded clip; null = unknown/none
	bmName: '',
	bmRemaining: -1, // -1 = no bookmark ahead
})

/** Ceil to whole seconds, "h:mm:ss" above an hour, else "m:ss". '' for no value. */
function fmtCountdown(secs) {
	if (!Number.isFinite(secs) || secs < 0) return ''
	const t = Math.ceil(secs)
	const two = (n) => String(n).padStart(2, '0')
	const h = Math.floor(t / 3600)
	const m = Math.floor((t % 3600) / 60)
	const s = t % 60
	return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`
}

/** Parse the /trucue/status JSON payload into a normalized object, or null. */
function parseStatusPayload(json) {
	let o
	try {
		o = JSON.parse(json)
	} catch (_e) {
		return null
	}
	if (typeof o !== 'object' || o === null || Array.isArray(o)) return null
	const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d)
	return {
		clip: typeof o.clip === 'string' ? o.clip : '',
		index: Math.max(0, Math.round(num(o.index, 0))),
		remaining: Math.max(0, num(o.remaining, 0)),
		playing: num(o.playing, 0) ? 1 : 0,
		next: typeof o.next === 'string' ? o.next : '',
		prev: typeof o.prev === 'string' ? o.prev : '',
		vol: o.vol === undefined ? null : num(o.vol, 0),
		bmName: typeof o.bmName === 'string' ? o.bmName : '',
		bmRemaining: o.bmRemaining === undefined ? -1 : Math.max(0, num(o.bmRemaining, 0)),
	}
}

/** Parse the /trucue/status/playlist JSON payload into a names array, or null. */
function parsePlaylistPayload(json) {
	let a
	try {
		a = JSON.parse(json)
	} catch (_e) {
		return null
	}
	if (!Array.isArray(a)) return null
	return a.map((n) => String(n ?? ''))
}

/**
 * Decode one UDP packet and extract whatever status it carries.
 * @param {Buffer} buf
 * @returns {{status: object|null, playlist: string[]|null}}
 */
function parseStatusPacket(buf) {
	const out = { status: null, playlist: null }
	let msgs
	try {
		msgs = decodePacket(buf)
	} catch (_e) {
		return out
	}
	for (const msg of msgs) {
		const s = msg.args[0] && msg.args[0].type === 's' ? msg.args[0].value : null
		if (s === null) continue
		const addr = msg.address.toLowerCase()
		if (addr === '/trucue/status') {
			const st = parseStatusPayload(s)
			if (st) out.status = st
		} else if (addr === '/trucue/status/playlist') {
			const pl = parsePlaylistPayload(s)
			if (pl) out.playlist = pl
		}
	}
	return out
}

/** UDP listener for the status feed. */
class StatusListener {
	/**
	 * @param {(level: string, msg: string) => void} log
	 * @param {(status: object) => void} onStatus
	 * @param {(names: string[]) => void} onPlaylist
	 * @param {(ok: boolean, msg?: string) => void} onState
	 */
	constructor(log, onStatus, onPlaylist, onState) {
		this.log = log
		this.onStatus = onStatus
		this.onPlaylist = onPlaylist
		this.onState = onState
		this.socket = null
	}

	open(port) {
		this.close()
		// No reuseAddr: a port conflict (e.g. two connections on 9001)
		// must surface as a bind error, not silently receive nothing.
		const sock = dgram.createSocket({ type: 'udp4' })
		this.socket = sock
		sock.on('error', (err) => {
			this.log('error', `Feedback listener error: ${err.message}`)
			this.onState(false, `Feedback listener: ${err.message}`)
			try {
				sock.close()
			} catch (_e) {
				// already closed
			}
			if (this.socket === sock) this.socket = null
		})
		sock.on('message', (buf) => {
			const { status, playlist } = parseStatusPacket(buf)
			if (status) this.onStatus(status)
			if (playlist) this.onPlaylist(playlist)
		})
		sock.bind({ address: '0.0.0.0', port }, () => {
			this.log('info', `Listening for TRUCUE status on UDP ${port}`)
			this.onState(true)
		})
	}

	close() {
		if (this.socket) {
			try {
				this.socket.close()
			} catch (_e) {
				// already closed
			}
			this.socket = null
		}
	}
}

module.exports = { EMPTY_STATUS, fmtCountdown, parseStatusPayload, parsePlaylistPayload, parseStatusPacket, StatusListener }
