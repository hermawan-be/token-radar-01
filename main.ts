// Token Radar entrypoint: snapshot in, board + dashboard + dossier out.
//
// Run it from the repository root, for example:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
// It reads the sealed snapshot, scores every rankable pre-token protocol
// with the model in lib/model.ts, writes board.json and data.js, copies
// dashboard/ and screenshots/ into the output directory, and writes
// dossier.json with the vendored make.fun library. Node 22, stdlib only.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TUNING,
  baseMultipleOf,
  boardProblem,
  buildBoard,
  buildPayload,
  dataScript,
  parseSnapshot,
} from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** Caps the scorer enforces on the dossier's text and the screenshots. */
const TEXT_CAP_BYTES = 65_536;
const SHOT_CAP = { max: 4, max_bytes: 524_288 };
const SHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Pick --name <value> (or --name=<value>) out of the arguments. */
function flag(name: string, fallback: string): string {
  const argv = process.argv;
  const at = argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < argv.length) return argv[at + 1]!;
  const glued = argv.find((a) => a.startsWith(`--${name}=`));
  return glued === undefined ? fallback : glued.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

const inputArg = flag('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`);
}
const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snap = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { multiple, count } = baseMultipleOf(snap);
const tuning = { base_multiple: multiple, ...TUNING };
const board = buildBoard(snap, tuning);
const problem = boardProblem(board, snap);
if (problem !== null) fail(`the model wrote a board the gate refuses: ${problem}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
const { payload } = buildPayload(snap, board, tuning, count);
writeFileSync(join(outDir, 'data.js'), dataScript(payload));

/** Copy a directory's regular files into `to`, skipping dotfiles. Returns the names copied. */
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const done: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    done.push(name);
  }
  return done;
}

copyDir(join(here, 'dashboard'), join(outDir, 'dashboard'));
const dashFiles = readdirSync(join(outDir, 'dashboard')).filter((n) => !n.startsWith('.'));
const hasPage = dashFiles.includes('index.html');
const hasStyle = dashFiles.some((n) => n.endsWith('.css'));
const hasScript = dashFiles.some((n) => n.endsWith('.js'));
if (!hasPage || !hasStyle || !hasScript) {
  fail(`dashboard/ is missing its page, stylesheet or script (has index.html: ${hasPage}, .css: ${hasStyle}, .js: ${hasScript})`);
}
const shots = copyDir(join(here, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3) {
  fail(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
}
for (const name of shots) {
  if (!SHOT_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
}

// The dossier goes last: the scorer rebuilds it from this output and compares bytes.
const dossierBytes = buildDossier(outDir, {
  text_max_bytes: TEXT_CAP_BYTES,
  screenshots: SHOT_CAP,
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
});
writeFileSync(join(outDir, 'dossier.json'), dossierBytes);

// Read the dossier back so a bad write fails here, in this run, not at the gate.
const dossierBack = JSON.parse(readFileSync(join(outDir, 'dossier.json'), 'utf8'));
if (dossierBack.schema !== 'makefun/dossier/v1') {
  fail(`dossier.json came back with schema ${String(dossierBack.schema)}`);
}

const liveSetAside = payload.live_size;
const earlyRows = payload.early_size;
process.stdout.write(
  `token radar: ${snap.protocols.length} protocols, ${snap.watchlist.length} on the watchlist, ${board.length} rows scored (${earlyRows} early, ${liveSetAside} live set aside)\n` +
    `token radar: base multiple ${tuning.base_multiple} from ${count} live-token protocols (median market-cap/TVL)\n` +
    `token radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ${join(outDir, 'dashboard')} (3 files), ${join(outDir, 'screenshots')} (${shots.length} images) and ${join(outDir, 'dossier.json')}\n`,
);
