// ============================================================================
//  The wheel: drawing, the satisfying spin animation, sound & confetti.
//  Drawing is THEME-AWARE — each theme gets its own palette, ring, hub, pointer
//  and label treatment (see wheelStyle), so the wheel is redesigned per theme.
// ============================================================================

function wheelStyle() {
  const t = document.documentElement.getAttribute("data-theme") || "a24";
  const styles = {
    // A24: stark black & white, alternating segments, thin minimal pointer
    a24: {
      alternate: ["#0a0a0a", "#ffffff"],
      segStroke: "#111111", segStrokeW: 1.5, ring: "#111111", ringW: 2,
      hubFill: "#0a0a0a", hubStroke: "#ffffff", hubR: 17,
      pointerFill: "#0a0a0a", pointerStroke: "#ffffff", pointerW: 14,
      labelFont: '800 14px "Archivo", system-ui, sans-serif', upper: true,
      emptyText: "#9a9a9a", emptyFill: "rgba(0,0,0,0.05)",
    },
    // The Strokes: bright GeoCities clip-art colours, thick black outlines, chunky
    strokes: {
      palette: ["#ff2424", "#0000cc", "#00a000", "#ffd000", "#cc00cc", "#00a8c0", "#ff7e00"],
      segStroke: "#000000", segStrokeW: 3, ring: "#000000", ringW: 4,
      hubFill: "#000000", hubStroke: "#ffff00", hubR: 20,
      pointerFill: "#ffd000", pointerStroke: "#000000", pointerW: 22,
      labelFont: '700 15px "Pixelify Sans", "Courier New", monospace', upper: false,
      labelColor: "#ffffff", labelStroke: "#000000",
      emptyText: "#ffffff", emptyFill: "rgba(255,255,255,0.14)",
    },
  };
  // Per-theme dark-mode patches, merged over the light style when [data-mode="dark"].
  const darkPatch = {
    a24: {
      alternate: ["#e8e9ec", "#2a2e39"], segStroke: "#0e0f13", ring: "#5b6270",
      hubFill: "#14151a", hubStroke: "#f0f1f3", pointerFill: "#f0f1f3", pointerStroke: "#0e0f13",
      emptyText: "#9aa0ab", emptyFill: "rgba(255,255,255,0.05)",
    },
    strokes: {}, // wheel sits in a light Win95 window — unchanged
  };
  const base = styles[t] || styles.a24;
  const dark = document.documentElement.getAttribute("data-mode") === "dark";
  return dark ? { ...base, ...(darkPatch[t] || {}) } : base;
}

function isDark(hex) {
  const c = hex.replace("#", "");
  const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b < 140;
}

// Size the canvas backing store to the device pixel ratio so the wheel is crisp
// on retina / mobile, while we keep drawing in logical (CSS-pixel) coordinates.
function setupHiDPI(canvas, logical) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(logical * dpr);
  canvas.height = Math.round(logical * dpr);
  canvas.style.width = logical + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

// ---- audio ----------------------------------------------------------------
let muted = false;
let audioCtx = null;

export function setMuted(v) { muted = !!v; }
export function isMuted() { return muted; }

export function resumeAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch (_) {}
}

function tone(freq, dur, type, vol) {
  if (muted) return;
  try {
    resumeAudio();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + dur);
  } catch (_) {}
}

const tick = (freq) => tone(freq, 0.04, "square", 0.12);
function ding() {
  tone(880, 0.5, "triangle", 0.25);
  setTimeout(() => tone(1320, 0.55, "triangle", 0.2), 90);
}

function burstConfetti() {
  if (typeof window.confetti !== "function") return;
  window.confetti({ particleCount: 160, spread: 90, origin: { y: 0.6 } });
  setTimeout(() => window.confetti({ particleCount: 80, angle: 60, spread: 70, origin: { x: 0 } }), 150);
  setTimeout(() => window.confetti({ particleCount: 80, angle: 120, spread: 70, origin: { x: 1 } }), 300);
}

// ---- drawing ---------------------------------------------------------------
function pageBg() {
  try { return getComputedStyle(document.body).backgroundColor || "#ffffff"; }
  catch (_) { return "#ffffff"; }
}

// Punch round holes around a radius (filled with the page bg so they read as cut
// through) — this is what gives the wheel its film-reel character.
function drawHoles(ctx, cx, cy, radius, holeR, count, fill, edge, rot) {
  for (let k = 0; k < count; k++) {
    const a = (rot || 0) + (k / count) * 2 * Math.PI;
    const x = cx + radius * Math.cos(a), y = cy + radius * Math.sin(a);
    ctx.beginPath();
    ctx.arc(x, y, holeR, 0, 2 * Math.PI);
    ctx.fillStyle = fill;
    ctx.fill();
    if (edge) { ctx.lineWidth = 1.5; ctx.strokeStyle = edge; ctx.stroke(); }
  }
}

// The reel's outer band: a clean thick rim. Real reels have a smooth rim (no
// perimeter holes), and on our wheel that's where the film titles sit.
function drawReelRim(ctx, cx, cy, rSeg, rOuter, s) {
  const band = rOuter - rSeg;
  ctx.beginPath();
  ctx.arc(cx, cy, (rSeg + rOuter) / 2, 0, 2 * Math.PI);
  ctx.strokeStyle = s.ring; ctx.lineWidth = band; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, rOuter, 0, 2 * Math.PI);
  ctx.strokeStyle = s.ring; ctx.lineWidth = s.ringW; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, rSeg, 0, 2 * Math.PI);
  ctx.strokeStyle = s.ring; ctx.lineWidth = s.ringW; ctx.stroke();
}

// The reel hub: a centre cap ringed with small holes, plus a spindle (hole+pin).
function drawReelHub(ctx, cx, cy, s, bg, rot) {
  ctx.beginPath(); ctx.arc(cx, cy, s.hubR, 0, 2 * Math.PI);
  ctx.fillStyle = s.hubFill; ctx.fill();
  ctx.strokeStyle = s.hubStroke; ctx.lineWidth = 3; ctx.stroke();
  drawHoles(ctx, cx, cy, s.hubR * 0.56, Math.max(1.5, s.hubR * 0.13), 6, bg, null, rot);
  ctx.beginPath(); ctx.arc(cx, cy, s.hubR * 0.28, 0, 2 * Math.PI);
  ctx.fillStyle = bg; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, Math.max(1.5, s.hubR * 0.1), 0, 2 * Math.PI);
  ctx.fillStyle = s.hubStroke; ctx.fill();
}

function drawWheel(ctx, size, segments, rotation, highlightIndex) {
  const s = wheelStyle();
  const n = segments.length;
  const cx = size / 2, cy = size / 2;
  const rOuter = size / 2 - 6;
  const band = Math.max(16, size * 0.05);
  const rSeg = rOuter - band;        // the segmented disc sits inside the reel rim
  const bg = pageBg();
  const seg = (2 * Math.PI) / n;
  ctx.clearRect(0, 0, size, size);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  for (let i = 0; i < n; i++) {
    const a0 = i * seg + rotation;
    const a1 = (i + 1) * seg + rotation;
    const fill = s.alternate ? s.alternate[i % s.alternate.length] : s.palette[i % s.palette.length];

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, rSeg, a0, a1);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (i === highlightIndex) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fill();
      ctx.restore();
    }
    ctx.strokeStyle = s.segStroke;
    ctx.lineWidth = s.segStrokeW;
    ctx.stroke();

    // label, drawn from the rim inward
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a0 + seg / 2);
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.font = s.labelFont;
    let title = segments[i].title || "";
    if (s.upper) title = title.toUpperCase();
    const label = title.length > 16 ? title.slice(0, 15) + "…" : title;

    let lc, ls;
    if (s.alternate) { lc = isDark(fill) ? "#ffffff" : "#0a0a0a"; ls = null; }
    else { lc = s.labelColor; ls = s.labelStroke; }
    if (ls) { ctx.lineWidth = 3; ctx.strokeStyle = ls; ctx.strokeText(label, rSeg - 14, 0); }
    ctx.fillStyle = lc;
    ctx.fillText(label, rSeg - 14, 0);
    ctx.restore();
  }

  // reel spokes — the section separators, drawn over the seams as raised arms
  ctx.strokeStyle = s.ring;
  ctx.lineWidth = Math.max(s.segStrokeW + 1, size * 0.011);
  ctx.lineCap = "butt";
  for (let i = 0; i < n; i++) {
    const a = i * seg + rotation;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (s.hubR - 1), cy + Math.sin(a) * (s.hubR - 1));
    ctx.lineTo(cx + Math.cos(a) * rSeg, cy + Math.sin(a) * rSeg);
    ctx.stroke();
  }
  ctx.lineCap = "round";

  drawReelRim(ctx, cx, cy, rSeg, rOuter, s);
  drawReelHub(ctx, cx, cy, s, bg, rotation);
}

function drawPointer(ctx, size) {
  const s = wheelStyle();
  const cx = size / 2;
  const w = s.pointerW;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.fillStyle = s.pointerFill;
  ctx.strokeStyle = s.pointerStroke;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - w, 0);
  ctx.lineTo(cx + w, 0);
  ctx.lineTo(cx, w * 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// Static wheel shown on the Wheel tab.
export function renderIdleWheel(canvas, movies) {
  const s = wheelStyle();
  const size = 460;
  const ctx = setupHiDPI(canvas, size);
  if (!movies.length) {
    ctx.clearRect(0, 0, size, size);
    const cx = size / 2, cy = size / 2;
    const rOuter = size / 2 - 6;
    const rSeg = rOuter - Math.max(16, size * 0.05);
    const bg = pageBg();
    ctx.fillStyle = s.emptyFill;
    ctx.beginPath();
    ctx.arc(cx, cy, rSeg, 0, 2 * Math.PI);
    ctx.fill();
    drawReelRim(ctx, cx, cy, rSeg, rOuter, s);
    drawReelHub(ctx, cx, cy, s, bg, 0);
    ctx.fillStyle = s.emptyText;
    ctx.font = "16px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Add books to fill the wheel", cx, cy - s.hubR - 22);
    return;
  }
  drawWheel(ctx, size, movies.map((m) => ({ id: m.id, title: m.title })), 0, -1);
  drawPointer(ctx, size);
}

export function chooseWinnerIndex(n) {
  return Math.floor(Math.random() * n);
}

// ---- the spin animation overlay -------------------------------------------
// Respect the OS "reduce motion" setting: motion-sensitive users get the result
// without the long spin or the confetti burst. (CSS already neutralises the
// overlay's fade/pop animations under the same query — this covers the parts
// driven by JS: the canvas rotation, confetti and vibration.)
const prefersReducedMotion = () => {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  catch (_) { return false; }
};

function playSpinOverlay(spin, onDone) {
  const segments = spin.segments || [];
  const n = segments.length;
  if (n === 0) { onDone?.(); return; }
  const winnerIndex = Math.min(Math.max(spin.winnerIndex || 0, 0), n - 1);
  const duration = spin.durationMs || 6000;
  const reduce = prefersReducedMotion();

  const overlay = document.createElement("div");
  overlay.className = "spin-overlay";
  overlay.innerHTML = `
    <div class="spin-stage">
      <div class="spin-pointer-label">spinning the wheel…</div>
      <canvas class="spin-canvas" width="520" height="520"></canvas>
      <div class="spin-caption"></div>
    </div>`;
  document.body.appendChild(overlay);

  const canvas = overlay.querySelector(".spin-canvas");
  const caption = overlay.querySelector(".spin-caption");
  const size = 500;
  const ctx = setupHiDPI(canvas, size);
  const seg = (2 * Math.PI) / n;

  // Land somewhere INSIDE the winning wedge (not dead-centre) under the top
  // pointer (-90°), plus full spins. The offset is derived from the seed so every
  // client lands identically, and is kept clear of the wedge edges so the pointer
  // never straddles a seam (which would read as the wrong film).
  const pointer = -Math.PI / 2;
  const landFrac = 0.25 + (((spin.seed || 0) % 1000) / 1000) * 0.5; // 0.25–0.75 of the wedge
  const landAngle = (winnerIndex + landFrac) * seg;
  const spins = 8 + (Math.floor((spin.seed || 0) / 137) % 3); // deterministic flair (8–10 turns)
  let aligned = pointer - landAngle;
  aligned = ((aligned % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const target = spins * 2 * Math.PI + aligned;

  const startTime = performance.now();
  let lastBoundary = 0;
  resumeAudio();

  function frame(now) {
    const t = Math.min(1, (now - startTime) / duration);
    const eased = 1 - Math.pow(1 - t, 5); // easeOutQuint — slow, satisfying settle
    const rotation = eased * target;
    // easeOutQuint's tail crawls in imperceptibly, so we cut it rather than wait
    // out the full timer. Keep the threshold tight (~0.1°): cutting too early
    // froze the wheel — and flipped on the winner highlight — while it was still
    // visibly turning, which read as the result "jumping in" before it settled.
    // Snap the final frame to the exact target so it lands cleanly.
    const settled = t >= 1 || target - rotation < 0.002;
    drawWheel(ctx, size, segments, settled ? target : rotation, settled ? winnerIndex : -1);
    drawPointer(ctx, size);

    const boundary = Math.floor(rotation / seg);
    if (boundary !== lastBoundary) {
      tick(900 + (1 - t) * 500);
      navigator.vibrate?.(8);
      lastBoundary = boundary;
    }

    if (!settled) requestAnimationFrame(frame);
    else finish();
  }

  function finish() {
    ding(); // audio is gated by mute, not by reduced-motion
    caption.textContent = segments[winnerIndex].title || "";
    caption.classList.add("win");
    if (!reduce) {
      navigator.vibrate?.([20, 40, 90]);
      burstConfetti();
    }
    setTimeout(() => {
      overlay.classList.add("closing");
      setTimeout(() => { overlay.remove(); onDone?.(); }, reduce ? 200 : 600);
    }, reduce ? 1100 : 1700);
  }

  // Reduced motion: skip the spin entirely — draw the landed wheel and announce
  // the winner straight away, no rotation.
  if (reduce) {
    overlay.querySelector(".spin-pointer-label").textContent = "the wheel picked";
    drawWheel(ctx, size, segments, target, winnerIndex);
    drawPointer(ctx, size);
    finish();
    return;
  }

  requestAnimationFrame(frame);
}

// Play the spin once per unique seed, and only if it's happening right now
// (so reloading the page later doesn't replay an old spin).
let lastPlayedSeed = null;
export function maybePlaySpin(lastSpin, onDone) {
  if (!lastSpin || !lastSpin.seed) { onDone?.(); return; }
  if (lastSpin.seed === lastPlayedSeed) { onDone?.(); return; }
  lastPlayedSeed = lastSpin.seed;
  const age = Date.now() - (lastSpin.startedAt || 0);
  if (age > (lastSpin.durationMs || 6000) + 5000) { onDone?.(); return; }
  playSpinOverlay(lastSpin, onDone);
}
