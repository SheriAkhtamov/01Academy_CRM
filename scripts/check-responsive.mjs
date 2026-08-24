/*
  Small-screen guard rails.

  The app is used on phones as well as desktops, and the two failures that
  actually reach a user are silent ones: a box that cannot fit the screen and so
  pushes the whole page into horizontal scroll, and a height measured against a
  viewport unit that lies on mobile. Neither shows up in a type check or a unit
  test, and neither is visible at a desktop window size — so they are checked
  here instead.

  Every rule below is mechanical and has no judgement in it. Layout decisions —
  which columns a phone drops, when a table becomes a list of cards — belong in
  the components, not in a linter.
*/
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const clientSrc = join(rootDir, 'client/src');

/** Narrowest screen worth supporting, minus the app shell's own page gutter. */
const PHONE_CONTENT_WIDTH = 340;
const REM = 16;

const BREAKPOINT = String.raw`(?:sm|md|lg|xl|2xl|max-sm|max-md|max-lg|max-xl)`;

const findings = [];
const add = (file, line, message) => findings.push(
  `${relative(rootDir, file)}:${line}: ${message}`,
);

const tsxFiles = (dir) => readdirSync(dir).flatMap((entry) => {
  const full = join(dir, entry);
  if (statSync(full).isDirectory()) return tsxFiles(full);
  return full.endsWith('.tsx') ? [full] : [];
});

/**
 * The intrinsic width of one grid track, in px. Anything that can collapse —
 * `fr`, `auto`, a percentage, `min()`, `calc()` — counts as zero, because those
 * are exactly the forms that let a row reflow instead of overflowing.
 */
const trackWidth = (rawTrack) => {
  const track = rawTrack.trim();
  // Only the floor of a minmax() is binding.
  const floor = /^minmax\(([^,]+),[^)]*\)$/.exec(track);
  const value = floor ? floor[1].trim() : track;

  const px = /^(\d+(?:\.\d+)?)px$/.exec(value);
  if (px) return Number(px[1]);
  const rem = /^(\d+(?:\.\d+)?)rem$/.exec(value);
  if (rem) return Number(rem[1]) * REM;
  return 0;
};

const rules = [
  {
    name: 'dynamic viewport height',
    /*
      On a phone `100vh` is the viewport as it would be with the browser chrome
      hidden, which is taller than what the reader can actually see. A dialog
      capped at `90vh` therefore hangs its own footer buttons underneath the
      address bar, out of reach. `dvh` measures what is on screen right now.
    */
    test: (line) => {
      const found = [];
      for (const match of line.matchAll(/\b(?:max-h|min-h|h)-\[[^\]]*?\d+vh/g)) {
        found.push(`${match[0]}…] uses vh; use dvh so the browser chrome is counted`);
      }
      for (const match of line.matchAll(/\b(?:max-h|min-h|h)-screen\b/g)) {
        found.push(`${match[0]} resolves to 100vh; use the dvh equivalent`);
      }
      return found;
    },
  },
  {
    name: 'grid wider than a phone',
    /*
      A grid whose fixed tracks add up to more than the screen does not wrap or
      shrink — it overflows, and takes the whole page into horizontal scroll
      with it. Putting the track list behind a breakpoint is the fix: state the
      phone layout first, then widen.
    */
    test: (line) => {
      const found = [];
      const pattern = new RegExp(
        String.raw`(?:^|[\s"'\`])((?:${BREAKPOINT}:)?grid-cols-\[([^\]]+)\])`,
        'g',
      );
      for (const match of line.matchAll(pattern)) {
        if (new RegExp(`^${BREAKPOINT}:`).test(match[1])) continue;
        const tracks = match[2].split('_');
        const total = tracks.reduce((sum, track) => sum + trackWidth(track), 0)
          + (tracks.length - 1) * 12; // a gap-3 allowance between tracks
        if (total > PHONE_CONTENT_WIDTH) {
          found.push(
            `${match[1]} needs ~${Math.round(total)}px and cannot shrink; `
            + 'put it behind a breakpoint and give the phone its own track list',
          );
        }
      }
      return found;
    },
  },
  {
    name: 'width wider than a phone',
    /*
      `min-w-*` is deliberately excluded: a floor inside a horizontal scroller
      is how the calendars and the resource timeline are meant to work. This is
      only about widths a box cannot come down from.
    */
    test: (line) => {
      const found = [];
      const pattern = new RegExp(
        String.raw`(?:^|[\s"'\`])((?:${BREAKPOINT}:)?w-\[(\d+(?:\.\d+)?)(px|rem)\])`,
        'g',
      );
      for (const match of line.matchAll(pattern)) {
        if (new RegExp(`^${BREAKPOINT}:`).test(match[1])) continue;
        const width = Number(match[2]) * (match[3] === 'rem' ? REM : 1);
        if (width <= PHONE_CONTENT_WIDTH) continue;
        // An explicit cap means the author already thought about it.
        if (/\bmax-w-(full|\[)/.test(line)) continue;
        found.push(
          `${match[1]} is wider than a phone; cap it with max-w-full, use `
          + 'min(), or move it behind a breakpoint',
        );
      }
      return found;
    },
  },
];

for (const file of tsxFiles(clientSrc)) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const rule of rules) {
      for (const message of rule.test(line)) {
        add(file, index + 1, message);
      }
    }
  });
}

if (findings.length > 0) {
  console.error(`Responsive check failed with ${findings.length} finding(s):\n`);
  for (const finding of findings) console.error(`  ${finding}`);
  console.error('\nEach of these overflows or mis-measures on a phone screen.');
  process.exit(1);
}

console.log('Responsive check passed.');
