// @ts-nocheck
// 蓝色 V 型领带 —— 原样保留，不做任何修改
import * as THREE from 'three';

function createBlueRibbon() {
  const body = new THREE.Group();
  const S = 1.5 / 23.05, CX = 55.70, CY = 98.55;
  const sx = (x) => (x - CX) * S, sy = (y) => (CY - y) * S;

  const svgToShape = (d) => {
    const shape = new THREE.Shape(), t = d.match(/[MLCZ]|-?\d+(?:\.\d+)?/gi) || [];
    let i = 0, cmd = '';
    while (i < t.length) {
      if (/^[MLCZ]$/i.test(t[i])) { if ((cmd = t[i++].toUpperCase()) === 'Z') shape.closePath(); continue; }
      if (cmd === 'M') { shape.moveTo(sx(+t[i++]), sy(+t[i++])); cmd = 'L'; }
      else if (cmd === 'L') shape.lineTo(sx(+t[i++]), sy(+t[i++]));
      else if (cmd === 'C') shape.bezierCurveTo(sx(+t[i++]), sy(+t[i++]), sx(+t[i++]), sy(+t[i++]), sx(+t[i++]), sy(+t[i++]));
    }
    return shape;
  };

  const opt = { depth: 0.06, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2 };

  const back = new THREE.Mesh(
    new THREE.ExtrudeGeometry(svgToShape("M60.85 39.45 L79.75 39.45 L64.05 68.05 L48.05 68.05 Z"), opt),
    new THREE.MeshPhysicalMaterial({
      color: 0x0f56a8, roughness: 0.46, clearcoat: 0.20, clearcoatRoughness: 0.45,
    })
  );
  back.position.z = -0.03;
  back.castShadow = true; back.receiveShadow = true;

  const front = new THREE.Mesh(
    new THREE.ExtrudeGeometry(svgToShape("M30.45 39.45 L50.15 39.45 L63.05 68.05 L48.05 68.05 Z"), opt),
    new THREE.MeshPhysicalMaterial({
      color: 0x1288ff, roughness: 0.38, clearcoat: 0.32, clearcoatRoughness: 0.28,
    })
  );
  front.position.z = 0.06;
  front.castShadow = true; front.receiveShadow = true;

  body.add(back, front);

  const riserL = new THREE.Object3D(); riserL.position.set(sx(40.30), sy(39.45), 0.08);
  const riserR = new THREE.Object3D(); riserR.position.set(sx(70.30), sy(39.45), -0.02);
  body.add(riserL, riserR);

  return { group: body, riserL, riserR, bottomY: sy(68.05) };
}

export { createBlueRibbon };
