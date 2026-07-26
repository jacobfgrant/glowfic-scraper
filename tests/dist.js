// Reads build output. `npm test` builds once beforehand via the pretest script;
// test files must not build themselves, since they run in parallel and the
// build clears the directory out from under whoever else is reading it.
import { existsSync, readFileSync } from 'node:fs';

export function distFile(name) {
  const path = new URL(`../dist/${name}`, import.meta.url);
  if (!existsSync(path)) {
    throw new Error(`dist/${name} is missing — run \`python3 build.py\` first.`);
  }
  return readFileSync(path, 'utf8');
}
