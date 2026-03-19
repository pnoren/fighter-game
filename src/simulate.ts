import {
  FighterState,
  GameState,
  Input,
  Rect,
  StateId,
  MoveId,
  MoveData,
  BufferedInput,
  MOVES,
  BUFFER_WINDOW,
  MAX_COMBO_SCALING,
  DAMAGE_SCALE_PER_HIT,
  HITSTUN_SCALE_PER_HIT,
  GRAVITY,
  WALK_SPEED,
  JUMP_VELOCITY,
  AIR_CONTROL,
  AIR_MAX_SPEED,
  STAGE_FLOOR,
  STAGE_WIDTH,
  FIGHTER_WIDTH,
  FIGHTER_HEIGHT,
  CROUCH_HEIGHT,
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

function wantsAttack(input: Input): MoveId | null {
  if (input.light) return "light";
  if (input.heavy) return "heavy";
  return null;
}

function tryAttack(f: FighterState, input: Input): FighterState | null {
  const move = wantsAttack(input);
  if (!move) return null;
  return enter(f, "attacking", input, { activeMove: move, velocity: { x: 0, y: 0 }, inputBuffer: [] });
}

// -- Input buffer --

function bufferInput(f: FighterState, input: Input, frame: number): FighterState {
  const move = wantsAttack(input);
  let buffer = f.inputBuffer.filter(b => frame - b.frame < BUFFER_WINDOW);
  if (move) {
    buffer = [...buffer, { move, frame }];
  }
  return buffer !== f.inputBuffer ? { ...f, inputBuffer: buffer } : f;
}

function consumeBuffer(f: FighterState, input: Input): FighterState | null {
  if (f.inputBuffer.length === 0) return null;
  const last = f.inputBuffer[f.inputBuffer.length - 1];
  return enter(f, "attacking", input, { activeMove: last.move, velocity: { x: 0, y: 0 }, inputBuffer: [] });
}

// -- FSM state handlers: each returns updated FighterState --

type StateHandler = (f: FighterState, input: Input) => FighterState;

const FSM: Record<StateId, StateHandler> = {

  idle(f, input) {
    const atk = tryAttack(f, input);
    if (atk) return atk;
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
    const atk = tryAttack(f, input);
    if (atk) return atk;
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
    // Landed — check buffer for attack, otherwise idle
    if (f.grounded) {
      const buffered = consumeBuffer(f, input);
      if (buffered) return buffered;
      return enter(f, "idle", input, { velocity: { x: 0, y: 0 } });
    }

    // Air control
    let vx = f.velocity.x;
    if (input.left) vx -= AIR_CONTROL;
    if (input.right) vx += AIR_CONTROL;
    vx = Math.max(-AIR_MAX_SPEED, Math.min(AIR_MAX_SPEED, vx));
    return tick(f, input, { velocity: { x: vx, y: f.velocity.y } });
  },

  crouching(f, input) {
    const atk = tryAttack(f, input);
    if (atk) return atk;
    if (wantsJump(f, input)) {
      return enter(f, "jumping", input, {
        velocity: { x: 0, y: JUMP_VELOCITY },
        grounded: false,
      });
    }
    if (!input.down) return enter(f, "idle", input);
    return tick(f, input, { velocity: { x: 0, y: 0 } });
  },

  attacking(f, input) {
    if (!f.activeMove) return enter(f, "idle", input, { activeMove: null, hitConfirmed: false });
    const move = MOVES[f.activeMove];
    const total = move.startup + move.active + move.recovery;
    if (f.stateFrame >= total) {
      // Attack finished — check buffer for chained attack
      const buffered = consumeBuffer(f, input);
      if (buffered) return { ...buffered, hitConfirmed: false };
      return enter(f, "idle", input, { activeMove: null, hitConfirmed: false });
    }
    return tick(f, input, { velocity: { x: 0, y: 0 } });
  },

  hitstun(f, input) {
    if (f.stateFrame >= f.hitstunDuration) {
      // Hitstun over — combo resets, check buffer for immediate counterattack
      const buffered = consumeBuffer(f, input);
      if (buffered) return { ...buffered, comboCount: 0 };
      return enter(f, "idle", input, { comboCount: 0 });
    }
    return tick(f, input, { velocity: { x: 0, y: 0 } });
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

// -- Hitbox / hurtbox derivation --

export function deriveHurtbox(f: FighterState): Rect {
  const isCrouching = f.state === "crouching";
  const h = isCrouching ? CROUCH_HEIGHT : FIGHTER_HEIGHT;
  const yOffset = isCrouching ? FIGHTER_HEIGHT - CROUCH_HEIGHT : 0;
  return {
    x: f.position.x - FIGHTER_WIDTH / 2,
    y: f.position.y + yOffset,
    w: FIGHTER_WIDTH,
    h,
  };
}

export function deriveHitbox(f: FighterState): Rect | null {
  if (f.state !== "attacking" || !f.activeMove || f.hitConfirmed) return null;
  const move = MOVES[f.activeMove];
  // Only active during active frames
  if (f.stateFrame < move.startup || f.stateFrame >= move.startup + move.active) return null;
  const hb = move.hitbox;
  return {
    x: f.position.x + hb.offsetX * f.facing - (f.facing === 1 ? 0 : hb.w),
    y: f.position.y + hb.offsetY,
    w: hb.w,
    h: hb.h,
  };
}

// -- AABB collision --

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// -- Hit resolution --

function applyHit(
  attacker: FighterState,
  defender: FighterState,
  move: MoveData,
  attackerLabel: string,
): [FighterState, FighterState] {
  const combo = defender.comboCount + 1;
  const scale = Math.max(0, 1 - DAMAGE_SCALE_PER_HIT * Math.min(defender.comboCount, MAX_COMBO_SCALING));
  const stunScale = Math.max(0.3, 1 - HITSTUN_SCALE_PER_HIT * Math.min(defender.comboCount, MAX_COMBO_SCALING));
  const damage = Math.round(move.damage * scale);
  const hitstun = Math.round(move.hitstun * stunScale);
  const newHealth = Math.max(0, defender.health - damage);

  console.log(
    `${attackerLabel} ${attacker.activeMove} hit: ${defender.health} → ${newHealth} (-${damage}) combo:${combo} scale:${(scale * 100).toFixed(0)}%`,
  );

  return [
    { ...attacker, hitConfirmed: true },
    {
      ...defender,
      health: newHealth,
      state: "hitstun" as const,
      stateFrame: 0,
      hitstunDuration: hitstun,
      comboCount: combo,
      velocity: { x: 0, y: 0 },
      activeMove: null,
    },
  ];
}

function resolveHits(f0: FighterState, f1: FighterState): [FighterState, FighterState] {
  const h0 = deriveHitbox(f0);
  const h1 = deriveHitbox(f1);
  const hurt0 = deriveHurtbox(f0);
  const hurt1 = deriveHurtbox(f1);

  if (h0 && rectsOverlap(h0, hurt1)) {
    [f0, f1] = applyHit(f0, f1, MOVES[f0.activeMove!], "P1");
  }
  if (h1 && rectsOverlap(h1, hurt0)) {
    [f1, f0] = applyHit(f1, f0, MOVES[f1.activeMove!], "P2");
  }

  return [f0, f1];
}

// -- Top-level simulate: pure (GameState, Inputs) → GameState --

export function simulate(state: GameState, inputs: [Input, Input]): GameState {
  let [f0, f1] = state.fighters;

  // Buffer attack inputs
  f0 = bufferInput(f0, inputs[0], state.frame);
  f1 = bufferInput(f1, inputs[1], state.frame);

  // Gravity first — so FSM can react to landing
  f0 = applyGravity(f0);
  f1 = applyGravity(f1);

  // FSM handles transitions + movement
  f0 = fsmUpdate(f0, inputs[0]);
  f1 = fsmUpdate(f1, inputs[1]);

  // Position integration (x-axis)
  f0 = integrate(f0);
  f1 = integrate(f1);

  // Hit detection
  [f0, f1] = resolveHits(f0, f1);

  // Pushbox
  [f0, f1] = resolvePush(f0, f1);

  // Facing
  f0 = updateFacing(f0, f1);
  f1 = updateFacing(f1, f0);

  return { frame: state.frame + 1, fighters: [f0, f1] };
}
