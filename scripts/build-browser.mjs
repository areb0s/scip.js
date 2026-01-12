#!/usr/bin/env node
/**
 * Build browser-compatible IIFE bundle for SCIP.js
 * 
 * This script creates dist/scip.browser.js which can be loaded via:
 *   <script src="scip.browser.js"></script>
 *   <script>
 *     const result = await SCIP.solve(`...`);
 *   </script>
 */

import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const srcDir = join(rootDir, 'src');
const distDir = join(rootDir, 'dist');

/**
 * Plugin to resolve ./scip-core.js imports to dist/scip-core.js
 */
const resolveScipPlugin = {
  name: 'resolve-scip',
  setup(build) {
    // Intercept imports of ./scip-core.js and redirect to dist/scip-core.js
    build.onResolve({ filter: /^\.\/scip-core\.js$/ }, (args) => {
      return { path: join(distDir, 'scip-core.js') };
    });
  }
};

/**
 * Polyfill for import.meta.url in non-module contexts
 * This gets injected at the top of the bundle
 */
const importMetaPolyfill = `
// Polyfill for import.meta.url in IIFE context
// Always use CDN as the base URL for WASM loading
var __importMetaUrl = (function() {
  var CDN_BASE = 'https://cdn.jsdelivr.net/gh/areb0s/scip.js/dist/scip.min.js';
  
  // Check for explicit SCIP_BASE_URL first
  if (typeof SCIP_BASE_URL !== 'undefined' && SCIP_BASE_URL) {
    return SCIP_BASE_URL + (SCIP_BASE_URL.endsWith('/') ? '' : '/') + 'scip.min.js';
  }
  
  // Always return CDN - this ensures WASM is loaded from CDN
  return CDN_BASE;
})();
`;

async function build() {
  console.log('Building browser bundle...');

  try {
    // Build the IIFE bundle
    const result = await esbuild.build({
      entryPoints: [join(srcDir, 'scip-browser.js')],
      bundle: true,
      format: 'iife',
      globalName: 'SCIPModule',
      outfile: join(distDir, 'scip.js'),
      platform: 'browser',
      target: ['es2020'],
      minify: false, // Keep readable for debugging
      sourcemap: true,
      
      // Plugins
      plugins: [resolveScipPlugin],
      
      // Banner: inject import.meta polyfill
      banner: {
        js: importMetaPolyfill
      },
      
      // Replace import.meta.url with our polyfill variable
      define: {
        'import.meta.url': '__importMetaUrl'
      },
      
      // Footer: expose SCIP globally (Worker, Browser, Node.js)
      footer: {
        js: `
// Expose SCIP globally (works in Worker, Browser, Node.js)
(function(g) {
  g.SCIP = SCIPModule.default || SCIPModule;
  if (SCIPModule.init) g.SCIP.init = SCIPModule.init;
  if (SCIPModule.solve) g.SCIP.solve = SCIPModule.solve;
  if (SCIPModule.minimize) g.SCIP.minimize = SCIPModule.minimize;
  if (SCIPModule.maximize) g.SCIP.maximize = SCIPModule.maximize;
  if (SCIPModule.version) g.SCIP.version = SCIPModule.version;
  if (SCIPModule.Status) g.SCIP.Status = SCIPModule.Status;
  if (SCIPModule.ready) g.SCIP.ready = SCIPModule.ready;
})(typeof self !== 'undefined' ? self : typeof window !== 'undefined' ? window : globalThis);
`
      },

      // Log level
      logLevel: 'info',
    });

    console.log('Browser bundle created: dist/scip.js');

    // Also create minified version
    await esbuild.build({
      entryPoints: [join(srcDir, 'scip-browser.js')],
      bundle: true,
      format: 'iife',
      globalName: 'SCIPModule',
      outfile: join(distDir, 'scip.min.js'),
      platform: 'browser',
      target: ['es2020'],
      minify: true,
      sourcemap: 'external',  // .map 파일 생성하되 JS에 참조 안 넣음
      plugins: [resolveScipPlugin],
      banner: {
        js: importMetaPolyfill
      },
      define: {
        'import.meta.url': '__importMetaUrl'
      },
      footer: {
        js: `(function(g){g.SCIP=SCIPModule.default||SCIPModule;if(SCIPModule.ready)g.SCIP.ready=SCIPModule.ready;})(typeof self!=='undefined'?self:typeof window!=='undefined'?window:globalThis);`
      },
    });

    console.log('Minified bundle created: dist/scip.min.js');
    console.log('\nDone! Usage:');
    console.log('  <script src="scip.min.js"></script>');
    console.log('  <script>');
    console.log('    const result = await SCIP.solve(`...`);');
    console.log('  </script>');

  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
