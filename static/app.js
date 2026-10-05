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

  function markdown(text) {
    if (window.marked && window.DOMPurify) return DOMPurify.sanitize(marked.parse(text, { breaks: false, gfm: true }));
    return `<p style="white-space:pre-wrap">${esc(text)}</p>`;
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
  async function ask(q, m) {
    const myRequest = ++requestSeq;
    const session = current || startSession(q);
    current = session;
    setHash(session.id);
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
        body: JSON.stringify({ question: q, mode: m }), signal: myController.signal,
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
