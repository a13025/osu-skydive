// @ts-nocheck
// 7 气室冲压翼伞 —— 原样保留，不做任何修改
import * as THREE from 'three';

function createRamAirParachute() {
  const group = new THREE.Group();
  const COLORS = ['#FFC700', '#FF352B', '#34C759', '#0A84FF', '#34C759', '#FF352B', '#FFC700'].map(c => new THREE.Color(c));
  const CELLS = 7, NU = 12, NV = 18, INSET = 0.225;
  const verts = [], cols = [], idx = [];

  const addV = (u, v, w, inset, c, m = 1) => {
    verts.push({ u, v, w, inset });
    cols.push(c.r * m, c.g * m, c.b * m);
    return verts.length - 1;
  };
  const addQ = (a, b, c, d) => idx.push(a, b, d, b, c, d);
  const lerp = (a, b, t) => a + (b - a) * t;
  const sm = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

  for (let c = 0; c < CELLS; c++) {
    const col = COLORS[c], u0 = c / CELLS, u1 = (c + 1) / CELLS, top = [], bot = [];
    for (let iu = 0; iu <= NU; iu++) {
      const u = lerp(u0, u1, iu / NU), tR = [], bR = [];
      for (let iv = 0; iv <= NV; iv++) {
        tR.push(addV(u, iv / NV, 1, 0, col, 0.98 + 0.02 * sm(0, 0.15, Math.min(iu, NU - iu) / NU)));
        bR.push(addV(u, iv / NV, 0, 0, col, 0.86));
      }
      top.push(tR); bot.push(bR);
    }
    for (let iu = 0; iu < NU; iu++) {
      for (let iv = 0; iv < NV; iv++) {
        addQ(top[iu][iv], top[iu + 1][iv], top[iu + 1][iv + 1], top[iu][iv + 1]);
        addQ(bot[iu + 1][iv], bot[iu][iv], bot[iu][iv + 1], bot[iu + 1][iv + 1]);
      }
      const uA = lerp(u0, u1, iu / NU), uB = lerp(u0, u1, (iu + 1) / NU);
      addQ(addV(uA, 0, 1, 0, col, 0.90), addV(uA, 0, 0, 0, col, 0.82), addV(uB, 0, 0, 0, col, 0.82), addV(uB, 0, 1, 0, col, 0.90));
      addQ(addV(uA, 1, 1, 0, col, 0.82), addV(uB, 1, 1, 0, col, 0.82), addV(uB, 1, 1, INSET, col, 0.55), addV(uA, 1, 1, INSET, col, 0.55));
      addQ(addV(uB, 1, 0, 0, col, 0.78), addV(uA, 1, 0, 0, col, 0.78), addV(uA, 1, 0, INSET, col, 0.50), addV(uB, 1, 0, INSET, col, 0.50));
      addQ(addV(uA, 1, 1, INSET, col, 0.48), addV(uB, 1, 1, INSET, col, 0.48), addV(uB, 1, 0, INSET, col, 0.44), addV(uA, 1, 0, INSET, col, 0.44));
    }
  }

  const wingGeo = new THREE.BufferGeometry();
  const posArr = new Float32Array(verts.length * 3);
  const posAttr = new THREE.BufferAttribute(posArr, 3).setUsage(THREE.DynamicDrawUsage);
  wingGeo.setAttribute('position', posAttr);
  wingGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  wingGeo.setIndex(idx);

  // 织物材质：低 sheen 避免泛白，低 envMapIntensity 避免环境反射冲淡颜色
  const wingMesh = new THREE.Mesh(wingGeo, new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.62,
    metalness: 0.0,
    clearcoat: 0.02,
    clearcoatRoughness: 0.7,
    sheen: 0.22,
    sheenRoughness: 0.7,
    sheenColor: new THREE.Color(0xffd89a),
    side: THREE.DoubleSide,
    envMapIntensity: 0.65,
  }));
  wingMesh.castShadow = true;
  wingMesh.receiveShadow = true;
  group.add(wingMesh);

  const CHORDS = [0.10, 0.50, 0.92], SEGS = 10, COSH = Math.cosh(1.7);
  const lineArr = new Float32Array(24 * SEGS * 2 * 3);
  const lineAttr = new THREE.BufferAttribute(lineArr, 3).setUsage(THREE.DynamicDrawUsage);
  const lineGeo = new THREE.BufferGeometry().setAttribute('position', lineAttr);
  group.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({
    color: 0xf4f7fb, transparent: true, opacity: 0.9,
  })));

  const evalPt = (u, v, w, inset, time, out = new THREE.Vector3()) => {
    const th = (u - 0.5) * 2.55;
    const cell = Math.pow(Math.abs(Math.sin(u * 7 * Math.PI)), 0.7);
    const cam = 0.45 * Math.sin(v * Math.PI);
    const rip = 0.05 * Math.sin(11 * u + 2 * time) * Math.sin(v * Math.PI)
              + 0.025 * Math.sin(7 * v - 2.6 * time + 3 * u);
    const rOut = 6 + cam + 0.16 * cell + rip;
    const rIn = lerp(rOut, 6 + 0.6 * cam + 0.05 * cell - 0.34 + rip, sm(0, 0.18, v));
    const r = lerp(rIn, rOut, w);
    return out.set(
      Math.sin(th) * r,
      4.4 + Math.cos(th) * r,
      (v - 0.5) * 4.1 * (0.88 + 0.12 * Math.sin(u * Math.PI)) - 0.4 * Math.pow(2 * u - 1, 2) - inset
    );
  };

  const _pt = new THREE.Vector3(), _rL = new THREE.Vector3(), _rR = new THREE.Vector3();

  function update(time, riserL, riserR) {
    for (let i = 0; i < verts.length; i++) {
      evalPt(verts[i].u, verts[i].v, verts[i].w, verts[i].inset, time, _pt);
      posArr[i * 3] = _pt.x; posArr[i * 3 + 1] = _pt.y; posArr[i * 3 + 2] = _pt.z;
    }
    posAttr.needsUpdate = true;
    wingGeo.computeVertexNormals();
    wingGeo.computeBoundingSphere();

    _rL.setFromMatrixPosition(riserL.matrixWorld); group.worldToLocal(_rL);
    _rR.setFromMatrixPosition(riserR.matrixWorld); group.worldToLocal(_rR);

    let p = 0;
    for (let g = 0; g < 8; g++) {
      const u = g / 7, target = g < 4 ? _rL : _rR;
      for (let ci = 0; ci < 3; ci++) {
        evalPt(u, CHORDS[ci], 0, 0, time, _pt);
        for (let s = 0; s < SEGS; s++) {
          const s0 = s / SEGS, s1 = (s + 1) / SEGS;
          const sag0 = -0.028 * (COSH - Math.cosh(1.7 * (2 * s0 - 1))) / (COSH - 1);
          const sag1 = -0.028 * (COSH - Math.cosh(1.7 * (2 * s1 - 1))) / (COSH - 1);
          lineArr[p++] = lerp(_pt.x, target.x, s0); lineArr[p++] = lerp(_pt.y, target.y, s0) + sag0; lineArr[p++] = lerp(_pt.z, target.z, s0);
          lineArr[p++] = lerp(_pt.x, target.x, s1); lineArr[p++] = lerp(_pt.y, target.y, s1) + sag1; lineArr[p++] = lerp(_pt.z, target.z, s1);
        }
      }
    }
    lineAttr.needsUpdate = true;
  }

  return { group, update };
}

export { createRamAirParachute };
