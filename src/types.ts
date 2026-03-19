// -- Game constants --

export const STAGE_WIDTH = 800;
export const STAGE_HEIGHT = 600;
export const STAGE_FLOOR = 480;
export const FIGHTER_WIDTH = 60;
export const FIGHTER_HEIGHT = 120;
export const GRAVITY = 0.8;
export const WALK_SPEED = 4;
export const JUMP_VELOCITY = -14;
export const AIR_CONTROL = 0.3;
export const AIR_MAX_SPEED = 3;
export const CROUCH_HEIGHT = 80;

// -- Geometry --

export type Rect = { x: number; y: number; w: number; h: number };

// -- Move data --

export type MoveId = "light" | "heavy";

export type MoveData = {
  startup: number;
  active: number;
  recovery: number;
  damage: number;
  hitstun: number;
  hitbox: { offsetX: number; offsetY: number; w: number; h: number };
};

export const MOVES: Record<MoveId, MoveData> = {
  light:  { startup: 4, active: 3, recovery: 8,  damage: 5,  hitstun: 12, hitbox: { offsetX: 25, offsetY: 30, w: 50, h: 20 } },
  heavy:  { startup: 8, active: 4, recovery: 16, damage: 12, hitstun: 20, hitbox: { offsetX: 20, offsetY: 15, w: 60, h: 30 } },
};

export const MAX_HEALTH = 100;
export const MAX_COMBO_SCALING = 5;
export const DAMAGE_SCALE_PER_HIT = 0.15;
export const HITSTUN_SCALE_PER_HIT = 0.12;
export const BUFFER_WINDOW = 8;

export type BufferedInput = { move: MoveId; frame: number };

// -- Core types --

export type StateId = "idle" | "walking" | "jumping" | "crouching" | "attacking" | "hitstun";

export type FighterState = {
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  facing: 1 | -1;
  state: StateId;
  stateFrame: number;
  grounded: boolean;
  jumpHeld: boolean;
  activeMove: MoveId | null;
  hitConfirmed: boolean;
  health: number;
  hitstunDuration: number;
  comboCount: number;
  inputBuffer: BufferedInput[];
  characterId: string;
};

export type GameState = {
  frame: number;
  fighters: [FighterState, FighterState];
};

export type Input = {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  light: boolean;
  heavy: boolean;
};
