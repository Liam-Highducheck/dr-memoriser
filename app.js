// DR Memoriser. Cases come from data/cases.json (every DR with optimal length <= 6, one per shape). Progress lives in
// Store (SQLite on this device). The cube is cubing.js's twisty-player, the same viewer the drm doc page uses.
(async () => {
  const $ = (id) => document.getElementById(id);
  const MIN = 60000;
  // review gaps by level. A miss goes back to level 0, a fast optimal answer moves up one.
  const STEPS = [1, 10, 60, 480, 1440, 4320, 10080, 23040, 50400].map((m) => m * MIN);
  const LEARNING_AT_ONCE = 8;
  const DEFAULTS = { cls: "4c4e", len: 4, type: "all", upto: false, mode: "review", target: 10, showLen: true, auto: true, back: false, showScr: false, tap: false, randDR: true, randMirror: false, randUD: false };
  const S = { ...DEFAULTS };

  // ---- load cases, open storage
  const [CASES, st] = await Promise.all([
    fetch("data/cases.json").then((r) => r.json()),
    Store.open().then(() => Store.load()),
  ]);
  const loaded = st.settings.s || {};
  Object.assign(S, loaded);
  if ((loaded.v || 0) < 2) { S.randDR = true; S.showScr = false; }   // v2: random DR moves on by default, scramble text hidden
  S.v = 2;
  let prog = st.progress;
  // k.t = 1: some optimal solution is class-keeping setup moves then the class's shortest trigger. k.t = 0: every optimal
  // solution has an R/L quarter turn before that, which changes the class (the rzp breaks).
  const counter = new Map(), minLen = {}, trigOf = {};
  for (const k of CASES) {
    const key = `${k.c}/${k.m}/${k.t}`;
    k.no = (counter.get(key) || 0) + 1; counter.set(key, k.no);
    k.id = String(k.id);
    minLen[k.c] = Math.min(minLen[k.c] ?? 99, k.m);
  }
  for (const k of CASES) if (k.m === minLen[k.c] && !trigOf[k.c]) trigOf[k.c] = k.s;
  const label = (k) => `${k.t ? "T" : "B"}${k.no}`;
  const isTrigger = (moves, min) => { const i = moves.findIndex((t) => /^[RL]'?$/.test(t)); return i >= moves.length - min; };
  const classes = [...new Set(CASES.map((k) => k.c))];
  const caseById = new Map(CASES.map((k) => [k.id, k]));
  if (!classes.includes(S.cls)) S.cls = DEFAULTS.cls;
  const saveSettings = () => Store.setting("s", S).catch(() => {});

  // ---- cube model (only to list optimal solutions for the exact scramble shown)
  $("case-name").textContent = "Loading cases…";
  await new Promise((r) => setTimeout(r, 30));
  const C = Cube, D = DR(C);

  // ---- 3D cube
  const player = new window.__cubing.TwistyPlayer({
    puzzle: "3x3x3", visualization: "3D", controlPanel: "none", background: "none", hintFacelets: "none",
    backView: S.back ? "top-right" : "none", experimentalDragInput: "auto", tempoScale: 1.4,
  });
  $("cube").appendChild(player);

  // ---- settings drawer
  const bind = (id, key, num) => {
    const el = $(id);
    if (el.type === "checkbox") el.checked = !!S[key]; else el.value = S[key];
    el.addEventListener("change", () => {
      S[key] = el.type === "checkbox" ? el.checked : num ? Math.max(2, +el.value || DEFAULTS[key]) : el.value;
      saveSettings();
      if (key === "back") player.backView = S.back ? "top-right" : "none";
      if (key === "showLen") showCase();
      if (key === "target") renderSet();
    });
  };
  bind("target", "target", true); bind("show-len", "showLen"); bind("auto", "auto"); bind("back", "back");
  bind("rand-dr", "randDR"); bind("rand-mirror", "randMirror"); bind("rand-ud", "randUD");
  const target = () => S.target * 1000;
  const openDrawer = () => { $("scrim").hidden = false; $("drawer").hidden = false; $("close-settings").focus(); };
  const closeDrawer = () => { $("scrim").hidden = true; $("drawer").hidden = true; };
  $("open-settings").addEventListener("click", openDrawer);
  $("close-settings").addEventListener("click", closeDrawer);
  $("scrim").addEventListener("click", closeDrawer);
  const storeText = {
    sqlite: () => `Progress is kept in a SQLite database on this device (${Store.detail}). It stays when you close the app. Back it up before deleting the app or clearing site data.`,
    local: () => `SQLite is not available here (${Store.detail}), so progress is kept in the browser's local storage instead.`,
    locked: () => `The progress database is open in another tab or window. Close the other one and reload. Nothing is saved from this one.`,
  };
  const storeNote = () => (storeText[Store.mode] ? storeText[Store.mode]() : "");
  $("store-note").textContent = storeNote();
  $("open-info").addEventListener("click", () => { $("info-store").textContent = storeNote(); $("info").showModal(); });

  // ---- the chosen set
  let set = [];
  function fillClasses() {
    $("cls").innerHTML = classes.map((c) => `<option value="${c}">${c} (${CASES.filter((k) => k.c === c).length})</option>`).join("");
    $("cls").value = S.cls;
  }
  const typeOk = (k) => S.type === "all" || (S.type === "trig" ? k.t === 1 : k.t === 0);
  const pool = () => CASES.filter((k) => k.c === S.cls && typeOk(k));
  function fillTypes() {
    const n = CASES.filter((k) => k.c === S.cls), t = n.filter((k) => k.t).length;
    $("type").innerHTML = `<option value="all">All (${n.length})</option><option value="trig">Ends in trigger (${t})</option><option value="brk">Breaks rzp (${n.length - t})</option>`;
    if (S.type === "trig" && !t) S.type = "all";
    if (S.type === "brk" && t === n.length) S.type = "all";
    $("type").value = S.type;
    $("trig-note").textContent = `Standard trigger for ${S.cls}: ${trigOf[S.cls]}. Trigger cases are setup moves that keep the class, then the trigger. Breaking cases need an earlier quarter turn that changes the class.`;
  }
  function fillLengths() {
    const cnt = {};
    for (const k of pool()) cnt[k.m] = (cnt[k.m] || 0) + 1;
    const ls = Object.keys(cnt).map(Number).sort((a, b) => a - b);
    if (!ls.includes(S.len)) S.len = ls.find((m) => cnt[m] >= 5) || ls[0];
    $("len").innerHTML = ls.map((m) => `<option value="${m}">${m} (${cnt[m]})</option>`).join("");
    $("len").value = S.len;
  }
  function buildSet() {
    set = pool().filter((k) => (S.upto ? k.m <= S.len : k.m === S.len));
    $("set-count").textContent = `${set.length} case${set.length === 1 ? "" : "s"}`;
  }
  const stateOf = (k) => { const r = prog[k.id]; return !r ? "new" : r.box <= 1 ? "learn" : r.box <= 3 ? "young" : "known"; };

  // ---- choosing the next case
  let queue = [], qpos = 0, misses = [], recent = [], ahead = false;
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  function startRecap(list) { queue = shuffle(list.slice()); qpos = 0; misses = []; }
  function pickReview() {
    const now = Date.now();
    const skip = new Set(recent.slice(-Math.min(3, set.length - 1)));
    const pool = set.filter((k) => !skip.has(k.id));
    const due = pool.filter((k) => prog[k.id] && prog[k.id].due <= now).sort((a, b) => prog[a.id].due - prog[b.id].due);
    ahead = false;
    if (due.length) return due[0];
    const fresh = pool.filter((k) => !prog[k.id]);
    const learning = set.filter((k) => prog[k.id] && prog[k.id].box <= 1).length;
    if (fresh.length && learning < LEARNING_AT_ONCE) return fresh[Math.floor(Math.random() * fresh.length)];
    const seen = pool.filter((k) => prog[k.id]).sort((a, b) => prog[a.id].due - prog[b.id].due);
    if (seen.length) { ahead = true; return seen[0]; }
    return fresh.length ? fresh[0] : set[0];
  }

  // ---- scrambles
  const MIRRORS = [["R", "L"], ["U", "D"], ["F", "B"]];
  function mirrorAlg(s, which) {
    const sw = {}; let odd = 0;
    which.forEach((on, i) => { if (on) { const [a, b] = MIRRORS[i]; sw[a] = b; sw[b] = a; odd ^= 1; } });
    return s.split(" ").map((t) => {
      const f = sw[t[0]] || t[0], suf = t.slice(1);
      return f + (odd && suf !== "2" ? (suf === "'" ? "" : "'") : suf);
    }).join(" ");
  }
  const DRNAMES = ["U", "U2", "U'", "D", "D2", "D'", "R2", "L2", "F2", "B2"];
  const axisOf = (x) => ("UD".includes(x[0]) ? 0 : "RL".includes(x[0]) ? 1 : 2);
  function randomDR(n) {
    const out = [];
    while (out.length < n) {
      const m = DRNAMES[Math.floor(Math.random() * DRNAMES.length)], c = out.length;
      if (c && out[c - 1][0] === m[0]) continue;
      if (c > 1 && axisOf(out[c - 1]) === axisOf(m) && axisOf(out[c - 2]) === axisOf(m)) continue;
      out.push(m);
    }
    return out.join(" ");
  }

  // ---- the case on screen. phase: idle | solve | confirm | done
  let cur = null, phase = "idle", t0 = 0, frozen = 0, advance = 0, log = [], mine = [];
  const elapsed = () => (phase === "solve" ? performance.now() - t0 : frozen);

  function show(k) {
    clearTimeout(advance);
    let alg = k.s;
    if (S.randMirror) alg = mirrorAlg(alg, [0, 1, 2].map(() => Math.random() < 0.5));
    let setup = C.names(C.invertSeq(C.parse(alg)));
    if (S.randUD) setup += " " + ["U", "U2", "U'", "D", "D2", "D'"][Math.floor(Math.random() * 6)];
    const scr = (S.randDR ? randomDR(12) + " " : "") + setup;
    const g = C.applySeq(C.solved(), C.parse(scr));
    const sols = D.solve(g, 7);
    cur = { k, g, scr, sols, d: sols[0].length };
    recent.push(k.id); if (recent.length > 8) recent.shift();
    phase = "solve"; t0 = performance.now(); frozen = 0;
    player.experimentalSetupAlg = scr; player.alg = ""; player.jumpToStart();
    mine = []; renderMoves();
    $("scramble").textContent = scr;
    $("sols").innerHTML = ""; status("", "");
    showCase(); renderActions(); renderSet();
  }
  function nextCase() {
    if (!set.length) return;
    if (S.mode === "recap") { if (qpos >= queue.length) return recapDone(); show(queue[qpos]); }
    else show(pickReview());
  }
  function recapDone() {
    clearTimeout(advance);
    cur = null; phase = "idle";
    const n = queue.length, miss = misses.length;
    $("case-name").textContent = "Recap finished"; $("case-opt").textContent = "";
    status(miss ? `${n - miss} of ${n} optimal. ${miss} missed.` : `All ${n} cases optimal.`, miss ? "warn" : "hit");
    $("sols").innerHTML = "";
    renderActions(); renderSet();
  }
  function showCase() {
    if (!cur) return;
    $("case-name").textContent = `${cur.k.c} · ${cur.k.m} · ${label(cur.k)}`;
    $("case-opt").textContent = S.showLen || phase !== "solve" ? `DR in ${cur.d} · ${cur.k.t ? "ends in trigger" : "breaks rzp"}` : "";
  }
  function status(msg, cls) { const t = $("status"); t.textContent = msg; t.className = cls; }
  function showSolutions(mine) {
    const list = cur.sols.map((s) => C.names(s));
    const min = minLen[cur.k.c];
    const tag = (s) => (isTrigger(s.split(" "), min) ? "trig" : "brk");
    const shown = list.slice().sort((a, b) => (tag(a) === "trig" ? 0 : 1) - (tag(b) === "trig" ? 0 : 1)).slice(0, 12);
    $("sols").innerHTML = shown.map((s) => `<button data-alg="${s}" class="${tag(s)}${s === mine ? " mine" : ""}">${s}</button>`).join("")
      + (list.length > 12 ? `<span class="more">+${list.length - 12} more</span>` : "")
      + `<p class="key"><i class="trig"></i>ends in the trigger <i class="brk"></i>breaks the rzp</p>`;
  }
  $("sols").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-alg]");
    if (b) { player.alg = b.dataset.alg; player.jumpToStart(); player.play(); }
  });

  // ---- optional: tap the centre of a face to turn it clockwise
  const FACES = [["R", 0, 1], ["L", 0, -1], ["U", 1, 1], ["D", 1, -1], ["F", 2, 1], ["B", 2, -1]];   // face, axis, side (cube spans +-0.5)
  async function faceAt(cx, cy) {
    const v = [...(await player.experimentalCurrentVantages())][0];
    const cam = await v.camera();
    cam.updateMatrixWorld(true);
    const r = player.getBoundingClientRect();
    const x = ((cx - r.left) / r.width) * 2 - 1, y = -(((cy - r.top) / r.height) * 2 - 1);
    const a = new cam.position.constructor(x, y, 0.5).unproject(cam), o = cam.position;
    const d = [a.x - o.x, a.y - o.y, a.z - o.z], oo = [o.x, o.y, o.z];
    let best = null;
    for (const [m, ax, sg] of FACES) {
      const dn = d[ax] * sg;
      if (dn >= 0) continue;                       // facing away from the camera
      const t = (0.5 - oo[ax] * sg) / dn;
      if (t <= 0) continue;
      const pt = [0, 1, 2].map((i) => oo[i] + t * d[i]), others = [0, 1, 2].filter((i) => i !== ax);
      if (others.some((i) => Math.abs(pt[i]) > 0.5)) continue;
      if (!best || t < best.t) best = { m, t, centre: others.every((i) => Math.abs(pt[i]) <= 1 / 6) };
    }
    return best && best.centre ? best.m : null;
  }
  const canonMine = () => C.canon(C.parse(mine.join(" ")));
  function renderMoves() {
    const c = mine.length ? canonMine() : [];
    $("mymoves").innerHTML = mine.length ? `<b>${c.length ? C.names(c) : "no net moves"}</b> <span>${c.length} move${c.length === 1 ? "" : "s"}</span>` : `<span>Tap the centre of a face to turn it clockwise.</span>`;
  }
  function resetMoves() { mine = []; player.alg = ""; player.jumpToStart(); renderMoves(); if (phase === "solve") status("", ""); }
  function turn(m) {
    mine.push(m); player.experimentalAddMove(m); renderMoves(); status("", "");
    if (!D.isDR(C.applySeq(cur.g, C.parse(mine.join(" "))))) return;
    const sol = canonMine(), text = C.names(sol), ms = performance.now() - t0;
    if (sol.length > cur.d) {   // DR, but longer than optimal: the timer keeps running so you can reset and try again
      status(`DR in ${sol.length}, optimal is ${cur.d}. Reset to try again, or keep turning.`, "warn");
      return;
    }
    const fast = ms <= target();   // optimal DR: found, the timer stops
    finish(fast ? "fast" : "slow", text, ms);
    status(fast ? `DR in ${sol.length}, optimal, ${fmt(ms)}` : `DR in ${sol.length}, optimal, but ${fmt(ms)} is over the ${fmt(target())} target`, fast ? "hit" : "info");
  }
  let down = null;
  $("cube").addEventListener("pointerdown", (ev) => { down = ev.isPrimary ? { x: ev.clientX, y: ev.clientY, t: performance.now() } : null; }, true);
  $("cube").addEventListener("pointerup", async (ev) => {
    const d = down; down = null;
    if (!d || !S.tap || phase !== "solve") return;
    if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 8 || performance.now() - d.t > 600) return;   // a drag turns the view, not the cube
    const m = await faceAt(ev.clientX, ev.clientY).catch(() => null);
    if (m && phase === "solve") turn(m);
  }, true);
  $("cube").addEventListener("pointercancel", () => { down = null; }, true);
  const syncTap = () => { $("toggle-tap").textContent = S.tap ? "Tap to turn: on" : "Tap to turn: off"; $("moverow").hidden = !S.tap; };
  $("toggle-tap").addEventListener("click", () => { S.tap = !S.tap; saveSettings(); resetMoves(); syncTap(); });
  $("reset-moves").addEventListener("click", resetMoves);

  // ---- actions and grading
  function renderActions() {
    const btn = (act, label, key, cls = "") => `<button data-act="${act}" class="${cls}">${label}<kbd>${key}</kbd></button>`;
    $("actions").innerHTML =
      phase === "solve" ? btn("found", "Found it", "Space", "primary") + btn("giveup", "Give up", "Esc")
      : phase === "confirm" ? btn("yes", "Yes, optimal", "Y", "primary") + btn("no", "No", "N")
      : phase === "done" ? btn("next", "Next", "Space", "primary")
      : S.mode === "recap" && queue.length ? btn("again", "Shuffle again", "") + (misses.length ? btn("redo", "Repeat the misses", "") : "") : "";
  }
  function record(k, result, ms) {
    const now = Date.now();
    const r = prog[k.id] || { id: k.id, box: 0, due: 0, n: 0, fails: 0, last: 0, avg: 0, best: 0, ts: 0 };
    const early = r.n > 0 && now < r.due && now - r.ts < STEPS[r.box] / 2;
    if (result === "miss") { r.box = 0; r.fails++; }
    else if (result === "slow") r.box = Math.min(r.box, 2);
    else if (!early) r.box = Math.min(r.box + 1, STEPS.length - 1);
    r.due = now + STEPS[r.box]; r.n++; r.ts = now;
    if (result !== "miss") {
      r.last = Math.round(ms); r.avg = Math.round(r.avg ? 0.6 * r.avg + 0.4 * ms : ms);
      r.best = r.best ? Math.min(r.best, r.last) : r.last;
    }
    prog[k.id] = r;
    return r;
  }
  function finish(result, text, ms) {
    phase = "done"; frozen = ms;
    const row = record(cur.k, result, ms);
    const attempt = { ts: Date.now(), id: cur.k.id, result, ms: Math.round(ms), sol: text };
    Store.record({ ...row }, attempt).catch(() => status("Could not save this result on the device.", "warn"));
    log.unshift({ ...attempt });
    if (S.mode === "recap") { if (result === "miss") misses.push(cur.k); qpos++; }
    showCase(); showSolutions(text); renderActions(); renderStats(); renderSet();
    const id = cur.k.id;
    if (result === "fast" && S.auto) advance = setTimeout(() => { if (phase === "done" && cur && cur.k.id === id) nextCase(); }, 1100);
  }
  function found() {
    if (phase !== "solve") return;
    frozen = performance.now() - t0; phase = "confirm";
    showCase(); showSolutions(); renderActions();
    status("Was your solution one of these?", "info");
  }
  function answer(yes) {
    if (phase !== "confirm") return;
    const ms = frozen;
    if (yes) {
      const fast = ms <= target();
      finish(fast ? "fast" : "slow", "yours", ms);
      status(fast ? `Optimal in ${fmt(ms)}` : `Optimal, but ${fmt(ms)} is over the ${fmt(target())} target`, fast ? "hit" : "info");
    } else { finish("miss", "", ms); status("Counted as a miss.", "warn"); }
  }
  function giveUp() {
    if (phase !== "solve" && phase !== "confirm") return;
    const ms = phase === "confirm" ? frozen : performance.now() - t0;
    finish("miss", "", ms); status("These are the optimal ones. Counted as a miss.", "info");
  }
  $("actions").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-act]"); if (!b) return;
    ({ found, giveup: giveUp, yes: () => answer(true), no: () => answer(false), next: nextCase,
       again: () => { startRecap(set); nextCase(); }, redo: () => { startRecap(misses.slice()); nextCase(); } })[b.dataset.act]();
  });

  // ---- panels
  const fmt = (ms) => { const s = ms / 1000; return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}:${(s % 60).toFixed(0).padStart(2, "0")}`; };
  const gap = (ms) => ms < 90 * MIN ? `${Math.max(1, Math.round(ms / MIN))} min` : ms < 36 * 60 * MIN ? `${Math.round(ms / (60 * MIN))} h` : `${Math.round(ms / (1440 * MIN))} d`;
  function renderSet() {
    const now = Date.now(), n = { new: 0, learn: 0, young: 0, known: 0 };
    let fast = 0, dueN = 0;
    for (const k of set) { n[stateOf(k)]++; const r = prog[k.id]; if (r && r.last && r.last <= target() && r.box > 0) fast++; if (r && r.due <= now) dueN++; }
    const col = { new: "var(--chip)", learn: "var(--miss)", young: "var(--warn)", known: "var(--hit)" };
    $("bar").innerHTML = ["known", "young", "learn", "new"].map((s) => n[s] ? `<i style="flex:${n[s]};background:${col[s]}"></i>` : "").join("");
    $("l-new").textContent = `${n.new} new`; $("l-learn").textContent = `${n.learn} learning`;
    $("l-young").textContent = `${n.young} settling`; $("l-known").textContent = `${n.known} known`;
    $("l-fast").textContent = `${fast} of ${set.length} last solved within ${fmt(target())}`;
    $("chips").innerHTML = set.map((k) => {
      const r = prog[k.id], st = stateOf(k);
      const cls = [`s-${st}`, cur && cur.k === k ? "cur" : "", r && r.due <= now ? "due" : "", r && r.last > target() ? "slow" : ""].join(" ");
      const sub = !r ? "new" : r.last ? fmt(r.last) : "missed";
      const tip = !r ? "Not seen yet" : `Seen ${r.n}×, missed ${r.fails}×, ${r.due <= now ? "due now" : "due in " + gap(r.due - now)}`;
      return `<button class="${cls}" data-id="${k.id}" title="${tip}">${S.upto ? `${k.m}·` : ""}${label(k)}<em>${sub}</em></button>`;
    }).join("");
    if (S.mode === "recap") {
      $("q-pos").textContent = queue.length ? `${Math.min(qpos + (phase === "solve" || phase === "confirm" ? 1 : 0), queue.length)} / ${queue.length}` : "–";
      $("q-label").textContent = "recap";
      $("mode-note").textContent = "Every case in the set once, in a random order. Results still feed the spaced review.";
    } else {
      $("q-pos").textContent = dueN; $("q-label").textContent = "due";
      const next = set.filter((k) => prog[k.id] && prog[k.id].due > now).sort((a, b) => prog[a.id].due - prog[b.id].due)[0];
      $("mode-note").textContent = ahead ? `Nothing is due, so this one is early. Next due in ${next ? gap(prog[next.id].due - now) : "–"}.`
        : `Due cases first, then new ones, at most ${LEARNING_AT_ONCE} being learned at a time. A miss comes back in a minute.`;
    }
    $("mode-review").setAttribute("aria-pressed", S.mode === "review");
    $("mode-recap").setAttribute("aria-pressed", S.mode === "recap");
  }
  function renderStats() {
    const rows = log.slice(0, 60), good = rows.filter((r) => r.result !== "miss");
    $("s-cases").textContent = rows.length;
    $("s-opt").textContent = rows.length ? `${Math.round((100 * good.length) / rows.length)}%` : "–";
    $("s-time").textContent = good.length ? fmt(good.reduce((t, r) => t + r.ms, 0) / good.length) : "–";
    $("hist").innerHTML = rows.map((r) => {
      const k = caseById.get(String(r.id)); if (!k) return "";
      return `<div class="${r.result === "fast" ? "ok" : r.result}"><span>${k.c} #${k.no}</span><span>${k.m}</span><span>${r.result === "miss" ? "missed" : r.result === "slow" ? "slow" : "fast"}</span><em>${fmt(r.ms)}</em></div>`;
    }).join("") || `<div class="empty">Answered cases show up here, newest first.</div>`;
  }

  // ---- controls
  function changeSet() {
    buildSet(); saveSettings(); recent = [];
    if (S.mode === "recap") startRecap(set);
    wipeArmed = false; $("wipe-note").textContent = "";
    nextCase();
  }
  $("cls").addEventListener("change", () => { S.cls = $("cls").value; fillTypes(); fillLengths(); changeSet(); });
  $("type").addEventListener("change", () => { S.type = $("type").value; fillLengths(); changeSet(); });
  const syncScr = () => { $("scramble").hidden = !S.showScr; $("toggle-scr").textContent = S.showScr ? "Hide scramble" : "Show scramble"; };
  $("toggle-scr").addEventListener("click", () => { S.showScr = !S.showScr; saveSettings(); syncScr(); });
  $("len").addEventListener("change", () => { S.len = +$("len").value; changeSet(); });
  $("upto").checked = S.upto;
  $("upto").addEventListener("change", () => { S.upto = $("upto").checked; changeSet(); });
  $("mode-review").addEventListener("click", () => { S.mode = "review"; saveSettings(); nextCase(); });
  $("mode-recap").addEventListener("click", () => { S.mode = "recap"; saveSettings(); startRecap(set); nextCase(); });
  $("chips").addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (b) show(caseById.get(b.dataset.id)); });

  let wipeArmed = false;
  $("wipe").addEventListener("click", () => {
    if (!wipeArmed) { wipeArmed = true; $("wipe-note").textContent = `Press again to forget all ${set.length} cases in this set.`; return; }
    wipeArmed = false;
    const ids = set.filter((k) => prog[k.id]).map((k) => k.id);
    for (const id of ids) delete prog[id];
    Store.forget(ids).then(() => { $("wipe-note").textContent = "Progress for this set was reset."; renderSet(); },
      () => { $("wipe-note").textContent = "Could not reset on the device."; });
    renderSet();
  });
  $("backup").addEventListener("click", async () => {
    try {
      const data = await Store.dump();
      const text = JSON.stringify({ app: "dr-memoriser", version: 1, saved: new Date().toISOString(), ...data });
      const name = `dr-memoriser-${new Date().toISOString().slice(0, 10)}.json`;
      const file = new File([text], name, { type: "application/json" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); }
      else { const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000); }
      $("backup-note").textContent = `Backed up ${data.progress.length} cases and ${data.attempts.length} attempts.`;
    } catch (e) { if (e && e.name !== "AbortError") $("backup-note").textContent = "Could not make a backup: " + (e.message || e); }
  });
  $("restore").addEventListener("click", () => $("restore-file").click());
  $("restore-file").addEventListener("change", async () => {
    const f = $("restore-file").files[0]; $("restore-file").value = "";
    if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (d.app !== "dr-memoriser" || !Array.isArray(d.progress) || !Array.isArray(d.attempts)) throw new Error("This is not a DR Memoriser backup.");
      const rows = d.progress.filter((r) => caseById.has(String(r.id)) && (!prog[r.id] || r.ts > prog[r.id].ts)).map((r) => ({ ...r, id: String(r.id) }));
      await Store.restore({ progress: rows, attempts: d.attempts.filter((a) => caseById.has(String(a.id))) });
      for (const r of rows) prog[r.id] = r;
      log = (await Store.recent(60)).map((a) => ({ ...a }));
      renderStats(); renderSet();
      $("backup-note").textContent = `Restored ${rows.length} cases (newer than what is on this device).`;
    } catch (e) { $("backup-note").textContent = "Could not restore: " + (e.message || e); }
  });

  setInterval(() => {
    if (!cur && phase === "idle") return;
    const ms = elapsed(), t = $("timer");
    t.textContent = fmt(ms); t.classList.toggle("over", phase === "solve" && ms > target());
  }, 100);

  document.addEventListener("keydown", (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (!$("drawer").hidden) { if (ev.key === "Escape") closeDrawer(); return; }
    if ($("info").open) return;
    const tag = ev.target.tagName;
    if (tag === "SELECT" || tag === "TEXTAREA" || (tag === "INPUT" && ev.target.type !== "checkbox") || (tag === "BUTTON" && ev.key === " ")) return;
    const k = ev.key.toLowerCase();
    if (ev.key === " ") { ev.preventDefault(); phase === "solve" ? found() : phase === "done" ? nextCase() : 0; }
    else if (ev.key === "Enter") { if (phase === "done" || phase === "idle") { ev.preventDefault(); nextCase(); } }
    else if (k === "y") answer(true);
    else if (k === "n") answer(false);
    else if (ev.key === "Escape" || ev.key === "/") { ev.preventDefault(); giveUp(); }
  });

  // ---- start
  fillClasses(); fillTypes(); fillLengths(); buildSet(); syncScr(); syncTap();
  if (S.mode === "recap") startRecap(set);
  log = (await Store.recent(60)).map((a) => ({ ...a }));
  renderStats();
  nextCase();

  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
