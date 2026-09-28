/* The background "knowledge constellation".
 * Each drifting star stands for an indexed chunk. Asking a question drops a probe into the
 * field that fires beams at its k nearest stars — a picture of the top-k vector search that is
 * actually happening on the server. */
(function () {
  const canvas = document.getElementById("constellation");
  const ctx = canvas.getContext("2d");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let W = 0, H = 0, dpr = 1;
  let nodes = [];
  const mouse = { x: -9999, y: -9999 };
  const color = { r: 103, g: 232, b: 249 };
  const target = { r: 103, g: 232, b: 249 };
  let probe = null;       // { x, y, born, targets: [node], locked, fading, fadeStart }
  const ripples = [];

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.round(Math.min(120, Math.max(38, (W * H) / 13000)));
    while (nodes.length < count) nodes.push(makeNode());
    nodes.length = count;
  }

  function makeNode() {
    const depth = Math.random();
    return {
      x: Math.random() * W, y: Math.random() * H,
      vx: (Math.random() - .5) * .18 * (0.4 + depth), vy: (Math.random() - .5) * .18 * (0.4 + depth),
      r: 0.6 + depth * 1.6, depth, phase: Math.random() * Math.PI * 2,
      glow: 0, glowTarget: 0,
    };
  }

  const rgba = (a) => `rgba(${color.r | 0},${color.g | 0},${color.b | 0},${a})`;

  function step(t) {
    // ease the accent colour toward the current mode's colour
    color.r += (target.r - color.r) * .05;
    color.g += (target.g - color.g) * .05;
    color.b += (target.b - color.b) * .05;

    ctx.clearRect(0, 0, W, H);

    for (const n of nodes) {
      n.x += n.vx; n.y += n.vy;
      if (n.x < -20) n.x = W + 20; else if (n.x > W + 20) n.x = -20;
      if (n.y < -20) n.y = H + 20; else if (n.y > H + 20) n.y = -20;
      // stars lean very slightly toward the cursor
      const dx = mouse.x - n.x, dy = mouse.y - n.y, d2 = dx * dx + dy * dy;
      if (d2 < 160 * 160) { n.x += dx * .0016 * n.depth; n.y += dy * .0016 * n.depth; }
      n.glow += (n.glowTarget - n.glow) * .06;
    }

    // links
    const maxD = Math.min(150, Math.max(90, W / 10));
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const dx = a.x - b.x, dy = a.y - b.y, d = Math.hypot(dx, dy);
        if (d < maxD) {
          const alpha = (1 - d / maxD) * .16 * (0.5 + (a.depth + b.depth) / 2) + (a.glow + b.glow) * .12;
          ctx.strokeStyle = rgba(alpha);
          ctx.lineWidth = .6;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
    }

    // probe beams
    if (probe) drawProbe(t);

    // ripples
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i], age = (t - r.born) / 1400;
      if (age >= 1) { ripples.splice(i, 1); continue; }
      ctx.strokeStyle = rgba((1 - age) * .5);
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(r.x, r.y, 8 + age * 180, 0, Math.PI * 2); ctx.stroke();
    }

    // stars
    for (const n of nodes) {
      const tw = .55 + .45 * Math.sin(t / 900 + n.phase);
      const a = (.25 + n.depth * .45) * tw + n.glow * .8;
      if (n.glow > .05) {
        const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, 18 * n.glow + 4);
        g.addColorStop(0, rgba(.55 * n.glow)); g.addColorStop(1, rgba(0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(n.x, n.y, 18 * n.glow + 4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = n.glow > .05 ? rgba(Math.min(1, a)) : `rgba(220,226,255,${a * .8})`;
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r + n.glow * 1.8, 0, Math.PI * 2); ctx.fill();
    }
  }

  function drawProbe(t) {
    const age = t - probe.born;
    let alpha = 1;
    if (probe.fading) {
      alpha = 1 - (t - probe.fadeStart) / 1600;
      if (alpha <= 0) { probe.targets.forEach((n) => (n.glowTarget = 0)); probe = null; return; }
    }
    // probe core, breathing while we wait
    const breathe = 1 + .25 * Math.sin(age / 180);
    const g = ctx.createRadialGradient(probe.x, probe.y, 0, probe.x, probe.y, 30 * breathe);
    g.addColorStop(0, rgba(.9 * alpha)); g.addColorStop(.25, rgba(.35 * alpha)); g.addColorStop(1, rgba(0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(probe.x, probe.y, 30 * breathe, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.beginPath(); ctx.arc(probe.x, probe.y, 2.6, 0, Math.PI * 2); ctx.fill();

    if (!probe.locked) {
      // scanning sweep while embedding + searching
      const ang = age / 260;
      ctx.strokeStyle = rgba(.35 * alpha); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(probe.x, probe.y, 46, ang, ang + 1.2); ctx.stroke();
      ctx.beginPath(); ctx.arc(probe.x, probe.y, 64, -ang * .8, -ang * .8 + .8); ctx.stroke();
      return;
    }
    probe.targets.forEach((n, i) => {
      const p = Math.min(1, Math.max(0, (t - probe.lockedAt - i * 110) / 520));
      if (p <= 0) return;
      const ex = probe.x + (n.x - probe.x) * p, ey = probe.y + (n.y - probe.y) * p;
      const grad = ctx.createLinearGradient(probe.x, probe.y, ex, ey);
      grad.addColorStop(0, rgba(.05 * alpha)); grad.addColorStop(1, rgba(.75 * alpha));
      ctx.strokeStyle = grad; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(probe.x, probe.y); ctx.lineTo(ex, ey); ctx.stroke();
      if (p >= 1 && !probe.fading) n.glowTarget = 1;
      // a packet travelling along the beam
      const q = ((t - probe.lockedAt) / 1300 + i * .17) % 1;
      if (p >= 1) {
        ctx.fillStyle = rgba(.9 * alpha);
        ctx.beginPath(); ctx.arc(probe.x + (n.x - probe.x) * q, probe.y + (n.y - probe.y) * q, 1.6, 0, Math.PI * 2); ctx.fill();
      }
    });
  }

  let raf = 0;
  function loop(t) { step(t); raf = requestAnimationFrame(loop); }

  function start() { if (!raf && !reduced) raf = requestAnimationFrame(loop); }
  function stop() { cancelAnimationFrame(raf); raf = 0; }

  window.addEventListener("resize", () => { resize(); if (reduced) step(0); });
  window.addEventListener("pointermove", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; }, { passive: true });
  window.addEventListener("pointerleave", () => { mouse.x = mouse.y = -9999; });
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));

  resize();
  if (reduced) step(0); else start();

  window.Constellation = {
    setAccent(rgb) {
      const [r, g, b] = rgb.split(",").map((v) => parseFloat(v));
      target.r = r; target.g = g; target.b = b;
      if (reduced) { Object.assign(color, target); step(0); }
    },
    /** Drop a probe; call .lock(k) when the sources arrive and .release() when done. */
    query() {
      if (probe) { probe.targets.forEach((n) => (n.glowTarget = 0)); }
      const now = performance.now();
      const x = W * (0.3 + Math.random() * 0.4), y = H * (0.25 + Math.random() * 0.3);
      probe = { x, y, born: now, targets: [], locked: false, fading: false };
      ripples.push({ x, y, born: now });
      const handle = probe;
      return {
        lock(k) {
          if (probe !== handle) return;
          const ranked = nodes.slice().sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
          handle.targets = ranked.slice(0, Math.max(1, Math.min(k || 5, 8)));
          handle.locked = true; handle.lockedAt = performance.now();
          ripples.push({ x, y, born: handle.lockedAt });
        },
        release() {
          if (probe !== handle || handle.fading) return;
          handle.fading = true; handle.fadeStart = performance.now();
          handle.targets.forEach((n) => (n.glowTarget = 0));
        },
      };
    },
  };
})();
