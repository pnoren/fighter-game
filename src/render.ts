import {
  GameState,
  FighterState,
  STAGE_WIDTH,
  STAGE_HEIGHT,
  STAGE_FLOOR,
  FIGHTER_WIDTH,
  FIGHTER_HEIGHT,
  CROUCH_HEIGHT,
  MOVES,
} from "./types.js";

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

  // Frame counter
  ctx.fillStyle = "#666";
  ctx.font = "12px monospace";
  ctx.textAlign = "left";
  ctx.fillText(`frame: ${state.frame}`, 8, 18);
}
