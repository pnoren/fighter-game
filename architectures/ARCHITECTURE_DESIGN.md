# 2D Fighting Game — Three Architecture Designs

**Language:** TypeScript
**Renderer:** HTML5 Canvas (no engine)
**Target:** Browser prototype

---

## Architecture 1: Classical OOP with Hierarchical State Machines

### Core Concept

Each game entity is an **object** with behavior encapsulated in methods. Character behavior is governed by a **hierarchical state machine (HSM)** — a tree of states where parent states share common behavior and child states specialize. The inheritance hierarchy models the "is-a" relationships between game concepts.

### High-Level Structure

```
src/
  core/
    Game.ts              — Game loop, owns both fighters + stage
    InputManager.ts      — Polls input, maintains buffer ring
    CollisionSystem.ts   — Static methods: AABB + box overlap tests
    Renderer.ts          — Draws everything via Canvas 2D
  characters/
    Fighter.ts           — Base class: position, velocity, health, state machine
    Ryu.ts               — extends Fighter, overrides specials/normals
    Ken.ts               — extends Fighter, different frame data
  states/
    FighterState.ts      — Abstract base: enter(), update(), exit()
    GroundedState.ts     — Parent state: handles left/right, crouch transition
      IdleState.ts
      WalkState.ts
      CrouchState.ts
    AirborneState.ts     — Parent state: gravity, air control
      JumpState.ts
      FallState.ts
    AttackState.ts       — Parent state: drives animation frames, hitbox activation
      LightAttackState.ts
      HeavyAttackState.ts
      SpecialAttackState.ts
  data/
    FrameData.ts         — Type definitions for frame data tables
    ryu-frames.json      — Per-move frame data (startup, active, recovery, hitboxes)
    ken-frames.json
  animation/
    AnimationPlayer.ts   — Plays sprite sequences, fires frame callbacks
    SpriteSheet.ts       — Atlas management
  types/
    Hitbox.ts            — { x, y, w, h, damage, hitstun, blockstun }
    Hurtbox.ts           — { x, y, w, h }
    InputCommand.ts      — { direction, button, timestamp }
```

### How It Flows: Input → Action → Animation → Collision

```
1. INPUT
   InputManager polls keyboard/gamepad every frame.
   Raw inputs pushed into a circular buffer (last 60 frames).
   InputManager exposes: isHeld(key), wasPressed(key), getBuffer().

2. STATE EVALUATION
   Fighter.update() calls currentState.update(fighter, input).
   The current state checks input conditions:
     - IdleState sees "right held" → transitions to WalkState
     - GroundedState sees "down+heavy" → transitions to HeavyAttackState(crouching=true)
     - AttackState checks buffer for motion inputs (236+P) → SpecialAttackState
   State transitions call exit() on old state, enter() on new state.

3. ACTION / ANIMATION
   On enter(), AttackState looks up the move in the fighter's FrameData:
     attackState.enter() → this.frameData = fighter.getMoveData("cr.HP")
   AttackState.update() advances a frame counter each tick:
     - Frames 1-4 (startup): no hitbox, hurtbox only
     - Frames 5-7 (active): hitbox activated, registered with CollisionSystem
     - Frames 8-15 (recovery): hitbox removed, fighter is vulnerable
   AnimationPlayer is told which animation + frame to display.
   Animation is SLAVE to gameplay — the state machine is the source of truth.

4. COLLISION
   After all fighters update, Game calls CollisionSystem.check():
     - For each active hitbox on Fighter A, test overlap against
       all hurtboxes on Fighter B (and vice versa).
     - On hit: CollisionSystem returns HitResult { attacker, defender, move }
     - Game calls defender.onHit(hitResult):
       - Health reduced
       - Defender's state machine forced into HitstunState
       - Attacker's state may cancel into next move (if cancel window open)
   Push-box collision handled separately (prevents overlapping sprites).
```

### Adding a New Character

1. Create `NewChar.ts` extending `Fighter`
2. Override `getMoveList()` to return character-specific moves
3. Create `newchar-frames.json` with frame data for every move
4. Add character-specific states if needed (e.g., unique mechanic)

### Adding a New Move

1. Add entry to character's frame data JSON (startup, active, recovery, hitbox rects, damage)
2. If the move has unique behavior (e.g., projectile), create a new `AttackState` subclass
3. Add transition rules in the appropriate parent state

### Pros

- **Intuitive mental model** — a fighter "is in" a state, states have clear boundaries
- **Hierarchical states reduce duplication** — grounded behavior written once, shared by idle/walk/crouch
- **Frame data is data-driven** — moves defined in JSON, not hardcoded in state classes
- **Debugging is straightforward** — log state transitions to see exactly what happened
- **Matches how FGC thinks** — startup/active/recovery is how fighting game players already reason

### Cons

- **Inheritance rigidity** — deep hierarchies become fragile; changing `GroundedState` can break children
- **State explosion** — each move × variant (standing/crouching/aerial) can mean many state classes
- **Cross-cutting concerns are awkward** — "super armor" or "counter hit" logic touches many states
- **Fighter base class bloat** — over time, `Fighter` accumulates fields for every mechanic
- **Hard to compose behaviors** — a move that is both an attack AND a movement (dive kick) doesn't fit neatly into one parent state

### Scaling Problems

- **20+ characters** → the inheritance tree becomes deep and tangled. Shared behavior that's "almost but not quite the same" leads to override spaghetti.
- **Complex mechanics** (Roman Cancels, Burst, meter management) → these cross-cut all states. You end up passing the mechanic through every state or using fragile event systems.
- **Netcode/rollback** → serializing the entire state machine tree for rollback is painful. Deep object graphs with circular references don't snapshot cleanly.

---

## Architecture 2: Entity-Component-System (ECS)

### Core Concept

There are no "Fighter" objects. Instead, every game entity is just an **ID** (a number). All data lives in flat, typed **component arrays**. Stateless **systems** iterate over entities that have the right combination of components. Behavior emerges from which components an entity has, not from what class it is.

This is a **data-oriented** architecture. Memory layout is flat and cache-friendly. Logic is separated from data. Composition replaces inheritance entirely.

### High-Level Structure

```
src/
  ecs/
    World.ts             — Entity ID allocator + component storage
    System.ts            — Base interface: update(world, dt)
    Query.ts             — Finds entities with specific component sets
  components/
    Position.ts          — { x: number, y: number }
    Velocity.ts          — { vx: number, vy: number }
    Health.ts            — { current: number, max: number }
    FighterTag.ts        — Marker component (no data) — "this entity is a fighter"
    InputState.ts        — { held: Set<Key>, buffer: InputCommand[] }
    FSM.ts               — { current: StateID, frameInState: number, data: any }
    MoveData.ts          — { moveId: string, startup: n, active: n, recovery: n }
    ActiveHitbox.ts      — { rects: Rect[], damage: n, hitstun: n }
    Hurtbox.ts           — { rects: Rect[] }
    Animation.ts         — { sheet: string, frame: number, speed: number }
    Gravity.ts           — { strength: number }
    Grounded.ts          — Marker: entity is on the ground
    Hitstun.ts           — { framesRemaining: number }
    Blockstun.ts         — { framesRemaining: number }
    Pushbox.ts           — { rect: Rect }
    CharacterDef.ts      — { characterId: string } → points to data table
  systems/
    InputSystem.ts       — Reads raw input, writes to InputState component
    StateTransitionSystem.ts  — Reads InputState + FSM, transitions states
    MovementSystem.ts    — Reads InputState + Velocity (if not in hitstun), applies movement
    GravitySystem.ts     — Queries (Velocity, Gravity, !Grounded), applies gravity
    AttackSystem.ts      — Reads FSM + MoveData, manages hitbox lifecycle
    HitboxActivationSystem.ts — Adds/removes ActiveHitbox based on frame count
    CollisionSystem.ts   — Queries (ActiveHitbox) vs (Hurtbox), emits HitEvents
    DamageSystem.ts      — Processes HitEvents, modifies Health, adds Hitstun
    HitstunSystem.ts     — Decrements Hitstun, removes when done
    PushboxSystem.ts     — Resolves body-body overlap
    AnimationSyncSystem.ts — Reads FSM + MoveData, sets Animation frame
    RenderSystem.ts      — Reads Position + Animation, draws to canvas
  data/
    characters.ts        — Character definitions (maps characterId → move tables)
    moves.ts             — Move frame data tables
  prefabs/
    createFighter.ts     — Spawns entity with all fighter components
    createProjectile.ts  — Spawns entity with position, velocity, hitbox, animation
```

### System Execution Order (per frame)

```
1. InputSystem           — poll hardware → write InputState
2. HitstunSystem         — decrement stun timers, remove expired
3. StateTransitionSystem — read input + current state → maybe transition FSM
4. MovementSystem        — read input + state → write Velocity
5. GravitySystem         — apply gravity to airborne entities
6. AttackSystem          — advance attack frame counters
7. HitboxActivationSystem — activate/deactivate hitboxes based on frame
8. CollisionSystem       — hitbox vs hurtbox tests → emit HitEvents
9. DamageSystem          — process HitEvents → modify Health, apply Hitstun
10. PushboxSystem        — resolve body overlap
11. AnimationSyncSystem  — sync Animation component to game state
12. RenderSystem         — draw
```

### How It Flows: Input → Action → Animation → Collision

```
1. INPUT
   InputSystem runs first. For each entity with (InputState, FighterTag):
     - Reads keyboard/gamepad mapped to that player
     - Updates held keys, pushes to command buffer
   Output: InputState component is fresh for this frame.

2. STATE TRANSITION
   StateTransitionSystem runs on entities with (FSM, InputState):
     - Checks transition table: given current state + input → next state?
     - Transition tables are pure data (loaded from character definition)
     - Example: { from: "idle", input: "down+HP", to: "attack", moveId: "cr.HP" }
     - On transition: sets FSM.current, FSM.frameInState = 0,
       writes MoveData component with frame data for the move
   No class hierarchies. The "state machine" is a data table + a system that reads it.

3. ATTACK LIFECYCLE
   AttackSystem increments FSM.frameInState each frame.
   HitboxActivationSystem checks: if frameInState is within [startup, startup+active):
     - Adds ActiveHitbox component with the move's hitbox rects
   If frameInState >= startup+active:
     - Removes ActiveHitbox component
   If frameInState >= total frames:
     - StateTransitionSystem returns to idle (or checks buffer for cancels)

4. COLLISION
   CollisionSystem queries all entities with ActiveHitbox,
   tests against all entities with Hurtbox.
   On overlap → creates a HitEvent (stored in a global event queue or as
   a transient component on the defender).

5. DAMAGE
   DamageSystem processes HitEvents:
     - Subtracts Health
     - Adds Hitstun component (with frame count) to defender
     - Removes ActiveHitbox from attacker (prevents multi-hit unless intended)

6. ANIMATION SYNC
   AnimationSyncSystem reads FSM.current + FSM.frameInState:
     - Looks up the corresponding sprite animation + frame
     - Writes to Animation component
   Animation is always derived from game state, never drives it.

7. RENDER
   RenderSystem queries (Position, Animation), draws sprites.
```

### Adding a New Character

1. Add a new entry in the character data table (`characters.ts`)
2. Define all moves in the moves data table with their frame data
3. Define state transition table (what inputs cause what state changes)
4. Call `createFighter(world, "newchar", playerSlot)` — the prefab attaches all components
5. Zero new classes or systems needed (unless the character has a truly novel mechanic)

### Adding a New Move

1. Add an entry to the character's move table in the data files
2. Add transition rules for when the move can be activated
3. Done — the existing systems handle the rest based on the frame data

### Pros

- **Composition over inheritance** — a "projectile" is just an entity with (Position, Velocity, ActiveHitbox, Animation). No class needed.
- **Data-driven** — adding characters/moves is mostly adding data table entries
- **Systems are independent and testable** — test CollisionSystem by creating entities with known hitboxes/hurtboxes, run one system tick, check results
- **Rollback-friendly** — components are flat data. Snapshot = copy all component arrays. Restore = overwrite them. No object graph serialization.
- **Performance scales** — flat arrays, linear iteration, cache-friendly. 100 projectiles on screen costs almost nothing extra.
- **Cross-cutting behavior is natural** — "super armor" = add a SuperArmor component, DamageSystem checks for it. No touching attack states.

### Cons

- **Indirection is confusing** — behavior is spread across many systems. "What happens when I press heavy punch?" requires tracing through 6+ systems.
- **State machine in ECS is awkward** — FSM is inherently stateful and sequential, which fights against ECS's "stateless systems over flat data" philosophy. The FSM component becomes a mini-OOP island.
- **Debugging is harder** — "why did the hitbox not come out?" means checking InputSystem → StateTransitionSystem → AttackSystem → HitboxActivationSystem in order
- **Overkill for 2 entities** — ECS shines with thousands of entities. A fighting game has ~2 fighters + a few projectiles. The architectural overhead doesn't pay for itself in performance.
- **Event ordering is fragile** — system execution order matters enormously. Reorder two systems and hits stop registering or animations desync.

### Scaling Problems

- **Complex cancel systems** (Guilty Gear style) → the transition table becomes enormous. "Can cancel cr.LP into cr.MP but only on hit, and into special on block" is a lot of conditional data.
- **Character-specific systems** — if a character has a truly unique mechanic (Zato's negative edge, Ice Climbers' desync), you may need a one-off system that only runs for one entity. This undermines the generality.
- **Debugging production issues** — reproducing bugs requires replaying the exact system execution order with exact component state. Need disciplined logging.

---

## Architecture 3: Functional-Reactive with Immutable State

### Core Concept

The entire game state is a single **immutable value**. Each frame, a pure function takes the current state + inputs and produces the **next state**. There are no objects with methods, no mutation, no side effects in game logic. Rendering is a pure function from state → draw commands.

This is inspired by **Elm Architecture / Redux / functional reactive programming**. The game loop is: `state = update(state, inputs)` then `render(state)`.

### High-Level Structure

```
src/
  types/
    GameState.ts         — Top-level immutable state type
    FighterState.ts      — Per-fighter state (position, health, fsm, etc.)
    MoveState.ts         — Active move state (moveId, currentFrame)
    HitboxState.ts       — Derived: which hitboxes are active this frame
    InputSnapshot.ts     — Inputs for one frame
    FrameEvent.ts        — Union type: Hit | Block | StateChange | ...
  update/
    update.ts            — Top-level: (GameState, [Input1, Input2]) → GameState
    updateFighter.ts     — (FighterState, Input, OpponentState) → FighterState
    transition.ts        — (FsmState, Input, FighterState) → FsmState
    movement.ts          — (FighterState, Input) → FighterState (new position/velocity)
    gravity.ts           — (FighterState) → FighterState
    attack.ts            — (MoveState) → MoveState (advance frame counter)
    collision.ts         — (FighterState, FighterState) → FrameEvent[]
    applyEvents.ts       — (GameState, FrameEvent[]) → GameState
  derive/
    deriveHitboxes.ts    — (FighterState) → Hitbox[] (pure derivation from move + frame)
    deriveHurtboxes.ts   — (FighterState) → Hurtbox[]
    deriveAnimation.ts   — (FighterState) → AnimationFrame (what to draw)
  data/
    characters.ts        — Character data tables (immutable records)
    moves.ts             — Move frame data (immutable records)
    transitions.ts       — State transition tables (immutable maps)
  render/
    render.ts            — (GameState) → void (side effect boundary: Canvas drawing)
    drawFighter.ts       — (CanvasCtx, FighterState, AnimationFrame) → void
    drawHUD.ts           — (CanvasCtx, GameState) → void
  input/
    readInput.ts         — () → InputSnapshot (side effect boundary: reads hardware)
  loop/
    gameLoop.ts          — Ties it together: read input, update, render, requestAnimationFrame
  history/
    history.ts           — Manages state history ring buffer (for rollback)
```

### The State Shape

```typescript
type GameState = {
  readonly frame: number
  readonly fighters: readonly [FighterState, FighterState]
  readonly projectiles: readonly ProjectileState[]
  readonly events: readonly FrameEvent[]  // events from this frame (for VFX/SFX)
  readonly roundState: RoundState
}

type FighterState = {
  readonly position: Vec2
  readonly velocity: Vec2
  readonly facing: Direction
  readonly health: number
  readonly meter: number
  readonly fsm: FsmState
  readonly activeMove: MoveState | null
  readonly hitstun: number
  readonly blockstun: number
  readonly inputBuffer: readonly InputCommand[]
  readonly characterId: string
  readonly grounded: boolean
}

type FsmState = {
  readonly current: StateId    // "idle" | "walk" | "jump" | "attack" | "hitstun" | ...
  readonly frameInState: number
}

type MoveState = {
  readonly moveId: string
  readonly currentFrame: number
}
```

### How It Flows: Input → Action → Animation → Collision

```
Each frame is one function call. No mutation anywhere in game logic.

1. READ INPUT (side effect — isolated at boundary)
   const input1 = readInput(player1Config)
   const input2 = readInput(player2Config)

2. UPDATE (pure function pipeline)
   function update(state: GameState, inputs: [Input, Input]): GameState {

     // Phase 1: Buffer inputs
     let fighters = state.fighters.map((f, i) =>
       bufferInput(f, inputs[i])
     )

     // Phase 2: Transition states
     fighters = fighters.map(f =>
       { ...f, fsm: transition(f.fsm, f.inputBuffer, f) }
     )

     // Phase 3: Movement
     fighters = fighters.map(f =>
       f.fsm.current !== "hitstun" ? applyMovement(f, f.inputBuffer) : f
     )

     // Phase 4: Gravity
     fighters = fighters.map(f =>
       f.grounded ? f : applyGravity(f)
     )

     // Phase 5: Advance attacks
     fighters = fighters.map(f =>
       f.activeMove ? { ...f, activeMove: advanceMove(f.activeMove) } : f
     )

     // Phase 6: Derive hitboxes + check collision
     const hitboxes = fighters.map(f => deriveHitboxes(f))
     const hurtboxes = fighters.map(f => deriveHurtboxes(f))
     const events = checkCollisions(fighters, hitboxes, hurtboxes)

     // Phase 7: Apply events (damage, hitstun, etc.)
     fighters = applyHitEvents(fighters, events)

     // Phase 8: Resolve pushbox overlap
     fighters = resolvePushboxes(fighters)

     return {
       frame: state.frame + 1,
       fighters: fighters as [FighterState, FighterState],
       projectiles: updateProjectiles(state.projectiles, hitboxes),
       events,  // consumed by render for VFX/SFX
       roundState: checkRoundEnd(fighters, state.roundState)
     }
   }

3. RENDER (side effect — isolated at boundary)
   function render(ctx: CanvasRenderingContext2D, state: GameState) {
     drawStage(ctx)
     for (const fighter of state.fighters) {
       const anim = deriveAnimation(fighter)  // pure derivation
       drawFighter(ctx, fighter, anim)
     }
     drawHUD(ctx, state)
     // Play sounds/VFX based on state.events
   }

4. LOOP
   function gameLoop(state: GameState) {
     const inputs = [readInput(0), readInput(1)]
     const nextState = update(state, inputs)
     history.push(nextState)  // for rollback
     render(ctx, nextState)
     requestAnimationFrame(() => gameLoop(nextState))
   }
```

### Adding a New Character

1. Add character definition to the data tables (moves, transitions)
2. If the character has a unique resource (e.g., a charge meter), extend `FighterState` with an optional field
3. Add handling in the relevant pure functions (transition, update) with a simple conditional on `characterId`
4. No classes, no inheritance — just data + functions

### Adding a New Move

1. Add move data to the character's move table
2. Add transition rules for when the move can be activated
3. The existing pure functions (advanceMove, deriveHitboxes, checkCollisions) handle it automatically from the data

### Pros

- **Rollback is trivial** — state is immutable. `history[frame - 5]` gives you the exact state 5 frames ago. Copy it, replay inputs. This is the single biggest advantage for a fighting game, where rollback netcode is essential.
- **Time-travel debugging** — save every frame's state. Scrub back and forth. Inspect any frame's complete state. Invaluable for debugging frame-specific fighting game issues.
- **Perfectly testable** — `update()` is a pure function. Give it a state and inputs, assert on the output. No mocking, no setup, no teardown.
- **No spooky action at distance** — every piece of state is explicitly passed and returned. No hidden mutation. If health changed, you can trace exactly which function did it.
- **Deterministic** — same inputs + same state = same result. Always. Critical for replays and netcode.
- **Render is trivially separable** — state has no reference to Canvas, DOM, or any rendering concept. Swap renderers freely.

### Cons

- **Allocation pressure** — creating new state objects every frame (60fps × many objects) generates garbage. Need structural sharing or an object pool for the immutable wrappers.
- **Verbose updates** — changing one nested field requires spreading through multiple levels: `{ ...fighter, activeMove: { ...fighter.activeMove, currentFrame: fighter.activeMove.currentFrame + 1 } }`. Lens libraries or helper functions help but add complexity.
- **Not idiomatic TypeScript** — most TS developers expect classes and mutation. The functional style has a learning curve and can feel unnatural.
- **Shared/cross-entity logic is awkward** — when Fighter A's hit affects Fighter B, you need to thread both through the same function. The "map over each fighter independently" pattern breaks down for interactions.
- **Performance micro-costs** — object spread creates shallow copies every frame. For a 2-player fighting game this is negligible, but it's still more overhead than in-place mutation.

### Scaling Problems

- **Deep nesting** — as game state grows (meter, tension, burst, install states, round info), the state tree gets deep and updates get verbose. Need disciplined helper functions or optics.
- **Cross-fighter interactions** — moves that affect both players simultaneously (throws, supers with cinematic pauses) require careful orchestration since you can't just map over fighters independently.
- **Event/VFX coordination** — "on hit, spawn 3 particles and screen shake" doesn't fit cleanly into pure state updates. Need a separate event/command system at the render boundary that can grow unwieldy.

---

## Comparison Matrix

| Concern | OOP + HSM | ECS | Functional-Immutable |
|---|---|---|---|
| **Mental model** | Fighter is an object in a state | Fighter is an ID with data bags | Game is a value transformed each frame |
| **Adding characters** | Subclass + override + JSON data | Data tables + prefab function | Data tables + conditionals in functions |
| **Adding moves** | JSON data + maybe new state class | Data table entry | Data table entry |
| **Testability** | Medium — need to mock renderer, setup objects | Good — test systems in isolation with fake entities | Excellent — pure functions, no setup needed |
| **Rollback netcode** | Hard — serialize deep object graph | Medium — snapshot flat component arrays | Trivial — states are already immutable values |
| **Debugging** | Log state transitions | Log component changes per system | Inspect any frame's complete state snapshot |
| **Prototype speed** | Fastest to get running | Medium — need ECS scaffolding first | Medium — need immutable update helpers first |
| **Code familiarity** | Most developers know this | Game developers know this | Fewer developers have done this in games |
| **2-player fighting game fit** | Natural fit, this is how most FGs are built | Over-engineered for 2 entities | Excellent fit for the domain (determinism, rollback) |

## Recommendation for Prototyping

**Start with Architecture 1 (OOP + HSM)** for the fastest path to a playable prototype. It matches how fighting games are traditionally reasoned about and will feel natural.

**Switch to Architecture 3 (Functional-Immutable)** when adding netcode. Rollback is the hard problem in fighting game networking, and immutable state makes it dramatically simpler. The refactor from OOP to functional is also well-bounded — the core types (frame data, hitboxes, state IDs) transfer directly; you're mainly reorganizing where mutation happens.

**Use Architecture 2 (ECS)** only if the game expands beyond 1v1 — tag team, assists, many projectiles, stage hazards. ECS pays off when entity count and variety grows, not for the core 2-fighter interaction.
