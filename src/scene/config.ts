import * as THREE from 'three';

/* =====================================================================
   全局光照 / 环境配置
   —— 视觉太阳与光照太阳统一为同一方向（原版两者不一致，阴影与太阳位置对不上）
   ===================================================================== */

const DEG = Math.PI / 180;

/** 太阳仰角 / 方位：午后偏晚的暖金色阳光，低角度带来长阴影与明显的体积光 */
export const SUN_ELEVATION = 18 * DEG;
/** 方位角（绕 Y 轴，0 = 正前方 -Z，负值偏左） */
export const SUN_AZIMUTH = -40 * DEG;

export const SUN_DIR = new THREE.Vector3(
  Math.cos(SUN_ELEVATION) * Math.sin(SUN_AZIMUTH),
  Math.sin(SUN_ELEVATION),
  -Math.cos(SUN_ELEVATION) * Math.cos(SUN_AZIMUTH),
).normalize();

/** 太阳光颜色（略暖，接近 4800K） */
export const SUN_COLOR = new THREE.Color('#ffe9c4');
/** 太阳光强度（物理光照单位，与中性色调映射配合） */
export const SUN_INTENSITY = 3.4;

/** 天光（半球光）颜色 */
export const SKY_LIGHT_COLOR = new THREE.Color('#9dc4f0');
export const GROUND_LIGHT_COLOR = new THREE.Color('#6f6a48');

/** 雾 / 大气透视基色（线性空间通过 hex 自动转换） */
export const FOG_COLOR = new THREE.Color('#b7cfe8');
/** 地表（y = FOG_BASE_Y 处）的消光系数 /m，向上按指数衰减 */
export const FOG_DENSITY = 1.6e-4;
export const FOG_BASE_Y = -300;
export const FOG_HEIGHT_SCALE = 1100;

/** 跳伞参数 —— 与原版保持一致，不做改动 */
export const START_Y = 2800;
export const STOP_Y = 260;
export const MAX_SPEED = 75;
export const ACCEL_TIME = 3.0;
export const FIXED_STEP = 1 / 120;
export const TARGET_LIFT = 2;

/** 相机初始偏移：略微抬头，使太阳落在画面左上方，伞体处于逆光/侧逆光的电影感位置 */
export const CAM_OFFSET = new THREE.Vector3(11, -0.5, 27);
