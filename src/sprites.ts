import { AnimationFrame, AttackPhase } from "./animation.js";

// Procedural sprite drawing — each pose is a function that draws
// body parts relative to feet center (0,0), y-negative-up.
// The caller handles facing flip, squash/stretch, and color.

export type SpriteColors = {
  body: string;
  head: string;
  limb: string;
  fist: string;
};

// -- Main entry point --

export function drawSprite(
  ctx: CanvasRenderingContext2D,
  anim: AnimationFrame,
  colors: SpriteColors,
): void {
  const draw = POSE_MAP[anim.name] ?? POSE_MAP[anim.phase ?? ""] ?? poseIdle;
  draw(ctx, anim, colors);
}

// -- Body part primitives --

function head(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function limb(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string, angle = 0): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.fillRect(-w / 2, 0, w, h);
  ctx.restore();
}

function fist(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

// -- Pose functions --
// Coordinates: (0,0) = feet center, y negative = up
// "forward" = positive x (caller flips for facing)

type PoseFn = (ctx: CanvasRenderingContext2D, anim: AnimationFrame, c: SpriteColors) => void;

function poseIdle(ctx: CanvasRenderingContext2D, anim: AnimationFrame, c: SpriteColors): void {
  const breathOffset = [0, -2, 0, 2][anim.frame % 4];

  // Back arm
  limb(ctx, -6, -88 + breathOffset, 8, 35, c.limb, -0.15);
  // Legs
  limb(ctx, -8, -40, 10, 40, c.limb, -0.05);
  limb(ctx, 8, -40, 10, 40, c.limb, 0.05);
  // Torso
  ctx.fillStyle = c.body;
  ctx.fillRect(-15, -90 + breathOffset, 30, 50);
  // Front arm
  limb(ctx, 10, -86 + breathOffset, 8, 32, c.limb, 0.15);
  // Fists
  fist(ctx, 14, -54 + breathOffset, 5, c.fist);
  fist(ctx, -8, -54 + breathOffset, 5, c.fist);
  // Head
  head(ctx, 0, -102 + breathOffset, 14, c.head);
}

function poseWalk(ctx: CanvasRenderingContext2D, anim: AnimationFrame, c: SpriteColors): void {
  const t = (anim.frame % 6) / 6 * Math.PI * 2;
  const legSwing = Math.sin(t) * 0.4;
  const armSwing = Math.sin(t + Math.PI) * 0.35;
  const bob = Math.abs(Math.sin(t)) * 3;

  // Back arm
  limb(ctx, -4, -88 + bob, 8, 33, c.limb, armSwing);
  // Legs
  limb(ctx, -6, -40, 10, 40, c.limb, legSwing);
  limb(ctx, 6, -40, 10, 40, c.limb, -legSwing);
  // Torso
  ctx.fillStyle = c.body;
  ctx.fillRect(-15, -90 + bob, 30, 50);
  // Front arm
  limb(ctx, 8, -86 + bob, 8, 33, c.limb, -armSwing);
  // Fists
  fist(ctx, 8 + Math.sin(-armSwing) * 33, -86 + bob + Math.cos(-armSwing) * 33, 5, c.fist);
  fist(ctx, -4 + Math.sin(armSwing) * 33, -88 + bob + Math.cos(armSwing) * 33, 5, c.fist);
  // Head
  head(ctx, 2, -102 + bob, 14, c.head);
}

function poseJump(ctx: CanvasRenderingContext2D, anim: AnimationFrame, c: SpriteColors): void {
  const frame = Math.min(anim.frame, 2);
  // Frame 0: launch, 1: airborne, 2: falling
  const legTuck = [0.3, 0.7, 0.4][frame];
  const armRaise = [-0.3, -0.8, -0.5][frame];
  const bodyOffset = [0, -5, -2][frame];

  // Back arm
  limb(ctx, -8, -88 + bodyOffset, 8, 30, c.limb, armRaise + 0.3);
  // Legs — tucked
  limb(ctx, -6, -40, 10, 36, c.limb, legTuck);
  limb(ctx, 6, -40, 10, 36, c.limb, -legTuck * 0.5);
  // Torso
  ctx.fillStyle = c.body;
  ctx.fillRect(-15, -90 + bodyOffset, 30, 50);
  // Front arm
  limb(ctx, 10, -88 + bodyOffset, 8, 30, c.limb, armRaise);
  // Fists
  fist(ctx, 10 + Math.sin(armRaise) * 30, -88 + bodyOffset + Math.cos(armRaise) * 30, 5, c.fist);
  // Head
  head(ctx, 0, -102 + bodyOffset, 14, c.head);
}

function poseCrouch(ctx: CanvasRenderingContext2D, _anim: AnimationFrame, c: SpriteColors): void {
  // Compact crouching pose
  // Back arm
  limb(ctx, -10, -58, 8, 28, c.limb, -0.3);
  // Legs — bent
  limb(ctx, -8, -28, 10, 30, c.limb, 0.4);
  limb(ctx, 8, -28, 10, 30, c.limb, -0.2);
  // Torso — shortened and lower
  ctx.fillStyle = c.body;
  ctx.fillRect(-16, -62, 32, 35);
  // Front arm — guard position
  limb(ctx, 12, -58, 8, 25, c.limb, 0.3);
  // Fists
  fist(ctx, 18, -38, 5, c.fist);
  fist(ctx, -14, -34, 5, c.fist);
  // Head — lower
  head(ctx, 0, -72, 13, c.head);
}

function poseLightStartup(ctx: CanvasRenderingContext2D, _anim: AnimationFrame, c: SpriteColors): void {
  // Pull arm back
  // Back arm (non-attacking)
  limb(ctx, -8, -86, 8, 30, c.limb, -0.2);
  // Legs
  limb(ctx, -8, -40, 10, 40, c.limb, -0.05);
  limb(ctx, 8, -40, 10, 40, c.limb, 0.1);
  // Torso
  ctx.fillStyle = c.body;
  ctx.fillRect(-15, -90, 30, 50);
  // Attacking arm — pulled back
  limb(ctx, 6, -84, 8, 28, c.limb, -0.6);
  fist(ctx, 6 + Math.sin(-0.6) * 28, -84 + Math.cos(-0.6) * 28, 6, c.fist);
  // Head
  head(ctx, -2, -102, 14, c.head);
}

function poseLightActive(ctx: CanvasRenderingContext2D, _anim: AnimationFrame, c: SpriteColors): void {
  // Jab extended
  // Back arm
  limb(ctx, -8, -86, 8, 30, c.limb, -0.1);
  // Legs
  limb(ctx, -8, -40, 10, 40, c.limb, -0.1);
  limb(ctx, 8, -40, 10, 40, c.limb, 0.15);
  // Torso — slight lean forward
  ctx.fillStyle = c.body;
  ctx.fillRect(-13, -90, 30, 50);
  // Attacking arm — extended forward
  limb(ctx, 12, -82, 8, 35, c.limb, 1.4);
  fist(ctx, 12 + Math.sin(1.4) * 38, -82 + Math.cos(1.4) * 38, 7, c.fist);
  // Head
  head(ctx, 3, -102, 14, c.head);
}

function poseLightRecovery(ctx: CanvasRenderingContext2D, _anim: AnimationFrame, c: SpriteColors): void {
  // Arm returning
  // Back arm
  limb(ctx, -6, -86, 8, 30, c.limb, -0.1);
  // Legs
  limb(ctx, -8, -40, 10, 40, c.limb, -0.05);
  limb(ctx, 8, -40, 10, 40, c.limb, 0.05);
  // Torso
  ctx.fillStyle = c.body;
  ctx.fillRect(-15, -90, 30, 50);
  // Attacking arm — half retracted
  limb(ctx, 10, -84, 8, 30, c.limb, 0.6);
  fist(ctx, 10 + Math.sin(0.6) * 32, -84 + Math.cos(0.6) * 32, 5, c.fist);
  // Head
  head(ctx, 1, -102, 14, c.head);
}

function poseHeavyStartup(ctx: CanvasRenderingContext2D, _anim: AnimationFrame, c: SpriteColors): void {
  // Big wind up — arm raised high
  // Back arm
  limb(ctx, -10, -86, 8, 30, c.limb, -0.3);
  // Legs — wide stance
  limb(ctx, -10, -40, 10, 40, c.limb, -0.15);
  limb(ctx, 10, -40, 10, 40, c.limb, 0.15);
  // Torso — leaning back
  ctx.fillStyle = c.body;
  ctx.fillRect(-16, -92, 32, 52);
  // Attacking arm — raised high behind
  limb(ctx, 4, -90, 10, 34, c.limb, -1.2);
  fist(ctx, 4 + Math.sin(-1.2) * 36, -90 + Math.cos(-1.2) * 36, 7, c.fist);
  // Head
  head(ctx, -3, -105, 14, c.head);
}

function poseHeavyActive(ctx: CanvasRenderingContext2D, _anim: AnimationFrame, c: SpriteColors): void {
  // Big swing — arm sweeping down and forward
  // Back arm
  limb(ctx, -8, -86, 8, 28, c.limb, 0.1);
  // Legs — lunging
  limb(ctx, -10, -40, 10, 40, c.limb, -0.2);
  limb(ctx, 12, -40, 10, 40, c.limb, 0.3);
  // Torso — rotated forward
  ctx.fillStyle = c.body;
  ctx.fillRect(-12, -90, 32, 50);
  // Attacking arm — extended forward-down
  limb(ctx, 14, -82, 10, 38, c.limb, 1.0);
  fist(ctx, 14 + Math.sin(1.0) * 42, -82 + Math.cos(1.0) * 42, 8, c.fist);
  // Head
  head(ctx, 5, -102, 14, c.head);
}

function poseHeavyRecovery(ctx: CanvasRenderingContext2D, _anim: AnimationFrame, c: SpriteColors): void {
  // Settling from heavy swing
  // Back arm
  limb(ctx, -6, -86, 8, 30, c.limb, 0.0);
  // Legs
  limb(ctx, -8, -40, 10, 40, c.limb, -0.05);
  limb(ctx, 10, -40, 10, 40, c.limb, 0.1);
  // Torso
  ctx.fillStyle = c.body;
  ctx.fillRect(-14, -90, 30, 50);
  // Arm — low and returning
  limb(ctx, 10, -80, 9, 32, c.limb, 0.5);
  fist(ctx, 10 + Math.sin(0.5) * 34, -80 + Math.cos(0.5) * 34, 6, c.fist);
  // Head
  head(ctx, 2, -102, 14, c.head);
}

function poseHitstun(ctx: CanvasRenderingContext2D, anim: AnimationFrame, c: SpriteColors): void {
  const recoil = anim.frame === 0 ? -6 : -3;
  const tilt = anim.frame === 0 ? -0.15 : -0.08;

  // Arms — limp
  limb(ctx, -10 + recoil, -84, 8, 32, c.limb, 0.4);
  limb(ctx, 6 + recoil, -82, 8, 30, c.limb, 0.3);
  // Legs — staggering
  limb(ctx, -6, -40, 10, 40, c.limb, -0.1);
  limb(ctx, 8, -40, 10, 40, c.limb, 0.2);
  // Torso — recoiling
  ctx.save();
  ctx.translate(recoil, 0);
  ctx.rotate(tilt);
  ctx.fillStyle = c.body;
  ctx.fillRect(-15, -90, 30, 50);
  ctx.restore();
  // Fists — drooping
  fist(ctx, -10 + recoil + Math.sin(0.4) * 32, -84 + Math.cos(0.4) * 32, 5, c.fist);
  fist(ctx, 6 + recoil + Math.sin(0.3) * 30, -82 + Math.cos(0.3) * 30, 5, c.fist);
  // Head — snapping back
  head(ctx, recoil - 2, -100, 14, c.head);
}

// -- Attack pose dispatch (phase-aware) --

function poseAttack(moveId: string): PoseFn {
  return (ctx, anim, c) => {
    const phase = anim.phase ?? "startup";
    const key = `${moveId}_${phase}`;
    const fn = ATTACK_POSES[key];
    if (fn) {
      fn(ctx, anim, c);
    } else {
      poseIdle(ctx, anim, c);
    }
  };
}

const ATTACK_POSES: Record<string, PoseFn> = {
  light_startup: poseLightStartup,
  light_active: poseLightActive,
  light_recovery: poseLightRecovery,
  heavy_startup: poseHeavyStartup,
  heavy_active: poseHeavyActive,
  heavy_recovery: poseHeavyRecovery,
};

// -- Pose lookup --

const POSE_MAP: Record<string, PoseFn> = {
  idle: poseIdle,
  walk: poseWalk,
  jump: poseJump,
  crouch: poseCrouch,
  hitstun: poseHitstun,
  light: poseAttack("light"),
  heavy: poseAttack("heavy"),
};
