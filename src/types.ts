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

// -- Move data --

export type MoveId = "light" | "heavy";

export type MoveData = {
  startup: number;
  active: number;
  recovery: number;
};

export const MOVES: Record<MoveId, MoveData> = {
  light: { startup: 4, active: 3, recovery: 8 },
  heavy: { startup: 8, active: 4, recovery: 16 },
};

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
