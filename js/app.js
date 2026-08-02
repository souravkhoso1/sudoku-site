(() => {
  "use strict";

  const PUZZLES_DIR = "puzzles";
  const STORAGE_PREFIX = "sudoku-progress-";
  const MISTAKE_LIMIT = 3;

  const el = {
    board: document.getElementById("board"),
    numpad: document.getElementById("numpad"),
    dateLine: document.getElementById("dateLine"),
    difficultyBadge: document.getElementById("difficultyBadge"),
    timerDisplay: document.getElementById("timerDisplay"),
    mistakesDisplay: document.getElementById("mistakesDisplay"),
    restartBtn: document.getElementById("restartBtn"),
    restartModal: document.getElementById("restartModal"),
    restartConfirmBtn: document.getElementById("restartConfirmBtn"),
    winModal: document.getElementById("winModal"),
    winTime: document.getElementById("winTime"),
    winMistakes: document.getElementById("winMistakes"),
    winDifficulty: document.getElementById("winDifficulty"),
    downloadCertBtn: document.getElementById("downloadCertBtn"),
    closeWinBtn: document.getElementById("closeWinBtn"),
    certCanvas: document.getElementById("certCanvas"),
  };

  /** @type {{date:string, difficulty:string, puzzle:number[][], solution:number[][]}} */
  let puzzleData = null;
  let cells = []; // flat array of 81 cell DOM nodes
  let userGrid = []; // flat array of 81 numbers (0 = empty), mirrors what the player entered
  let selectedIndex = null;
  let mistakes = 0;
  let elapsedMs = 0;
  let runningSince = null;
  let timerHandle = null;
  let completed = false;

  // ---------- date helpers ----------

  function localDateStr(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function formatFriendlyDate(isoStr) {
    const d = new Date(isoStr + "T00:00:00");
    return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  }

  // ---------- loading ----------

  async function loadTodaysPuzzle() {
    let manifest;
    try {
      const res = await fetch(`${PUZZLES_DIR}/manifest.json`, { cache: "no-store" });
      if (!res.ok) throw new Error("manifest fetch failed");
      manifest = await res.json();
    } catch (err) {
      el.dateLine.textContent = "Couldn't load the puzzle list. Try again shortly.";
      return;
    }

    const dates = (manifest.dates || []).slice().sort();
    if (dates.length === 0) {
      el.dateLine.textContent = "No puzzles published yet — check back soon.";
      return;
    }

    const today = localDateStr();
    // Pick the latest available date that is <= today; otherwise the earliest available.
    let target = dates.filter((d) => d <= today).pop();
    if (!target) target = dates[0];

    try {
      const res = await fetch(`${PUZZLES_DIR}/${target}.json`, { cache: "no-store" });
      if (!res.ok) throw new Error("puzzle fetch failed");
      puzzleData = await res.json();
    } catch (err) {
      el.dateLine.textContent = "Couldn't load today's puzzle. Try again shortly.";
      return;
    }

    initBoardFromPuzzle();
  }

  // ---------- board setup ----------

  function storageKey() {
    return STORAGE_PREFIX + puzzleData.date;
  }

  function loadProgress() {
    try {
      const raw = localStorage.getItem(storageKey());
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function saveProgress() {
    const payload = {
      grid: userGrid,
      mistakes,
      elapsedMs: currentElapsedMs(),
      completed,
    };
    try {
      localStorage.setItem(storageKey(), JSON.stringify(payload));
    } catch {
      // localStorage unavailable (private mode / quota) — progress just won't persist.
    }
  }

  function clearProgress() {
    try {
      localStorage.removeItem(storageKey());
    } catch {
      /* ignore */
    }
  }

  function initBoardFromPuzzle() {
    el.dateLine.textContent = formatFriendlyDate(puzzleData.date);
    el.difficultyBadge.hidden = false;
    el.difficultyBadge.textContent = puzzleData.difficulty;
    el.difficultyBadge.dataset.level = puzzleData.difficulty;

    const saved = loadProgress();

    buildBoardDom();

    if (saved && Array.isArray(saved.grid) && saved.grid.length === 81) {
      userGrid = saved.grid.slice();
      mistakes = saved.mistakes || 0;
      elapsedMs = saved.elapsedMs || 0;
      completed = !!saved.completed;
    } else {
      userGrid = flatten(puzzleData.puzzle);
      mistakes = 0;
      elapsedMs = 0;
      completed = false;
    }

    renderGrid();
    updateMistakesDisplay();

    if (completed) {
      stopTimer();
      renderTimer();
    } else {
      startTimer();
    }
  }

  function flatten(grid2d) {
    return grid2d.flat();
  }

  function buildBoardDom() {
    el.board.innerHTML = "";
    cells = [];
    for (let i = 0; i < 81; i++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.setAttribute("role", "gridcell");
      cell.dataset.index = String(i);
      cell.addEventListener("click", () => selectCell(i));
      el.board.appendChild(cell);
      cells.push(cell);
    }
  }

  function isGiven(i) {
    const r = Math.floor(i / 9);
    const c = i % 9;
    return puzzleData.puzzle[r][c] !== 0;
  }

  function renderGrid() {
    for (let i = 0; i < 81; i++) {
      const cell = cells[i];
      const val = userGrid[i];
      cell.textContent = val === 0 ? "" : String(val);
      cell.classList.toggle("given", isGiven(i));
    }
    highlightPeers();
  }

  function selectCell(i) {
    if (completed || isGiven(i)) {
      // Givens aren't editable, but still let the player see peer highlighting.
      selectedIndex = i;
      highlightPeers();
      return;
    }
    selectedIndex = i;
    highlightPeers();
  }

  function highlightPeers() {
    cells.forEach((c) => c.classList.remove("selected", "peer"));
    if (selectedIndex === null) return;
    const r = Math.floor(selectedIndex / 9);
    const c = selectedIndex % 9;
    const boxR = Math.floor(r / 3) * 3;
    const boxC = Math.floor(c / 3) * 3;
    for (let i = 0; i < 81; i++) {
      const ir = Math.floor(i / 9);
      const ic = i % 9;
      const sameRow = ir === r;
      const sameCol = ic === c;
      const sameBox = ir >= boxR && ir < boxR + 3 && ic >= boxC && ic < boxC + 3;
      if (i === selectedIndex) cells[i].classList.add("selected");
      else if (sameRow || sameCol || sameBox) cells[i].classList.add("peer");
    }
  }

  function inputNumber(num) {
    if (completed || selectedIndex === null) return;
    if (isGiven(selectedIndex)) return;

    if (num === 0) {
      userGrid[selectedIndex] = 0;
      renderGrid();
      saveProgress();
      return;
    }

    const r = Math.floor(selectedIndex / 9);
    const c = selectedIndex % 9;
    const correct = puzzleData.solution[r][c];

    if (num === correct) {
      userGrid[selectedIndex] = num;
      renderGrid();
      saveProgress();
      checkCompletion();
    } else {
      const cellEl = cells[selectedIndex];
      cellEl.classList.remove("mistake");
      // restart the CSS animation
      void cellEl.offsetWidth;
      cellEl.classList.add("mistake");
      setTimeout(() => cellEl.classList.remove("mistake"), 260);

      mistakes++;
      updateMistakesDisplay();
      saveProgress();

      if (mistakes >= MISTAKE_LIMIT) {
        pauseForMistakeLimit();
      }
    }
  }

  function updateMistakesDisplay() {
    el.mistakesDisplay.textContent = `${mistakes} / ${MISTAKE_LIMIT}`;
    el.mistakesDisplay.classList.toggle("at-limit", mistakes >= MISTAKE_LIMIT);
  }

  function checkCompletion() {
    for (let i = 0; i < 81; i++) {
      const r = Math.floor(i / 9);
      const c = i % 9;
      if (userGrid[i] !== puzzleData.solution[r][c]) return;
    }
    completed = true;
    stopTimer();
    saveProgress();
    showWinModal();
  }

  // ---------- timer ----------

  function currentElapsedMs() {
    if (runningSince === null) return elapsedMs;
    return elapsedMs + (Date.now() - runningSince);
  }

  function renderTimer() {
    const totalSec = Math.floor(currentElapsedMs() / 1000);
    const m = String(Math.floor(totalSec / 60)).padStart(2, "0");
    const s = String(totalSec % 60).padStart(2, "0");
    el.timerDisplay.textContent = `${m}:${s}`;
  }

  function startTimer() {
    if (runningSince !== null) return;
    runningSince = Date.now();
    timerHandle = setInterval(() => {
      renderTimer();
      // periodically fold running time into elapsedMs and persist
      elapsedMs = currentElapsedMs();
      runningSince = Date.now();
      saveProgress();
    }, 1000);
    renderTimer();
  }

  function stopTimer() {
    if (timerHandle) clearInterval(timerHandle);
    timerHandle = null;
    elapsedMs = currentElapsedMs();
    runningSince = null;
    renderTimer();
  }

  // ---------- mistake limit / restart ----------

  function pauseForMistakeLimit() {
    stopTimer();
    el.restartModal.hidden = false;
  }

  function restartPuzzle() {
    userGrid = flatten(puzzleData.puzzle);
    mistakes = 0;
    elapsedMs = 0;
    runningSince = null;
    completed = false;
    selectedIndex = null;
    clearProgress();
    renderGrid();
    updateMistakesDisplay();
    el.restartModal.hidden = true;
    el.winModal.hidden = true;
    startTimer();
  }

  // ---------- win modal + certificate ----------

  function showWinModal() {
    renderTimer();
    el.winTime.textContent = el.timerDisplay.textContent;
    el.winMistakes.textContent = String(mistakes);
    el.winDifficulty.textContent = puzzleData.difficulty;
    el.winModal.hidden = false;
  }

  function drawCertificate() {
    const canvas = el.certCanvas;
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;

    // background
    ctx.fillStyle = "#f7f5f0";
    ctx.fillRect(0, 0, W, H);

    // border
    ctx.strokeStyle = "#1f2933";
    ctx.lineWidth = 6;
    ctx.strokeRect(24, 24, W - 48, H - 48);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(38, 38, W - 76, H - 76);

    // small grid glyph
    const gx = W / 2 - 45, gy = 70, gs = 90;
    ctx.strokeStyle = "#3a5a78";
    ctx.lineWidth = 3;
    ctx.strokeRect(gx, gy, gs, gs);
    for (const f of [1 / 3, 2 / 3]) {
      ctx.beginPath();
      ctx.moveTo(gx + gs * f, gy);
      ctx.lineTo(gx + gs * f, gy + gs);
      ctx.moveTo(gx, gy + gs * f);
      ctx.lineTo(gx + gs, gy + gs * f);
      ctx.stroke();
    }

    ctx.textAlign = "center";
    ctx.fillStyle = "#24292e";
    ctx.font = "700 40px Georgia, 'Times New Roman', serif";
    ctx.fillText("Sudoku Completion Certificate", W / 2, 210);

    ctx.font = "20px -apple-system, Helvetica, Arial, sans-serif";
    ctx.fillStyle = "#5b6470";
    ctx.fillText(`Puzzle for ${formatFriendlyDate(puzzleData.date)}`, W / 2, 250);

    // stats row
    const stats = [
      ["TIME", el.winTime.textContent],
      ["MISTAKES", String(mistakes)],
      ["DIFFICULTY", puzzleData.difficulty.toUpperCase()],
    ];
    const colW = (W - 160) / 3;
    stats.forEach(([label, value], i) => {
      const cx = 80 + colW * i + colW / 2;
      ctx.font = "700 13px -apple-system, Helvetica, Arial, sans-serif";
      ctx.fillStyle = "#5b6470";
      ctx.fillText(label, cx, 330);
      ctx.font = "700 44px ui-monospace, Menlo, Consolas, monospace";
      ctx.fillStyle = "#24292e";
      ctx.fillText(value, cx, 385);
    });

    ctx.font = "15px -apple-system, Helvetica, Arial, sans-serif";
    ctx.fillStyle = "#5b6470";
    ctx.fillText("dailysudoku — a new puzzle every day", W / 2, H - 60);

    return canvas;
  }

  function downloadCertificate() {
    drawCertificate();
    el.certCanvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sudoku-${puzzleData.date}-certificate.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }, "image/png");
  }

  // ---------- input wiring ----------

  el.numpad.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-num]");
    if (!btn) return;
    inputNumber(Number(btn.dataset.num));
  });

  document.addEventListener("keydown", (e) => {
    if (selectedIndex === null) return;
    if (e.key >= "1" && e.key <= "9") {
      inputNumber(Number(e.key));
    } else if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") {
      inputNumber(0);
    } else if (e.key.startsWith("Arrow")) {
      e.preventDefault();
      const r = Math.floor(selectedIndex / 9);
      const c = selectedIndex % 9;
      let nr = r, nc = c;
      if (e.key === "ArrowUp") nr = Math.max(0, r - 1);
      if (e.key === "ArrowDown") nr = Math.min(8, r + 1);
      if (e.key === "ArrowLeft") nc = Math.max(0, c - 1);
      if (e.key === "ArrowRight") nc = Math.min(8, c + 1);
      selectCell(nr * 9 + nc);
    }
  });

  el.restartBtn.addEventListener("click", () => {
    el.restartModal.hidden = false;
  });
  el.restartConfirmBtn.addEventListener("click", restartPuzzle);
  el.downloadCertBtn.addEventListener("click", downloadCertificate);
  el.closeWinBtn.addEventListener("click", () => {
    el.winModal.hidden = true;
  });

  document.addEventListener("visibilitychange", () => {
    // Pause the running clock while the tab is hidden so idle time isn't counted.
    if (document.hidden) {
      if (runningSince !== null) {
        elapsedMs = currentElapsedMs();
        runningSince = null;
      }
    } else if (!completed && mistakes < MISTAKE_LIMIT && puzzleData) {
      startTimer();
    }
  });

  loadTodaysPuzzle();
})();
