// evaluated in the page: lays out every module family in rows (z = row * -2)
(() => {
  setMode('build');
  world.clear();
  const vi = (id, rot = 0) => VARIANTS.find((v) => v.module.id === id && v.rot === rot).index;
  const rows = [
    [['grass'], ['court'], ['water'], ['maze'], ['greatTree'], ['crystals'], ['shrine']],
    [['wall'], ['wallGate'], ['wallGatehouse'], ['wallCorner'], ['wallT'], ['wallCross'], ['wallEnd']],
    [['towerBase', 'towerMid', 'towerRoof'], ['towerBase', 'towerCrown'], ['sqTowerBase', 'sqTowerMid', 'sqTowerRoof'], ['sqTowerBase', 'sqTowerRoof'], ['towerBase', 'towerMid', 'towerCrown']],
    [['hall', 'hallRoof'], ['hallEnd', 'hallRoofEnd'], ['hallCorner', 'hallRoofCorner'], ['hallT', 'hallRoofT'], ['hallCross', 'hallRoofCross'], ['hallCorner', 'hallCornerUpper', 'hallRoofCorner']],
    [['canalBridge'], ['coveredBridge'], ['arcade'], ['arcadeCorner'], ['arcadeT'], ['arcadeEnd']],
  ];
  const only = window.__only;
  rows.forEach((row, r) => (only === undefined || only === r) && row.forEach((stack, i) => stack.forEach((id, y) => {
    const x = i * 2 - 6, z = -r * 2 + 4;
    world.set(x, y, z, vi(id));
    if (id.endsWith('Bridge')) { world.set(x, 0, z - 1, vi('water')); world.set(x, 0, z + 1, vi('water')); }
  })));
  build.showSockets = false;
  document.getElementById('ui').style.display = 'none';
  window.__row = (r, x0 = -6, x1 = 6) => {
    const z = (-r * 2 + 4) * 4;
    const cx = ((x0 + x1) / 2) * 4;
    const w = (x1 - x0) * 4 + 8;
    stage.controls.target.set(cx, 2.5, z);
    stage.camera.position.set(cx + w * 0.2, w * 0.42, z + w * 0.7);
  };
})();
