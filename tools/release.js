#!/usr/bin/env node
// Copies the freshly built module package into releases/ — one versioned
// file (history) plus a stable "latest" name (permanent download link).
// Run via `yarn release` (tests + build + this) on every version bump.

const fs = require('fs')
const path = require('path')

const version = require('../package.json').version
const root = path.join(__dirname, '..')
const src = path.join(root, `pkinc-trucue-${version}.tgz`)
if (!fs.existsSync(src)) {
	console.error(`Missing ${src} — run \`yarn package\` first`)
	process.exit(1)
}
const dir = path.join(root, 'releases')
fs.mkdirSync(dir, { recursive: true })
fs.copyFileSync(src, path.join(dir, `pkinc-trucue-${version}.tgz`))
fs.copyFileSync(src, path.join(dir, 'pkinc-trucue-latest.tgz'))
console.log(`releases/: pkinc-trucue-${version}.tgz + pkinc-trucue-latest.tgz updated — commit them`)
