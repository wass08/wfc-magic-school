(() => {
  setMode('build');
  world.clear();
  document.getElementById('ui').style.display = 'none';
  build.showSockets = false;
  const vi = (id, rot = 0) => VARIANTS.find((v) => v.module.id === id && v.rot === rot).index;
  const set = (x, y, z, id, rot = 0) => world.set(x, y, z, vi(id, rot));
  // terrace plateau 3x3 at x=-6..-4, z=-1..1 with gardens on top, a raised canal on its east column
  for (let x = -6; x <= -4; x++) for (let z = -1; z <= 1; z++) set(x, 0, z, 'terrace');
  set(-6, 1, -1, 'grass'); set(-5, 1, -1, 'well'); set(-6, 1, 0, 'court'); set(-5, 1, 0, 'statues');
  set(-6, 1, 1, 'pond'); set(-5, 1, 1, 'greatTree');
  for (const z of [-1, 0, 1]) set(-4, 1, z, 'water');
  for (const z of [-1, 0, 1]) set(-3, 0, z, 'water');          // lower canal catching the waterfall
  set(-7, 0, 0, 'stairs', 2);                                   // stairs climbing east onto the terrace (low end west)
  set(-8, 0, 0, 'court');
  // sky bridge between two towers
  set(0, 0, 3, 'towerBase'); set(0, 1, 3, 'towerMid'); set(0, 2, 3, 'towerRoof');
  set(3, 0, 3, 'sqTowerBase'); set(3, 1, 3, 'sqTowerMid'); set(3, 2, 3, 'sqTowerRoof');
  set(1, 1, 3, 'skyBridge'); set(2, 1, 3, 'skyBridge');
  set(1, 0, 3, 'grass'); set(2, 0, 3, 'court');
  // wall gallery between wall pieces
  set(-1, 0, -3, 'wallEnd', 2); set(0, 0, -3, 'wallGallery'); set(1, 0, -3, 'wallGallery'); set(2, 0, -3, 'wallEnd');
  // chapel: nave + chapel end + hall end
  set(5, 0, -1, 'hallChapel', 0); set(6, 0, -1, 'hallNave'); set(7, 0, -1, 'hallNave'); set(8, 0, -1, 'hallEnd', 2);
  set(5, 1, -1, 'hallRoofEnd', 0); set(6, 1, -1, 'hallRoof'); set(7, 1, -1, 'hallRoof'); set(8, 1, -1, 'hallRoofEnd', 2);
  // gardens
  set(5, 0, 2, 'greenhouse'); set(6, 0, 2, 'well'); set(7, 0, 2, 'pond'); set(8, 0, 2, 'statues');
  // balconies: hall with an upper floor (style hashed; force by placing several)
  for (let x = 5; x <= 8; x++) { set(x, 0, 5, x === 5 ? 'hallEnd' : x === 8 ? 'hallEnd' : 'hall', x === 8 ? 2 : 0); set(x, 1, 5, x === 5 ? 'hallEndUpper' : x === 8 ? 'hallEndUpper' : 'hallUpper', x === 8 ? 2 : 0); set(x, 2, 5, x === 5 || x === 8 ? 'hallRoofEnd' : 'hallRoof', x === 8 ? 2 : 0); }
  window.__view = (tx, tz, d = 1, y = 3) => { stage.controls.target.set(tx * 4, y, tz * 4); stage.camera.position.set(tx * 4 + 14 * d, 13 * d + y, tz * 4 + 18 * d); };
})();
