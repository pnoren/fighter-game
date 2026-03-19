// -- Game constants --

export const STAGE_WIDTH = 800;
export const STAGE_HEIGHT = 600;
export const STAGE_FLOOR = 480;
export const FIGHTER_WIDTH = 60;
export const FIGHTER_HEIGHT = 120;
export const GRAVITY = 0.8;
export const CROUCH_HEIGHT = 80;
export const MAX_HEALTH = 100;
export const MAX_COMBO_SCALING = 5;
export const DAMAGE_SCALE_PER_HIT = 0.15;
export const HITSTUN_SCALE_PER_HIT = 0.12;
export const BUFFER_WINDOW = 8;

// -- Geometry --

export type Rect = { x: number; y: number; w: number; h: number };

// -- Move data --

export type MoveData = {
  startup: number;
  active: number;
  recovery: number;
  damage: number;
  hitstun: number;
  hitstop: number;
  knockback: number;
  hitbox: { offsetX: number; offsetY: number; w: number; h: number };
};

// -- Character definition --

export type CharacterDef = {
  moves: Record<string, MoveData>;
  walkSpeed: number;
  jumpVelocity: number;
  airControl: number;
  airMaxSpeed: number;
  animations?: Record<string, { frames: number; frameDuration: number; loop: boolean }>;
};

export const CHARACTERS: Record<string, CharacterDef> = {
  fighter: {
    walkSpeed: 4,
    jumpVelocity: -14,
    airControl: 0.3,
    airMaxSpeed: 3,
    moves: {
      light:  { startup: 4, active: 3, recovery: 8,  damage: 5,  hitstun: 12, hitstop: 4, knockback: 3,  hitbox: { offsetX: 25, offsetY: 30, w: 50, h: 20 } },
      heavy:  { startup: 8, active: 4, recovery: 16, damage: 12, hitstun: 20, hitstop: 7, knockback: 7, hitbox: { offsetX: 20, offsetY: 15, w: 60, h: 30 } },
    },
  },
};

// -- Core types --

export type BufferedInput = { move: string; frame: number };

export type StateId = "idle" | "walking" | "jumping" | "crouching" | "attacking" | "hitstun";

export type FighterState = {
  position: { x: number; y: number };
  velocity: { x: number; y: number };
  facing: 1 | -1;
  state: StateId;
  stateFrame: number;
  grounded: boolean;
  jumpHeld: boolean;
  activeMove: string | null;
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
  hitstop: number;
};

export type Input = {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  light: boolean;
  heavy: boolean;
};
