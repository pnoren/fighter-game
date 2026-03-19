// Sprite sheet loader and renderer
// Frame grid: 128x128 pixels, 10 columns per row

const FRAME_W = 128;
const FRAME_H = 128;
const COLS = 10;

export type SpriteStripDef = {
  path: string;
  totalFrames: number;
};

export type SpriteStrip = {
  img: HTMLImageElement;
  totalFrames: number;
  loaded: boolean;
};

// -- Animation → sprite strip mapping --

const STRIP_DIR = "src/assets/Split animations";

export const SPRITE_DEFS: Record<string, SpriteStripDef> = {
  idle:       { path: `${STRIP_DIR}/Male_spritesheet_idle.png`, totalFrames: 60 },
  walk:       { path: `${STRIP_DIR}/Male_spritesheet_run.png`, totalFrames: 20 },
  jump:       { path: `${STRIP_DIR}/Male_spritesheet_run_jump.png`, totalFrames: 27 },
  crouch:     { path: `${STRIP_DIR}/Male_spritesheet_crouch_idle.png`, totalFrames: 80 },
  lightPunch: { path: `${STRIP_DIR}/Male_spritesheet_punch_1.png`, totalFrames: 25 },
  heavyPunch: { path: `${STRIP_DIR}/Male_spritesheet_punch_straight.png`, totalFrames: 50 },
  lightKick:  { path: `${STRIP_DIR}/Male_spritesheet_kick_low.png`, totalFrames: 50 },
  heavyKick:  { path: `${STRIP_DIR}/Male_spritesheet_kick_high.png`, totalFrames: 42 },
  jumpKick:   { path: `${STRIP_DIR}/Male_spritesheet_kick_spin_high.png`, totalFrames: 60 },
  fireball:   { path: `${STRIP_DIR}/Male_spritesheet_punch_quad.png`, totalFrames: 50 },
  hitstun:    { path: `${STRIP_DIR}/Male_spritesheet_dodge_back.png`, totalFrames: 40 },
  ko:         { path: `${STRIP_DIR}/Male_spritesheet_death_1.png`, totalFrames: 80 },
  throwing:   { path: `${STRIP_DIR}/Male_spritesheet_punch_3.png`, totalFrames: 30 },
  thrown:     { path: `${STRIP_DIR}/Male_spritesheet_falling_idle.png`, totalFrames: 30 },
};

// -- Loaded strips cache --

const strips: Record<string, SpriteStrip> = {};
let allLoaded = false;

export function loadAllSprites(): Promise<void> {
  const promises: Promise<void>[] = [];

  for (const [name, def] of Object.entries(SPRITE_DEFS)) {
    const img = new Image();
    strips[name] = { img, totalFrames: def.totalFrames, loaded: false };

    const p = new Promise<void>((resolve) => {
      img.onload = () => {
        strips[name].loaded = true;
        resolve();
      };
      img.onerror = () => {
        console.warn(`Failed to load sprite: ${def.path}`);
        resolve();
      };
    });
    img.src = def.path;
    promises.push(p);
  }

  return Promise.all(promises).then(() => {
    allLoaded = true;
    console.log("All sprites loaded");
  });
}

export function spritesReady(): boolean {
  return allLoaded;
}

export function getStrip(name: string): SpriteStrip | null {
  const strip = strips[name];
  return strip?.loaded ? strip : null;
}

// -- Frame rendering --

export function drawSpriteFrame(
  ctx: CanvasRenderingContext2D,
  strip: SpriteStrip,
  frameIndex: number,
  dx: number,
  dy: number,
  scale: number,
): void {
  const frame = Math.max(0, Math.min(frameIndex, strip.totalFrames - 1));
  const col = frame % COLS;
  const row = Math.floor(frame / COLS);
  const sx = col * FRAME_W;
  const sy = row * FRAME_H;

  const dw = FRAME_W * scale;
  const dh = FRAME_H * scale;

  ctx.drawImage(strip.img, sx, sy, FRAME_W, FRAME_H, dx, dy, dw, dh);
}

// -- Map game frame to sprite frame --

// For looping animations: cycle through all sprite frames
export function loopFrame(stateFrame: number, totalSpriteFrames: number, speed: number): number {
  return Math.floor(stateFrame / speed) % totalSpriteFrames;
}

// For one-shot animations (attacks, ko): map game duration to sprite frames
export function oneshotFrame(stateFrame: number, gameDuration: number, totalSpriteFrames: number): number {
  const t = Math.min(stateFrame / Math.max(1, gameDuration), 1);
  return Math.min(Math.floor(t * totalSpriteFrames), totalSpriteFrames - 1);
}
