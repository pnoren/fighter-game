import { FighterState, CHARACTERS } from "./types.js";

// -- Animation types --

export type AnimationDef = {
  frames: number;        // number of sprite frames in the animation
  frameDuration: number; // game frames per sprite frame
  loop: boolean;
};

export type AttackPhase = "startup" | "active" | "recovery";

export type AnimationFrame = {
  name: string;          // animation name (e.g., "idle", "walk", "light")
  frame: number;         // current sprite frame (0-indexed)
  totalFrames: number;   // total sprite frames in this animation
  loop: boolean;
  phase: AttackPhase | null;
  blend: number;         // 0 = just transitioned, 1 = fully settled
};

// -- Squash/stretch for visual transitions --

export type SquashStretch = {
  scaleX: number;  // width multiplier (>1 = wider)
  scaleY: number;  // height multiplier (>1 = taller)
};

// Per-state blend-in frames (0 = instant snap)
const BLEND_FRAMES: Record<string, number> = {
  idle: 4,
  walk: 3,
  jump: 2,
  crouch: 3,
  hitstun: 0,
  // attacks: 0 (default — gameplay-critical, must snap)
};

// Squash/stretch at blend=0 (start of transition into this state)
// Values interpolate toward {1, 1} as blend reaches 1
const TRANSITION_SQUASH: Record<string, SquashStretch> = {
  idle:    { scaleX: 1.1,  scaleY: 0.85 }, // landing squash / recovery settle
  walk:    { scaleX: 1.0,  scaleY: 0.95 },
  jump:    { scaleX: 0.85, scaleY: 1.15 }, // launch stretch
  crouch:  { scaleX: 1.15, scaleY: 0.8  }, // duck squash
  hitstun: { scaleX: 1.15, scaleY: 0.85 }, // hit impact squash
};

// -- Pure derivation: game state → animation frame --

export function deriveAnimation(f: FighterState): AnimationFrame {
  const charAnims = CHARACTERS[f.characterId]?.animations;

  if (f.state === "attacking" && f.activeMove) {
    return deriveAttackAnimation(f, charAnims);
  }

  const animName = STATE_TO_ANIM[f.state] ?? f.state;
  const def = charAnims?.[animName] ?? DEFAULT_ANIMATIONS[animName];
  if (!def) {
    return { name: animName, frame: 0, totalFrames: 1, loop: false, phase: null, blend: 1 };
  }

  const gameFrame = f.stateFrame;
  const spriteFrame = Math.floor(gameFrame / def.frameDuration);
  const frame = def.loop
    ? spriteFrame % def.frames
    : Math.min(spriteFrame, def.frames - 1);

  const blendDuration = BLEND_FRAMES[animName] ?? 0;
  const blend = blendDuration === 0 ? 1 : Math.min(1, gameFrame / blendDuration);

  return {
    name: animName,
    frame,
    totalFrames: def.frames,
    loop: def.loop,
    phase: null,
    blend,
  };
}

// -- Derive squash/stretch from animation blend --

export function deriveSquashStretch(anim: AnimationFrame): SquashStretch {
  if (anim.blend >= 1) return { scaleX: 1, scaleY: 1 };

  const target = TRANSITION_SQUASH[anim.name];
  if (!target) return { scaleX: 1, scaleY: 1 };

  // Ease-out: fast at start, settles smoothly
  const t = anim.blend;
  const ease = t * (2 - t); // quadratic ease-out

  return {
    scaleX: target.scaleX + (1 - target.scaleX) * ease,
    scaleY: target.scaleY + (1 - target.scaleY) * ease,
  };
}

// -- Attack animation with phase tracking --

function deriveAttackAnimation(
  f: FighterState,
  charAnims?: Record<string, AnimationDef>,
): AnimationFrame {
  const moveId = f.activeMove!;
  const moveDef = CHARACTERS[f.characterId]?.moves[moveId];
  if (!moveDef) {
    return { name: moveId, frame: 0, totalFrames: 1, loop: false, phase: null, blend: 1 };
  }

  const { startup, active, recovery } = moveDef;
  const total = startup + active + recovery;
  const gameFrame = f.stateFrame;

  let phase: AttackPhase;
  if (gameFrame < startup) {
    phase = "startup";
  } else if (gameFrame < startup + active) {
    phase = "active";
  } else {
    phase = "recovery";
  }

  const def = charAnims?.[moveId];
  let frame: number;
  let totalFrames: number;

  if (def) {
    const spriteFrame = Math.floor(gameFrame / def.frameDuration);
    frame = Math.min(spriteFrame, def.frames - 1);
    totalFrames = def.frames;
  } else {
    frame = Math.min(gameFrame, total - 1);
    totalFrames = total;
  }

  // Attacks snap instantly (blend=1) — timing is gameplay-critical
  return { name: moveId, frame, totalFrames, loop: false, phase, blend: 1 };
}

// -- State-to-animation name mapping --

const STATE_TO_ANIM: Record<string, string> = {
  idle: "idle",
  walking: "walk",
  jumping: "jump",
  crouching: "crouch",
  hitstun: "hitstun",
};

// -- Default animation definitions (used when character doesn't override) --

export const DEFAULT_ANIMATIONS: Record<string, AnimationDef> = {
  idle:    { frames: 4, frameDuration: 10, loop: true },
  walk:    { frames: 6, frameDuration: 8,  loop: true },
  jump:    { frames: 3, frameDuration: 6,  loop: false },
  crouch:  { frames: 1, frameDuration: 1,  loop: false },
  hitstun: { frames: 2, frameDuration: 6,  loop: false },
};
