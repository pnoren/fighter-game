import {
  GameState,
  FighterState,
  STAGE_WIDTH,
  STAGE_HEIGHT,
  STAGE_FLOOR,
  FIGHTER_WIDTH,
  FIGHTER_HEIGHT,
  CROUCH_HEIGHT,
  MAX_HEALTH,
  CHARACTERS,
} from "./types.js";
import { deriveHurtbox, deriveHitbox } from "./simulate.js";
import { deriveAnimation, deriveSquashStretch } from "./animation.js";
import { drawSprite, SpriteColors } from "./sprites.js";
import { spritesReady, getStrip, drawSpriteFrame, loopFrame, oneshotFrame } from "./spritesheet.js";

const COLORS = ["#3498db", "#e74c3c"];

function parseHex(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function lightenColor(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex);
  const l = (v: number) => Math.min(255, Math.round(v + (255 - v) * amount));
  return `rgb(${l(r)},${l(g)},${l(b)})`;
}

function darkenColor(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex);
  const d = (v: number) => Math.round(v * (1 - amount));
  return `rgb(${d(r)},${d(g)},${d(b)})`;
}

function deriveColors(color: string, fighter: FighterState, anim: ReturnType<typeof deriveAnimation>, hitstop: number): SpriteColors {
  const isHitFlash = hitstop > 0 && fighter.state === "hitstun" && fighter.stateFrame === 0;

  let body = color;
  if (isHitFlash) {
    body = "#fff";
  } else if (anim.phase === "active") {
    body = lightenColor(color, 0.35);
  } else if (fighter.state === "hitstun") {
    body = darkenColor(color, 0.3);
  } else if (anim.phase === "recovery") {
    body = darkenColor(color, 0.15);
  }

  return {
    body,
    head: isHitFlash ? "#fff" : lightenColor(color, 0.2),
    limb: isHitFlash ? "#fff" : darkenColor(color, 0.2),
    fist: isHitFlash ? "#fff" : lightenColor(color, 0.4),
  };
}

// -- Sprite frame calculation --

const LOOPING_ANIMS = new Set(["idle", "walk", "crouch"]);
const SPRITE_SCALE = 0.9;  // 128px sprites scaled to ~115px (close to FIGHTER_HEIGHT)

function getSpriteFrame(anim: ReturnType<typeof deriveAnimation>, fighter: FighterState): number {
  const strip = getStrip(anim.name);
  if (!strip) return 0;

  if (LOOPING_ANIMS.has(anim.name)) {
    // Looping: cycle through sprite frames
    const speed = anim.name === "idle" ? 3 : 2;
    return loopFrame(fighter.stateFrame, strip.totalFrames, speed);
  }

  // One-shot: map game duration to sprite frame count
  if (anim.phase) {
    // Attack: map across full move duration
    const moveDef = CHARACTERS[fighter.characterId]?.moves[fighter.activeMove ?? ""];
    if (moveDef) {
      const total = moveDef.startup + moveDef.active + moveDef.recovery;
      return oneshotFrame(fighter.stateFrame, total, strip.totalFrames);
    }
  }

  // Other one-shots (ko, hitstun, throwing, thrown)
  return oneshotFrame(fighter.stateFrame, anim.totalFrames, strip.totalFrames);
}

// -- Fighter drawing --

function drawFighter(ctx: CanvasRenderingContext2D, fighter: FighterState, color: string, hitstop: number, playerIdx: number): void {
  const anim = deriveAnimation(fighter);
  const ss = deriveSquashStretch(anim, fighter.stateFrame);
  const colors = deriveColors(color, fighter, anim, hitstop);

  const feetX = fighter.position.x + ss.leanX * fighter.facing;
  const feetY = fighter.position.y + FIGHTER_HEIGHT;

  const strip = spritesReady() ? getStrip(anim.name) : null;

  if (strip) {
    // -- Sprite sheet rendering --
    const spriteFrame = getSpriteFrame(anim, fighter);
    const baseSize = 128 * SPRITE_SCALE;

    ctx.save();
    ctx.translate(feetX, feetY);

    // Flip: sprites face right by default
    if (fighter.facing === -1) {
      ctx.scale(-1, 1);
    }

    // Apply squash/stretch
    ctx.scale(ss.scaleX, ss.scaleY);

    const isHitFlash = hitstop > 0 && fighter.state === "hitstun" && fighter.stateFrame === 0;

    // Draw sprite anchored at feet-center
    drawSpriteFrame(ctx, strip, spriteFrame, -baseSize / 2, -baseSize, SPRITE_SCALE);

    // P2 color tint (red overlay)
    if (playerIdx === 1) {
      ctx.globalCompositeOperation = "source-atop";
      ctx.fillStyle = "rgba(200, 50, 50, 0.25)";
      ctx.fillRect(-baseSize / 2, -baseSize, baseSize, baseSize);
      ctx.globalCompositeOperation = "source-over";
    }

    // Hit flash overlay
    if (isHitFlash) {
      ctx.globalCompositeOperation = "source-atop";
      ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
      ctx.fillRect(-baseSize / 2, -baseSize, baseSize, baseSize);
      ctx.globalCompositeOperation = "source-over";
    }

    // Active attack: bright overlay
    if (anim.phase === "active" && !isHitFlash) {
      ctx.globalCompositeOperation = "source-atop";
      ctx.fillStyle = "rgba(255, 255, 200, 0.2)";
      ctx.fillRect(-baseSize / 2, -baseSize, baseSize, baseSize);
      ctx.globalCompositeOperation = "source-over";
    }

    ctx.restore();
  } else {
    // -- Procedural fallback --
    ctx.save();
    ctx.translate(feetX, feetY);
    ctx.scale(fighter.facing, 1);
    ctx.scale(ss.scaleX, ss.scaleY);
    drawSprite(ctx, anim, colors);
    ctx.restore();
  }

  // Debug: hurtbox (green outline)
  const hurtbox = deriveHurtbox(fighter);
  ctx.strokeStyle = "rgba(0, 255, 0, 0.3)";
  ctx.lineWidth = 1;
  ctx.strokeRect(hurtbox.x, hurtbox.y, hurtbox.w, hurtbox.h);

  // Debug: hitbox (red filled)
  const hitbox = deriveHitbox(fighter);
  if (hitbox) {
    ctx.fillStyle = "rgba(255, 0, 0, 0.3)";
    ctx.fillRect(hitbox.x, hitbox.y, hitbox.w, hitbox.h);
    ctx.strokeStyle = "rgba(255, 0, 0, 0.7)";
    ctx.strokeRect(hitbox.x, hitbox.y, hitbox.w, hitbox.h);
  }
}

function drawHealthBars(ctx: CanvasRenderingContext2D, fighters: [FighterState, FighterState]): void {
  const barW = 300;
  const barH = 20;
  const y = 30;
  const gap = 10;

  for (let i = 0; i < 2; i++) {
    const x = i === 0 ? gap : STAGE_WIDTH - barW - gap;
    const pct = fighters[i].health / MAX_HEALTH;

    // Background
    ctx.fillStyle = "#333";
    ctx.fillRect(x, y, barW, barH);

    // Health fill
    if (i === 0) {
      ctx.fillStyle = pct > 0.3 ? "#2ecc71" : "#e74c3c";
      ctx.fillRect(x, y, barW * pct, barH);
    } else {
      ctx.fillStyle = pct > 0.3 ? "#2ecc71" : "#e74c3c";
      ctx.fillRect(x + barW * (1 - pct), y, barW * pct, barH);
    }

    // Border
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, barW, barH);

    // Label
    ctx.fillStyle = "#fff";
    ctx.font = "12px monospace";
    ctx.textAlign = i === 0 ? "left" : "right";
    ctx.fillText(`P${i + 1}`, i === 0 ? x : x + barW, y - 5);
  }
}

export function render(ctx: CanvasRenderingContext2D, state: GameState): void {
  // Screen shake during hitstop
  const shakeIntensity = state.hitstop > 0 ? state.hitstop * 0.8 : 0;
  const shakeX = shakeIntensity > 0 ? Math.sin(state.frame * 17) * shakeIntensity : 0;
  const shakeY = shakeIntensity > 0 ? Math.cos(state.frame * 13) * shakeIntensity * 0.5 : 0;

  ctx.save();
  ctx.translate(shakeX, shakeY);

  // Clear
  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(-10, -10, STAGE_WIDTH + 20, STAGE_HEIGHT + 20);

  // Floor
  ctx.fillStyle = "#2d2d44";
  ctx.fillRect(0, STAGE_FLOOR, STAGE_WIDTH, STAGE_HEIGHT - STAGE_FLOOR);

  // Fighters
  drawFighter(ctx, state.fighters[0], COLORS[0], state.hitstop, 0);
  drawFighter(ctx, state.fighters[1], COLORS[1], state.hitstop, 1);

  // Projectiles
  for (const p of state.projectiles) {
    const color = COLORS[p.owner];
    const glow = lightenColor(color, 0.5);
    const px = p.position.x - p.width / 2;
    const py = p.position.y - p.height / 2;
    // Glow
    ctx.fillStyle = glow;
    ctx.globalAlpha = 0.4;
    ctx.fillRect(px - 3, py - 3, p.width + 6, p.height + 6);
    ctx.globalAlpha = 1;
    // Core
    ctx.fillStyle = color;
    ctx.fillRect(px, py, p.width, p.height);
    // Bright center
    ctx.fillStyle = "#fff";
    ctx.fillRect(px + 4, py + 4, p.width - 8, p.height - 8);
  }

  // Health bars
  drawHealthBars(ctx, state.fighters);

  // Combo counters
  for (let i = 0; i < 2; i++) {
    const f = state.fighters[i];
    if (f.comboCount >= 2) {
      ctx.fillStyle = "#f1c40f";
      ctx.font = "bold 24px monospace";
      ctx.textAlign = "center";
      ctx.fillText(`${f.comboCount} HIT`, f.position.x, f.position.y - 20);
    }
  }

  // Frame counter
  ctx.fillStyle = "#666";
  ctx.font = "12px monospace";
  ctx.textAlign = "left";
  ctx.fillText(`frame: ${state.frame}`, 8, 18);

  ctx.restore();
}
