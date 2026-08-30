// tsc emits .js only. The Python helper is a runtime asset that must sit beside
// the compiled frontend, or the published package analyses nothing.
import { cp, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const from = fileURLToPath(new URL('src/frontend/python/helper/', root));
const to = fileURLToPath(new URL('dist/frontend/python/helper/', root));

await mkdir(to, { recursive: true });
await cp(from, to, { recursive: true });
console.log(`copied python helper -> ${to}`);
