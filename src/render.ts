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
  MOVES,
} from "./types.js";
import { deriveHurtbox, deriveHitbox } from "./simulate.js";

const COLORS = ["#3498db", "#e74c3c"];

function drawFighter(ctx: CanvasRenderingContext2D, fighter: FighterState, color: string): void {
  const isCrouching = fighter.state === "crouching";
  const h = isCrouching ? CROUCH_HEIGHT : FIGHTER_HEIGHT;
  const yOffset = isCrouching ? FIGHTER_HEIGHT - CROUCH_HEIGHT : 0;

  const x = fighter.position.x - FIGHTER_WIDTH / 2;
  const y = fighter.position.y + yOffset;

  // Body
  ctx.fillStyle = color;
  ctx.fillRect(x, y, FIGHTER_WIDTH, h);

  // Facing indicator (small triangle on the front side)
  ctx.fillStyle = "#fff";
  const cx = fighter.facing === 1 ? x + FIGHTER_WIDTH : x;
  const dir = fighter.facing;
  ctx.beginPath();
  ctx.moveTo(cx, y + 15);
  ctx.lineTo(cx + dir * 10, y + 22);
  ctx.lineTo(cx, y + 29);
  ctx.closePath();
  ctx.fill();

  // State label
  ctx.fillStyle = "#fff";
  ctx.font = "11px monospace";
  ctx.textAlign = "center";
  let label: string = fighter.state;
  if (fighter.state === "attacking" && fighter.activeMove) {
    const move = MOVES[fighter.activeMove];
    const frame = fighter.stateFrame;
    let phase = "startup";
    if (frame >= move.startup) phase = "active";
    if (frame >= move.startup + move.active) phase = "recovery";
    label = `${fighter.activeMove} ${phase}`;
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
      // P2 bar fills from right
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
  // Clear
  ctx.fillStyle = "#1a1a2e";
  ctx.fillRect(0, 0, STAGE_WIDTH, STAGE_HEIGHT);

  // Floor
  ctx.fillStyle = "#2d2d44";
  ctx.fillRect(0, STAGE_FLOOR, STAGE_WIDTH, STAGE_HEIGHT - STAGE_FLOOR);

  // Fighters
  drawFighter(ctx, state.fighters[0], COLORS[0]);
  drawFighter(ctx, state.fighters[1], COLORS[1]);

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
}
