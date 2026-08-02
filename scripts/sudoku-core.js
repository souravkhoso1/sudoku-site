// sudoku-core.js
// Pure logic: seeded RNG, full-grid generation, uniqueness-checked puzzle carving.
// Used by scripts/generate-daily-puzzle.js (Node, runs in GitHub Actions).

/** Deterministic PRNG (mulberry32) so a given date always yields the same puzzle. */
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return h;
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function isSafe(grid, row, col, num) {
  for (let x = 0; x < 9; x++) {
    if (grid[row][x] === num || grid[x][col] === num) return false;
  }
  const startRow = row - (row % 3);
  const startCol = col - (col % 3);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (grid[startRow + r][startCol + c] === num) return false;
    }
  }
  return true;
}

function findEmpty(grid) {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (grid[r][c] === 0) return [r, c];
    }
  }
  return null;
}

/** Fills an empty 9x9 grid completely using randomized backtracking. */
function generateFullGrid(rng) {
  const grid = Array.from({ length: 9 }, () => Array(9).fill(0));

  function fill() {
    const empty = findEmpty(grid);
    if (!empty) return true;
    const [row, col] = empty;
    const nums = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rng);
    for (const num of nums) {
      if (isSafe(grid, row, col, num)) {
        grid[row][col] = num;
        if (fill()) return true;
        grid[row][col] = 0;
      }
    }
    return false;
  }

  fill();
  return grid;
}

/** Counts solutions up to `limit` (we only ever need to know if it's >1). */
function countSolutions(grid, limit = 2) {
  let count = 0;
  const g = grid.map((row) => row.slice());

  function solve() {
    if (count >= limit) return;
    const empty = findEmpty(g);
    if (!empty) {
      count++;
      return;
    }
    const [row, col] = empty;
    for (let num = 1; num <= 9; num++) {
      if (count >= limit) return;
      if (isSafe(g, row, col, num)) {
        g[row][col] = num;
        solve();
        g[row][col] = 0;
      }
    }
  }

  solve();
  return count;
}

const DIFFICULTY_CLUES = {
  easy: 40, // clues left on the board
  medium: 34,
  hard: 28,
};

/**
 * Carves a puzzle out of a full solved grid by removing cells one at a time,
 * backing off any removal that would break solution-uniqueness.
 */
function carvePuzzle(fullGrid, difficulty, rng) {
  const targetClues = DIFFICULTY_CLUES[difficulty] ?? DIFFICULTY_CLUES.medium;
  const puzzle = fullGrid.map((row) => row.slice());

  const cells = [];
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) cells.push([r, c]);
  const order = shuffle(cells, rng);

  let clues = 81;
  for (const [r, c] of order) {
    if (clues <= targetClues) break;
    const backup = puzzle[r][c];
    puzzle[r][c] = 0;
    const solutions = countSolutions(puzzle, 2);
    if (solutions !== 1) {
      puzzle[r][c] = backup; // revert, keeps puzzle uniquely solvable
    } else {
      clues--;
    }
  }

  return puzzle;
}

function difficultyForDate(dateStr) {
  // Rotate difficulty through the week so the site has a rhythm:
  // Mon/Tue/Wed easy-ish, Thu/Fri medium, weekends hard.
  const d = new Date(dateStr + "T00:00:00Z").getUTCDay(); // 0=Sun..6=Sat
  if (d === 0 || d === 6) return "hard";
  if (d === 4 || d === 5) return "medium";
  return "easy";
}

/** Generates a full puzzle payload for a given ISO date string (YYYY-MM-DD). */
function generatePuzzleForDate(dateStr) {
  const rng = mulberry32(seedFromString(dateStr));
  const solution = generateFullGrid(rng);
  const difficulty = difficultyForDate(dateStr);
  const puzzle = carvePuzzle(solution, difficulty, rng);
  return {
    date: dateStr,
    difficulty,
    puzzle,
    solution,
  };
}

module.exports = {
  mulberry32,
  seedFromString,
  generateFullGrid,
  countSolutions,
  carvePuzzle,
  difficultyForDate,
  generatePuzzleForDate,
};
