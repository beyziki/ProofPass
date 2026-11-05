// Bundles src/browser.js (circomlibjs + snarkjs + helpers) into one browser script: window.PDZK
require('esbuild').buildSync({
  entryPoints: ['src/browser.js'], bundle: true, format: 'iife', platform: 'browser', minify: true,
  outfile: 'build/pdzk.bundle.js', define: { global: 'globalThis' },
  alias: { crypto: 'crypto-browserify', stream: 'stream-browserify', assert: 'assert', util: 'util', events: 'events', buffer: 'buffer', process: 'process/browser' },
  external: ['fs', 'os', 'path', 'worker_threads', 'readline', 'child_process', 'url', 'http', 'https', 'net', 'tls', 'zlib', 'constants']
});
console.log('build/pdzk.bundle.js written');
