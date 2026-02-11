import SCIP from './dist/index.mjs';
import fs from 'fs';
import path from 'path';

async function main() {
  try {
    // Initialize with local wasm path
    await SCIP.init({
      wasmPath: path.resolve('./dist/scip.wasm')
    });

    const params = await SCIP.getParameters();
    console.log(params);
  } catch (err) {
    console.error(err);
  }
}

main();
