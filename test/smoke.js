#!/usr/bin/env node
// Offline verification of the module against TRUCUE's actual OSC receiver
// behavior. The command mapper below is a port of the app's Swift
// OSCCommand.from (ControlNook/OSCSender.swift), so every action is
// round-tripped through what the app will do with the packet: encode →
// decode (incl. bundles) → prefix match → map. Sequence actions are run
// through a simulation of the app's state machines from every start
// state, and the status-feedback path is tested end to end with
// app-shaped /trucue/status packets. (The shared decoder is exercised
// against the encoder here; the encoder itself was byte-verified against
// the `osc` npm package.)
//
// Run: node test/smoke.js   (no Companion, no network needed)

const assert = require('node:assert/strict')
const { oscString, encodeMessage, encodeBundle, decodeMessage, decodePacket, buildAddress } = require('../src/osc')
const { EMPTY_STATUS, fmtCountdown, parseStatusPayload, parsePlaylistPayload, parseStatusPacket } = require('../src/status')
const { getVariableDefinitions, variablesForStatus, fmtDb } = require('../src/variables')
const getActionDefinitions = require('../src/actions')
const getFeedbackDefinitions = require('../src/feedbacks')
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
		case '/volume/adjust':
			return num === undefined ? null : { cmd: addr, value: num }
		default:
			return null
	}
}

// ── Simulation of the app's mode + shuttle state machines ───────────────
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

// ── 1. Encoder golden bytes + decoder round-trip ────────────────────────
eq(oscString('/play').toString('hex'), '2f706c6179000000', 'oscString NUL-terminates and pads')
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
const sent = [] // { kind: 'cmd'|'raw'|'seq', packet: Buffer, args }
const logs = []
const self = {
	status: { ...EMPTY_STATUS },
	playlistNames: [],
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
let actions = getActionDefinitions(self)

async function run(actionId, options = {}) {
	sent.length = 0
	logs.length = 0
	ok(actions[actionId], `action "${actionId}" exists`)
	await actions[actionId].callback({ actionId, options }, context)
	return sent[0] ?? null
}
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
	await expectMapped('volume_adjust', { db: '1' }, '/volume/adjust', 1)
	await expectMapped('volume_adjust', { db: '-0.5' }, '/volume/adjust', -0.5)
	ok(actions.jump_to_mark.name.includes('by Index'), 'jump_to_mark renamed to "…by Index"')

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

	// Load Clip dropdown: choices come from the playlist feed
	{
		let opt = actions.load_clip.options.find((o) => o.id === 'clip')
		eq(opt.choices, [{ id: 0, label: '— no playlist received yet —' }], 'load_clip placeholder before playlist')
		const none = await run('load_clip', { clip: 0 })
		eq(none, null, 'load_clip placeholder sends nothing')
		ok(logs.some((l) => l.level === 'warn'), 'load_clip placeholder warns')

		self.playlistNames = ['Intro', 'Main Show', 'Outro']
		actions = getActionDefinitions(self)
		opt = actions.load_clip.options.find((o) => o.id === 'clip')
		eq(opt.choices.length, 3, 'load_clip has one choice per clip')
		eq(opt.choices[1], { id: 2, label: '2: Main Show' }, 'load_clip choice shape')
		eq(opt.default, 1, 'load_clip defaults to first clip')
		await expectMapped('load_clip', { clip: 2 }, '/load/index', 2)
		await expectMapped('load_clip', { clip: '3' }, '/load/index', 3) // string form (allowCustom-safe)
	}

	// Invalid input → skipped with a warning, nothing sent
	for (const [actionId, options] of [
		['load_index', { index: 'abc' }],
		['volume_adjust', { db: 'loud' }],
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

	// ── 4. Status feed: formatting, parsing, variables, feedbacks ──────
	eq(fmtCountdown(0), '0:00', undefined)
	eq(fmtCountdown(0.4), '0:01', 'sub-second ceils to 0:01')
	eq(fmtCountdown(59.2), '1:00', 'ceil rolls to the next minute')
	eq(fmtCountdown(75), '1:15', undefined)
	eq(fmtCountdown(3600), '1:00:00', 'hour form')
	eq(fmtCountdown(-1), '', 'negative = no value')

	const stJson = JSON.stringify({
		clip: 'Main Show ↻B', index: 2, remaining: 12.34, playing: 1,
		next: 'Outro →', prev: 'Intro B', vol: -3.5, bmName: 'Chorus', bmRemaining: 4.2,
	})
	{
		const st = parseStatusPayload(stJson)
		eq(st, {
			clip: 'Main Show ↻B', index: 2, remaining: 12.34, playing: 1,
			next: 'Outro →', prev: 'Intro B', vol: -3.5, bmName: 'Chorus', bmRemaining: 4.2,
		}, 'status payload parses (markers pass through verbatim)')
		const empty = parseStatusPayload(JSON.stringify({ clip: '', index: 0, remaining: 0, playing: 0 }))
		eq(empty.bmRemaining, -1, 'missing bookmark → -1')
		eq(empty.vol, null, 'missing vol → null')
		eq(empty.next, '', 'missing next → empty')
		eq(parseStatusPayload('not json'), null, 'garbage json → null')
		eq(parseStatusPayload('[1,2]'), null, 'array payload → null')
		eq(parsePlaylistPayload('["A","B"]'), ['A', 'B'], 'playlist payload parses')
		eq(parsePlaylistPayload('{"a":1}'), null, 'non-array playlist → null')
	}
	{
		// End to end: app-shaped packets through the listener's parser
		const p1 = parseStatusPacket(encodeMessage('/trucue/status', [{ type: 's', value: stJson }]))
		eq(p1.status.clip, 'Main Show ↻B', 'status packet routes')
		eq(p1.playlist, null, undefined)
		const p2 = parseStatusPacket(encodeMessage('/trucue/status/playlist', [{ type: 's', value: '["A","B"]' }]))
		eq(p2.playlist, ['A', 'B'], 'playlist packet routes')
		const p3 = parseStatusPacket(encodeMessage('/trucue/play', []))
		eq(p3, { status: null, playlist: null }, 'non-status address ignored')
		const p4 = parseStatusPacket(Buffer.from('garbage'))
		eq(p4, { status: null, playlist: null }, 'undecodable packet ignored')
	}
	eq(fmtDb(-3.5), '-3.5 dB', undefined)
	eq(fmtDb(0), '0 dB', undefined)
	eq(fmtDb(2), '+2 dB', 'positive gains get a +')
	{
		const vars = variablesForStatus(parseStatusPayload(stJson))
		eq(vars, {
			clip_name: 'Main Show ↻B', clip_index: 2,
			next_clip_name: 'Outro →', prev_clip_name: 'Intro B', clip_volume: '-3.5 dB',
			time_remaining: '0:13', time_remaining_s: 13,
			bookmark_name: 'Chorus', bookmark_remaining: '0:05', bookmark_remaining_s: 5,
		}, 'variables from status')
		const cleared = variablesForStatus({ ...EMPTY_STATUS })
		for (const v of Object.values(cleared)) eq(v, '', 'cleared status blanks every variable')
		const varIds = new Set(getVariableDefinitions().map((d) => d.variableId))
		for (const k of Object.keys(vars)) ok(varIds.has(k), `variable "${k}" is defined`)
		eq(varIds.size, Object.keys(vars).length, 'every defined variable gets a value')
	}
	const feedbacks = getFeedbackDefinitions(self)
	{
		self.status = parseStatusPayload(stJson) // remaining 12.34, bmRemaining 4.2
		eq(feedbacks.countdown_under.callback({ options: { seconds: 10 } }), false, 'countdown 12.34s not under 10')
		eq(feedbacks.countdown_under.callback({ options: { seconds: 15 } }), true, 'countdown 12.34s under 15')
		eq(feedbacks.bookmark_under.callback({ options: { seconds: 5 } }), true, 'bookmark 4.2s under 5')
		eq(feedbacks.bookmark_under.callback({ options: { seconds: 4 } }), false, 'bookmark 4.2s not under 4')
		self.status = { ...EMPTY_STATUS }
		eq(feedbacks.countdown_under.callback({ options: { seconds: 9999 } }), false, 'no clip → countdown feedback off')
		eq(feedbacks.bookmark_under.callback({ options: { seconds: 9999 } }), false, 'no bookmark → bookmark feedback off')
	}

	// Upgrade scripts: pre-1.1 configs get the feedback defaults, and the
	// old default ports migrate to the new ones.
	{
		const UpgradeScripts = require('../src/upgrades')
		eq(UpgradeScripts.length, 2, 'two upgrade scripts')
		const r = UpgradeScripts[0]({}, { config: { host: '1.2.3.4', port: '8000', prefix: 'trucue' }, actions: [], feedbacks: [] })
		eq(r.updatedConfig.listen, true, 'upgrade defaults listen on')
		eq(r.updatedConfig.feedbackPort, '9001', 'upgrade defaults feedback port (as shipped in 1.1.0)')
		eq(r.updatedActions, [], 'upgrade touches no actions')
		const r2 = UpgradeScripts[0]({}, { config: { listen: false }, actions: [], feedbacks: [] })
		eq(r2.updatedConfig, null, 'explicit listen setting untouched')
		const r3 = UpgradeScripts[0]({}, { config: null, actions: [], feedbacks: [] })
		eq(r3.updatedConfig, null, 'null config tolerated')

		const p1 = UpgradeScripts[1]({}, { config: { port: '8000', feedbackPort: '9001' }, actions: [], feedbacks: [] })
		eq(p1.updatedConfig, { port: '8017', feedbackPort: '9017' }, 'old default ports migrate')
		const p2 = UpgradeScripts[1]({}, { config: { port: 8000, feedbackPort: '5555' }, actions: [], feedbacks: [] })
		eq(p2.updatedConfig, { port: '8017', feedbackPort: '5555' }, 'numeric 8000 migrates, custom feedback port kept')
		const p3 = UpgradeScripts[1]({}, { config: { port: '8001', feedbackPort: '9002' }, actions: [], feedbacks: [] })
		eq(p3.updatedConfig, null, 'deliberate non-default ports untouched')
	}

	// ── 5. Presets reference real actions/feedbacks/variables ──────────
	const presets = getPresetDefinitions()
	ok(Object.keys(presets).length >= 25, 'a useful number of presets exist')
	const varIds = new Set(getVariableDefinitions().map((d) => d.variableId))
	for (const [key, preset] of Object.entries(presets)) {
		for (const step of preset.steps) {
			for (const ref of [
				...(step.down ?? []), ...(step.up ?? []),
				...(step.rotate_left ?? []), ...(step.rotate_right ?? []),
			]) {
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
		for (const ref of preset.feedbacks ?? []) {
			const fb = feedbacks[ref.feedbackId]
			ok(fb, `preset "${key}" references existing feedback "${ref.feedbackId}"`)
			for (const o of fb.options ?? []) {
				ok(
					Object.prototype.hasOwnProperty.call(ref.options, o.id),
					`preset "${key}" supplies option "${o.id}" of feedback "${ref.feedbackId}"`,
				)
			}
		}
		// Every $(pkinc-trucue:X) in button text must be a defined variable
		for (const m of String(preset.style.text).matchAll(/\$\(pkinc-trucue:([a-z0-9_]+)\)/g)) {
			ok(varIds.has(m[1]), `preset "${key}" uses defined variable "${m[1]}"`)
		}
	}

	console.log(`OK — ${checks} checks passed`)
}

main().catch((err) => {
	console.error('SMOKE TEST FAILED:')
	console.error(err)
	process.exit(1)
})
