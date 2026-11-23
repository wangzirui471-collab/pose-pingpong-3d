/* 体感乒乓 · 常量与配置
 * 纯数据模块，浏览器 <script> 与 node require 通用（挂到全局 PP 命名空间）。
 * 单位一律 SI：米 / 秒 / 千克 / 弧度每秒。
 */
;(function (G) {
  'use strict';
  var NS = (G.PP = G.PP || {});

  // ITTF 标准球台：2.74 x 1.525 m，台面高 0.76 m，网高 0.1525 m
  var TABLE = {
    LENGTH: 2.74,
    WIDTH: 1.525,
    HEIGHT: 0.76,
    NET_HEIGHT: 0.1525,   // 相对台面
    NET_HALF_THICK: 0.010,
    HALF_L: 1.37,
    HALF_W: 0.7625
  };
  TABLE.NET_TOP = TABLE.HEIGHT + TABLE.NET_HEIGHT;   // 0.9125 m 绝对高度

  // 40+ 乒乓球：直径 40 mm，质量 2.7 g
  // 空气动力学系数取自 MIT 许可的 2005Andy/pingpong-simulation
  // (doc/physics_model.md)：F_drag=-1/2 rho v^2 S Cd vhat, Cd=0.40；
  // F_magnus = rho R^3 C_Omega (omega x v), C_Omega=0.20。
  // 详见 third_party/pingpong-simulation-MIT/ 内 LICENSE 与原文。
  var BALL = {
    RADIUS: 0.020,
    MASS: 0.0027,
    AREA: Math.PI * 0.020 * 0.020,
    DRAG_CD: 0.40,
    AIR_RHO: 1.225,          // kg/m3
    MAGNUS_C_OMEGA: 0.20,
    // ITTF：从 30 cm 落下须弹起约 23 cm -> e = sqrt(23/30) = 0.8756。
    // MIT 项目用的是 0.90，这里取更严格的 ITTF 实测值，可在现场标定后切换。
    RESTITUTION: 0.876,
    FRICTION: 0.25,          // 台面切向摩擦（MIT 0.25）
    SPIN_DECAY: 0.998        // 每步旋转衰减（空气）
  };

  // COCO-17 下标（人物自身左右；从镜头看需要 mirror 时才翻转）
  var COCO = {
    NOSE: 0, L_EYE: 1, R_EYE: 2, L_EAR: 3, R_EAR: 4,
    L_SHOULDER: 5, R_SHOULDER: 6, L_ELBOW: 7, R_ELBOW: 8,
    L_WRIST: 9, R_WRIST: 10, L_HIP: 11, R_HIP: 12,
    L_KNEE: 13, R_KNEE: 14, L_ANKLE: 15, R_ANKLE: 16
  };

  // MediaPipe 33 -> COCO 17
  var MAP33_TO17 = [0, 2, 5, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

  // MediaPipe HandLandmarker 21 点
  var HAND = {
    WRIST: 0,
    THUMB: [1, 2, 3, 4],
    INDEX: [5, 6, 7, 8],
    MIDDLE: [9, 10, 11, 12],
    RING: [13, 14, 15, 16],
    PINKY: [17, 18, 19, 20],
    MCP: [5, 9, 13, 17],     // 掌指关节：掌心中心用这四个，腕点 0 会随转腕漂移
    TIPS: [8, 12, 16, 20]
  };

  // 四档难度。serveSpeed 单调递增 = 越难对手发球越快（用户指定的主特征）。
  // serveSpeed 定义：出球的**水平速度分量**（m/s）。垂直分量由 ai.solveServe()
  // 按真实动力学反解，保证慢球也能先落己方半台、再弹起越过 15.25cm 的网。
  var DIFFICULTY = {
    novice: {
      key: 'novice', label: '新手',
      serveSpeed: 5.0,
      returnSpeed: 5.5,
      reaction: 0.45,          // s，看到球后才开始移动
      aimError: 0.35,         // m，落点散布
      spin: 0.0,              // 主动旋转强度 0..1
      moveSpeed: 1.2,
      playerAimAssist: 0.30   // 新手给玩家的击球容错（拍面有效半径放大）
    },
    normal: {
      key: 'normal', label: '普通',
      serveSpeed: 6.5, returnSpeed: 7.5, reaction: 0.30,
      aimError: 0.22, spin: 0.15, moveSpeed: 1.8, playerAimAssist: 0.18
    },
    hard: {
      key: 'hard', label: '困难',
      serveSpeed: 8.0, returnSpeed: 10.0, reaction: 0.20,
      aimError: 0.12, spin: 0.45, moveSpeed: 2.6, playerAimAssist: 0.08
    },
    devil: {
      key: 'devil', label: '魔鬼',
      serveSpeed: 9.5, returnSpeed: 14.5, reaction: 0.10,
      aimError: 0.05, spin: 0.85, moveSpeed: 3.6, playerAimAssist: 0.0
    }
  };
  var DIFFICULTY_ORDER = ['novice', 'normal', 'hard', 'devil'];

  NS.constants = {
    TABLE: TABLE,
    BALL: BALL,
    COCO: COCO,
    MAP33_TO17: MAP33_TO17,
    HAND: HAND,
    DIFFICULTY: DIFFICULTY,
    DIFFICULTY_ORDER: DIFFICULTY_ORDER,
    G: 9.81,
    FIXED_DT: 1 / 240,          // 物理固定步长
    MAX_SUBSTEP_DIST: 0.008,     // 子步最大位移，防高速穿台
    PADDLE_RADIUS: 0.085,        // 球拍有效击球半径
    PADDLE_RESTITUTION: 0.88,   // 反胶恢复系数（MIT 0.88）
    PADDLE_FRICTION: 0.45,      // 反胶摩擦系数（MIT 0.45）
    MAX_BALL_SPEED: 26.0,        // 扣杀上限，防止数值爆炸
    GAME_TO: 11,
    WIN_BY: 2,
    SERVE_TOSS_MIN: 0.16,       // 合规抛球高度 16 cm
    HIT_COOLDOWN: 0.08,
    // 世界坐标：x 右 / y 上 / z 朝玩家。玩家在 +z，对手在 -z。
    PLAYER_Z: TABLE.HALF_L,
    AI_Z: -TABLE.HALF_L,
    // 玩家侧球拍活动中心（第一视角视线前方）
    PADDLE_HOME: [0, TABLE.HEIGHT + 0.22, TABLE.HALF_L + 0.28]
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = NS.constants;
})(typeof globalThis !== 'undefined' ? globalThis : this);
