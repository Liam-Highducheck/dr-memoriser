// EO trainer core: facelet cube model, EO masks for the three axes, and enumeration of every NISS EO up to
// 5 moves. A state is a permutation of the 54 sticker slots: g[i] = slot where the sticker that started in
// slot i is now; doing move m gives g'[i] = m[g[i]]. Slots are face-major in the order U R F D L B, each face
// read row by row as it appears on the usual net.

const Cube = (() => {
  const FACE_ORDER = ["U", "R", "F", "D", "L", "B"];
  const NORMAL = { U: [0, 1, 0], R: [1, 0, 0], F: [0, 0, 1], D: [0, -1, 0], L: [-1, 0, 0], B: [0, 0, -1] };
  const POS = {
    U: (r, c) => [c - 1, 1, r - 1],
    D: (r, c) => [c - 1, -1, 1 - r],
    F: (r, c) => [c - 1, 1 - r, 1],
    B: (r, c) => [1 - c, 1 - r, -1],
    R: (r, c) => [1, 1 - r, 1 - c],
    L: (r, c) => [-1, 1 - r, c - 1],
  };
  const stickers = [];
  for (const f of FACE_ORDER)
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) stickers.push({ face: f, pos: POS[f](r, c), nrm: NORMAL[f] });
  const key = (p, n) => p.join(",") + "|" + n.join(",");
  const index = new Map(stickers.map((s, i) => [key(s.pos, s.nrm), i]));
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  // clockwise quarter turn seen from the face: v -> n(n.v) - n x v
  const rot = (n, v) => { const c = cross(n, v), d = dot(n, v); return [n[0] * d - c[0], n[1] * d - c[1], n[2] * d - c[2]]; };

  // moves: face index f in U D R L F B order; move = 3f + k, k = 0 quarter, 1 half, 2 prime
  const MFACES = ["U", "D", "R", "L", "F", "B"];
  const AXIS_NAMES = ["UD", "RL", "FB"];
  const MOVE_NAMES = [];
  const MOVES = [];
  for (const f of MFACES) {
    const n = NORMAL[f];
    const q = stickers.map((s, i) => (dot(s.pos, n) === 1 ? index.get(key(rot(n, s.pos), rot(n, s.nrm))) : i));
    let p = q.slice();
    for (const suf of ["", "2", "'"]) {
      MOVE_NAMES.push(f + suf);
      MOVES.push(Uint8Array.from(p));
      p = p.map((j) => q[j]);
    }
  }
  // whole-cube rotations as slot maps: y turns like U, x like R, z like F
  const ROTS = {};
  for (const [r, f] of [["y", "U"], ["x", "R"], ["z", "F"]]) {
    const q = stickers.map((s) => index.get(key(rot(NORMAL[f], s.pos), rot(NORMAL[f], s.nrm))));
    ROTS[r] = Uint8Array.from(q);
    ROTS[r + "'"] = Uint8Array.from(q.map((j) => q[q[j]]));
  }
  const axisOf = (m) => Math.floor(m / 6);
  const faceOf = (m) => Math.floor(m / 3);
  const flips = (m, ax) => axisOf(m) === ax && m % 3 !== 1;
  const allowed = (prev, next) => prev < 0 || (faceOf(prev) !== faceOf(next) && !(axisOf(prev) === axisOf(next) && faceOf(next) < faceOf(prev)));

  const solved = () => Uint8Array.from({ length: 54 }, (_, i) => i);
  const apply = (g, m) => { const mv = MOVES[m], o = new Uint8Array(54); for (let i = 0; i < 54; i++) o[i] = mv[g[i]]; return o; };
  const applySeq = (g, seq) => seq.reduce(apply, g);
  const compose = (s, x) => { const o = new Uint8Array(54); for (let i = 0; i < 54; i++) o[i] = x[s[i]]; return o; };
  const inverse = (g) => { const o = new Uint8Array(54); for (let i = 0; i < 54; i++) o[g[i]] = i; return o; };
  // with the cube turned so physical slot s is seen at slot view[s], move M as seen is physical move view^-1 M view
  const conjMove = (view, M) => {
    const vi = inverse(view), want = Array.from({ length: 54 }, (_, s) => vi[MOVES[M][view[s]]]);
    return MOVES.findIndex((mv) => want.every((v, s) => mv[s] === v));
  };
  const invertSeq = (seq) => seq.slice().reverse().map((m) => 3 * faceOf(m) + [2, 1, 0][m % 3]);
  const parse = (s) => s.trim().split(/\s+/).filter(Boolean).map((t) => {
    const m = MOVE_NAMES.indexOf(t.replace("’", "'"));
    if (m < 0) throw new Error(`"${t}" is not a move`);
    return m;
  });
  const names = (seq) => seq.map((m) => MOVE_NAMES[m]).join(" ");
  const keyOf = (g) => String.fromCharCode(...g);

  // merge same-face turns (also across the opposite face, which commutes), then put same-axis pairs in order
  function canon(seq) {
    let s = seq.slice(), changed = true;
    while (changed) {
      changed = false;
      const out = [];
      for (const m of s) {
        let j = out.length - 1;
        while (j >= 0 && axisOf(out[j]) === axisOf(m) && faceOf(out[j]) !== faceOf(m)) j--;
        if (j >= 0 && faceOf(out[j]) === faceOf(m)) {
          const tot = ((out[j] % 3) + 1 + (m % 3) + 1) % 4;
          changed = true;
          if (tot === 0) out.splice(j, 1); else out[j] = 3 * faceOf(m) + tot - 1;
        } else out.push(m);
      }
      s = out;
    }
    for (let i = 0; i + 1 < s.length; i++)
      if (axisOf(s[i]) === axisOf(s[i + 1]) && faceOf(s[i + 1]) < faceOf(s[i])) [s[i], s[i + 1]] = [s[i + 1], s[i]];
    return s;
  }

  // EO: one "good" sticker per edge slot. Axis FB (flipped by F/B quarter turns): U/D stickers, and F/B stickers
  // of E-slice edges. RL: U/D stickers, and R/L stickers of E-slice edges. UD: F/B stickers, and U/D stickers
  // of S-slice edges.
  const isEdge = (p) => p.filter((x) => x !== 0).length === 2;
  const edgePositions = [];
  const edgeSlot = new Int8Array(54).fill(-1);
  stickers.forEach((s, i) => {
    if (!isEdge(s.pos)) return;
    const k = s.pos.join(",");
    let j = edgePositions.indexOf(k);
    if (j < 0) { j = edgePositions.length; edgePositions.push(k); }
    edgeSlot[i] = j;
  });
  const goodRule = [
    (s) => (s.nrm[2] !== 0) || (s.nrm[1] !== 0 && s.pos[2] === 0), // UD
    (s) => (s.nrm[1] !== 0) || (s.nrm[0] !== 0 && s.pos[1] === 0), // RL
    (s) => (s.nrm[1] !== 0) || (s.nrm[2] !== 0 && s.pos[1] === 0), // FB
  ];
  const good = goodRule.map((rule) => stickers.map((s, i) => edgeSlot[i] >= 0 && rule(s)));
  const ref = good.map((gd) => { const r = new Array(12); gd.forEach((v, i) => { if (v) r[edgeSlot[i]] = i; }); return r; });
  const eoMask = (g, ax) => { let m = 0; for (const r of ref[ax]) { const t = g[r]; if (!good[ax][t]) m |= 1 << edgeSlot[t]; } return m; };
  const eoOk = (g, ax) => eoMask(g, ax) === 0;
  const badSlots = (g, ax) => { const out = []; for (const r of ref[ax]) { const t = g[r]; if (!good[ax][t]) out.push(t); } return out; };

  // mask transitions and distances
  const T = [0, 1, 2].map((ax) => MOVES.map((mv) => {
    const dest = [], flip = [];
    for (let s = 0; s < 12; s++) { const t = mv[ref[ax][s]]; dest.push(edgeSlot[t]); flip.push(good[ax][t] ? 0 : 1); }
    const tab = new Uint16Array(4096);
    for (let x = 0; x < 4096; x++) { let y = 0; for (let s = 0; s < 12; s++) if (((x >> s) & 1) ^ flip[s]) y |= 1 << dest[s]; tab[x] = y; }
    return tab;
  }));
  const DIST = [0, 1, 2].map((ax) => {
    const d = new Uint8Array(4096).fill(255); d[0] = 0; let fr = [0];
    for (let k = 1; fr.length; k++) {
      const nx = [];
      for (const x of fr) for (let m = 0; m < 18; m++) { const y = T[ax][m][x]; if (d[y] === 255) { d[y] = k; nx.push(y); } }
      fr = nx;
    }
    return d;
  });

  // An outer move is useless unless it flips: the run of same-axis moves at the outer end of a side may hold only
  // quarter turns of the EO axis. strip() drops the useless ones (A: trailing end, B: leading end).
  function outerOk(seq, ax, atEnd) {
    if (!seq.length) return true;
    const s = atEnd ? seq.slice().reverse() : seq;
    if (!flips(s[0], ax)) return false;
    return !(s.length > 1 && axisOf(s[1]) === axisOf(s[0]) && !flips(s[1], ax));
  }
  function strip(seq, ax, atEnd) {
    let s = canon(seq);
    for (;;) {
      if (!s.length) return s;
      const idx = atEnd ? [s.length - 1, s.length - 2] : [0, 1];
      const run = idx.filter((i, k) => i >= 0 && i < s.length && (k === 0 || axisOf(s[i]) === axisOf(s[idx[0]])));
      const bad = run.find((i) => !flips(s[i], ax));
      if (bad === undefined) return s;
      s = s.filter((_, i) => i !== bad);
    }
  }

  // every NISS EO (A normal moves, B premoves) with |A| + |B| <= maxc, one per resulting state B P A, cheapest
  // first; outer moves on both sides must flip (see outerOk)
  function allEOs(P, maxc = 5) {
    const gP = applySeq(solved(), P);
    const found = new Map();
    const outerSeqs = (ax, len) => {
      let out = [[]];
      for (let k = 0; k < len; k++) {
        const nx = [];
        for (const s of out) for (let m = 0; m < 18; m++) if (allowed(s.length ? s[s.length - 1] : -1, m) && (k > 0 || flips(m, ax))) nx.push([...s, m]);
        out = nx;
      }
      return out.filter((s) => outerOk(s, ax, false));
    };
    for (let c = 1; c <= maxc; c++)
      for (let ax = 0; ax < 3; ax++)
        for (let b = 0; b <= c; b++) {
          const a = c - b;
          for (const B of outerSeqs(ax, b)) {
            const S = compose(applySeq(solved(), B), gP);
            const x0 = eoMask(S, ax);
            if (DIST[ax][x0] > a) continue;
            const A = [];
            const dfs = (x, left) => {
              if (left === 0) {
                if (x !== 0 || !outerOk(A, ax, true)) return;
                const q = applySeq(S, A);
                const k = keyOf(q);
                if (!found.has(k)) found.set(k, { A: A.slice(), B: B.slice(), c, ax });
                return;
              }
              for (let m = 0; m < 18; m++) {
                if (!allowed(A.length ? A[A.length - 1] : -1, m)) continue;
                const y = T[ax][m][x];
                if (DIST[ax][y] > left - 1) continue;
                if (left === 1 && !flips(m, ax)) continue;
                A.push(m); dfs(y, left - 1); A.pop();
              }
            };
            dfs(x0, a);
          }
        }
    // group: EOs that differ only in the direction of their outer quarter turns (F vs F' as the last normal move
    // or the first premove) share a group, the state reached with every outer quarter turn made clockwise
    const outward = (seq, ax, atEnd) => {
      const s = seq.slice(), i = atEnd ? s.length - 1 : 0, j = atEnd ? i - 1 : 1;
      for (const k of [i, j]) if (k >= 0 && k < s.length && axisOf(s[k]) === axisOf(s[i]) && flips(s[k], ax)) s[k] = 3 * faceOf(s[k]);
      return s;
    };
    return [...found.entries()].map(([key, e]) => {
      const B = outward(e.B, e.ax, false), A = outward(e.A, e.ax, true);
      const group = keyOf(applySeq(compose(applySeq(solved(), B), gP), A));
      return { ...e, key, group, type: e.B.length === 0 ? "normal" : e.A.length === 0 ? "inverse" : "mixed" };
    });
  }

  // NISS notation: normal moves, then the inverse-side moves in brackets (premoves B written as B^-1)
  const niss = (A, B) => [names(A), B.length ? `(${names(invertSeq(B))})` : ""].filter(Boolean).join(" ");

  function randomScramble(len = 22, rnd = Math.random) {
    const s = [];
    while (s.length < len) {
      const m = Math.floor(rnd() * 18);
      if (s.length && !allowed(s[s.length - 1], m)) continue;
      s.push(m);
    }
    return s;
  }

  return { ROTS, conjMove, MOVE_NAMES, AXIS_NAMES, stickers, edgeSlot, solved, apply, applySeq, compose, inverse, invertSeq, parse, names,
           keyOf, canon, strip, eoMask, eoOk, badSlots, allEOs, niss, randomScramble, flips, axisOf };
})();

if (typeof module !== "undefined") module.exports = Cube;
