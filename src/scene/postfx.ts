import * as THREE from 'three';
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  GodRaysEffect,
  BloomEffect,
  VignetteEffect,
  ToneMappingEffect,
  ToneMappingMode,
  SMAAEffect,
  SMAAPreset,
  KernelSize,
  BlendFunction,
} from 'postprocessing';
import { LensFlareEffect } from './lensflare';

/* =====================================================================
   后期管线（HDR 半浮点）
   RenderPass → [GodRays + Bloom + LensFlare + Vignette + NeutralToneMapping] → [SMAA]
   - 体积光（丁达尔光束）：以真实太阳位置为光源，被伞体 / 挂坠 / 地形遮挡
   - Bloom 仅作用于高亮区域（太阳、水面反光、云层亮部）
   - Khronos PBR Neutral 色调映射：高动态范围下仍保持伞体色彩饱和不发灰
   ===================================================================== */

export interface PostFX {
  composer: EffectComposer;
  godRays: GodRaysEffect;
  bloom: BloomEffect;
  flare: LensFlareEffect;
  sunMesh: THREE.Mesh;
  setSize(w: number, h: number): void;
  setGodRaysEnabled(v: boolean): void;
  setBloomEnabled(v: boolean): void;
  setFlareEnabled(v: boolean): void;
  dispose(): void;
}

export function createPostFX(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  sunDir: THREE.Vector3,
): PostFX {
  // 体积光光源：位于太阳方向远处的柔和光盘（不加入主场景，由效果内部渲染）
  const sunTex = (() => {
    const s = 256;
    const cv = document.createElement('canvas');
    cv.width = cv.height = s;
    const ctx = cv.getContext('2d')!;
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0.0, 'rgba(255,250,235,1)');
    g.addColorStop(0.25, 'rgba(255,240,200,0.95)');
    g.addColorStop(0.55, 'rgba(255,225,160,0.45)');
    g.addColorStop(1.0, 'rgba(255,210,130,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const sunMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({
      map: sunTex,
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    }),
  );
  sunMesh.frustumCulled = false;
  // 距离 9000m（远山之上），视角约 4.5°
  const SUN_DIST = 9000;
  sunMesh.scale.setScalar(SUN_DIST * 0.05);

  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
    multisampling: 0,
  });
  composer.addPass(new RenderPass(scene, camera));

  const godRays = new GodRaysEffect(camera, sunMesh, {
    blendFunction: BlendFunction.SCREEN,
    samples: 64,
    density: 0.95,
    decay: 0.90,
    weight: 0.30,
    exposure: 0.28,
    clampMax: 1.0,
    resolutionScale: 0.5,
    kernelSize: KernelSize.SMALL,
    blur: true,
  });

  const bloom = new BloomEffect({
    blendFunction: BlendFunction.SCREEN,
    mipmapBlur: true,
    intensity: 0.55,
    luminanceThreshold: 1.05,
    luminanceSmoothing: 0.25,
    radius: 0.72,
    levels: 7,
  });

  const flare = new LensFlareEffect(camera, sunDir);
  flare.intensity = 0.85;

  const vignette = new VignetteEffect({ offset: 0.26, darkness: 0.5 });
  const tone = new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL });
  const smaa = new SMAAEffect({ preset: SMAAPreset.HIGH });

  const mainPass = new EffectPass(camera, godRays, bloom, flare, vignette, tone);
  const aaPass = new EffectPass(camera, smaa);
  composer.addPass(mainPass);
  composer.addPass(aaPass);

  // 每帧更新光源位置（跟随相机，保持在无限远方向）
  const camPos = new THREE.Vector3();
  const origRender = composer.render.bind(composer);
  composer.render = (dt?: number) => {
    camera.getWorldPosition(camPos);
    sunMesh.position.copy(camPos).addScaledVector(sunDir, SUN_DIST);
    sunMesh.lookAt(camPos);
    sunMesh.updateMatrixWorld(true);
    origRender(dt);
  };

  return {
    composer,
    godRays,
    bloom,
    flare,
    sunMesh,
    setSize(w, h) { composer.setSize(w, h); },
    setGodRaysEnabled(v) { godRays.blendMode.blendFunction = v ? BlendFunction.SCREEN : BlendFunction.SKIP; },
    setBloomEnabled(v) { bloom.blendMode.blendFunction = v ? BlendFunction.SCREEN : BlendFunction.SKIP; },
    setFlareEnabled(v) { flare.blendMode.blendFunction = v ? BlendFunction.ADD : BlendFunction.SKIP; },
    dispose() {
      composer.dispose();
      sunTex.dispose();
      sunMesh.geometry.dispose();
      (sunMesh.material as THREE.Material).dispose();
    },
  };
}
