import {
  FighterState,
  GameState,
  Input,
  Rect,
  StateId,
  MoveData,
  CharacterDef,
  BufferedInput,
  Projectile,
  CHARACTERS,
  THROW_RANGE,
  THROW_DAMAGE,
  THROW_DURATION,
  THROW_HITSTOP,
  BUFFER_WINDOW,
  MAX_COMBO_SCALING,
  DAMAGE_SCALE_PER_HIT,
  HITSTUN_SCALE_PER_HIT,
  GRAVITY,
  STAGE_FLOOR,
  STAGE_WIDTH,
  FIGHTER_WIDTH,
  FIGHTER_HEIGHT,
  CROUCH_HEIGHT,
} from "./types.js";

// -- Character data lookup --

function charDef(f: FighterState): CharacterDef {
  return CHARACTERS[f.characterId];
}

function moveData(f: FighterState): MoveData | null {
  if (!f.activeMove) return null;
  return charDef(f).moves[f.activeMove] ?? null;
}

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

function wantsAttack(input: Input, fighter?: FighterState): string | null {
  // Special move: down + forward + lightPunch = fireball
  if (fighter && input.down && input.lightPunch) {
    const forward = fighter.facing === 1 ? input.right : input.left;
    if (forward && charDef(fighter).moves["fireball"]) return "fireball";
  }
  if (input.lightPunch) return "lightPunch";
  if (input.heavyPunch) return "heavyPunch";
  if (input.lightKick) return "lightKick";
  if (input.heavyKick) return "heavyKick";
  return null;
}

function tryAttack(f: FighterState, input: Input): FighterState | null {
  const move = wantsAttack(input, f);
  if (!move || !charDef(f).moves[move]) return null;
  return enter(f, "attacking", input, { activeMove: move, velocity: { x: 0, y: 0 }, inputBuffer: [], chainCount: 0 });
}

// -- Chain cancel logic --

const MAX_LIGHT_CHAIN = 2;

function canChainInto(f: FighterState, nextMoveId: string): boolean {
  const cd = charDef(f);
  const current = f.activeMove ? cd.moves[f.activeMove] : null;
  const next = cd.moves[nextMoveId];
  if (!current || !next) return false;

  // Specials (weight 3) are enders — cannot cancel
  if (current.weight >= 3) return false;

  // Heavy into special — always allowed (light → heavy → special)
  if (current.weight === 2 && next.weight >= 3) return true;

  // Heavy into anything else — no
  if (current.weight >= 2) return false;

  // Light into heavier — always allowed
  if (next.weight > current.weight) return true;

  // Light into light — limited chain count
  if (next.weight <= current.weight && f.chainCount < MAX_LIGHT_CHAIN) return true;

  return false;
}

function tryChain(f: FighterState, input: Input): FighterState | null {
  // Try direct input first
  const moveId = wantsAttack(input, f);
  if (moveId && canChainInto(f, moveId)) {
    const newChain = charDef(f).moves[moveId].weight <= 1 ? f.chainCount + 1 : 0;
    return enter(f, "attacking", input, {
      activeMove: moveId, velocity: { x: 0, y: 0 }, inputBuffer: [],
      hitConfirmed: false, chainCount: newChain,
    });
  }

  // Try buffer
  if (f.inputBuffer.length > 0) {
    const last = f.inputBuffer[f.inputBuffer.length - 1];
    if (canChainInto(f, last.move)) {
      const newChain = charDef(f).moves[last.move]?.weight <= 1 ? f.chainCount + 1 : 0;
      return enter(f, "attacking", input, {
        activeMove: last.move, velocity: { x: 0, y: 0 }, inputBuffer: [],
        hitConfirmed: false, chainCount: newChain,
      });
    }
  }

  return null;
}

// -- Throw detection (needs opponent state, checked in simulate) --

function canThrow(attacker: FighterState, defender: FighterState, input: Input): boolean {
  // Forward + heavyPunch at close range
  const forward = attacker.facing === 1 ? input.right : input.left;
  if (!forward || !input.heavyPunch) return false;
  // Don't trigger fireball input (needs down too)
  if (input.down) return false;
  // Must be in a throwable grounded state
  const throwable: StateId[] = ["idle", "walking", "crouching"];
  if (!throwable.includes(attacker.state)) return false;
  if (!throwable.includes(defender.state) && defender.state !== "attacking") return false;
  if (!attacker.grounded || !defender.grounded) return false;
  // Range check
  const dist = Math.abs(attacker.position.x - defender.position.x);
  return dist <= THROW_RANGE;
}

// -- Input buffer --

function bufferInput(f: FighterState, input: Input, frame: number): FighterState {
  const move = wantsAttack(input, f);
  let buffer = f.inputBuffer.filter(b => frame - b.frame < BUFFER_WINDOW);
  if (move) {
    buffer = [...buffer, { move, frame }];
  }
  return buffer !== f.inputBuffer ? { ...f, inputBuffer: buffer } : f;
}

function consumeBuffer(f: FighterState, input: Input): FighterState | null {
  if (f.inputBuffer.length === 0) return null;
  const last = f.inputBuffer[f.inputBuffer.length - 1];
  if (!charDef(f).moves[last.move]) return null;
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
        velocity: { x: f.velocity.x, y: charDef(f).jumpVelocity },
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
        velocity: { x: f.velocity.x, y: charDef(f).jumpVelocity },
        grounded: false,
      });
    }
    if (input.down) return enter(f, "crouching", input, { velocity: { x: 0, y: 0 } });
    if (!input.left && !input.right) return enter(f, "idle", input, { velocity: { x: 0, y: 0 } });

    const speed = charDef(f).walkSpeed;
    let vx = 0;
    if (input.left) vx -= speed;
    if (input.right) vx += speed;
    // Walking backward is slower (75%) — fundamental spacing mechanic
    const walkDir = vx > 0 ? 1 : -1;
    if (walkDir !== f.facing) vx *= 0.75;
    return tick(f, input, { velocity: { x: vx, y: 0 } });
  },

  jumping(f, input) {
    if (f.grounded) {
      const buffered = consumeBuffer(f, input);
      if (buffered) return buffered;
      return enter(f, "idle", input, { velocity: { x: 0, y: 0 } });
    }

    // Air attack — jumpKick on any kick button
    if ((input.lightKick || input.heavyKick) && charDef(f).moves["jumpKick"]) {
      return enter(f, "attacking", input, {
        activeMove: "jumpKick",
        inputBuffer: [],
        chainCount: 0,
      });
    }

    const cd = charDef(f);
    let vx = f.velocity.x;
    if (input.left) vx -= cd.airControl;
    if (input.right) vx += cd.airControl;
    vx = Math.max(-cd.airMaxSpeed, Math.min(cd.airMaxSpeed, vx));
    return tick(f, input, { velocity: { x: vx, y: f.velocity.y } });
  },

  crouching(f, input) {
    const atk = tryAttack(f, input);
    if (atk) return atk;
    if (wantsJump(f, input)) {
      return enter(f, "jumping", input, {
        velocity: { x: 0, y: charDef(f).jumpVelocity },
        grounded: false,
      });
    }
    if (!input.down) return enter(f, "idle", input);
    return tick(f, input, { velocity: { x: 0, y: 0 } });
  },

  attacking(f, input) {
    const move = moveData(f);
    if (!move) return enter(f, "idle", input, { activeMove: null, hitConfirmed: false, chainCount: 0 });
    const total = move.startup + move.active + move.recovery;

    // Attack finished — return to idle (chain window is recovery only)
    if (f.stateFrame >= total) {
      return enter(f, "idle", input, { activeMove: null, hitConfirmed: false, chainCount: 0 });
    }

    // Recovery cancel on hit — chain into valid next attack or jump
    const inRecovery = f.stateFrame >= move.startup + move.active;
    if (inRecovery && f.hitConfirmed) {
      const chain = tryChain(f, input);
      if (chain) return chain;
      if (wantsJump(f, input)) {
        return enter(f, "jumping", input, {
          velocity: { x: 0, y: charDef(f).jumpVelocity },
          grounded: false,
          activeMove: null,
          hitConfirmed: false,
          chainCount: 0,
        });
      }
    }

    // Air attacks keep gravity, ground attacks lock in place
    if (f.grounded) {
      return tick(f, input, { velocity: { x: 0, y: 0 } });
    }
    return tick(f, input);
  },

  hitstun(f, input) {
    if (f.stateFrame >= f.hitstunDuration) {
      const buffered = consumeBuffer(f, input);
      if (buffered) return { ...buffered, comboCount: 0 };
      return enter(f, "idle", input, { comboCount: 0 });
    }

    // Early out: last 2 frames accept movement to feel responsive
    const framesLeft = f.hitstunDuration - f.stateFrame;
    if (framesLeft <= 2) {
      if (wantsJump(f, input)) {
        return enter(f, "jumping", input, {
          velocity: { x: 0, y: charDef(f).jumpVelocity },
          grounded: false,
          comboCount: 0,
        });
      }
      if (input.down) return enter(f, "crouching", input, { velocity: { x: 0, y: 0 }, comboCount: 0 });
      if (input.left || input.right) return enter(f, "walking", input, { comboCount: 0 });
    }

    // Friction: slide to a stop
    const vx = f.velocity.x * 0.85;
    return tick(f, input, { velocity: { x: Math.abs(vx) < 0.1 ? 0 : vx, y: 0 } });
  },

  ko(f, input) {
    const vx = f.velocity.x * 0.9;
    return tick(f, input, { velocity: { x: Math.abs(vx) < 0.1 ? 0 : vx, y: 0 } });
  },

  throwing(f, input) {
    // Throw animation plays for THROW_DURATION frames
    if (f.stateFrame >= THROW_DURATION) {
      return enter(f, "idle", input, { activeMove: null, velocity: { x: 0, y: 0 } });
    }
    return tick(f, input, { velocity: { x: 0, y: 0 } });
  },

  thrown(f, input) {
    // Thrown: locked until throw duration ends, then hitstun
    if (f.stateFrame >= THROW_DURATION) {
      return enter(f, "hitstun", input, {
        hitstunDuration: 15,
        velocity: { x: -f.facing * 6, y: 0 },
      });
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
  // Lock facing during attacks and hitstun — prevents mid-swing flip
  if (fighter.state === "attacking" || fighter.state === "hitstun" || fighter.state === "throwing" || fighter.state === "thrown" || fighter.state === "ko") return fighter;
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
  const move = moveData(f);
  if (!move) return null;
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

  // Knockback: push defender away, attacker pushed back slightly
  const kb = move.knockback * attacker.facing;
  const attackerPushback = -kb * 0.3;

  return [
    { ...attacker, hitConfirmed: true, velocity: { x: attackerPushback, y: attacker.velocity.y } },
    {
      ...defender,
      health: newHealth,
      state: newHealth <= 0 ? "ko" as const : "hitstun" as const,
      stateFrame: 0,
      hitstunDuration: hitstun,
      comboCount: combo,
      velocity: { x: kb * (newHealth <= 0 ? 1.5 : 1), y: 0 },
      activeMove: null,
    },
  ];
}

function resolveHitsWithStop(f0: FighterState, f1: FighterState): [FighterState, FighterState, number] {
  const h0 = deriveHitbox(f0);
  const h1 = deriveHitbox(f1);
  const hurt0 = deriveHurtbox(f0);
  const hurt1 = deriveHurtbox(f1);
  let hitstop = 0;

  if (h0 && rectsOverlap(h0, hurt1)) {
    const move = moveData(f0);
    if (move) {
      [f0, f1] = applyHit(f0, f1, move, "P1");
      hitstop = Math.max(hitstop, move.hitstop);
    }
  }
  if (h1 && rectsOverlap(h1, hurt0)) {
    const move = moveData(f1);
    if (move) {
      [f1, f0] = applyHit(f1, f0, move, "P2");
      hitstop = Math.max(hitstop, move.hitstop);
    }
  }

  return [f0, f1, hitstop];
}

// -- Projectile spawning --

function spawnProjectiles(
  fighters: [FighterState, FighterState],
  existing: Projectile[],
): Projectile[] {
  let projectiles = [...existing];
  for (let i = 0; i < 2; i++) {
    const f = fighters[i];
    if (f.state !== "attacking" || !f.activeMove) continue;
    const move = charDef(f).moves[f.activeMove];
    if (!move?.projectile) continue;
    // Spawn on first active frame only
    if (f.stateFrame !== move.startup) continue;
    const p = move.projectile;
    projectiles.push({
      position: {
        x: f.position.x + 30 * f.facing,
        y: f.position.y + p.offsetY,
      },
      velocity: { x: p.speed * f.facing, y: 0 },
      width: p.width,
      height: p.height,
      damage: move.damage,
      hitstun: move.hitstun,
      hitstop: move.hitstop,
      knockback: move.knockback,
      owner: i as 0 | 1,
      lifetime: p.lifetime,
    });
  }
  return projectiles;
}

// -- Projectile simulation --

function updateProjectiles(projectiles: Projectile[]): Projectile[] {
  return projectiles
    .map(p => ({
      ...p,
      position: { x: p.position.x + p.velocity.x, y: p.position.y + p.velocity.y },
      lifetime: p.lifetime - 1,
    }))
    .filter(p => p.lifetime > 0 && p.position.x > 0 && p.position.x < STAGE_WIDTH);
}

// -- Projectile vs fighter collision --

function resolveProjectileHits(
  fighters: [FighterState, FighterState],
  projectiles: Projectile[],
): { fighters: [FighterState, FighterState]; projectiles: Projectile[]; hitstop: number } {
  let [f0, f1] = fighters;
  let remaining = [...projectiles];
  let hitstop = 0;

  for (let i = remaining.length - 1; i >= 0; i--) {
    const p = remaining[i];
    const targetIdx = p.owner === 0 ? 1 : 0;
    const target = targetIdx === 0 ? f0 : f1;
    const hurtbox = deriveHurtbox(target);
    const projRect: Rect = {
      x: p.position.x - p.width / 2,
      y: p.position.y - p.height / 2,
      w: p.width,
      h: p.height,
    };

    if (rectsOverlap(projRect, hurtbox)) {
      const combo = target.comboCount + 1;
      const scale = Math.max(0, 1 - DAMAGE_SCALE_PER_HIT * Math.min(target.comboCount, MAX_COMBO_SCALING));
      const stunScale = Math.max(0.3, 1 - HITSTUN_SCALE_PER_HIT * Math.min(target.comboCount, MAX_COMBO_SCALING));
      const damage = Math.round(p.damage * scale);
      const stun = Math.round(p.hitstun * stunScale);
      const newHealth = Math.max(0, target.health - damage);
      const kbDir = p.velocity.x > 0 ? 1 : -1;

      console.log(`P${p.owner + 1} fireball hit P${targetIdx + 1}: ${target.health} → ${newHealth} (-${damage}) combo:${combo}`);

      const hitTarget: FighterState = {
        ...target,
        health: newHealth,
        state: newHealth <= 0 ? "ko" : "hitstun",
        stateFrame: 0,
        hitstunDuration: stun,
        comboCount: combo,
        velocity: { x: p.knockback * kbDir * (newHealth <= 0 ? 1.5 : 1), y: 0 },
        activeMove: null,
      };

      if (targetIdx === 0) f0 = hitTarget; else f1 = hitTarget;
      hitstop = Math.max(hitstop, p.hitstop);
      remaining.splice(i, 1);
    }
  }

  return { fighters: [f0, f1], projectiles: remaining, hitstop };
}

// -- Throw resolution --

function resolveThrows(
  f0: FighterState, f1: FighterState,
  inputs: [Input, Input],
): [FighterState, FighterState, number] {
  let hitstop = 0;

  // Check P1 throwing P2
  if (canThrow(f0, f1, inputs[0])) {
    const newHealth = Math.max(0, f1.health - THROW_DAMAGE);
    console.log(`P1 throw P2: ${f1.health} → ${newHealth} (-${THROW_DAMAGE})`);
    hitstop = THROW_HITSTOP;
    f0 = { ...f0, state: "throwing", stateFrame: 0, activeMove: "throw", velocity: { x: 0, y: 0 } };
    f1 = {
      ...f1,
      health: newHealth,
      state: newHealth <= 0 ? "ko" : "thrown",
      stateFrame: 0,
      velocity: { x: 0, y: 0 },
      activeMove: null,
      comboCount: f1.comboCount + 1,
    };
    return [f0, f1, hitstop];
  }

  // Check P2 throwing P1
  if (canThrow(f1, f0, inputs[1])) {
    const newHealth = Math.max(0, f0.health - THROW_DAMAGE);
    console.log(`P2 throw P1: ${f0.health} → ${newHealth} (-${THROW_DAMAGE})`);
    hitstop = THROW_HITSTOP;
    f1 = { ...f1, state: "throwing", stateFrame: 0, activeMove: "throw", velocity: { x: 0, y: 0 } };
    f0 = {
      ...f0,
      health: newHealth,
      state: newHealth <= 0 ? "ko" : "thrown",
      stateFrame: 0,
      velocity: { x: 0, y: 0 },
      activeMove: null,
      comboCount: f0.comboCount + 1,
    };
    return [f0, f1, hitstop];
  }

  return [f0, f1, 0];
}

// -- Top-level simulate: pure (GameState, Inputs) → GameState --

export function simulate(state: GameState, inputs: [Input, Input]): GameState {
  // Hitstop: freeze both fighters, just decrement the counter
  if (state.hitstop > 0) {
    let [f0, f1] = state.fighters;
    f0 = bufferInput(f0, inputs[0], state.frame);
    f1 = bufferInput(f1, inputs[1], state.frame);
    return { frame: state.frame + 1, fighters: [f0, f1], projectiles: state.projectiles, hitstop: state.hitstop - 1 };
  }

  let [f0, f1] = state.fighters;

  // Buffer attack inputs
  f0 = bufferInput(f0, inputs[0], state.frame);
  f1 = bufferInput(f1, inputs[1], state.frame);

  // Gravity first — so FSM can react to landing
  f0 = applyGravity(f0);
  f1 = applyGravity(f1);

  // Throw check (before FSM so it takes priority over attacks)
  let hitstop = 0;
  let throwStop = 0;
  [f0, f1, throwStop] = resolveThrows(f0, f1, inputs);
  hitstop = Math.max(hitstop, throwStop);

  // FSM handles transitions + movement
  f0 = fsmUpdate(f0, inputs[0]);
  f1 = fsmUpdate(f1, inputs[1]);

  // Position integration (x-axis)
  f0 = integrate(f0);
  f1 = integrate(f1);

  // Hit detection (melee)
  [f0, f1, hitstop] = resolveHitsWithStop(f0, f1);

  // Projectiles: spawn, move, collide
  let projectiles = spawnProjectiles([f0, f1], state.projectiles);
  projectiles = updateProjectiles(projectiles);
  const projResult = resolveProjectileHits([f0, f1], projectiles);
  [f0, f1] = projResult.fighters;
  projectiles = projResult.projectiles;
  hitstop = Math.max(hitstop, projResult.hitstop);

  // Pushbox
  [f0, f1] = resolvePush(f0, f1);

  // Facing
  f0 = updateFacing(f0, f1);
  f1 = updateFacing(f1, f0);

  return { frame: state.frame + 1, fighters: [f0, f1], projectiles, hitstop };
}
