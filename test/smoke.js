#!/usr/bin/env node
// Offline verification of the module against TRUCUE's actual OSC receiver
// behavior. The decoder + command mapper below are a line-for-line port of
// the app's Swift OSCDecode / OSCCommand.from (ControlNook/OSCSender.swift),
// so every action is round-tripped through exactly what the app will do
// with the packet: encode → decode (incl. bundles) → prefix match → map.
// Sequence actions (shuttle, auto-advance) are additionally run through a
// simulation of the app's state machines from every possible start state.
//
// Run: node test/smoke.js   (no Companion, no network needed)

const assert = require('node:assert/strict')
const { oscString, encodeMessage, encodeBundle, buildAddress } = require('../src/osc')
const getActionDefinitions = require('../src/actions')
const getPresetDefinitions = require('../src/presets')

let checks = 0
function ok(cond, msg) {
	checks++
	assert.ok(cond, msg)
}
function eq(a, b, msg) {
	checks++
	assert.deepEqual(a, b, msg)
}

// ── Port of TRUCUE's OSCDecode (strict OSC 1.0, big-endian, 4-aligned) ──
function readOscString(buf, off) {
	let end = off
	while (end < buf.length && buf[end] !== 0) end++
	if (end >= buf.length) throw new Error('unterminated OSC string')
	return { s: buf.toString('utf8', off, end), off: off + ((end - off + 1 + 3) & ~3) }
}

function decodeMessage(buf) {
	let r = readOscString(buf, 0)
	const address = r.s
	let off = r.off
	if (!address.startsWith('/')) throw new Error('address must start with /')
	r = readOscString(buf, off)
	const tags = r.s
	off = r.off
	if (!tags.startsWith(',')) throw new Error('missing type tag string')
	const args = []
	for (const t of tags.slice(1)) {
		if (t === 'i') {
			args.push({ type: 'i', value: buf.readInt32BE(off) })
			off += 4
		} else if (t === 'f') {
			args.push({ type: 'f', value: buf.readFloatBE(off) })
			off += 4
		} else if (t === 's') {
			r = readOscString(buf, off)
			args.push({ type: 's', value: r.s })
			off = r.off
		} else {
			throw new Error(`unexpected type tag "${t}"`)
		}
	}
	if (off !== buf.length) throw new Error(`trailing bytes: ${buf.length - off}`)
	return { address, args }
}

// Mirrors OSCDecode.packet/bundle: '#' → bundle (skip 8-byte time tag,
// int32-sized sub-packets in order), else single message.
function decodePacket(buf) {
	if (buf.length && buf[0] === 0x23) {
		let r = readOscString(buf, 0)
		if (r.s !== '#bundle') throw new Error('bad bundle header')
		let off = r.off + 8
		const out = []
		while (off + 4 <= buf.length) {
			const size = buf.readInt32BE(off)
			off += 4
			if (size <= 0 || off + size > buf.length) break
			out.push(...decodePacket(buf.subarray(off, off + size)))
			off += size
		}
		return out
	}
	return [decodeMessage(buf)]
}

// ── Port of TRUCUE's OSCCommand.from (prefix + trigger-zero rules) ──────
const TRIGGERS = new Set([
	'/play', '/pause', '/playpause', '/ff', '/rewind', '/jumptostart', '/jumptoend',
	'/markin', '/markout', '/cleartrim', '/select/next', '/select/prev', '/load',
	'/clip/next', '/clip/prev',
])
function mapCommand(msg, prefix) {
	let addr = msg.address.toLowerCase()
	const p = prefix.trim().toLowerCase()
	if (p !== '') {
		const pfx = p.startsWith('/') ? p : '/' + p
		if (!addr.startsWith(pfx + '/')) return null
		addr = addr.slice(pfx.length)
	}
	const first = msg.args[0]
	const num = first && (first.type === 'i' || first.type === 'f') ? first.value : undefined
	if (TRIGGERS.has(addr)) {
		if (num === 0) return null // app swallows explicit 0 as button-release
		return { cmd: addr }
	}
	switch (addr) {
		case '/loop':
		case '/autonext':
		case '/muteall':
			return { cmd: addr, value: num === undefined ? 'toggle' : num !== 0 }
		case '/load/name': {
			const s = first && first.type === 's' ? first.value : ''
			return s ? { cmd: addr, value: s } : null
		}
		case '/load/index':
		case '/jumptomark':
			return num === undefined ? null : { cmd: addr, value: Math.round(num) }
		case '/jumptolast':
		case '/jump':
		case '/goto/seconds':
		case '/goto/percent':
			return num === undefined ? null : { cmd: addr, value: num }
		default:
			return null
	}
}

// ── Simulation of the app's mode + shuttle state machines ───────────────
// Loop/auto (PlaylistView oscSetLoop / oscSetAutoNext / toggleAutoNext):
// setting Loop on clears auto; the 3-state auto cycle is off→next→first→off,
// fired only when the arg differs from autoplayNext (true only in 'next');
// landing on an auto mode clears Loop.
function applyModeCmd(state, m) {
	if (m.cmd === '/loop') {
		const v = m.value === 'toggle' ? !state.loop : m.value
		if (v !== state.loop) {
			state.loop = v
			if (v) state.auto = 'off'
		}
	} else if (m.cmd === '/autonext') {
		const cur = state.auto === 'next'
		const v = m.value === 'toggle' ? !cur : m.value
		if (v !== cur) {
			state.auto = state.auto === 'off' ? 'next' : state.auto === 'next' ? 'first' : 'off'
			if (state.auto !== 'off') state.loop = false
		}
	}
}
// Shuttle ladder (handleOSCCommand ff/rewind/play/pause): ff from
// non-forward-shuttle → 2×, then ×2 up to 32× then back to 1× play;
// rewind from non-reverse → −2×, then ×2 down to −32× then wraps to −2×.
function applyTransportCmd(state, m) {
	if (m.cmd === '/pause') {
		state.mode = 'pause'
	} else if (m.cmd === '/play') {
		state.mode = 'play'
	} else if (m.cmd === '/ff') {
		if (state.mode === 'ff') {
			if (state.rate === 32) state.mode = 'play'
			else state.rate *= 2
		} else {
			state.mode = 'ff'
			state.rate = 2
		}
	} else if (m.cmd === '/rewind') {
		if (state.mode === 'rw') {
			state.rate = state.rate === -32 ? -2 : state.rate * 2
		} else {
			state.mode = 'rw'
			state.rate = -2
		}
	}
}

// ── 1. Encoder golden bytes ─────────────────────────────────────────────
// '/play' = 5 bytes + NUL = 6 → zero-padded to 8
eq(oscString('/play').toString('hex'), '2f706c6179000000', 'oscString NUL-terminates and pads')
eq(oscString('/play').length, 8, 'oscString pads to 4-byte boundary')
eq(
	encodeMessage('/trucue/play', []).toString('hex'),
	Buffer.concat([oscString('/trucue/play'), oscString(',')]).toString('hex'),
	'no-arg message = address + bare type tag',
)
eq(encodeMessage('/trucue/play', []).length, 20, 'no-arg /trucue/play is 20 bytes')
{
	const b = encodeMessage('/a', [{ type: 'i', value: 3 }])
	eq(b.toString('hex'), '2f610000' + '2c690000' + '00000003', 'int32 big-endian')
}
{
	const b = encodeMessage('/a', [{ type: 'f', value: 1.5 }])
	eq(b.toString('hex'), '2f610000' + '2c660000' + '3fc00000', 'float32 big-endian')
}
{
	const b = encodeMessage('/a', [{ type: 's', value: 'Intro' }])
	eq(b.toString('hex'), '2f610000' + '2c730000' + '496e74726f000000', 'padded string arg')
}
{
	const msgs = [{ address: '/a', args: [] }, { address: '/b', args: [{ type: 'i', value: 7 }] }]
	const decoded = decodePacket(encodeBundle(msgs))
	eq(decoded.map((m) => m.address), ['/a', '/b'], 'bundle round-trips in order')
	eq(decoded[1].args, [{ type: 'i', value: 7 }], 'bundle preserves args')
}

// ── 2. buildAddress prefix handling ─────────────────────────────────────
eq(buildAddress('trucue', '/play'), '/trucue/play', undefined)
eq(buildAddress('/trucue', '/play'), '/trucue/play', 'leading slash tolerated')
eq(buildAddress('trucue/', '/play'), '/trucue/play', 'trailing slash tolerated')
eq(buildAddress(' trucue ', '/play'), '/trucue/play', 'whitespace trimmed')
eq(buildAddress('', '/play'), '/play', 'empty prefix = flat address')
eq(buildAddress(undefined, '/play'), '/play', 'missing prefix = flat address')
eq(buildAddress('///', '/play'), '/play', 'slash-only prefix = flat address')

// ── 3. Every action, round-tripped through the app's decode + map ───────
const sent = [] // { kind: 'cmd'|'raw'|'seq', packet: Buffer }
const logs = []
const self = {
	sendOsc: (cmd, args) => sent.push({ kind: 'cmd', packet: encodeMessage(buildAddress('trucue', cmd), args), args }),
	sendOscRaw: (address, args) => sent.push({ kind: 'raw', packet: encodeMessage(address, args), args }),
	sendOscSeq: (seq) =>
		sent.push({
			kind: 'seq',
			packet: encodeBundle(seq.map(({ cmd, args }) => ({ address: buildAddress('trucue', cmd), args }))),
		}),
	log: (level, msg) => logs.push({ level, msg }),
}
const context = { parseVariablesInString: async (s) => s }
const actions = getActionDefinitions(self)

async function run(actionId, options = {}) {
	sent.length = 0
	logs.length = 0
	ok(actions[actionId], `action "${actionId}" exists`)
	await actions[actionId].callback({ actionId, options }, context)
	return sent[0] ?? null
}
// Run an action and return what the app would map it to: a list of
// {cmd, value} (single messages give a 1-element list).
async function mappedList(actionId, options) {
	const out = await run(actionId, options)
	ok(out, `${actionId}: sent a packet`)
	return decodePacket(out.packet).map((msg) => {
		const m = mapCommand(msg, 'trucue')
		ok(m, `${actionId}: app maps ${msg.address} (got null)`)
		return m
	})
}
async function expectMapped(actionId, options, expectCmd, expectValue) {
	const list = await mappedList(actionId, options)
	eq(list.length, 1, `${actionId}: single message`)
	eq(list[0].cmd, expectCmd, `${actionId}: maps to ${expectCmd}`)
	if (expectValue !== undefined) {
		if (typeof expectValue === 'number' && !Number.isInteger(expectValue)) {
			ok(Math.abs(list[0].value - expectValue) < 1e-4, `${actionId}: value ≈ ${expectValue} (got ${list[0].value})`)
		} else {
			eq(list[0].value, expectValue, `${actionId}: value = ${expectValue}`)
		}
	}
	return sent[0]
}

const main = async () => {
	// Triggers: must send ZERO args (an explicit 0 would be swallowed by the app)
	const triggerActions = {
		play: '/play', pause: '/pause', play_pause: '/playpause',
		jump_to_start: '/jumptostart', jump_to_end: '/jumptoend', mark_in: '/markin',
		mark_out: '/markout', clear_trim: '/cleartrim', select_next: '/select/next',
		select_prev: '/select/prev', load_selected: '/load', clip_next: '/clip/next',
		clip_prev: '/clip/prev',
	}
	for (const [actionId, cmd] of Object.entries(triggerActions)) {
		const pkt = await expectMapped(actionId, {}, cmd)
		eq(pkt.args.length, 0, `${actionId}: trigger sends no arguments`)
	}

	// Valued commands
	await expectMapped('load_index', { index: '3' }, '/load/index', 3)
	await expectMapped('load_index', { index: '2.6' }, '/load/index', 3) // rounds like the app
	await expectMapped('load_name', { name: '  Intro Video ' }, '/load/name', 'Intro Video')
	await expectMapped('jump', { seconds: '-10' }, '/jump', -10)
	await expectMapped('jump', { seconds: '2.5' }, '/jump', 2.5)
	await expectMapped('goto_seconds', { seconds: '90' }, '/goto/seconds', 90)
	await expectMapped('goto_percent', { percent: '50.5' }, '/goto/percent', 50.5)
	await expectMapped('jump_to_last', { seconds: '10' }, '/jumptolast', 10)
	await expectMapped('jump_to_mark', { mark: '2' }, '/jumptomark', 2)

	// Toggle/set commands
	for (const [actionId, cmd] of [['loop', '/loop'], ['mute_all', '/muteall']]) {
		const pkt = await expectMapped(actionId, { mode: 'toggle' }, cmd, 'toggle')
		eq(pkt.args.length, 0, `${actionId} toggle sends no args`)
		await expectMapped(actionId, { mode: 'on' }, cmd, true)
		await expectMapped(actionId, { mode: 'off' }, cmd, false)
	}

	// Auto-Advance: bundle sequence must land on the selected mode from
	// EVERY valid start state (loop and auto are mutually exclusive).
	const modeStarts = [
		{ loop: false, auto: 'off' }, { loop: true, auto: 'off' },
		{ loop: false, auto: 'next' }, { loop: false, auto: 'first' },
	]
	for (const target of ['off', 'next', 'first']) {
		const list = await mappedList('autonext', { mode: target })
		for (const start of modeStarts) {
			const state = { ...start }
			for (const m of list) applyModeCmd(state, m)
			eq(state.auto, target, `autonext ${target} from ${JSON.stringify(start)} → auto=${target}`)
			eq(state.loop, false, `autonext ${target} from ${JSON.stringify(start)} → loop off`)
		}
	}

	// Fast Forward / Rewind: sequence must land on the selected speed from
	// EVERY start state (paused, playing, any forward or reverse rate).
	const shuttleStarts = [{ mode: 'pause', rate: 0 }, { mode: 'play', rate: 1 }]
	for (const r of [2, 4, 8, 16, 32]) shuttleStarts.push({ mode: 'ff', rate: r }, { mode: 'rw', rate: -r })
	const shuttleActions = [
		['ff', 'ff', 1, '/play'], // actionId, expected sim mode, rate sign, normalizer
		['rewind', 'rw', -1, '/pause'],
	]
	for (const [actionId, wantMode, sign, normalizer] of shuttleActions) {
		for (const speed of ['off', '2', '4', '8', '16', '32']) {
			const list = await mappedList(actionId, { speed })
			if (speed !== 'off') {
				eq(list[0].cmd, normalizer, `${actionId} ${speed} normalizes with ${normalizer}`)
				// Regression guard: /ff right after /pause races the app's
				// async pause and lands paused — FF must never send /pause.
				if (actionId === 'ff') {
					ok(!list.some((m) => m.cmd === '/pause'), `ff ${speed} sequence contains no /pause`)
				}
			}
			for (const start of shuttleStarts) {
				const state = { ...start }
				for (const m of list) applyTransportCmd(state, m)
				if (speed === 'off') {
					eq(state.mode, 'pause', `${actionId} off from ${JSON.stringify(start)} → pause`)
				} else {
					eq(state.mode, wantMode, `${actionId} ${speed} from ${JSON.stringify(start)} → mode ${wantMode}`)
					eq(state.rate, sign * Number(speed), `${actionId} ${speed} from ${JSON.stringify(start)} → rate ${sign * Number(speed)}`)
				}
			}
		}
	}

	// Custom command (raw, prefix as typed)
	{
		const pkt = await run('custom', { address: '/trucue/play', argtype: 'none', value: '' })
		eq(pkt.kind, 'raw', 'custom sends raw')
		eq(mapCommand(decodePacket(pkt.packet)[0], 'trucue').cmd, '/play', 'custom default reaches /play')
		const pi = await run('custom', { address: '/trucue/load/index', argtype: 'int', value: '4' })
		eq(pi.args, [{ type: 'i', value: 4 }], 'custom int arg')
		const pf = await run('custom', { address: '/x', argtype: 'float', value: '1.5' })
		eq(pf.args, [{ type: 'f', value: 1.5 }], 'custom float arg')
		const ps = await run('custom', { address: '/x', argtype: 'string', value: 'hi' })
		eq(ps.args, [{ type: 's', value: 'hi' }], 'custom string arg')
	}

	// Invalid input → skipped with a warning, nothing sent
	for (const [actionId, options] of [
		['load_index', { index: 'abc' }],
		['jump', { seconds: '' }],
		['load_name', { name: '   ' }],
		['custom', { address: 'no-slash', argtype: 'none', value: '' }],
	]) {
		const pkt = await run(actionId, options)
		eq(pkt, null, `${actionId} with invalid input sends nothing`)
		ok(logs.some((l) => l.level === 'warn'), `${actionId} with invalid input logs a warning`)
	}

	// Wrong prefix must NOT match (mirrors the app's "/<prefix>/" rule)
	{
		const msg = decodePacket(encodeMessage('/trucue/play', []))[0]
		eq(mapCommand(msg, 'other'), null, 'wrong prefix is rejected')
		eq(mapCommand(msg, ''), null, 'flat-prefix app rejects prefixed address')
		eq(mapCommand(decodeMessage(encodeMessage('/TRUCUE/Play', [])), 'trucue').cmd, '/play', 'matching is case-insensitive')
	}

	// ── 4. Presets reference real actions with complete options ────────
	const presets = getPresetDefinitions()
	ok(Object.keys(presets).length >= 25, 'a useful number of presets exist')
	for (const [key, preset] of Object.entries(presets)) {
		for (const step of preset.steps) {
			for (const ref of [...(step.down ?? []), ...(step.up ?? [])]) {
				const action = actions[ref.actionId]
				ok(action, `preset "${key}" references existing action "${ref.actionId}"`)
				const optionDefs = action.options ?? []
				const optionIds = new Set(optionDefs.map((o) => o.id))
				for (const k of Object.keys(ref.options)) {
					ok(optionIds.has(k), `preset "${key}" option "${k}" is defined by action "${ref.actionId}"`)
				}
				for (const o of optionDefs) {
					if (o.type === 'static-text') continue
					if (typeof o.isVisible === 'function' && !o.isVisible(ref.options)) continue
					ok(
						Object.prototype.hasOwnProperty.call(ref.options, o.id),
						`preset "${key}" supplies option "${o.id}" of action "${ref.actionId}"`,
					)
					if (o.type === 'dropdown') {
						ok(
							o.choices.some((c) => c.id === ref.options[o.id]),
							`preset "${key}" option "${o.id}" value "${ref.options[o.id]}" is a valid choice`,
						)
					}
				}
			}
		}
	}

	console.log(`OK — ${checks} checks passed`)
}

main().catch((err) => {
	console.error('SMOKE TEST FAILED:')
	console.error(err)
	process.exit(1)
})
