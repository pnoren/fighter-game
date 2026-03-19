import {
  FighterState,
  GameState,
  Input,
  StateId,
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

// -- FSM helpers --

function enter(f: FighterState, state: StateId, input: Input, extra?: Partial<FighterState>): FighterState {
  return { ...f, state, stateFrame: 0, jumpHeld: input.up, ...extra };
}

function tick(f: FighterState, input: Input, extra?: Partial<FighterState>): FighterState {
  return { ...f, stateFrame: f.stateFrame + 1, jumpHeld: input.up, ...extra };
}

function wantsJump(f: FighterState, input: Input): boolean {
  return input.up && !f.jumpHeld && f.grounded;
}

// -- FSM state handlers: each returns updated FighterState --

type StateHandler = (f: FighterState, input: Input) => FighterState;

const FSM: Record<StateId, StateHandler> = {

  idle(f, input) {
    if (wantsJump(f, input)) {
      return enter(f, "jumping", input, {
        velocity: { x: f.velocity.x, y: JUMP_VELOCITY },
        grounded: false,
      });
    }
    if (input.down) return enter(f, "crouching", input, { velocity: { x: 0, y: 0 } });
    if (input.left || input.right) return enter(f, "walking", input);
    return tick(f, input);
  },

  walking(f, input) {
    if (wantsJump(f, input)) {
      return enter(f, "jumping", input, {
        velocity: { x: f.velocity.x, y: JUMP_VELOCITY },
        grounded: false,
      });
    }
    if (input.down) return enter(f, "crouching", input, { velocity: { x: 0, y: 0 } });
    if (!input.left && !input.right) return enter(f, "idle", input, { velocity: { x: 0, y: 0 } });

    let vx = 0;
    if (input.left) vx -= WALK_SPEED;
    if (input.right) vx += WALK_SPEED;
    return tick(f, input, { velocity: { x: vx, y: 0 } });
  },

  jumping(f, input) {
    // Landed — gravity set grounded=true before FSM runs
    if (f.grounded) return enter(f, "idle", input, { velocity: { x: 0, y: 0 } });

    // Air control
    let vx = f.velocity.x;
    if (input.left) vx -= AIR_CONTROL;
    if (input.right) vx += AIR_CONTROL;
    vx = Math.max(-AIR_MAX_SPEED, Math.min(AIR_MAX_SPEED, vx));
    return tick(f, input, { velocity: { x: vx, y: f.velocity.y } });
  },

  crouching(f, input) {
    if (wantsJump(f, input)) {
      return enter(f, "jumping", input, {
        velocity: { x: 0, y: JUMP_VELOCITY },
        grounded: false,
      });
    }
    if (!input.down) return enter(f, "idle", input);
    return tick(f, input, { velocity: { x: 0, y: 0 } });
  },

  // Placeholders — no behavior yet, just hold the state
  attacking(f, input) {
    return tick(f, input);
  },

  hitstun(f, input) {
    return tick(f, input);
  },
};

// -- Pure FSM dispatch --

function fsmUpdate(fighter: FighterState, input: Input): FighterState {
  return FSM[fighter.state](fighter, input);
}

// -- Pure gravity + landing (physics only, no state changes) --

function applyGravity(fighter: FighterState): FighterState {
  if (fighter.grounded) return fighter;

  const vy = fighter.velocity.y + GRAVITY;
  const y = fighter.position.y + vy;

  // Land
  if (y >= STAGE_FLOOR - FIGHTER_HEIGHT) {
    return {
      ...fighter,
      position: { ...fighter.position, y: STAGE_FLOOR - FIGHTER_HEIGHT },
      velocity: { x: fighter.velocity.x, y: 0 },
      grounded: true,
    };
  }

  return {
    ...fighter,
    position: { ...fighter.position, y },
    velocity: { ...fighter.velocity, y: vy },
  };
}

// -- Pure position integration (x-axis) + stage bounds --

function integrate(fighter: FighterState): FighterState {
  let x = fighter.position.x + fighter.velocity.x;
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

  // Gravity first — so FSM can react to landing
  f0 = applyGravity(f0);
  f1 = applyGravity(f1);

  // FSM handles transitions + movement
  f0 = fsmUpdate(f0, inputs[0]);
  f1 = fsmUpdate(f1, inputs[1]);

  // Position integration (x-axis)
  f0 = integrate(f0);
  f1 = integrate(f1);

  // Pushbox
  [f0, f1] = resolvePush(f0, f1);

  // Facing
  f0 = updateFacing(f0, f1);
  f1 = updateFacing(f1, f0);

  return { frame: state.frame + 1, fighters: [f0, f1] };
}
