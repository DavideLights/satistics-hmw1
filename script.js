// secp256k1 Point Multiplication & Coordinate Distribution
// Procedural implementation with Continuous Curve (R), Discrete Field (F97), and secp256k1 Scatter (Fp)

// 1. Curve Parameters (secp256k1)
const P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2Fn;
const Gx = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n;
const Gy = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n;
const G = { x: Gx, y: Gy };

// Real-field continuous curve parameters (y^2 = x^3 + 7 over R)
const G_REAL = { x: -1.0, y: Math.sqrt((-1.0) ** 3 + 7) }; // (-1.0, 2.4494897)

// Discrete small field parameters (y^2 = x^3 + 7 mod 97)
const P97 = 97;
const G97 = { x: 1, y: 28 }; // (28^2 = 784 = 8 mod 97; 1^3 + 7 = 8)
const ALL_POINTS_97 = [];
for (let x = 0; x < P97; x++) {
  const rhs = ((x * x * x + 7) % P97 + P97) % P97;
  for (let y = 0; y < P97; y++) {
    if (((y * y) % P97 + P97) % P97 === rhs) {
      ALL_POINTS_97.push({ x, y });
    }
  }
}

// State variables
let currentView = "real"; // "real" | "discrete" | "finite"
let runId = 0;
let isRunning = false;

// History of points for all representations
let secpPoints = [];
let realPoints = [];
let f97Points = [];
let activeChord = null; // { x1, y1, x2, y2, lam } for chord/tangent line

// DOM Elements
const privateKeyInput = document.getElementById("privateKey");
const methodSelect = document.getElementById("methodSelect");
const delaySlider = document.getElementById("delaySlider");
const delayValue = document.getElementById("delayValue");
const btnRun = document.getElementById("btnRun");
const btnReset = document.getElementById("btnReset");

const binaryDisplay = document.getElementById("binaryDisplay");
const stepCounter = document.getElementById("stepCounter");
const opBadge = document.getElementById("opBadge");
const coordX = document.getElementById("coordX");
const coordY = document.getElementById("coordY");
const logBox = document.getElementById("logBox");

const canvas = document.getElementById("plotCanvas");
const ctx = canvas.getContext("2d");
const pointCounter = document.getElementById("pointCounter");
const plotCaption = document.getElementById("plotCaption");
const legendPastText = document.getElementById("legendPastText");
const legendCurText = document.getElementById("legendCurText");
const viewTabs = document.getElementById("viewTabs");

// Delay slider listener
delaySlider.addEventListener("input", () => {
  delayValue.textContent = `${delaySlider.value} ms`;
});

// View switcher tabs listener
viewTabs.addEventListener("click", (e) => {
  const btn = e.target.closest(".view-tab");
  if (!btn) return;

  viewTabs.querySelectorAll(".view-tab").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  currentView = btn.dataset.view;

  updateViewMetadata();
  drawCurrentPlot();
});

function updateViewMetadata() {
  if (currentView === "real") {
    legendPastText.textContent = "Intermediate Points";
    legendCurText.textContent = "Current Q (on curve)";
    plotCaption.textContent = "Continuous curve y² = x³ + 7 over ℝ. Tangent and chord lines illustrate geometric point addition.";
  } else if (currentView === "discrete") {
    legendPastText.textContent = "Visited Steps";
    legendCurText.textContent = "Current Q";
    plotCaption.textContent = "Discrete curve y² ≡ x³ + 7 (mod 97). Light gray dots show all 78 points on the modular curve.";
  } else {
    legendPastText.textContent = "Past Points (3×3)";
    legendCurText.textContent = "Current Q (5×5)";
    plotCaption.textContent = "secp256k1 (256-bit 𝔽ₚ) normalized coordinates (x/p, y/p) ∈ [0, 1]² exhibiting apparent uniformity.";
  }
}

// Sleep helper
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 2. Math Functions

// Modulo helper
function mod(n, m) {
  return ((n % m) + m) % m;
}

// Extended Euclidean Algorithm for 256-bit BigInt
function modInverse(a, m) {
  let [old_r, r] = [mod(a, m), m];
  let [old_s, s] = [1n, 0n];

  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }

  if (old_r !== 1n) {
    throw new Error("Modular inverse does not exist");
  }

  return mod(old_s, m);
}

// secp256k1 Point Doubling
function pointDouble(p1) {
  if (!p1 || p1.y === 0n) return null;

  const numerator = 3n * p1.x * p1.x;
  const denominator = 2n * p1.y;
  const lambda = mod(numerator * modInverse(denominator, P), P);

  const x3 = mod(lambda * lambda - 2n * p1.x, P);
  const y3 = mod(lambda * (p1.x - x3) - p1.y, P);

  return { x: x3, y: y3 };
}

// secp256k1 Point Addition
function pointAdd(p1, p2) {
  if (!p1) return p2;
  if (!p2) return p1;

  if (p1.x === p2.x) {
    if (p1.y !== p2.y) return null;
    return pointDouble(p1);
  }

  const deltaY = p2.y - p1.y;
  const deltaX = p2.x - p1.x;
  const lambda = mod(deltaY * modInverse(deltaX, P), P);

  const x3 = mod(lambda * lambda - p1.x - p2.x, P);
  const y3 = mod(lambda * (p1.x - x3) - p1.y, P);

  return { x: x3, y: y3 };
}

// --- Real Continuous Arithmetic (over R) ---
function realDouble(p1) {
  if (!p1 || Math.abs(p1.y) < 1e-9) return null;
  const lam = (3 * p1.x * p1.x) / (2 * p1.y);
  const x3 = lam * lam - 2 * p1.x;
  const y3 = lam * (p1.x - x3) - p1.y;
  return { x: x3, y: y3, lam, p1, p2: p1 };
}

function realAdd(p1, p2) {
  if (!p1) return p2;
  if (!p2) return p1;
  if (Math.abs(p1.x - p2.x) < 1e-9) {
    if (Math.abs(p1.y - p2.y) < 1e-9) return realDouble(p1);
    return null; // Point at infinity
  }
  const lam = (p2.y - p1.y) / (p2.x - p1.x);
  const x3 = lam * lam - p1.x - p2.x;
  const y3 = lam * (p1.x - x3) - p1.y;
  return { x: x3, y: y3, lam, p1, p2 };
}

// --- Small Field Arithmetic (mod 97) ---
function inv97(a) {
  let [old_r, r] = [((a % P97) + P97) % P97, P97];
  let [old_s, s] = [1, 0];
  while (r !== 0) {
    const q = Math.floor(old_r / r);
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  return ((old_s % P97) + P97) % P97;
}

function f97Double(p1) {
  if (!p1 || p1.y === 0) return null;
  const lam = (((3 * p1.x * p1.x * inv97(2 * p1.y)) % P97) + P97) % P97;
  const x3 = (((lam * lam - 2 * p1.x) % P97) + P97) % P97;
  const y3 = (((lam * (p1.x - x3) - p1.y) % P97) + P97) % P97;
  return { x: x3, y: y3 };
}

function f97Add(p1, p2) {
  if (!p1) return p2;
  if (!p2) return p1;
  if (p1.x === p2.x) {
    if (p1.y !== p2.y) return null;
    return f97Double(p1);
  }
  const lam = ((((p2.y - p1.y) * inv97(p2.x - p1.x)) % P97) + P97) % P97;
  const x3 = (((lam * lam - p1.x - p2.x) % P97) + P97) % P97;
  const y3 = (((lam * (p1.x - x3) - p1.y) % P97) + P97) % P97;
  return { x: x3, y: y3 };
}

// 3. Canvas Rendering

function formatCoordHex(bigintVal) {
  if (bigintVal === null || bigintVal === undefined) return "Infinity (O)";
  return "0x" + bigintVal.toString(16).toUpperCase().padStart(64, "0");
}

function clearCanvas() {
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// Convert real math coords (x in [-2.5, 3.5], y in [-6, 6]) to 400x400 canvas
function toCanvasReal(x, y) {
  const xMin = -2.5, xMax = 3.5;
  const yMin = -6.0, yMax = 6.0;
  const cx = ((x - xMin) / (xMax - xMin)) * canvas.width;
  const cy = canvas.height - ((y - yMin) / (yMax - yMin)) * canvas.height;
  return [cx, cy];
}

// Render Continuous Curve over R
function drawRealCurvePlot() {
  clearCanvas();
  const w = canvas.width;
  const h = canvas.height;

  // 1. Grid & Axes
  ctx.strokeStyle = "#F0F0F0";
  ctx.lineWidth = 1;
  for (let x = -2; x <= 3; x++) {
    const [cx] = toCanvasReal(x, 0);
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, h);
    ctx.stroke();
  }
  for (let y = -4; y <= 4; y += 2) {
    const [, cy] = toCanvasReal(0, y);
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(w, cy);
    ctx.stroke();
  }

  // Axes X and Y
  const [ox, oy] = toCanvasReal(0, 0);
  ctx.strokeStyle = "#CCCCCC";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, oy);
  ctx.lineTo(w, oy);
  ctx.moveTo(ox, 0);
  ctx.lineTo(ox, h);
  ctx.stroke();

  // Axis Labels & Numbers
  ctx.fillStyle = "#555555";
  ctx.font = "10px monospace";
  for (let x = -2; x <= 3; x++) {
    if (x === 0) continue;
    const [cx, cy] = toCanvasReal(x, 0);
    ctx.fillText(`${x}`, cx - 3, cy + 12);
  }
  for (let y = -4; y <= 4; y += 2) {
    if (y === 0) continue;
    const [cx, cy] = toCanvasReal(0, y);
    ctx.fillText(`${y}`, cx + 4, cy + 3);
  }

  // 2. Draw Continuous Curve: y = +/- sqrt(x^3 + 7)
  const minX = -Math.cbrt(7); // ~ -1.91293
  ctx.strokeStyle = "#111111";
  ctx.lineWidth = 2;

  // Upper branch
  ctx.beginPath();
  let first = true;
  for (let x = minX; x <= 3.4; x += 0.015) {
    const val = x * x * x + 7;
    if (val >= 0) {
      const y = Math.sqrt(val);
      const [cx, cy] = toCanvasReal(x, y);
      if (first) {
        ctx.moveTo(cx, cy);
        first = false;
      } else {
        ctx.lineTo(cx, cy);
      }
    }
  }
  ctx.stroke();

  // Lower branch
  ctx.beginPath();
  first = true;
  for (let x = minX; x <= 3.4; x += 0.015) {
    const val = x * x * x + 7;
    if (val >= 0) {
      const y = -Math.sqrt(val);
      const [cx, cy] = toCanvasReal(x, y);
      if (first) {
        ctx.moveTo(cx, cy);
        first = false;
      } else {
        ctx.lineTo(cx, cy);
      }
    }
  }
  ctx.stroke();

  // Curve label
  ctx.fillStyle = "#111111";
  ctx.font = "bold 12px system-ui, sans-serif";
  ctx.fillText("y² = x³ + 7  (over ℝ)", 12, 22);

  // 3. Tangent / Secant chord line if present
  if (activeChord && activeChord.lam !== undefined) {
    ctx.strokeStyle = "#0055FF";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    const xLeft = -2.5;
    const yLeft = activeChord.p1.y + activeChord.lam * (xLeft - activeChord.p1.x);
    const xRight = 3.5;
    const yRight = activeChord.p1.y + activeChord.lam * (xRight - activeChord.p1.x);
    const [cxl, cyl] = toCanvasReal(xLeft, yLeft);
    const [cxr, cyr] = toCanvasReal(xRight, yRight);
    ctx.beginPath();
    ctx.moveTo(cxl, cyl);
    ctx.lineTo(cxr, cyr);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 4. Draw Past Real Points
  for (let i = 0; i < realPoints.length; i++) {
    const pt = realPoints[i];
    if (pt && Math.abs(pt.x) < 5 && Math.abs(pt.y) < 8) {
      const [cx, cy] = toCanvasReal(pt.x, pt.y);
      ctx.fillStyle = "#111111";
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fill();

      // Label point index if small count
      if (realPoints.length <= 15) {
        ctx.font = "9px monospace";
        ctx.fillText(`${i + 1}G`, cx + 6, cy - 4);
      }
    }
  }

  // 5. Draw Current Real Point
  if (realPoints.length > 0) {
    const cur = realPoints[realPoints.length - 1];
    if (cur && Math.abs(cur.x) < 5 && Math.abs(cur.y) < 8) {
      const [cx, cy] = toCanvasReal(cur.x, cur.y);
      ctx.fillStyle = "#0055FF";
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  pointCounter.textContent = `Points plotted: ${realPoints.length}`;
}

// Render Discrete Curve over F97
function drawDiscreteCurvePlot() {
  clearCanvas();
  const w = canvas.width;
  const h = canvas.height;
  const pad = 24;
  const span = w - 2 * pad;

  function toCanvas97(x, y) {
    const cx = pad + (x / (P97 - 1)) * span;
    const cy = h - pad - (y / (P97 - 1)) * span;
    return [cx, cy];
  }

  // Draw Grid Boundary
  ctx.strokeStyle = "#CCCCCC";
  ctx.lineWidth = 1;
  ctx.strokeRect(pad, pad, span, span);

  ctx.fillStyle = "#555555";
  ctx.font = "9px monospace";
  ctx.fillText("0", pad - 12, h - pad + 4);
  ctx.fillText("96", pad + span - 8, h - pad + 14);
  ctx.fillText("96", pad - 18, pad + 8);

  // Draw all 78 points of the discrete curve in light gray
  ctx.fillStyle = "#CCCCCC";
  for (let i = 0; i < ALL_POINTS_97.length; i++) {
    const pt = ALL_POINTS_97[i];
    const [cx, cy] = toCanvas97(pt.x, pt.y);
    ctx.fillRect(Math.round(cx - 1), Math.round(cy - 1), 3, 3);
  }

  // Title
  ctx.fillStyle = "#111111";
  ctx.font = "bold 12px system-ui, sans-serif";
  ctx.fillText("y² ≡ x³ + 7 (mod 97) [78 curve points]", 12, 18);

  // Visited points in black
  ctx.fillStyle = "#111111";
  for (let i = 0; i < f97Points.length; i++) {
    const pt = f97Points[i];
    if (pt) {
      const [cx, cy] = toCanvas97(pt.x, pt.y);
      ctx.fillRect(Math.round(cx - 2), Math.round(cy - 2), 5, 5);
    }
  }

  // Current point in blue
  if (f97Points.length > 0) {
    const cur = f97Points[f97Points.length - 1];
    if (cur) {
      const [cx, cy] = toCanvas97(cur.x, cur.y);
      ctx.fillStyle = "#0055FF";
      ctx.fillRect(Math.round(cx - 3), Math.round(cy - 3), 7, 7);
    }
  }

  pointCounter.textContent = `Points plotted: ${f97Points.length}`;
}

// Render secp256k1 Finite Field Normalized Scatter
function drawFiniteScatterPlot() {
  clearCanvas();
  const w = canvas.width;
  const h = canvas.height;

  // Reference faint continuous curve shape across the unit square
  ctx.strokeStyle = "#EEEEEE";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 4; i++) {
    const pos = (i / 4) * w;
    ctx.moveTo(pos, 0);
    ctx.lineTo(pos, h);
    ctx.moveTo(0, pos);
    ctx.lineTo(w, pos);
  }
  ctx.stroke();

  // Title
  ctx.fillStyle = "#111111";
  ctx.font = "bold 12px system-ui, sans-serif";
  ctx.fillText("secp256k1 (𝔽ₚ): Q = kG (x/p, y/p) ∈ [0, 1]²", 12, 18);

  // Draw past points: 3x3 black squares
  ctx.fillStyle = "#111111";
  for (let i = 0; i < secpPoints.length; i++) {
    const pt = secpPoints[i];
    if (pt) {
      const px = (Number(pt.x >> 240n) / 65535) * w;
      const py = (Number(pt.y >> 240n) / 65535) * h;
      ctx.fillRect(Math.round(px - 1), Math.round(py - 1), 3, 3);
    }
  }

  // Draw current point: 5x5 blue square
  if (secpPoints.length > 0) {
    const cur = secpPoints[secpPoints.length - 1];
    if (cur) {
      ctx.fillStyle = "#0055FF";
      const curPx = (Number(cur.x >> 240n) / 65535) * w;
      const curPy = (Number(cur.y >> 240n) / 65535) * h;
      ctx.fillRect(Math.round(curPx - 2), Math.round(curPy - 2), 5, 5);
    }
  }

  pointCounter.textContent = `Points plotted: ${secpPoints.length}`;
}

function drawCurrentPlot() {
  if (currentView === "real") {
    drawRealCurvePlot();
  } else if (currentView === "discrete") {
    drawDiscreteCurvePlot();
  } else {
    drawFiniteScatterPlot();
  }
}

// 4. UI Updating & Trace Logging

function updateUI(step, totalSteps, opName, Q_secp, Q_real, Q_f97, activeBitIdx = -1) {
  stepCounter.textContent = `Step: ${step} / ${totalSteps}`;
  opBadge.textContent = opName;
  opBadge.className = "op-badge";

  if (Q_secp) {
    coordX.textContent = formatCoordHex(Q_secp.x);
    coordY.textContent = formatCoordHex(Q_secp.y);
    secpPoints.push({ x: Q_secp.x, y: Q_secp.y });
  } else {
    coordX.textContent = "Point at Infinity (O)";
    coordY.textContent = "Point at Infinity (O)";
  }

  if (Q_real) {
    realPoints.push(Q_real);
  }
  if (Q_f97) {
    f97Points.push(Q_f97);
  }

  // Redraw active canvas view
  drawCurrentPlot();

  // Update binary display bit cell highlight
  if (activeBitIdx >= 0) {
    const bitCells = binaryDisplay.querySelectorAll(".bit-cell");
    bitCells.forEach((cell, idx) => {
      cell.classList.remove("active");
      if (idx < activeBitIdx) {
        cell.classList.add("done");
      } else if (idx === activeBitIdx) {
        cell.classList.add("active");
      }
    });
  }

  // Append log entry
  const entry = document.createElement("div");
  entry.className = "log-entry active-log";
  const xSnippet = Q_secp ? "0x" + Q_secp.x.toString(16).substring(0, 8) + "..." : "O";
  entry.textContent = `[#${step}] ${opName} -> Q.x: ${xSnippet}`;
  logBox.appendChild(entry);
  logBox.scrollTop = logBox.scrollHeight;
}

// 5. Scalar Multiplication Execution

// Method 1: Linear / Naive (G + G + ...)
async function computeNaive(k, currentRunId) {
  const totalSteps = Number(k);
  let step = 1;

  let Q_secp = { x: G.x, y: G.y };
  let Q_real = { x: G_REAL.x, y: G_REAL.y };
  let Q_f97 = { x: G97.x, y: G97.y };
  activeChord = null;

  updateUI(step, totalSteps, "INIT Q = G", Q_secp, Q_real, Q_f97);

  let delay = parseInt(delaySlider.value, 10);
  await sleep(delay);

  for (let i = 2n; i <= k; i++) {
    if (currentRunId !== runId) return;

    step++;
    const prevReal = Q_real;
    Q_secp = pointAdd(Q_secp, G);
    Q_real = realAdd(Q_real, G_REAL);
    Q_f97 = f97Add(Q_f97, G97);

    activeChord = prevReal && G_REAL ? { p1: prevReal, p2: G_REAL, lam: (G_REAL.y - prevReal.y) / (G_REAL.x - prevReal.x) } : null;

    updateUI(step, totalSteps, `Q = Q + G (i=${i})`, Q_secp, Q_real, Q_f97);

    delay = parseInt(delaySlider.value, 10);
    await sleep(delay);
  }

  if (currentRunId === runId) {
    activeChord = null;
    drawCurrentPlot();
    opBadge.textContent = "COMPLETED";
    opBadge.className = "op-badge done";
    finishExecution();
  }
}

// Method 2: Double-and-Add (O(log k))
async function computeDoubleAndAdd(k, currentRunId) {
  const bits = k.toString(2);

  let totalSteps = 1; // init
  for (let i = 1; i < bits.length; i++) {
    totalSteps++; // DOUBLE
    if (bits[i] === "1") {
      totalSteps++; // ADD G
    }
  }

  binaryDisplay.innerHTML = "";
  for (let i = 0; i < bits.length; i++) {
    const span = document.createElement("span");
    span.className = "bit-cell";
    span.textContent = bits[i];
    binaryDisplay.appendChild(span);
  }

  let step = 1;
  let Q_secp = { x: G.x, y: G.y };
  let Q_real = { x: G_REAL.x, y: G_REAL.y };
  let Q_f97 = { x: G97.x, y: G97.y };
  activeChord = null;

  updateUI(step, totalSteps, "INIT Q = G (bit 0 = 1)", Q_secp, Q_real, Q_f97, 0);

  let delay = parseInt(delaySlider.value, 10);
  await sleep(delay);

  for (let i = 1; i < bits.length; i++) {
    if (currentRunId !== runId) return;

    // Double step
    step++;
    const prevRealDouble = Q_real;
    Q_secp = pointDouble(Q_secp);
    Q_real = realDouble(Q_real);
    Q_f97 = f97Double(Q_f97);

    activeChord = prevRealDouble ? { p1: prevRealDouble, p2: prevRealDouble, lam: (3 * prevRealDouble.x * prevRealDouble.x) / (2 * prevRealDouble.y) } : null;

    updateUI(step, totalSteps, `DOUBLE (bit [${i}] = ${bits[i]})`, Q_secp, Q_real, Q_f97, i);

    delay = parseInt(delaySlider.value, 10);
    await sleep(delay);

    if (currentRunId !== runId) return;

    // Add step if bit is 1
    if (bits[i] === "1") {
      step++;
      const prevRealAdd = Q_real;
      Q_secp = pointAdd(Q_secp, G);
      Q_real = realAdd(Q_real, G_REAL);
      Q_f97 = f97Add(Q_f97, G97);

      activeChord = prevRealAdd && G_REAL ? { p1: prevRealAdd, p2: G_REAL, lam: (G_REAL.y - prevRealAdd.y) / (G_REAL.x - prevRealAdd.x) } : null;

      updateUI(step, totalSteps, `ADD G (bit [${i}] = 1)`, Q_secp, Q_real, Q_f97, i);

      delay = parseInt(delaySlider.value, 10);
      await sleep(delay);
    }
  }

  if (currentRunId === runId) {
    activeChord = null;
    drawCurrentPlot();
    const bitCells = binaryDisplay.querySelectorAll(".bit-cell");
    bitCells.forEach((c) => {
      c.classList.remove("active");
      c.classList.add("done");
    });
    opBadge.textContent = "COMPLETED";
    opBadge.className = "op-badge done";
    finishExecution();
  }
}

// 6. Reset & Run Handlers

function resetUI() {
  runId++;
  isRunning = false;
  secpPoints = [];
  realPoints = [];
  f97Points = [];
  activeChord = null;

  btnRun.textContent = "Run Multiplication";
  btnRun.disabled = false;
  methodSelect.disabled = false;
  privateKeyInput.disabled = false;

  stepCounter.textContent = "Step: 0 / 0";
  opBadge.textContent = "IDLE";
  opBadge.className = "op-badge idle";

  coordX.textContent = "None (not started)";
  coordY.textContent = "None (not started)";

  binaryDisplay.innerHTML = '<span class="bit-cell">Press Run to inspect binary expansion</span>';
  logBox.innerHTML = '<div class="log-entry">Waiting for execution...</div>';

  drawCurrentPlot();
  pointCounter.textContent = "Points plotted: 0";
}

function finishExecution() {
  isRunning = false;
  btnRun.textContent = "Run Multiplication";
  btnRun.disabled = false;
  methodSelect.disabled = false;
  privateKeyInput.disabled = false;
}

btnReset.addEventListener("click", () => {
  resetUI();
});

btnRun.addEventListener("click", async () => {
  const kStr = privateKeyInput.value.trim();

  if (!kStr || !/^\d+$/.test(kStr)) {
    alert("Please enter a valid positive integer for scalar k.");
    return;
  }

  const k = BigInt(kStr);
  if (k <= 0n) {
    alert("Scalar k must be greater than or equal to 1.");
    return;
  }

  const method = methodSelect.value;
  if (method === "naive" && k > 1000n) {
    const confirmRun = confirm(
      `Warning: Naive method will perform ${k} sequential steps and point additions, which may take significant time.\n\nDo you want to continue? (Click Cancel to switch to Double-and-Add)`
    );
    if (!confirmRun) return;
  }

  runId++;
  const currentRunId = runId;
  isRunning = true;
  secpPoints = [];
  realPoints = [];
  f97Points = [];
  activeChord = null;

  btnRun.disabled = true;
  btnRun.textContent = "Running...";
  methodSelect.disabled = true;
  privateKeyInput.disabled = true;

  logBox.innerHTML = "";
  drawCurrentPlot();

  if (method === "naive") {
    binaryDisplay.innerHTML = `<span class="bit-cell">Naive mode: scalar k = ${k.toString()}</span>`;
    await computeNaive(k, currentRunId);
  } else {
    await computeDoubleAndAdd(k, currentRunId);
  }
});

// Initial render
updateViewMetadata();
drawCurrentPlot();
