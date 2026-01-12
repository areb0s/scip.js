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
var __importMetaUrl = (function() {
  if (typeof document !== 'undefined') {
    // Browser: use currentScript or last script tag
    if (document.currentScript && document.currentScript.src) {
      return document.currentScript.src;
    }
    // Fallback: find script tag with our filename
    var scripts = document.getElementsByTagName('script');
    for (var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].src;
      if (src && (src.includes('scip.browser') || src.includes('scip.js'))) {
        return src;
      }
    }
    // Last resort: current URL
    return window.location.href;
  }
  // Node.js or other environment
  return '';
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
      
      // Footer: expose SCIP globally
      footer: {
        js: `
// Expose SCIP globally
if (typeof window !== 'undefined') {
  window.SCIP = SCIPModule.default || SCIPModule;
  // Also expose named exports
  if (SCIPModule.init) window.SCIP.init = SCIPModule.init;
  if (SCIPModule.solve) window.SCIP.solve = SCIPModule.solve;
  if (SCIPModule.minimize) window.SCIP.minimize = SCIPModule.minimize;
  if (SCIPModule.maximize) window.SCIP.maximize = SCIPModule.maximize;
  if (SCIPModule.version) window.SCIP.version = SCIPModule.version;
  if (SCIPModule.Status) window.SCIP.Status = SCIPModule.Status;
}
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
      sourcemap: true,
      plugins: [resolveScipPlugin],
      banner: {
        js: importMetaPolyfill
      },
      define: {
        'import.meta.url': '__importMetaUrl'
      },
      footer: {
        js: `if(typeof window!=='undefined'){window.SCIP=SCIPModule.default||SCIPModule;}`
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
