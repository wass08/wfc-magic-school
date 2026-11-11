// evaluated in the page: compose wide buildings from footprints, then frame them
(() => {
  setMode('build');
  world.clear();
  document.getElementById('ui').style.display = 'none';
  build.showSockets = false;
  const DX = [[1, 0], [0, -1], [-1, 0], [0, 1]];
  const footprints = [
    { ox: -9, oz: -4, rows: ['#####', '#####', '#####', '#####', '#####', '#####', '#####', '#####'] },
    { ox: -2, oz: -4, rows: ['######', '#....#', '#....#', '#....#', '######'] },
    { ox: -2, oz: 3, rows: ['#######', '#######', '##.....', '##.....'] },
  ];
  const errors = [];
  for (const f of footprints) {
    const inside = (x, z) => f.rows[z]?.[x] === '#';
    const cells = [];
    f.rows.forEach((row, z) => [...row].forEach((ch, x) => {
      if (ch !== '#') { world.set(f.ox + x, 0, f.oz + z, VARIANTS.find((v) => v.module.id === 'grass').index); return; }
      // desired facade mask, then pick the block tile whose sides match it
      const fac = DX.map(([dx, dz]) => !inside(x + dx, z + dz));
      let best = null;
      for (const v of VARIANTS) {
        if (v.module.category !== 'block' || v.module.level !== 'ground') continue;
        if (!v.sides.every((s, d) => (s === 'hf') === fac[d])) continue;
        // ge/gi must agree with what the neighbour would show; prefer inner corners where a diagonal is outside
        const diagOut = [0, 1, 2, 3].some((d) => { const e = (d + 1) % 4; return !fac[d] && !fac[e] && !inside(x + DX[d][0] + DX[e][0], z + DX[d][1] + DX[e][1]); });
        const isInner = v.module.id === 'blkInner';
        if (fac.every((q) => !q) && diagOut !== isInner) continue;
        if (isInner) {
          const ok = v.sides.every((s, d) => {
            if (s !== 'ge') return true;
            const e = (d + 1) % 4, w = (d + 3) % 4;
            return !inside(x + DX[d][0] + DX[e][0], z + DX[d][1] + DX[e][1]) || !inside(x + DX[d][0] + DX[w][0], z + DX[d][1] + DX[w][1]);
          });
          if (!ok) continue;
        }
        best = v; break;
      }
      if (!best) { errors.push(`no tile at ${x},${z}`); return; }
      cells.push([f.ox + x, f.oz + z, best]);
    }));
    for (const [x, z, v] of cells) {
      world.set(x, 0, z, v.index);
      const roof = VARIANTS.find((r) => r.module.id === v.module.id.replace('blk', 'blkRoof') && r.rot === v.rot);
      world.set(x, 1, z, roof.index);
    }
  }
  // socket check between neighbours
  for (const c of world.cells.values()) {
    const v = VARIANTS[c.v];
    DX.forEach(([dx, dz], d) => {
      const n = world.get(c.x + dx, c.y, c.z + dz);
      if (!n) return;
      const a = v.sides[d], b = VARIANTS[n.v].sides[(d + 2) % 4];
      const join = ['ge', 'gi', 're', 'ri'];
      if ((join.includes(a) || join.includes(b)) && a !== b) errors.push(`${c.x},${c.y},${c.z} side ${d}: ${a} vs ${b}`);
    });
  }
  window.__errors = errors;
  stage.controls.target.set(-8, 2, 2);
  stage.camera.position.set(30, 44, 54);
})();
