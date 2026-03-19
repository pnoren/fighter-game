import {
  GameState,
  FighterState,
  STAGE_WIDTH,
  STAGE_HEIGHT,
  STAGE_FLOOR,
  FIGHTER_WIDTH,
  FIGHTER_HEIGHT,
  MAX_HEALTH,
} from "./types.js";
import { initInput, readInput } from "./input.js";
import { simulate } from "./simulate.js";
import { render } from "./render.js";

// -- Initial state --

function createFighter(x: number, facing: 1 | -1, id: string): FighterState {
  return {
    position: { x, y: STAGE_FLOOR - FIGHTER_HEIGHT },
    velocity: { x: 0, y: 0 },
    facing,
    state: "idle",
    stateFrame: 0,
    grounded: true,
    jumpHeld: false,
    activeMove: null,
    hitConfirmed: false,
    health: MAX_HEALTH,
    hitstunDuration: 0,
    comboCount: 0,
    inputBuffer: [],
    characterId: id,
  };
}

const INITIAL_STATE: GameState = {
  frame: 0,
  fighters: [
    createFighter(STAGE_WIDTH * 0.3, 1, "fighter"),
    createFighter(STAGE_WIDTH * 0.7, -1, "fighter"),
  ],
  hitstop: 0,
};

// -- Bootstrap --

const canvas = document.createElement("canvas");
canvas.width = STAGE_WIDTH;
canvas.height = STAGE_HEIGHT;
document.body.style.margin = "0";
document.body.style.display = "flex";
document.body.style.justifyContent = "center";
document.body.style.alignItems = "center";
document.body.style.height = "100vh";
document.body.style.background = "#000";
document.body.appendChild(canvas);

const ctx = canvas.getContext("2d")!;
initInput();

// -- Fixed-timestep game loop --

const FRAME_TIME = 1000 / 60;
let state = INITIAL_STATE;
let lastTime = 0;
let accumulator = 0;

function loop(now: number): void {
  const delta = lastTime === 0 ? FRAME_TIME : now - lastTime;
  lastTime = now;
  accumulator += delta;

  while (accumulator >= FRAME_TIME) {
    const inputs: [ReturnType<typeof readInput>, ReturnType<typeof readInput>] = [
      readInput(0),
      readInput(1),
    ];
    state = simulate(state, inputs);
    accumulator -= FRAME_TIME;
  }

  render(ctx, state);
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
