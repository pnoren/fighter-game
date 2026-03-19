import { Input } from "./types.js";

// P1: WASD + J/K/U/I    P2: Arrows + Numpad1/2/4/5
const P1_KEYS = {
  left: "KeyA", right: "KeyD", up: "KeyW", down: "KeyS",
  lightPunch: "KeyJ", heavyPunch: "KeyK",
  lightKick: "KeyU", heavyKick: "KeyI",
};
const P2_KEYS = {
  left: "ArrowLeft", right: "ArrowRight", up: "ArrowUp", down: "ArrowDown",
  lightPunch: "Period", heavyPunch: "Slash",
  lightKick: "Semicolon", heavyKick: "Quote",
};
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
    lightPunch: held.has(keys.lightPunch),
    heavyPunch: held.has(keys.heavyPunch),
    lightKick: held.has(keys.lightKick),
    heavyKick: held.has(keys.heavyKick),
  };
}
