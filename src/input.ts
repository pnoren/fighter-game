import { Input } from "./types.js";

// Player 1: WASD, Player 2: Arrow keys
const KEY_MAPS: Record<string, boolean>[][] = [
  [{ KeyA: true }, { KeyD: true }, { KeyW: true }, { KeyS: true }] as any,
  [{ ArrowLeft: true }, { ArrowRight: true }, { ArrowUp: true }, { ArrowDown: true }] as any,
];

const P1_KEYS = { left: "KeyA", right: "KeyD", up: "KeyW", down: "KeyS", light: "KeyJ", heavy: "KeyK" };
const P2_KEYS = { left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown", light: "Period", heavy: "Slash" };
const PLAYER_KEYS = [P1_KEYS, P2_KEYS];

const held = new Set<string>();

export function initInput(): void {
  window.addEventListener("keydown", (e) => held.add(e.code));
  window.addEventListener("keyup", (e) => held.delete(e.code));
}

export function readInput(player: 0 | 1): Input {
  const keys = PLAYER_KEYS[player];
  return {
    left: held.has(keys.left),
    right: held.has(keys.right),
    up: held.has(keys.up),
    down: held.has(keys.down),
    light: held.has(keys.light),
    heavy: held.has(keys.heavy),
  };
}
