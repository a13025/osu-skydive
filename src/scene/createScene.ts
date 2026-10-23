import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { smoothstep } from './utils';
import { createRamAirParachute } from './parachute';
import { createBlueRibbon } from './ribbon';
import { createOsuLogo } from './osuLogo';
import { installAtmosphericFog } from './fog';
import { createSky } from './sky';
import { buildTerrain } from './terrain';
import { createClouds } from './clouds';
import { createPostFX } from './postfx';
import {
  SUN_DIR, SUN_COLOR, SUN_INTENSITY, SKY_LIGHT_COLOR, GROUND_LIGHT_COLOR,
  FOG_COLOR, FOG_DENSITY, FOG_BASE_Y, FOG_HEIGHT_SCALE,
  START_Y, STOP_Y, MAX_SPEED, ACCEL_TIME, FIXED_STEP, TARGET_LIFT, CAM_OFFSET,
} from './config';

export interface SceneStatus {
  altitude: number;
  speedKmh: number;
  falling: boolean;
  landed: boolean;
  cloud: number;
  fps: number;
}

export interface SceneOptions {
  godRays: boolean;
  bloom: boolean;
  flare: boolean;
  clouds: boolean;
  shadows: boolean;
}

export interface SceneHandle {
  reset(): void;
  /** 调试：直接跳到指定高度 */
  jumpTo(y: number): void;
  setOptions(o: Partial<SceneOptions>): void;
  dispose(): void;
}

export function createScene(
  container: HTMLElement,
  onStatus: (s: SceneStatus) => void,
): SceneHandle {
  /* ---------- 全局大气雾（必须在任何材质编译前安装） ---------- */
  installAtmosphericFog(SUN_DIR);

  /* ---------- 渲染器 ---------- */
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.toneMapping = THREE.NoToneMapping; // 色调映射交由后期（Neutral）
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // r186：PCF 内置 Vogel 盘软采样
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const fog = new THREE.FogExp2(FOG_COLOR.clone(), FOG_DENSITY);
  scene.fog = fog;

  const camera = new THREE.PerspectiveCamera(48, container.clientWidth / container.clientHeight, 0.3, 40000);
  camera.position.set(0, START_Y, 0).add(CAM_OFFSET);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, START_Y + TARGET_LIFT, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.065;
  controls.minDistance = 6;
  controls.maxDistance = 300;
  controls.maxPolarAngle = Math.PI * 0.96;

  /* ---------- 天空 + 环境贴图 ---------- */
  const sky = createSky(SUN_DIR, 20000);
  scene.add(sky.dome);
  sky.setAltitude(START_Y);
  sky.updateEnvironment(renderer, scene);
  scene.environmentIntensity = 0.85;
  let lastEnvAlt = START_Y;

  /* ---------- 光照 ---------- */
  // 主光：太阳（方向与天空中的太阳严格一致）
  const sunLight = new THREE.DirectionalLight(SUN_COLOR, SUN_INTENSITY);
  sunLight.position.copy(SUN_DIR).multiplyScalar(60);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(4096, 4096);
  sunLight.shadow.bias = -0.00015;
  sunLight.shadow.normalBias = 0.012;
  sunLight.shadow.radius = 6;
  {
    const sc = sunLight.shadow.camera;
    sc.left = -17; sc.right = 17; sc.top = 17; sc.bottom = -17;
    sc.near = 1; sc.far = 220;
  }
  scene.add(sunLight, sunLight.target);

  // 天光：顶部蓝天 / 底部大地反射
  const hemi = new THREE.HemisphereLight(SKY_LIGHT_COLOR, GROUND_LIGHT_COLOR, 0.55);
  scene.add(hemi);

  // 相机侧补光：逆光构图下保证挂坠正面可读（弱、偏冷，模拟天空漫射）
  const fill = new THREE.DirectionalLight(new THREE.Color('#d6e6ff'), 0.42);
  scene.add(fill, fill.target);

  // 地面反弹光：自下而上，照亮伞衣内侧与挂坠底部
  const bounce = new THREE.DirectionalLight(new THREE.Color('#b9b48a'), 0.28);
  scene.add(bounce, bounce.target);

  /* ---------- 地形 / 河流 / 云 ---------- */
  const terrain = buildTerrain(SUN_DIR);
  scene.add(terrain.group);

  const clouds = createClouds(SUN_DIR);
  scene.add(clouds.mesh);

  /* ---------- 伞 / 领带 / osu! 挂坠（与原版完全一致） ---------- */
  const parachute = createRamAirParachute();
  const ribbon = createBlueRibbon();

  const pendulum = new THREE.Group();
  pendulum.position.set(0, 3.84, 0);
  ribbon.group.position.set(0, -3.84, 0);
  pendulum.add(ribbon.group);

  const logoPivot = new THREE.Group();
  logoPivot.position.set(0, ribbon.bottomY, 0.02);
  const osuLogo = createOsuLogo();
  osuLogo.group.position.set(0, -osuLogo.radius * 0.985, 0);
  logoPivot.add(osuLogo.group);
  ribbon.group.add(logoPivot);

  parachute.group.add(pendulum);
  parachute.group.position.set(0, START_Y, 0);
  scene.add(parachute.group);

  /* ---------- 后期 ---------- */
  const post = createPostFX(renderer, scene, camera, SUN_DIR);
  post.setSize(container.clientWidth, container.clientHeight);

  /* ---------- 坠落状态（与原版一致） ---------- */
  let falling = true;
  let velocity = 0;
  let fallTime = 0;
  let physicsAccumulator = 0;
  const prevParachutePos = new THREE.Vector3(0, START_Y, 0);

  function resetAll() {
    falling = true;
    velocity = 0;
    fallTime = 0;
    physicsAccumulator = 0;

    parachute.group.position.set(0, START_Y, 0);
    parachute.group.rotation.set(0, 0, 0);
    pendulum.rotation.set(0, 0, 0);
    logoPivot.rotation.set(0, 0, 0);

    prevParachutePos.set(0, START_Y, 0);

    camera.position.copy(parachute.group.position).add(CAM_OFFSET);
    controls.target.copy(parachute.group.position);
    controls.target.y += TARGET_LIFT;
    controls.update();
  }

  /* ---------- 选项 ---------- */
  const options: SceneOptions = { godRays: true, bloom: true, flare: true, clouds: true, shadows: true };
  const applyOptions = () => {
    post.setGodRaysEnabled(options.godRays);
    post.setBloomEnabled(options.bloom);
    post.setFlareEnabled(options.flare);
    clouds.setVisible(options.clouds);
    sunLight.castShadow = options.shadows;
  };
  applyOptions();

  /* ---------- 渲染循环 ---------- */
  const timer = new THREE.Timer();
  let clockStarted = false;
  let rafId = 0;
  let statusTimer = 0;
  let fpsAcc = 0, fpsN = 0, fps = 60;
  const camPos = new THREE.Vector3();
  const toCam = new THREE.Vector3();
  const cloudFogColor = new THREE.Color(1.02, 1.03, 1.06);
  const baseFogColor = FOG_COLOR.clone();

  function animate() {
    rafId = requestAnimationFrame(animate);

    timer.update();
    if (!clockStarted) {
      clockStarted = true;
      controls.update();
      scene.updateMatrixWorld(true);
      parachute.update(0, ribbon.riserL, ribbon.riserR);
      post.composer.render(0);
      return;
    }

    const dt = Math.min(0.1, timer.getDelta());
    const t = timer.getElapsed();

    physicsAccumulator += dt;
    physicsAccumulator = Math.min(physicsAccumulator, 0.1);
    while (physicsAccumulator >= FIXED_STEP) {
      if (falling) {
        fallTime += FIXED_STEP;
        const f = smoothstep(0, ACCEL_TIME, fallTime);
        velocity = MAX_SPEED * f;
        parachute.group.position.y -= velocity * FIXED_STEP;

        parachute.group.position.x = 22 * Math.sin(fallTime * 0.42);
        parachute.group.position.z = 15 * Math.cos(fallTime * 0.34);

        const k = velocity / MAX_SPEED;
        parachute.group.rotation.x = -0.03 - k * 0.06 + 0.02 * Math.sin(t * 1.05);
        parachute.group.rotation.z = 0.025 * Math.sin(t * 0.75);

        if (parachute.group.position.y <= STOP_Y) {
          parachute.group.position.y = STOP_Y;
          falling = false;
          velocity = 0;
        }
      }
      physicsAccumulator -= FIXED_STEP;
    }

    if (!falling) {
      parachute.group.rotation.z = 0.02 * Math.sin(t * 0.9);
      parachute.group.rotation.x = 0.03 * Math.sin(t * 0.7 + 0.5);
    }

    pendulum.rotation.z = 0.11 * Math.sin(t * 1.15);
    pendulum.rotation.x = 0.055 * Math.sin(t * 0.82 + 1.2);

    logoPivot.rotation.z = 0.05 * Math.sin(t * 1.38 + 0.7);
    logoPivot.rotation.x = 0.035 * Math.sin(t * 1.02 + 1.9);

    const delta = new THREE.Vector3().subVectors(parachute.group.position, prevParachutePos);
    camera.position.add(delta);
    controls.target.add(delta);
    prevParachutePos.copy(parachute.group.position);

    controls.update();
    camera.updateMatrixWorld();
    camera.getWorldPosition(camPos);

    /* ----- 光照跟随 ----- */
    sunLight.position.copy(parachute.group.position).addScaledVector(SUN_DIR, 60);
    sunLight.target.position.copy(parachute.group.position);
    sunLight.target.updateMatrixWorld();

    toCam.subVectors(camPos, parachute.group.position).normalize();
    fill.position.copy(parachute.group.position).addScaledVector(toCam, 60).add(new THREE.Vector3(0, 28, 0));
    fill.target.position.copy(parachute.group.position);
    fill.target.updateMatrixWorld();

    bounce.position.copy(parachute.group.position).add(new THREE.Vector3(8, -60, 10));
    bounce.target.position.copy(parachute.group.position);
    bounce.target.updateMatrixWorld();

    /* ----- 天空 / 环境 ----- */
    sky.dome.position.copy(camPos);
    sky.setAltitude(camPos.y);
    if (Math.abs(camPos.y - lastEnvAlt) > 900) {
      lastEnvAlt = camPos.y;
      sky.updateEnvironment(renderer, scene);
    }

    /* ----- 云 / 穿云泛白 ----- */
    const dens = options.clouds ? clouds.densityAt(camPos) : 0;
    const heightFactor = Math.exp((camPos.y - FOG_BASE_Y) / FOG_HEIGHT_SCALE);
    fog.density = FOG_DENSITY + dens * 0.028 * heightFactor;
    fog.color.copy(baseFogColor).lerp(cloudFogColor, dens);
    sky.setCloudFade(dens * 0.92);
    sunLight.intensity = SUN_INTENSITY * (1 - 0.55 * dens);
    hemi.intensity = 0.55 + 0.6 * dens;
    post.godRays.godRaysMaterial.weight = 0.28 * (1 - 0.85 * dens);
    post.flare.intensity = 0.85 * (1 - dens);
    clouds.update(camera, SUN_DIR);

    terrain.update(dt);

    scene.updateMatrixWorld(true);
    parachute.update(t, ribbon.riserL, ribbon.riserR);

    post.composer.render(dt);

    /* ----- 状态回调（10Hz） ----- */
    fpsAcc += dt; fpsN++;
    statusTimer += dt;
    if (statusTimer >= 0.1) {
      fps = fpsN / Math.max(fpsAcc, 1e-3);
      fpsAcc = 0; fpsN = 0;
      statusTimer = 0;
      const landed = !falling && parachute.group.position.y <= STOP_Y + 1;
      onStatus({
        altitude: parachute.group.position.y,
        speedKmh: velocity * 0.36,
        falling,
        landed,
        cloud: dens,
        fps,
      });
    }
  }
  animate();

  const onResize = () => {
    const w = container.clientWidth, h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    post.setSize(w, h);
  };
  window.addEventListener('resize', onResize);

  return {
    reset: resetAll,
    jumpTo(y) {
      const target = Math.max(STOP_Y, Math.min(START_Y, y));
      const d = target - parachute.group.position.y;
      parachute.group.position.y = target;
      prevParachutePos.y = target;
      camera.position.y += d;
      controls.target.y += d;
      fallTime = Math.max(fallTime, ACCEL_TIME);
      controls.update();
    },
    setOptions(o) {
      Object.assign(options, o);
      applyOptions();
    },
    dispose() {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      post.dispose();
      clouds.dispose();
      sky.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
