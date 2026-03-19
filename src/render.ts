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
} from "./types.js";
import { deriveHurtbox, deriveHitbox } from "./simulate.js";
import { deriveAnimation, deriveSquashStretch } from "./animation.js";

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

function drawFighter(ctx: CanvasRenderingContext2D, fighter: FighterState, color: string, hitstop: number): void {
  const isCrouching = fighter.state === "crouching";
  const baseH = isCrouching ? CROUCH_HEIGHT : FIGHTER_HEIGHT;
  const yOffset = isCrouching ? FIGHTER_HEIGHT - CROUCH_HEIGHT : 0;

  // Squash/stretch from animation blend
  const anim = deriveAnimation(fighter);
  const ss = deriveSquashStretch(anim, fighter.stateFrame);
  const w = FIGHTER_WIDTH * ss.scaleX;
  const h = baseH * ss.scaleY;

  // Anchor at feet center: x centered, y pinned to bottom
  // leanX shifts in facing direction (anticipation/follow-through)
  const baseBottom = fighter.position.y + yOffset + baseH;
  const x = fighter.position.x - w / 2 + ss.leanX * fighter.facing;
  const y = baseBottom - h;

  // Body — state-based color tinting
  const isHitFlash = hitstop > 0 && fighter.state === "hitstun" && fighter.stateFrame === 0;
  let bodyColor = color;
  if (isHitFlash) {
    bodyColor = "#fff";
  } else if (anim.phase === "active") {
    bodyColor = lightenColor(color, 0.35);
  } else if (fighter.state === "hitstun") {
    bodyColor = darkenColor(color, 0.3);
  } else if (anim.phase === "recovery") {
    bodyColor = darkenColor(color, 0.15);
  }
  ctx.fillStyle = bodyColor;
  ctx.fillRect(x, y, w, h);

  // Facing indicator (small triangle on the front side)
  ctx.fillStyle = "#fff";
  const cx = fighter.facing === 1 ? x + w : x;
  const dir = fighter.facing;
  ctx.beginPath();
  ctx.moveTo(cx, y + 15);
  ctx.lineTo(cx + dir * 10, y + 22);
  ctx.lineTo(cx, y + 29);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "11px monospace";
  ctx.textAlign = "center";
  let label = `${anim.name} [${anim.frame}/${anim.totalFrames}]`;
  if (anim.phase) {
    label = `${anim.name} ${anim.phase}`;
  }
  ctx.fillText(label, fighter.position.x, y - 6);

  // Debug: hurtbox (green outline)
  const hurtbox = deriveHurtbox(fighter);
  ctx.strokeStyle = "rgba(0, 255, 0, 0.5)";
  ctx.lineWidth = 1;
  ctx.strokeRect(hurtbox.x, hurtbox.y, hurtbox.w, hurtbox.h);

  // Debug: hitbox (red filled)
  const hitbox = deriveHitbox(fighter);
  if (hitbox) {
    ctx.fillStyle = "rgba(255, 0, 0, 0.4)";
    ctx.fillRect(hitbox.x, hitbox.y, hitbox.w, hitbox.h);
    ctx.strokeStyle = "rgba(255, 0, 0, 0.8)";
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
  drawFighter(ctx, state.fighters[0], COLORS[0], state.hitstop);
  drawFighter(ctx, state.fighters[1], COLORS[1], state.hitstop);

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
