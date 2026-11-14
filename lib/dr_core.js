// DR (U/D axis) from an F/B EO: checks, bad-piece counts, an optimal solver and a case generator. Moves that keep
// the F/B EO: any U, D, R, L turn, and F2, B2. DR: every corner's U/D sticker on U or D, both other EOs good, and
// the four E-slice edges in the E slice.

const DR = (C) => {
  const S = C.stickers;
  const ud = (i) => S[i].face === "U" || S[i].face === "D";
  const onUD = (slot) => S[slot].nrm[1] !== 0;
  const isCorner = (i) => S[i].pos.every((x) => x !== 0);
  const isEdge = (i) => C.edgeSlot[i] >= 0;
  const inE = (slot) => S[slot].pos[1] === 0;
  const cornerUD = S.map((_, i) => i).filter((i) => isCorner(i) && ud(i));      // one per corner piece
  const ePieces = S.map((_, i) => i).filter((i) => isEdge(i) && inE(i) && S[i].nrm[2] !== 0); // one per E piece
  const edgeAll = S.map((_, i) => i).filter(isEdge);

  const MOVES = C.MOVE_NAMES.map((n, m) => m).filter((m) => !("FB".includes(C.MOVE_NAMES[m][0]) && m % 3 !== 1));
  const DRMOVES = MOVES.filter((m) => C.MOVE_NAMES[m][0] === "U" || C.MOVE_NAMES[m][0] === "D" || m % 3 === 1);

  const badCorners = (g) => cornerUD.filter((i) => !onUD(g[i])).length;
  const eOut = (g) => ePieces.filter((i) => !inE(g[i])).length;
  const isDR = (g) => badCorners(g) === 0 && eOut(g) === 0 && C.eoOk(g, 1) && C.eoOk(g, 2);
  const caseName = (g) => `${badCorners(g)}c${2 * eOut(g)}e`;

  // stickers to dot: the U/D sticker of each twisted corner, and both stickers of each edge in the wrong layer
  // (an E-slice edge outside the E slice, or a U/D edge inside it)
  function badMarks(g) {
    const out = new Set();
    for (const i of cornerUD) if (!onUD(g[i])) out.add(g[i]);
    for (const i of edgeAll) if (inE(i) !== inE(g[i])) out.add(g[i]);
    return out;
  }

  // pruning tables: corner twist pattern and E-slice positions, each solved breadth-first over representatives
  const cfac = [...new Set(S.map((s, i) => (isCorner(i) ? s.pos.join() : null)).filter(Boolean))]
    .map((k) => S.map((s, i) => i).filter((i) => S[i].pos.join() === k));
  const coCoord = (g) => { const inv = C.inverse(g); let x = 0; for (const fs of cfac) { let k = 0; fs.forEach((f, j) => { if (ud(inv[f])) k = j; }); x = x * 3 + k; } return x; };
  const slCoord = (g) => { let m = 0; for (const i of ePieces) m |= 1 << C.edgeSlot[g[i]]; return m; };
  const table = (coord) => {
    const d = new Map([[coord(C.solved()), 0]]);
    let fr = [C.solved()];
    for (let k = 1; fr.length; k++) {
      const nx = [];
      for (const g of fr) for (const m of MOVES) { const h = C.apply(g, m), x = coord(h); if (!d.has(x)) { d.set(x, k); nx.push(h); } }
      fr = nx;
    }
    return d;
  };
  const CO = table(coCoord), SL = table(slCoord);
  const h = (g) => Math.max(CO.get(coCoord(g)), SL.get(slCoord(g)));

  // all optimal DRs (canonical move order) up to maxd moves; [] if none
  function solve(g, maxd = 7, cap = 500) {
    for (let d = h(g); d <= maxd; d++) {
      const out = [], seq = [];
      const dfs = (x, left) => {
        if (out.length >= cap) return;
        if (left === 0) { if (isDR(x)) out.push(seq.slice()); return; }
        if (h(x) > left) return;
        for (const m of MOVES) {
          if (seq.length && !allowed(seq[seq.length - 1], m)) continue;
          seq.push(m); dfs(C.apply(x, m), left - 1); seq.pop();
        }
      };
      dfs(g, d);
      if (out.length) return out;
    }
    return [];
  }
  const face = (m) => Math.floor(m / 3), axis = (m) => Math.floor(m / 6);
  const allowed = (p, n) => face(p) !== face(n) && !(axis(p) === axis(n) && face(n) < face(p));

  // every case (corner twist pattern x E-slice positions) up to 5 moves from DR, with a state for each, by distance
  const LEVELS = [[C.solved()]];
  {
    const seen = new Set([coCoord(C.solved()) * 4096 + slCoord(C.solved())]);
    for (let d = 1; d <= 5; d++) {
      const nx = [];
      for (const g of LEVELS[d - 1]) for (const m of MOVES) {
        const x = C.apply(g, m), k = coCoord(x) * 4096 + slCoord(x);
        if (!seen.has(k)) { seen.add(k); nx.push(x); }
      }
      LEVELS.push(nx);
    }
  }

  // a random case at one of the distances ds: a case picked evenly from that level, done after a random DR state
  // (that keeps the case); setup adds a random U or D turn on top
  function randomCase(ds, setup = false, rnd = Math.random) {
    for (;;) {
      const d = ds[Math.floor(rnd() * ds.length)];
      let hdr = C.solved();
      for (let k = 0; k < 25; k++) hdr = C.apply(hdr, DRMOVES[Math.floor(rnd() * DRMOVES.length)]);
      const lv = LEVELS[d];
      let g = C.compose(hdr, lv[Math.floor(rnd() * lv.length)]);
      if (setup) g = C.apply(g, Math.floor(rnd() * 6)); // U, U2, U', D, D2, D'
      if (isDR(g)) continue;
      const sols = solve(g, d + 1);
      return { g, d: sols[0].length, sols, name: caseName(g) };
    }
  }
  const levelSizes = LEVELS.map((l) => l.length);

  return { levelSizes, isDR, caseName, badMarks, solve, randomCase, badCorners, eOut };
};

if (typeof module !== "undefined") module.exports = DR;
