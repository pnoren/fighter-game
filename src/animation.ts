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
  phase: AttackPhase | null;  // only set during attacking state
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
    return { name: animName, frame: 0, totalFrames: 1, loop: false, phase: null };
  }

  const gameFrame = f.stateFrame;
  const spriteFrame = Math.floor(gameFrame / def.frameDuration);
  const frame = def.loop
    ? spriteFrame % def.frames
    : Math.min(spriteFrame, def.frames - 1);

  return {
    name: animName,
    frame,
    totalFrames: def.frames,
    loop: def.loop,
    phase: null,
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
    return { name: moveId, frame: 0, totalFrames: 1, loop: false, phase: null };
  }

  const { startup, active, recovery } = moveDef;
  const total = startup + active + recovery;
  const gameFrame = f.stateFrame;

  // Determine phase
  let phase: AttackPhase;
  if (gameFrame < startup) {
    phase = "startup";
  } else if (gameFrame < startup + active) {
    phase = "active";
  } else {
    phase = "recovery";
  }

  // Use character-specific animation def if it exists, otherwise 1:1 mapping
  const def = charAnims?.[moveId];
  let frame: number;
  let totalFrames: number;

  if (def) {
    const spriteFrame = Math.floor(gameFrame / def.frameDuration);
    frame = Math.min(spriteFrame, def.frames - 1);
    totalFrames = def.frames;
  } else {
    // Default: 1 sprite frame per game frame, total = move duration
    frame = Math.min(gameFrame, total - 1);
    totalFrames = total;
  }

  return { name: moveId, frame, totalFrames, loop: false, phase };
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
