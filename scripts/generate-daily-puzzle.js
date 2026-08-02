// generate-daily-puzzle.js
// Usage: node scripts/generate-daily-puzzle.js [YYYY-MM-DD] [--days-ahead N]
//
// Generates puzzle JSON files into /puzzles and keeps /puzzles/manifest.json
// up to date. Run with no args to generate today's (UTC) puzzle -- this is
// what the GitHub Action does every night. Run with --days-ahead N to also
// pre-generate the next N days (handy for bootstrapping the repo initially).

const fs = require("fs");
const path = require("path");
const { generatePuzzleForDate } = require("./sudoku-core");

const PUZZLES_DIR = path.join(__dirname, "..", "puzzles");
const MANIFEST_PATH = path.join(PUZZLES_DIR, "manifest.json");

function toISODate(d) {
  return d.toISOString().slice(0, 10);
}

function parseArgs(argv) {
  const args = { date: null, daysAhead: 0 };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--days-ahead") {
      args.daysAhead = parseInt(rest[i + 1] || "0", 10) || 0;
      i++;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(rest[i])) {
      args.date = rest[i];
    }
  }
  return args;
}

function writePuzzle(dateStr) {
  const filePath = path.join(PUZZLES_DIR, `${dateStr}.json`);
  if (fs.existsSync(filePath)) {
    console.log(`skip ${dateStr} (already exists)`);
    return false;
  }
  const payload = generatePuzzleForDate(dateStr);
  fs.writeFileSync(filePath, JSON.stringify(payload));
  console.log(`wrote ${dateStr} (${payload.difficulty})`);
  return true;
}

function updateManifest() {
  const files = fs
    .readdirSync(PUZZLES_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.replace(".json", ""))
    .sort();
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify({ dates: files }));
  console.log(`manifest updated: ${files.length} puzzle(s)`);
}

function main() {
  if (!fs.existsSync(PUZZLES_DIR)) fs.mkdirSync(PUZZLES_DIR, { recursive: true });

  const { date, daysAhead } = parseArgs(process.argv);
  const baseDate = date ? new Date(date + "T00:00:00Z") : new Date();

  const datesToGenerate = [toISODate(baseDate)];
  for (let i = 1; i <= daysAhead; i++) {
    const d = new Date(baseDate);
    d.setUTCDate(d.getUTCDate() + i);
    datesToGenerate.push(toISODate(d));
  }

  datesToGenerate.forEach(writePuzzle);
  updateManifest();
}

main();
