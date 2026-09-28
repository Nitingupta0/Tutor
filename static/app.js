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

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const body = document.body;
  const hero = $("#hero"), thread = $("#thread"), form = $("#composer"), input = $("#question");
  const send = $("#send"), glow = $(".modes-glow"), statusEl = $("#status"), hint = $("#composerHint");

  let mode = "answer";
  let busy = false;
  let controller = null;

  /* ---------- helpers ---------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function el(tag, cls, html) { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; }

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
  function scrollToEnd(force) {
    const nearBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 260;
    if (force || nearBottom) window.scrollTo({ top: document.body.scrollHeight, behavior: force ? "smooth" : "auto" });
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
  window.addEventListener("resize", placeGlow);
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

  /* ---------- composer ---------- */
  function autosize() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, window.innerHeight * .38) + "px"; updateSend(); }
  function updateSend() { send.disabled = busy || !input.value.trim(); }
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing) return;
    const wantsSend = mode === "debug" ? (e.ctrlKey || e.metaKey) : !e.shiftKey;
    if (wantsSend) { e.preventDefault(); form.requestSubmit(); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && document.activeElement !== input && !e.ctrlKey && !e.metaKey) { e.preventDefault(); input.focus(); }
  });
  form.addEventListener("submit", (e) => { e.preventDefault(); const q = input.value.trim(); if (q && !busy) ask(q, mode); });

  $("#newSession").addEventListener("click", () => {
    controller?.abort();
    thread.innerHTML = "";
    hero.hidden = false; hero.classList.remove("leaving");
    input.value = ""; autosize(); input.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  function hideHero() {
    if (hero.hidden) return;
    hero.classList.add("leaving");
    setTimeout(() => { hero.hidden = true; }, 380);
  }

  /* ---------- rendering pieces ---------- */
  function userMessage(q, m) {
    const wrap = el("div", "msg msg-user");
    const bubble = el("div", "bubble" + (m === "debug" ? " code" : ""));
    bubble.textContent = q;
    wrap.append(bubble, el("span", "tag", esc(MODES[m].label)));
    thread.appendChild(wrap);
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

  function friendlyError(msg) {
    if (/POSTGRES_PASSWORD/.test(msg)) return `The database password isn't configured — set <code>POSTGRES_PASSWORD</code> in <code>.env</code> and restart the server.`;
    if (/GROQ_API_KEY/.test(msg)) return `The LLM isn't configured yet — add your <code>GROQ_API_KEY</code> to <code>.env</code> and restart the server.`;
    if (/connect|Connection refused|could not connect|timeout/i.test(msg))
      return `Couldn't reach one of the databases. Is <code>docker compose up -d</code> running? <br><small>${esc(msg)}</small>`;
    if (/relation .* does not exist/i.test(msg)) return `The index is empty — run <code>python ingest.py</code> first.`;
    return esc(msg);
  }

  /* ---------- the request ---------- */
  async function ask(q, m) {
    busy = true; updateSend(); send.classList.add("busy");
    hideHero();
    userMessage(q, m);
    input.value = ""; autosize();
    const ui = tutorMessage(m);
    scrollToEnd(true);

    const probe = window.Constellation?.query();
    const t0 = performance.now();
    const first = m === "fetch" ? "embed" : "retrieve";
    ui.setStage(first, "on");

    let text = "";
    let pending = false;
    let settled = false;   // once the final render happens, queued stream repaints must not clobber it
    const paint = () => {
      pending = false;
      if (settled) return;
      ui.content.innerHTML = markdown(text);
      const last = ui.content.lastElementChild || ui.content;
      last.insertAdjacentHTML("beforeend", '<span class="caret"></span>');
      scrollToEnd(false);
    };

    controller = new AbortController();
    try {
      const res = await fetch("/ask/stream", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, mode: m }), signal: controller.signal,
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
            if (ev.cached) ui.head.appendChild(el("span", "chip cache", "⚡ instant"));
            ui.passages = ev.passages;
          } else if (ev.type === "token") {
            text += ev.text;
            if (!pending) { pending = true; requestAnimationFrame(paint); }
          } else if (ev.type === "problems") {
            probe?.lock(ev.problems.length);
            ui.setStage("embed", "ok"); ui.setStage("match", "ok");
            renderProblems(ui, ev.problems);
          } else if (ev.type === "error") {
            throw new Error(ev.message);
          } else if (ev.type === "done") {
            finished = true;
          }
        }
      }

      settled = true;
      if (m !== "fetch") {
        ui.setStage("reason", "ok");
        ui.content.innerHTML = text ? markdown(text) : '<p class="empty">The tutor had nothing to say — try rephrasing.</p>';
        decorateCode(ui.content);
        renderGrounding(ui, ui.passages);
        if (m === "hint") {
          const note = el("div", "spoiler-note", "Still stuck after really thinking it over? ");
          const reveal = el("button", "", "Reveal the full answer →"); reveal.type = "button";
          reveal.onclick = () => { if (!busy) { setMode("answer"); ask(q, "answer"); } };
          note.appendChild(reveal); ui.card.appendChild(note);
        }
      }
      ui.head.appendChild(el("span", "chip", `${((performance.now() - t0) / 1000).toFixed(1)}s`));
    } catch (err) {
      settled = true;
      if (err.name === "AbortError") { ui.wrap.remove(); }
      else {
        $$(".stage.on", ui.stages).forEach((s) => s.classList.remove("on"));
        const offline = err instanceof TypeError;
        renderError(ui, offline
          ? "Can't reach the Tutor API. Start it with <code>uvicorn main:app --reload</code>."
          : friendlyError(err.message || String(err)));
        if (offline) setStatus("down", "offline");
      }
    } finally {
      probe?.release();
      busy = false; send.classList.remove("busy"); updateSend();
      controller = null;
      scrollToEnd(false);
    }
  }

  /* ---------- boot ---------- */
  if (window.marked) marked.use({ gfm: true });
  setMode("answer");
  autosize();
  input.focus();
})();
