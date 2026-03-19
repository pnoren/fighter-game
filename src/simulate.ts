import {
  FighterState,
  GameState,
  Input,
  GRAVITY,
  WALK_SPEED,
  JUMP_VELOCITY,
  AIR_CONTROL,
  AIR_MAX_SPEED,
  STAGE_FLOOR,
  STAGE_WIDTH,
  FIGHTER_WIDTH,
  FIGHTER_HEIGHT,
} from "./types.js";

// -- Pure state transition --

function transitionState(fighter: FighterState, input: Input): FighterState {
  const { state, grounded, jumpHeld } = fighter;

  // Track whether up is held (must release before jumping again)
  const newJumpHeld = input.up;

  // Airborne — just tick stateFrame
  if (!grounded) {
    return { ...fighter, stateFrame: fighter.stateFrame + 1, jumpHeld: newJumpHeld };
  }

  // Jump — only on fresh press (not held from previous frame)
  if (input.up && !jumpHeld && grounded) {
    return {
      ...fighter,
      state: "jump",
      stateFrame: 0,
      velocity: { x: fighter.velocity.x, y: JUMP_VELOCITY },
      grounded: false,
      jumpHeld: true,
    };
  }

  // Crouch
  if (input.down && grounded) {
    if (state !== "crouch") {
      return { ...fighter, state: "crouch", stateFrame: 0, jumpHeld: newJumpHeld };
    }
    return { ...fighter, stateFrame: fighter.stateFrame + 1, jumpHeld: newJumpHeld };
  }

  // Walk
  if (input.left || input.right) {
    if (state !== "walk") {
      return { ...fighter, state: "walk", stateFrame: 0, jumpHeld: newJumpHeld };
    }
    return { ...fighter, stateFrame: fighter.stateFrame + 1, jumpHeld: newJumpHeld };
  }

  // Idle
  if (state !== "idle") {
    return { ...fighter, state: "idle", stateFrame: 0, jumpHeld: newJumpHeld };
  }
  return { ...fighter, stateFrame: fighter.stateFrame + 1, jumpHeld: newJumpHeld };
}

// -- Pure movement --

function applyMovement(fighter: FighterState, input: Input): FighterState {
  // Air control — nudge horizontal velocity, clamped
  if (!fighter.grounded) {
    let vx = fighter.velocity.x;
    if (input.left) vx -= AIR_CONTROL;
    if (input.right) vx += AIR_CONTROL;
    vx = Math.max(-AIR_MAX_SPEED, Math.min(AIR_MAX_SPEED, vx));
    return { ...fighter, velocity: { x: vx, y: fighter.velocity.y } };
  }

  if (fighter.state === "crouch") return { ...fighter, velocity: { x: 0, y: fighter.velocity.y } };

  let vx = 0;
  if (input.left) vx -= WALK_SPEED;
  if (input.right) vx += WALK_SPEED;

  return { ...fighter, velocity: { x: vx, y: fighter.velocity.y } };
}

// -- Pure gravity + landing --

function applyGravity(fighter: FighterState): FighterState {
  if (fighter.grounded && fighter.state !== "jump") return fighter;

  const vy = fighter.velocity.y + GRAVITY;
  const y = fighter.position.y + vy;

  // Land
  if (y >= STAGE_FLOOR - FIGHTER_HEIGHT) {
    return {
      ...fighter,
      position: { ...fighter.position, y: STAGE_FLOOR - FIGHTER_HEIGHT },
      velocity: { x: fighter.velocity.x, y: 0 },
      grounded: true,
      state: "idle",
      stateFrame: 0,
    };
  }

  return {
    ...fighter,
    position: { ...fighter.position, y },
    velocity: { ...fighter.velocity, y: vy },
  };
}

// -- Pure position integration + stage bounds --

function integrate(fighter: FighterState): FighterState {
  let x = fighter.position.x + fighter.velocity.x;

  // Clamp to stage
  const halfW = FIGHTER_WIDTH / 2;
  x = Math.max(halfW, Math.min(STAGE_WIDTH - halfW, x));

  return { ...fighter, position: { ...fighter.position, x } };
}

// -- Pure facing update --

function updateFacing(fighter: FighterState, opponent: FighterState): FighterState {
  const facing = opponent.position.x > fighter.position.x ? 1 : -1;
  return facing !== fighter.facing ? { ...fighter, facing } : fighter;
}

// -- Pure pushbox resolution --

function resolvePush(f0: FighterState, f1: FighterState): [FighterState, FighterState] {
  const halfW = FIGHTER_WIDTH / 2;
  const overlap = (halfW + halfW) - Math.abs(f0.position.x - f1.position.x);
  if (overlap <= 0) return [f0, f1];

  const push = overlap / 2;
  const sign = f0.position.x < f1.position.x ? -1 : 1;

  const clamp = (x: number) => Math.max(halfW, Math.min(STAGE_WIDTH - halfW, x));

  return [
    { ...f0, position: { ...f0.position, x: clamp(f0.position.x + sign * push) } },
    { ...f1, position: { ...f1.position, x: clamp(f1.position.x - sign * push) } },
  ];
}

// -- Top-level simulate: pure (GameState, Inputs) → GameState --

export function simulate(state: GameState, inputs: [Input, Input]): GameState {
  let [f0, f1] = state.fighters;

  // State transitions
  f0 = transitionState(f0, inputs[0]);
  f1 = transitionState(f1, inputs[1]);

  // Movement
  f0 = applyMovement(f0, inputs[0]);
  f1 = applyMovement(f1, inputs[1]);

  // Gravity + landing
  f0 = applyGravity(f0);
  f1 = applyGravity(f1);

  // Position integration
  f0 = integrate(f0);
  f1 = integrate(f1);

  // Pushbox
  [f0, f1] = resolvePush(f0, f1);

  // Facing
  f0 = updateFacing(f0, f1);
  f1 = updateFacing(f1, f0);

  return { frame: state.frame + 1, fighters: [f0, f1] };
}
