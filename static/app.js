(function () {
  "use strict";

  const MODES = {
    answer: { icon: "✦", rgb: "103,232,249", label: "Answer", placeholder: "Ask anything about algorithms…",
      example: "Why is binary search O(log n), and when can I use it on something that isn't an array?" },
    hint: { icon: "◐", rgb: "252,211,77", label: "Hint", placeholder: "Describe the problem — you'll get a nudge, not the answer…",
      example: "I need to find the first and last position of a target value in a sorted array. Where should I start thinking?" },
    debug: { icon: "⌁", rgb: "251,113,133", label: "Debug", placeholder: "Paste your code and say what goes wrong…",
      example: "This loops forever on some inputs — why?\n\nint lowerBound(vector<int>& a, int target) {\n    int left = 0, right = a.size() - 1;\n    while (left <= right) {\n        int mid = left + (right - left) / 2;\n        if (a[mid] < target) left = mid + 1;\n        else right = mid;\n    }\n    return left;\n}" },
    fetch: { icon: "⌖", rgb: "196,181,253", label: "Fetch", placeholder: "A problem id (1850A), a title, or a description…",
      example: "Find two numbers in an array that add up to a target" },
  };
  const STAGES = {
    llm: ["retrieve", "ground", "reason"],
    fetch: ["embed", "match"],
  };
  const ROTATE = ["see it", "find it", "debug it", "own it"];

  // How fast answers appear, in characters per second. The model streams far faster than anyone reads.
  const PACES = { calm: 45, normal: 110, fast: 280, instant: Infinity };
  const PACE_ORDER = ["calm", "normal", "fast", "instant"];
  const PACE_LABEL = { calm: "Calm", normal: "Normal", fast: "Fast", instant: "Instant" };

  // Sessions live only in this browser.
  const STORE_KEY = "tutor.sessions.v1";
  const PREFS_KEY = "tutor.prefs.v1";
  const MAX_SESSIONS = 50;
  const MAX_MESSAGES = 120;

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const body = document.body;
  const hero = $("#hero"), thread = $("#thread"), form = $("#composer"), input = $("#question");
  const send = $("#send"), glow = $(".modes-glow"), statusEl = $("#status"), hint = $("#composerHint");
  const topbar = $(".topbar"), jumpBtn = $("#jump"), paceBtn = $("#pace");
  const sidebar = $("#sidebar"), sbList = $("#sbList"), sbToggle = $("#sbToggle"), sbBackdrop = $("#sbBackdrop");

  let mode = "answer";
  let busy = false;
  let controller = null;
  let activeReveal = null;
  let requestSeq = 0;

  /* ---------- helpers ---------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function el(tag, cls, html) { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /* ---------- maths ----------
   * The model writes LaTeX: \[ … \] or $$ … $$ for display, \( … \) or $ … $ inline. Markdown would eat the
   * backslashes, so formulas are swapped for placeholders first, typeset with KaTeX, and put back afterwards.
   * Code (fenced or inline) is left alone, and "$5 and $10" stays text: inline $…$ needs no space just inside
   * the dollars and no digit right after the closing one. */
  const MATH_TOKEN = (i) => `%%KTX${i}%%`;

  function renderMath(src, display) {
    if (window.katex) {
      try { return katex.renderToString(src.trim(), { displayMode: display, throwOnError: false, output: "htmlAndMathml" }); }
      catch (_) { /* fall through to plain text */ }
    }
    return display ? `<pre class="math-src">${esc(src.trim())}</pre>` : `<code>${esc(src.trim())}</code>`;
  }

  function protectMath(text, store) {
    const keep = (src, display) => {
      store.push(renderMath(src, display));
      const token = MATH_TOKEN(store.length - 1);
      return display ? `\n\n${token}\n\n` : token;
    };
    // Odd-numbered parts are code: ``` fenced (possibly still open while streaming) or `inline`.
    return text.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g).map((part, i) => i % 2 ? part : part
      .replace(/\$\$([\s\S]+?)\$\$/g, (_, m) => keep(m, true))
      .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => keep(m, true))
      .replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => keep(m, false))
      .replace(/(^|[^\\$\w])\$(?!\s)([^$\n]+?)(?<!\s)\$(?![\d$\w])/g, (_, pre, m) => pre + keep(m, false))
    ).join("");
  }

  function markdown(text) {
    const math = [];
    const prepared = protectMath(text, math);
    const html = window.marked && window.DOMPurify
      ? DOMPurify.sanitize(marked.parse(prepared, { breaks: false, gfm: true }))
      : `<p style="white-space:pre-wrap">${esc(prepared)}</p>`;
    // KaTeX output is generated from escaped text by KaTeX itself, so it is inserted after sanitizing.
    return math.length ? html.replace(/%%KTX(\d+)%%/g, (t, i) => math[+i] ?? t) : html;
  }
  function decorateCode(root) {
    $$("pre code", root).forEach((code) => {
      if (window.hljs && !code.dataset.hl) { try { hljs.highlightElement(code); } catch (_) { /* unknown language */ } code.dataset.hl = 1; }
      const pre = code.parentElement;
      if (!$(".copy-btn", pre)) {
        const b = el("button", "copy-btn", "copy"); b.type = "button";
        b.onclick = () => navigator.clipboard?.writeText(code.innerText).then(() => { b.textContent = "copied"; setTimeout(() => (b.textContent = "copy"), 1200); });
        pre.appendChild(b);
      }
    });
  }

  /* ---------- visuals ----------
   * Three kinds of code block are drawn as pictures once an answer is complete:
   *   ```mermaid  a diagram (flowcharts, graphs), drawn by Mermaid, loaded only when first needed;
   *   ```tree     an indented outline (recursion trees, BSTs, heaps), turned into a Mermaid diagram here;
   *   ```trace    JSON describing an algorithm stepping over an array, drawn as a playable widget.
   * While the answer is still arriving they show a placeholder. Anything that can't be drawn stays a code block. */
  const MERMAID_URL = "https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.min.js";
  const VISUAL_LANGS = { mermaid: "a diagram", tree: "a tree", trace: "a step-by-step trace" };
  const POINTER_COLORS = ["#67e8f9", "#fcd34d", "#f0abfc", "#86efac", "#fca5a5", "#a5b4fc"];
  const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function visualBlocks(root) {
    return $$("pre > code", root).map((code) => {
      const lang = (/\blanguage-(mermaid|tree|trace)\b/.exec(code.className) || [])[1];
      return lang ? { lang, pre: code.parentElement, src: code.textContent } : null;
    }).filter(Boolean);
  }

  function renderVisuals(root, final) {
    for (const { lang, pre, src } of visualBlocks(root)) {
      if (!final) {
        pre.replaceWith(el("div", "visual-pending", `<i></i>Drawing ${VISUAL_LANGS[lang]}…`));
        continue;
      }
      const diagram = lang === "tree" ? treeToMermaid(src) : src;
      const widget = lang === "trace" ? traceWidget(src) : diagram && diagramWidget(diagram, pre, lang === "tree" ? "Tree" : "Diagram");
      if (widget) pre.replaceWith(widget);
    }
  }

  /* diagrams */
  let mermaidReady = null;
  function loadMermaid() {
    if (!mermaidReady) {
      mermaidReady = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = MERMAID_URL; s.async = true;
        s.onload = () => {
          window.mermaid.initialize({
            startOnLoad: false, securityLevel: "strict", theme: "base", fontFamily: "Inter, system-ui, sans-serif",
            themeVariables: {
              darkMode: true, background: "#0b0d18", primaryColor: "#14182b", primaryTextColor: "#eceef8",
              primaryBorderColor: "#67e8f9", lineColor: "#818cf8", secondaryColor: "#1a1530", tertiaryColor: "#0f1222",
              fontSize: "14px",
            },
          });
          resolve(window.mermaid);
        };
        s.onerror = () => { mermaidReady = null; reject(new Error("Mermaid failed to load")); };
        document.head.appendChild(s);
      });
    }
    return mermaidReady;
  }

  let mermaidQueue = Promise.resolve();   // Mermaid draws one diagram at a time
  function diagramWidget(src, pre, kind) {
    const fig = el("figure", "visual visual-diagram");
    fig.innerHTML = `<figcaption><span class="v-kind">${kind}</span></figcaption><div class="diagram-canvas"><div class="visual-pending"><i></i>Drawing a diagram…</div></div>`;
    const canvas = $(".diagram-canvas", fig);
    const id = "dg-" + uid();
    mermaidQueue = mermaidQueue.then(() => loadMermaid()).then(async (mermaid) => {
      const { svg } = await mermaid.render(id, src.trim());
      canvas.innerHTML = svg;
      fig.classList.add("drawn");
    }).catch(() => {
      document.getElementById(id)?.remove();         // Mermaid can leave a half-drawn node behind
      document.getElementById("d" + id)?.remove();
      decorateCode(pre);
      fig.replaceWith(pre);                           // show the source rather than nothing
    });
    return fig;
  }

  /* trees: one node per line, children indented under their parent; a line "-" is an empty child.
   * Repeated labels (fib(1) appears again and again in a recursion tree) are separate nodes, because the ids
   * are made up here instead of by the model, which tends to reuse or mix them up. */
  const MAX_TREE_NODES = 80;
  function treeToMermaid(src) {
    const nodes = [], edges = [], stack = [];
    for (const raw of src.replace(/\t/g, "  ").split("\n")) {
      if (!raw.trim()) continue;
      const lead = /^[\s│├└─|`]*/.exec(raw)[0];            // also accepts ASCII-art trees (├── child)
      const label = raw.slice(lead.length).replace(/^[-*+]\s+/, "").trim();
      if (!label) continue;
      if (nodes.length === MAX_TREE_NODES) return null;
      while (stack.length && stack[stack.length - 1].depth >= lead.length) stack.pop();
      const id = "n" + nodes.length;
      const empty = label === "-" || label === "∅";
      nodes.push(empty ? `${id}[" "]:::empty` : `${id}["${label.slice(0, 48).replace(/"/g, "#quot;")}"]`);
      if (stack.length) edges.push(`${stack[stack.length - 1].id} --> ${id}`);
      stack.push({ depth: lead.length, id });
    }
    if (!nodes.length) return null;
    return ["flowchart TD", ...nodes, ...edges, "classDef empty fill:transparent,stroke:#626887,stroke-dasharray:3 3"].join("\n");
  }

  /* traces */
  const MAX_CELLS = 40, MAX_STEPS = 60;
  const cellText = (v) => (v === null ? "∅" : String(v)).slice(0, 8);
  const isCell = (v) => v === null || ["number", "string", "boolean"].includes(typeof v);

  // Turns the model's JSON into a clean list of steps, or null if there's nothing drawable.
  function parseTrace(src) {
    let t;
    try { t = JSON.parse(src); } catch (_) { return null; }
    if (!t || typeof t !== "object" || !Array.isArray(t.steps) || !t.steps.length) return null;
    const okArray = (a) => Array.isArray(a) && a.length > 0 && a.length <= MAX_CELLS && a.every(isCell);
    let array = okArray(t.array) ? t.array.map(cellText) : null;
    const idx = (i, n, lo = 0, hi = n - 1) => Number.isInteger(i) && i >= lo && i <= hi;
    const steps = [];
    for (const s of t.steps.slice(0, MAX_STEPS)) {
      if (!s || typeof s !== "object") continue;
      if (okArray(s.array)) array = s.array.map(cellText);
      if (!array) continue;
      const n = array.length;
      const pointers = Object.entries(s.pointers && typeof s.pointers === "object" ? s.pointers : {})
        .filter(([name, i]) => name && idx(i, n, -1, n))   // -1 and n allowed: "before the start" / "past the end"
        .slice(0, 6).map(([name, i]) => ({ name: String(name).slice(0, 10), i }));
      const list = (v) => new Set((Array.isArray(v) ? v : []).filter((i) => idx(i, n)));
      const active = Array.isArray(s.active) && s.active.length === 2 && s.active.every(Number.isInteger) ? s.active : null;
      const vars = Object.entries(s.vars && typeof s.vars === "object" ? s.vars : {})
        .filter(([, v]) => isCell(v)).slice(0, 6).map(([k, v]) => [String(k).slice(0, 16), String(v).slice(0, 24)]);
      steps.push({ array, pointers, mark: list(s.mark), done: list(s.done), active, vars,
                   note: typeof s.note === "string" ? s.note.slice(0, 400) : "" });
    }
    if (!steps.length) return null;
    return { title: typeof t.title === "string" ? t.title.slice(0, 120) : "", steps };
  }

  function traceWidget(src) {
    const trace = parseTrace(src);
    if (!trace) return null;
    const { steps } = trace;
    const width = Math.max(...steps.map((s) => s.array.length));
    const colors = {};
    steps.forEach((s) => s.pointers.forEach((p) => { colors[p.name] ??= POINTER_COLORS[Object.keys(colors).length % POINTER_COLORS.length]; }));

    const fig = el("figure", "visual visual-trace");
    fig.tabIndex = 0;
    fig.setAttribute("aria-label", `Step-by-step trace${trace.title ? ": " + trace.title : ""}. Use the arrow keys to step.`);
    fig.style.setProperty("--cell", width <= 12 ? "44px" : width <= 20 ? "34px" : "28px");
    fig.innerHTML = `
      <figcaption><span class="v-kind">Trace</span><span class="v-title"></span><span class="v-count"></span></figcaption>
      <div class="trace-scroll"><div class="trace-track"><div class="trace-cells"></div><div class="trace-pointers"></div></div></div>
      <div class="trace-vars"></div>
      <p class="trace-note" aria-live="polite"></p>
      <div class="trace-controls">
        <button type="button" data-act="first" aria-label="First step">⏮</button>
        <button type="button" data-act="prev" aria-label="Previous step">‹</button>
        <button type="button" data-act="play" class="play" aria-label="Play">▶</button>
        <button type="button" data-act="next" aria-label="Next step">›</button>
        <input type="range" min="0" max="${steps.length - 1}" value="0" aria-label="Step">
      </div>`;
    $(".v-title", fig).textContent = trace.title;
    const cellsEl = $(".trace-cells", fig), ptrsEl = $(".trace-pointers", fig);
    const slider = $("input", fig), playBtn = $(".play", fig);
    if (steps.length === 1) $(".trace-controls", fig).hidden = true;

    const cells = [], ptrs = {};
    let at = -1, timer = 0;

    function show(k) {
      k = Math.max(0, Math.min(steps.length - 1, k));
      const s = steps[k], prev = steps[at];
      while (cells.length < s.array.length) {
        const c = el("div", "cell", `<b></b><small>${cells.length}</small>`);
        cellsEl.appendChild(c); cells.push(c);
      }
      cells.forEach((c, i) => {
        const has = i < s.array.length;
        c.hidden = !has;
        if (!has) return;
        const v = $("b", c);
        if (v.textContent !== s.array[i]) {
          v.textContent = s.array[i];
          if (prev && !reducedMotion()) { c.classList.remove("changed"); void c.offsetWidth; c.classList.add("changed"); }
        }
        const out = s.active && (i < Math.min(...s.active) || i > Math.max(...s.active));
        c.classList.toggle("out", !!out);
        c.classList.toggle("mark", s.mark.has(i));
        c.classList.toggle("done", s.done.has(i));
      });
      // Pointers slide between cells; several on one cell stack downwards.
      const stack = {};
      for (const name in ptrs) ptrs[name].hidden = true;
      for (const p of s.pointers) {
        if (!ptrs[p.name]) {
          const node = el("span", "ptr", `<i></i>${esc(p.name)}`);
          node.style.setProperty("--pc", colors[p.name]);
          ptrsEl.appendChild(node); ptrs[p.name] = node;
        }
        const row = stack[p.i] = (stack[p.i] ?? -1) + 1;
        const node = ptrs[p.name];
        node.hidden = false;
        node.style.transform = `translate(calc(var(--cell) * ${p.i + 1.5} - 50%), ${row * 22}px)`;
      }
      ptrsEl.style.height = `${(Math.max(-1, ...Object.values(stack)) + 1) * 22 + 6}px`;
      $(".trace-vars", fig).innerHTML = s.vars.map(([k, v]) => `<span><em>${esc(k)}</em>${esc(v)}</span>`).join("");
      $(".trace-note", fig).textContent = s.note;
      $(".v-count", fig).textContent = steps.length > 1 ? `step ${k + 1} / ${steps.length}` : "";
      slider.value = k;
      at = k;
      if (at === steps.length - 1) pause();
    }
    function pause() { clearInterval(timer); timer = 0; playBtn.textContent = "▶"; playBtn.setAttribute("aria-label", "Play"); }
    function play() {
      if (at === steps.length - 1) show(0);
      // Stops by itself once the widget leaves the page (new session, answer redrawn).
      timer = setInterval(() => (fig.isConnected ? show(at + 1) : pause()), 1300);
      playBtn.textContent = "❚❚"; playBtn.setAttribute("aria-label", "Pause");
    }
    const act = { first: () => show(0), prev: () => show(at - 1), next: () => show(at + 1), play: () => (timer ? pause() : play()) };
    fig.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-act]");
      if (!b) return;
      if (b.dataset.act !== "play") pause();
      act[b.dataset.act]();
    });
    slider.addEventListener("input", () => { pause(); show(+slider.value); });
    fig.addEventListener("keydown", (e) => {
      if (e.target === slider) return;
      const k = { ArrowLeft: "prev", ArrowRight: "next", Home: "first", " ": "play" }[e.key];
      if (k) { e.preventDefault(); if (k !== "play") pause(); act[k](); }
    });
    show(0);
    return fig;
  }

  /* ---------- storage (always guarded: private windows and full quotas must not break the page) ---------- */
  function readJSON(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch (_) { return fallback; }
  }
  function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; }
  }

  const prefs = Object.assign({ pace: "normal", sidebar: null }, readJSON(PREFS_KEY, {}));
  if (!PACES[prefs.pace]) prefs.pace = "normal";
  const savePrefs = () => writeJSON(PREFS_KEY, prefs);

  let sessions = readJSON(STORE_KEY, []);
  if (!Array.isArray(sessions)) sessions = [];
  sessions = sessions.filter((s) => s && s.id && Array.isArray(s.messages));
  let current = null;   // the open session, or null for a fresh, not-yet-saved one

  function saveSessions() {
    sessions.sort((a, b) => b.updated - a.updated);
    sessions = sessions.slice(0, MAX_SESSIONS);
    // If storage is full, drop the oldest sessions until it fits.
    while (!writeJSON(STORE_KEY, sessions) && sessions.length > 1) sessions.pop();
  }
  function startSession(firstQuestion) {
    const s = { id: uid(), title: firstQuestion.replace(/\s+/g, " ").trim().slice(0, 70), created: Date.now(), updated: Date.now(), messages: [] };
    sessions.unshift(s);
    return s;
  }
  function record(session, message) {
    session.messages.push(message);
    if (session.messages.length > MAX_MESSAGES) session.messages.splice(0, session.messages.length - MAX_MESSAGES);
    session.updated = Date.now();
    if (!sessions.includes(session)) sessions.unshift(session);
    saveSessions();
    renderSidebar();
  }

  /* ---------- mode switching ---------- */
  function placeGlow() {
    const tab = $(`.modes button[data-mode="${mode}"]`);
    if (!tab) return;
    glow.style.width = tab.offsetWidth + "px";
    glow.style.transform = `translateX(${tab.offsetLeft - 3}px)`;
  }
  function setMode(next) {
    if (!MODES[next]) return;
    mode = next;
    body.dataset.mode = next;
    $$(".modes button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.mode === next)));
    $$(".mode-card").forEach((c) => c.classList.toggle("active", c.dataset.mode === next));
    input.placeholder = MODES[next].placeholder;
    hint.innerHTML = next === "debug"
      ? "<kbd>Ctrl</kbd>+<kbd>Enter</kbd> to send · <kbd>Enter</kbd> for a new line — paste freely"
      : "<kbd>Enter</kbd> to send · <kbd>Shift</kbd>+<kbd>Enter</kbd> for a new line · <kbd>/</kbd> to focus";
    placeGlow();
    window.Constellation?.setAccent(MODES[next].rgb);
  }
  $$(".modes button").forEach((b) => b.addEventListener("click", () => { setMode(b.dataset.mode); input.focus(); }));
  $$(".mode-card").forEach((c) => {
    c.addEventListener("click", () => {
      setMode(c.dataset.mode);
      input.value = MODES[c.dataset.mode].example;
      autosize(); input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
    c.addEventListener("pointermove", (e) => {
      const r = c.getBoundingClientRect();
      c.style.setProperty("--mx", `${e.clientX - r.left}px`);
      c.style.setProperty("--my", `${e.clientY - r.top}px`);
    });
  });
  document.fonts?.ready.then(placeGlow);

  /* ---------- hero word rotator ---------- */
  const rot = $("#rotator");
  let ri = 0;
  setInterval(() => {
    if (hero.hidden || document.hidden) return;
    rot.classList.add("out");
    setTimeout(() => { ri = (ri + 1) % ROTATE.length; rot.textContent = ROTATE[ri]; rot.classList.remove("out"); }, 350);
  }, 2600);

  /* ---------- health ---------- */
  function setStatus(state, text) { statusEl.dataset.state = state; $("span", statusEl).textContent = text; }
  async function checkHealth() {
    try {
      const r = await fetch("/health", { cache: "no-store" });
      setStatus(r.ok ? "ok" : "down", r.ok ? "online" : "offline");
    } catch (_) { setStatus("down", "offline"); }
  }
  checkHealth();
  setInterval(checkHealth, 30000);

  /* ---------- reading pace ---------- */
  function renderPace() {
    $("span", paceBtn).textContent = PACE_LABEL[prefs.pace];
    paceBtn.title = `Answer speed: ${PACE_LABEL[prefs.pace]} — click to change`;
  }
  paceBtn.addEventListener("click", () => {
    prefs.pace = PACE_ORDER[(PACE_ORDER.indexOf(prefs.pace) + 1) % PACE_ORDER.length];
    savePrefs(); renderPace();
  });

  /* ---------- layout measurements ---------- */
  function measure() {
    body.style.setProperty("--topbar-h", topbar.offsetHeight + "px");
    body.style.setProperty("--composer-h", form.offsetHeight + "px");
    placeGlow();
  }
  window.addEventListener("resize", measure);
  const composerTop = () => form.getBoundingClientRect().top;

  /* ---------- scrolling: keep the question in view instead of chasing the newest token ---------- */
  let follow = false;   // only true after the reader asks to jump to the latest text
  let settlingUntil = 0; // while the question glides to the top, the answer only *looks* off-screen

  function scrollQuestionToTop(node) {
    settlingUntil = performance.now() + 800;
    setTimeout(updateJump, 820);
    const top = node.getBoundingClientRect().top + window.scrollY - topbar.offsetHeight - 14;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }
  function latestCard() { return $(".msg-tutor.latest .card", thread); }
  function scrollToAnswerEnd(smooth) {
    const card = latestCard();
    if (!card) return;
    const overflow = card.getBoundingClientRect().bottom - (composerTop() - 18);
    if (overflow > 0) window.scrollBy({ top: overflow, behavior: smooth ? "smooth" : "auto" });
  }
  function updateJump() {
    if (!activeReveal) { jumpBtn.hidden = true; return; }
    if (follow) { scrollToAnswerEnd(false); jumpBtn.hidden = true; return; }
    if (performance.now() < settlingUntil) { jumpBtn.hidden = true; return; }
    const card = latestCard();
    jumpBtn.hidden = !card || card.getBoundingClientRect().bottom <= composerTop() - 8;
  }
  jumpBtn.addEventListener("click", () => { follow = true; scrollToAnswerEnd(true); jumpBtn.hidden = true; });
  window.addEventListener("wheel", (e) => { if (e.deltaY < 0) follow = false; }, { passive: true });
  window.addEventListener("touchmove", () => { follow = false; }, { passive: true });
  window.addEventListener("scroll", () => { if (!follow) updateJump(); }, { passive: true });

  /* ---------- composer ---------- */
  function autosize() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, window.innerHeight * .38) + "px";
    updateSend();
    body.style.setProperty("--composer-h", form.offsetHeight + "px");
  }
  function updateSend() { send.disabled = busy || !input.value.trim(); }
  function setBusy(on) { busy = on; send.classList.toggle("busy", on); updateSend(); }
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing) return;
    const wantsSend = mode === "debug" ? (e.ctrlKey || e.metaKey) : !e.shiftKey;
    if (wantsSend) { e.preventDefault(); form.requestSubmit(); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== input && !e.ctrlKey && !e.metaKey) { e.preventDefault(); input.focus(); }
    if (e.key === "Escape" && body.classList.contains("sb-open") && isNarrow()) setSidebar(false);
  });
  form.addEventListener("submit", (e) => { e.preventDefault(); const q = input.value.trim(); if (q && !busy) ask(q, mode); });

  function hideHero() {
    if (hero.hidden) return;
    hero.classList.add("leaving");
    setTimeout(() => { hero.hidden = true; }, 380);
  }
  function showHero() {
    hero.hidden = false;
    hero.classList.remove("leaving");
  }

  /* ---------- rendering pieces ---------- */
  function userMessage(q, m) {
    const wrap = el("div", "msg msg-user");
    const bubble = el("div", "bubble" + (m === "debug" ? " code" : ""));
    bubble.textContent = q;
    wrap.append(bubble, el("span", "tag", esc(MODES[m].label)));
    thread.appendChild(wrap);
    return wrap;
  }

  function tutorMessage(m) {
    const wrap = el("div", "msg msg-tutor");
    wrap.style.setProperty("--m", MODES[m].rgb);
    const avatar = el("div", "avatar", MODES[m].icon);
    const card = el("div", "card");
    const head = el("div", "card-head", `<span class="mode-pill">${MODES[m].label}</span>`);
    const stageNames = m === "fetch" ? STAGES.fetch : STAGES.llm;
    const stages = el("div", "stages");
    stageNames.forEach((s, i) => {
      if (i) stages.appendChild(el("span", "stage-sep"));
      const st = el("span", "stage", s); st.dataset.stage = s; stages.appendChild(st);
    });
    const content = el("div", "body", '<span class="thinking"><i></i><i></i><i></i></span>');
    card.append(head, stages, content);
    wrap.append(avatar, card);
    thread.appendChild(wrap);

    const setStage = (name, state) => { const s = $(`[data-stage="${name}"]`, stages); if (s) { s.classList.remove("on", "ok"); if (state) s.classList.add(state); } };
    return { wrap, card, head, stages, content, setStage };
  }

  // A quiet trust signal: how many passages grounded the answer, never where they came from.
  function renderGrounding(ui, passages) {
    if (!passages) return;
    const line = el("div", "grounding");
    const dots = Array.from({ length: Math.min(passages, 8) }, (_, i) => `<i style="animation-delay:${i * 90}ms"></i>`).join("");
    line.innerHTML = `<span class="g-dots">${dots}</span><span>Grounded in curated notes · ${passages} passage${passages > 1 ? "s" : ""}</span>`;
    ui.card.appendChild(line);
  }

  function ratingColor(r) {
    if (r == null) return "#6b7280";
    if (r < 1200) return "#cbd5e1"; if (r < 1400) return "#86efac"; if (r < 1600) return "#5eead4";
    if (r < 1900) return "#a5b4fc"; if (r < 2100) return "#f0abfc"; if (r < 2400) return "#fdba74"; return "#fca5a5";
  }

  function renderProblems(ui, problems) {
    ui.content.innerHTML = "";
    if (!problems.length) {
      ui.content.innerHTML = '<p class="empty">No problems indexed yet. Run <code>python -m corpus.codeforces</code> to import the Codeforces problemset.</p>';
      return;
    }
    const list = el("div", "problems");
    problems.forEach((p, i) => {
      const a = el("a", "problem");
      a.href = p.url || "#"; a.target = "_blank"; a.rel = "noopener"; a.style.animationDelay = `${i * 80}ms`;
      const pct = p.score == null ? 0 : Math.max(0, Math.min(100, Math.round(p.score * 100)));
      a.innerHTML = `
        <span class="pid">${esc(p.id)}</span>
        <span><span class="ptitle">${esc(p.title)}</span>
          <span class="ptags">${(p.tags || []).slice(0, 5).map((t) => `<span>${esc(t)}</span>`).join("")}</span></span>
        <span class="pmeta">
          ${p.rating ? `<span class="rating" style="background:${ratingColor(p.rating)}">${p.rating}</span>` : ""}
          ${p.match === "exact" ? '<span class="match-exact">exact match</span>'
            : `<span>${pct}% similar</span><span class="meter"><i style="width:${pct}%"></i></span>`}
        </span>`;
      list.appendChild(a);
    });
    ui.content.appendChild(list);
  }

  function renderError(ui, message) {
    ui.content.innerHTML = "";
    const n = el("div", "notice");
    n.innerHTML = message;
    ui.content.appendChild(n);
  }

  // Draws a finished tutor reply — used both when an answer completes and when reopening a saved session.
  function finalizeTutor(ui, msg) {
    $$(".stage", ui.stages).forEach((s) => { s.classList.remove("on"); if (!msg.error) s.classList.add("ok"); });
    if (msg.cached) ui.head.appendChild(el("span", "chip cache", "⚡ instant"));
    if (msg.secs != null) ui.head.appendChild(el("span", "chip", `${msg.secs.toFixed(1)}s`));
    if (msg.error) { renderError(ui, msg.error); return; }
    if (msg.mode === "fetch") { renderProblems(ui, msg.problems || []); return; }

    ui.content.innerHTML = msg.text ? markdown(msg.text) : '<p class="empty">The tutor had nothing to say — try rephrasing.</p>';
    renderVisuals(ui.content, true);   // anything that can't be drawn (e.g. cut off mid-way) stays a code block
    decorateCode(ui.content);
    if (msg.stopped) ui.card.appendChild(el("div", "stopped-note", "Stopped before the answer finished."));
    renderGrounding(ui, msg.passages);
    if (msg.mode === "hint" && msg.question) {
      const note = el("div", "spoiler-note", "Still stuck after really thinking it over? ");
      const reveal = el("button", "", "Reveal the full answer →"); reveal.type = "button";
      reveal.onclick = () => { if (!busy) { setMode("answer"); ask(msg.question, "answer"); } };
      note.appendChild(reveal); ui.card.appendChild(note);
    }
  }

  // Setup hints only help the person running the server; public visitors get plain language.
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);

  function friendlyError(msg) {
    if (/Slow down/.test(msg)) return esc(msg);
    if (!isLocal) return "The tutor is having a moment — please try again in a minute.";
    if (/POSTGRES_PASSWORD/.test(msg)) return `The database password isn't configured — set <code>POSTGRES_PASSWORD</code> in <code>.env</code> and restart the server.`;
    if (/GROQ_API_KEY/.test(msg)) return `The LLM isn't configured yet — add your <code>GROQ_API_KEY</code> to <code>.env</code> and restart the server.`;
    if (/connect|Connection refused|could not connect|timeout/i.test(msg))
      return `Couldn't reach one of the databases. Is <code>docker compose up -d</code> running? <br><small>${esc(msg)}</small>`;
    if (/relation .* does not exist/i.test(msg)) return `The index is empty — run <code>python ingest.py</code> first.`;
    return esc(msg);
  }

  /* ---------- paced reveal: text arrives in bursts, appears at a steady reading speed ---------- */
  function createReveal(ui) {
    let target = "", shown = 0, carry = 0, last = 0, raf = 0;
    let streamDone = false, stopped = false, skipped = false, resolveDrain = null;

    const skipBtn = el("button", "chip skip", "Show all ⏭");
    skipBtn.type = "button";
    skipBtn.title = "Show the rest of the answer now";
    skipBtn.onclick = () => { skipped = true; schedule(); };

    function paint() {
      ui.content.innerHTML = markdown(target.slice(0, shown));
      renderVisuals(ui.content, false);
      const lastNode = ui.content.lastElementChild || ui.content;
      lastNode.insertAdjacentHTML("beforeend", '<span class="caret"></span>');
      updateJump();
    }
    function finish() {
      cancelAnimationFrame(raf); raf = 0;
      skipBtn.remove();
      const r = resolveDrain; resolveDrain = null;
      r?.();
    }
    function tick(now) {
      raf = 0;
      if (stopped) return;
      const rate = skipped ? Infinity : PACES[prefs.pace];
      const dt = last ? Math.min(now - last, 100) / 1000 : 0;
      last = now;
      if (shown < target.length) {
        if (rate === Infinity) shown = target.length;
        else {
          carry += rate * dt;
          const n = Math.floor(carry);
          carry -= n;
          shown = Math.min(target.length, shown + n);
        }
        paint();
      }
      if (shown >= target.length) {
        last = 0;
        if (streamDone) finish();
        return;   // idle until more text arrives
      }
      schedule();
    }
    function schedule() { if (!raf && !stopped) raf = requestAnimationFrame(tick); }

    return {
      push(text) {
        if (!target && text) ui.head.appendChild(skipBtn);
        target += text;
        schedule();
      },
      // Resolves once everything received so far is on screen (or the reader skipped ahead).
      drain() {
        streamDone = true;
        return new Promise((resolve) => {
          resolveDrain = resolve;
          if (shown >= target.length) finish(); else schedule();
        });
      },
      stop() { stopped = true; finish(); },
    };
  }

  /* ---------- the request ---------- */
  // The last few exchanges of this session, so follow-ups ("explain step 2", "now in Python") make sense.
  // Fetch lookups and failed replies aren't conversation; the server enforces the same limits.
  const HISTORY_TURNS = 6, HISTORY_CHARS = 2000;
  function historyFor(session) {
    const turns = [];
    for (const msg of session.messages) {
      if (msg.mode === "fetch") continue;
      if (msg.role === "user") turns.push({ role: "user", content: msg.text });
      else if (msg.text && !msg.error) turns.push({ role: "assistant", content: msg.text });
    }
    return turns.slice(-HISTORY_TURNS).map((t) => ({ role: t.role, content: t.content.slice(0, HISTORY_CHARS) }));
  }

  async function ask(q, m) {
    const myRequest = ++requestSeq;
    const session = current || startSession(q);
    current = session;
    setHash(session.id);
    const turns = m === "fetch" ? [] : historyFor(session);   // taken before this question is recorded
    record(session, { role: "user", mode: m, text: q, at: Date.now() });

    setBusy(true);
    hideHero();
    $$(".msg-tutor.latest", thread).forEach((n) => n.classList.remove("latest"));
    const userNode = userMessage(q, m);
    input.value = ""; autosize();
    const ui = tutorMessage(m);
    ui.wrap.classList.add("latest");
    follow = false;
    requestAnimationFrame(() => scrollQuestionToTop(userNode));

    const probe = window.Constellation?.query();
    const t0 = performance.now();
    ui.setStage(m === "fetch" ? "embed" : "retrieve", "on");

    const reveal = createReveal(ui);
    activeReveal = reveal;
    const msg = { role: "tutor", mode: m, question: q, at: Date.now() };
    let text = "";

    const myController = new AbortController();
    controller = myController;
    try {
      const res = await fetch("/ask/stream", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, mode: m, history: turns }), signal: myController.signal,
      });
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try { const j = await res.json(); detail = Array.isArray(j.detail) ? j.detail.map((d) => d.msg).join("; ") : (j.detail || detail); } catch (_) { /* not json */ }
        throw new Error(detail);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let finished = false;
      while (!finished) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const raw = buf.slice(0, idx); buf = buf.slice(idx + 2);
          const line = raw.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          const ev = JSON.parse(line.slice(5));

          if (ev.type === "grounding") {
            ui.setStage("retrieve", "ok"); ui.setStage("ground", "ok"); ui.setStage("reason", "on");
            probe?.lock(ev.passages);
            msg.passages = ev.passages;
            msg.cached = ev.cached;
          } else if (ev.type === "token") {
            text += ev.text;
            reveal.push(ev.text);
          } else if (ev.type === "problems") {
            probe?.lock(ev.problems.length);
            msg.problems = ev.problems;
          } else if (ev.type === "error") {
            throw new Error(ev.message);
          } else if (ev.type === "done") {
            finished = true;
          }
        }
      }

      msg.secs = (performance.now() - t0) / 1000;   // how long the tutor took, not how long the reveal took
      probe?.release();
      await reveal.drain();
      msg.text = text;
    } catch (err) {
      reveal.stop();
      if (err.name === "AbortError") {
        // Interrupted, e.g. by switching sessions: keep whatever arrived so the question isn't left unanswered.
        msg.text = text;
        msg.stopped = true;
      } else {
        const offline = err instanceof TypeError;
        msg.error = offline
          ? (isLocal ? "Can't reach the Tutor API. Start it with <code>uvicorn main:app --reload</code>."
                     : "Can't reach the tutor right now — check your connection and try again.")
          : friendlyError(err.message || String(err));
        if (offline) setStatus("down", "offline");
      }
    } finally {
      probe?.release();
      record(session, msg);
      if (myRequest === requestSeq) {
        finalizeTutor(ui, msg);
        activeReveal = null;
        jumpBtn.hidden = true;
        follow = false;
        controller = null;
        setBusy(false);
      }
    }
  }

  // Stop whatever is streaming right now (used before switching or starting sessions).
  function interrupt() {
    if (!busy) return;
    requestSeq++;            // the running request must no longer touch the screen
    controller?.abort();
    activeReveal?.stop();
    activeReveal = null;
    controller = null;
    jumpBtn.hidden = true;
    setBusy(false);
  }

  /* ---------- sessions ---------- */
  function setHash(id) {
    try { history.replaceState(null, "", id ? `#s=${id}` : location.pathname + location.search); } catch (_) { /* sandboxed */ }
  }

  function newSession() {
    interrupt();
    current = null;
    setHash(null);
    thread.innerHTML = "";
    showHero();
    renderSidebar();
    input.value = ""; autosize(); input.focus();
    window.scrollTo({ top: 0 });
    if (isNarrow()) setSidebar(false);
  }

  function openSession(id) {
    const s = sessions.find((x) => x.id === id);
    if (!s) { newSession(); return; }
    interrupt();
    current = s;
    setHash(s.id);
    thread.innerHTML = "";
    hero.hidden = true;
    for (const msg of s.messages) {
      if (msg.role === "user") userMessage(msg.text, MODES[msg.mode] ? msg.mode : "answer");
      else finalizeTutor(tutorMessage(MODES[msg.mode] ? msg.mode : "answer"), msg);
    }
    const lastMode = [...s.messages].reverse().find((x) => x.role === "user")?.mode;
    if (lastMode && MODES[lastMode]) setMode(lastMode);
    renderSidebar();
    requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight }));
    if (isNarrow()) setSidebar(false);
  }

  function deleteSession(id) {
    const s = sessions.find((x) => x.id === id);
    if (!s || !confirm(`Delete “${s.title}”? This can't be undone.`)) return;
    sessions = sessions.filter((x) => x.id !== id);
    saveSessions();
    if (current && current.id === id) newSession(); else renderSidebar();
  }

  function dayGroup(ts) {
    const d = new Date(ts), now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (ts >= startOfToday) return "Today";
    if (ts >= startOfToday - 864e5) return "Yesterday";
    if (ts >= startOfToday - 7 * 864e5) return "Previous 7 days";
    return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }

  function renderSidebar() {
    sbList.innerHTML = "";
    if (!sessions.length) {
      sbList.appendChild(el("p", "sb-empty", "Your sessions will appear here. Ask your first question to start one."));
      return;
    }
    let group = null;
    for (const s of sessions) {
      const g = dayGroup(s.updated);
      if (g !== group) { group = g; sbList.appendChild(el("p", "sb-group", esc(g))); }
      const firstMode = s.messages.find((x) => x.role === "user")?.mode || "answer";
      const item = el("div", "sb-item" + (current && current.id === s.id ? " active" : ""));
      item.setAttribute("role", "button");
      item.tabIndex = 0;
      item.style.setProperty("--m", (MODES[firstMode] || MODES.answer).rgb);
      const questions = s.messages.filter((x) => x.role === "user").length;
      item.innerHTML = `<span class="sb-dot"></span><span class="sb-title">${esc(s.title || "Untitled")}</span>
        <span class="sb-count" title="${questions} question${questions === 1 ? "" : "s"}">${questions}</span>`;
      const del = el("button", "sb-del", "×");
      del.type = "button";
      del.setAttribute("aria-label", `Delete session: ${s.title}`);
      del.addEventListener("click", (e) => { e.stopPropagation(); deleteSession(s.id); });
      item.appendChild(del);
      item.addEventListener("click", () => openSession(s.id));
      item.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSession(s.id); } });
      sbList.appendChild(item);
    }
  }

  $("#sbNew").addEventListener("click", newSession);
  $("#newSession").addEventListener("click", newSession);
  $("#sbClear").addEventListener("click", () => {
    if (!sessions.length || !confirm("Delete all saved sessions in this browser? This can't be undone.")) return;
    sessions = [];
    saveSessions();
    newSession();
  });

  /* ---------- sidebar open / close ---------- */
  const isNarrow = () => window.matchMedia("(max-width: 1179px)").matches;
  function setSidebar(open, remember) {
    body.classList.toggle("sb-open", open);
    sbToggle.setAttribute("aria-expanded", String(open));
    sbBackdrop.hidden = !(open && isNarrow());
    if (remember && !isNarrow()) { prefs.sidebar = open; savePrefs(); }
    requestAnimationFrame(measure);
  }
  sbToggle.addEventListener("click", () => setSidebar(!body.classList.contains("sb-open"), true));
  sbBackdrop.addEventListener("click", () => setSidebar(false));
  window.matchMedia("(max-width: 1179px)").addEventListener?.("change", () => setSidebar(!isNarrow() && prefs.sidebar !== false));

  /* ---------- boot ---------- */
  if (window.marked) marked.use({ gfm: true });
  setMode("answer");
  renderPace();
  setSidebar(!isNarrow() && prefs.sidebar !== false);
  renderSidebar();
  measure();
  autosize();
  const fromHash = /^#s=([\w-]+)$/.exec(location.hash);
  if (fromHash && sessions.some((s) => s.id === fromHash[1])) openSession(fromHash[1]);
  input.focus();
})();
