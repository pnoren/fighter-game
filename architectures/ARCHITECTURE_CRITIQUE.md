# Architecture Critique — Senior Game Engine Developer Review

---

## Preamble: What Fighting Games Actually Demand

Before tearing into these architectures, let me establish what makes fighting games architecturally unusual compared to most game genres:

1. **Frame-perfect determinism is non-negotiable.** A 1-frame difference in hitbox activation is a bug that competitive players *will* find and exploit. The architecture must make it trivially easy to verify that frame N always produces the same result given the same inputs.

2. **The cancel system is the real complexity, not the state machine.** Every architecture doc focuses on "idle → walk → attack." That's the easy part. The hard part is: "cr.LK chains into cr.LP on hit only, which cancels into 236P on hit or block, which can be Roman Cancelled on frames 3-15 if meter ≥ 50%, and the RC window is different on whiff." *That's* where architectures live or die.

3. **Two-player interaction is the core loop, not an edge case.** Throws, clash, proximity blocking, cross-up detection — these all require both fighters' states simultaneously. Any architecture that treats fighters as independent entities that only interact at collision time is lying to itself about the problem domain.

4. **Rollback netcode is now table stakes.** Any architecture designed in 2026 that doesn't account for snapshotting and restoring game state at 60fps is already outdated for anything beyond a local-only prototype.

---

## Architecture 1: OOP + Hierarchical State Machines

### Extensibility

**Adding characters:** The document says "create NewChar.ts extending Fighter." This is where things go wrong in practice. By character 5, `Fighter` has accrued fields for meter, burst gauge, install state, guard gauge, and whatever character 4 needed as a special resource. By character 10, the constructor takes 30 parameters or a config blob that's effectively untyped. Ryu doesn't need a puppet gauge. Zato doesn't need a charge timer. But they all share the base class, so they all carry the dead weight.

The real problem: **the subclass doesn't pull its weight.** If frame data already lives in JSON, and states already read from that JSON, what does `Ryu extends Fighter` actually *do*? Override `getMoveList()`? That's a lookup key, not behavior. Character-specific states? Those are already separate classes. The inheritance buys almost nothing — it's ceremony masquerading as architecture.

**Adding moves:** This is actually decent. JSON frame data + existing `AttackState` handles the 90% case. But the document glosses over the 10%: moves with multi-hit properties (Chun-Li's Lightning Legs), moves that change hitbox mid-animation (Dhalsim's extending limbs), moves that alter physics (dive kicks), projectile-spawning moves, command grabs that initiate a cinematic sequence. Each of these needs a new `AttackState` subclass, and the state hierarchy starts to contort.

### Complex Animations and Combos

The combo system is the biggest omission. The document mentions "cancel window open" in passing during the collision flow, but this is actually the hardest subsystem in the entire game. Where does the cancel table live? Who checks it? The current design has `AttackState` checking the input buffer for motion inputs — but cancel rules depend on:

- Whether the current move hit, was blocked, or whiffed
- Which specific move is active (not just "an attack")
- Meter state
- Character-specific conditions (install mode, stance)
- How far into recovery you are (kara-cancels use early frames)

Cramming all this into `AttackState.update()` creates a god method. Extracting it creates a parallel system that fights the state machine for authority.

Animation sync is stated as "animation is slave to gameplay," which is correct. But the document doesn't address animation blending. When you cancel a crouching heavy into a standing special, there's a visual transition that needs to happen. In OOP, this usually means `AnimationPlayer` grows its own stateful complexity (blend trees, transition rules) that duplicates and potentially conflicts with the game state machine.

### Risk of Mess Over Time

**High.** The hierarchy is the trap. Here's the typical lifecycle:

1. Month 1: Clean HSM. GroundedState, AirborneState, AttackState. Elegant.
2. Month 3: Character 3 needs an air dash. AirborneState gets an `if (this.fighter.canAirDash)` check. Character 4 needs a double jump. Another conditional.
3. Month 6: "Almost but not quite shared" behavior. Copy-paste starts. `CharacterSpecificGroundedState` variants appear.
4. Month 9: Cross-cutting mechanic (Roman Cancel) added. Every attack state needs an exit path to RC. 15+ state classes modified.
5. Month 12: Nobody touches `GroundedState` without fear.

The hierarchical state machine is the best Day 1 architecture and one of the worst Day 365 architectures for fighting games specifically.

### Debugging

Best of the three for *local* debugging. State transitions are explicit, named, and loggable. "Fighter entered HeavyAttackState at frame 1042" is immediately meaningful. You can breakpoint `enter()` and see the full call stack.

Falls apart for *networked* debugging because the state is hard to snapshot, diff, or replay.

---

## Architecture 2: ECS

### Extensibility

**Adding characters:** The document's claim that you need "zero new classes or systems" is optimistic to the point of being misleading. It holds for characters that are purely data variations (different frame data, same mechanics). It collapses for characters with unique mechanics.

Consider Guilty Gear's Zato-1. He has a shadow puppet that acts semi-independently, controlled by negative edge (button release = puppet action). In ECS, this means:
- A new entity for the puppet (fine)
- A new `NegativeEdgeInputSystem` or modifications to `InputSystem` (not fine — you're now special-casing a system for one character)
- A new `PuppetLinkComponent` to tie puppet and player together
- Logic in `StateTransitionSystem` to handle "player and puppet are in different states simultaneously"

You've now added a character-specific system, a character-specific component, and character-specific branches in a general system. The ECS hasn't saved you from character-specific complexity — it's just spread it across more files.

**Adding moves:** Genuinely good here. A new move is a data table entry, and the systems process it generically. This is ECS at its best: when the *structure* of the data is uniform and only the *values* vary.

### Complex Animations and Combos

The cancel system problem is even worse here than in OOP. The `StateTransitionSystem` reads a transition table, but cancel rules aren't simple transitions. They're conditional transitions gated on:
- A different system's output (did CollisionSystem report a hit this frame?)
- Temporal state (which frame of the move are we on?)
- Resource state (meter)
- Opponent state (are they in blockstun or hitstun?)

This means `StateTransitionSystem` either becomes a monolith that reads half the component types in the world, or you split cancel logic into its own system that runs at a very specific point in the system order — between `CollisionSystem` and... what? The system ordering diagram has 12 steps and no cancel system. That's not an oversight in the document; it's a genuine design problem. Cancel logic doesn't fit cleanly into ECS's "systems process one concern" model because cancels *are* the intersection of multiple concerns.

### Risk of Mess Over Time

**Medium-high, but differently than OOP.** ECS mess isn't inheritance spaghetti — it's *invisible coupling through execution order and shared components.*

The FSM component is the canary. It starts as `{ current: StateID, frameInState: number }`. Then it grows: `{ current, frameInState, previousState, canCancel, cancelWindow, hitConfirmed, comboCounter, ... }`. At some point you realize this component is a state machine pretending to be a data bag. You've reinvented OOP states, just worse, because the logic is scattered across 5 systems instead of being in one state class.

The other mess vector: **marker component proliferation.** SuperArmor, CounterHitState, AirActionUsed, HasAirDashed, WallBounceUsed, OTGUsed... each one is a tiny boolean that some system checks. They're the ECS equivalent of boolean flags on a god object, just distributed across the component store.

### Debugging

The document says debugging is harder, and that's an understatement. Here's a concrete scenario:

*"Player pressed heavy punch but the move didn't come out."*

Debugging path:
1. Check `InputSystem` — did the input reach `InputState`? (Correct: yes)
2. Check `StateTransitionSystem` — did the transition table match? (Correct: yes, transition to attack)
3. Check `HitstunSystem` — wait, did this run *before* `StateTransitionSystem` and clear a hitstun that should have prevented the transition? Or did it run after and *not yet* clear the hitstun? (Problem found: system order bug)

System order bugs are the worst kind of bug in ECS because they're correct-looking in every system and only wrong in aggregate. They also don't reproduce with breakpoints in a single system because the bug *is* the between-system boundary.

---

## Architecture 3: Functional-Immutable

### Extensibility

**Adding characters:** The document says "add handling in the relevant pure functions with a simple conditional on characterId." Let's be honest about what this becomes at scale:

```typescript
function transition(fsm: FsmState, buffer: InputCommand[], fighter: FighterState): FsmState {
  // 200 lines of generic transition logic

  if (fighter.characterId === "zato") {
    // 80 lines of puppet logic
  }
  if (fighter.characterId === "potemkin") {
    // 40 lines of hammerfall brake logic
  }
  // ... repeat for every character with unique mechanics
}
```

This is the *Strategy pattern expressed as switch statements*, which is worse than the OOP version because at least OOP puts the character-specific logic in a character-specific file. The functional version puts it all in `transition.ts`, which grows without bound.

**The fix is obvious:** make the transition function dispatch to character-specific sub-functions via a lookup table. But now you've reinvented virtual dispatch with extra steps. The functional architecture doesn't eliminate the need for polymorphism — it just forces you to implement it manually.

**Adding moves:** Same quality as ECS — purely data-driven, generic systems handle it. Best-in-class for the common case.

### Complex Animations and Combos

The update pipeline is deceptively clean because it processes phases sequentially: buffer → transition → movement → gravity → attack → collision → damage → pushbox. But combos break this linearity.

Consider: Fighter A's attack hits Fighter B. The collision phase produces a HitEvent. The damage phase applies hitstun. But now Fighter A needs to know the hit was confirmed — *this frame* — to open a cancel window. That information flows backwards: collision (phase 6) informs transition logic (phase 2) for *next* frame. This one-frame delay is actually correct for fighting games (hit confirm on reaction is a skill), but it means the cancel system lives awkwardly between frames:

```
Frame N:   attack → collision → hit event produced
Frame N+1: transition reads "hit confirmed" flag → cancel window opens
```

The FighterState needs a `hitConfirmed: boolean` or `lastHitFrame: number` field that's set in phase 7 and read in phase 2 of the next frame. This is fine, but it means the "pure pipeline within a single frame" is somewhat illusory — there's implicit cross-frame state coupling.

The bigger problem: **throws.** A throw in a fighting game is:
1. Fighter A enters throw startup (phase 2)
2. Check if Fighter B is in a throwable state AND in range (needs both fighters — breaks the `fighters.map()` pattern)
3. If successful: both fighters enter a synchronized cinematic state for 20+ frames
4. During the throw animation, both fighters' positions are locked relative to each other

This requires `updateFighter` to take the opponent's state, which the document acknowledges (`updateFighter.ts — (FighterState, Input, OpponentState) → FighterState`). But now you can't `fighters.map()` independently in phases 2-5. You need:

```typescript
const [f0, f1] = fighters
const f0_new = updateFighter(f0, inputs[0], f1)
const f1_new = updateFighter(f1, inputs[1], f0)  // f0, not f0_new — simultaneous resolution
```

This is solvable but it's a recurring friction point. Every new mechanic that involves both fighters (proximity block, cross-up detection, pushbox resolution) forces you out of the clean map pattern into explicit pair logic.

### Risk of Mess Over Time

**Medium-low for game logic, medium-high for the render boundary.**

Game logic stays remarkably clean because immutability prevents the "who mutated this?" class of bugs entirely. Pure functions don't accrue hidden state. When a function gets too big, you extract a helper — and that helper is also pure and testable. The refactoring story is genuinely excellent.

The mess accumulates at the **side-effect boundary**: rendering, audio, particles, screen shake, hit stop. These are all reactive — they respond to events in the game state. The document puts events in `GameState.events` and says "consumed by render for VFX/SFX." In practice this becomes:

```typescript
function render(ctx, state) {
  // ...draw stuff...

  for (const event of state.events) {
    if (event.type === "hit") {
      spawnParticles(event.position, event.strength)  // stateful!
      shakeScreen(event.hitstop)                       // stateful!
      playSound(event.soundId)                         // stateful!
      freezeFrame(event.hitstop)                       // affects GAME LOOP TIMING
    }
  }
}
```

Hit stop (both players freeze for N frames on a heavy hit) is especially nasty. It's a gameplay mechanic disguised as a visual effect. It needs to be in the game state (to be deterministic for rollback), but it *feels* like it belongs in the renderer. This boundary gets blurry, and that's where functional architectures accumulate debt.

### Debugging

The best of the three by a wide margin, with one caveat.

**The good:** Any frame's state is a complete, serializable, inspectable value. You can build a debugging UI that shows the entire game state as a tree. You can save a state, hand-edit it, resume from it. You can diff frame N and frame N+1 to see exactly what changed. You can write a test that says "given this exact game state and these inputs, the result must be this exact game state." This is unmatched.

**The caveat:** When the state tree gets deep and a field is wrong, you need to trace through the update pipeline to find *which phase* set it wrong. With immutable state, there's no mutation breakpoint — you can't say "break when `fighter.health` changes." You have to add logging at each phase or use a lens that tracks provenance. Not a dealbreaker, but it's a different debugging discipline than most developers are used to.

---

## Rankings

### 1. Extensibility (Adding Characters / Moves)

| Rank | Architecture | Rationale |
|------|-------------|-----------|
| 1 | ECS | Best separation of "data shape" from "behavior." Adding a move is purely additive. New mechanics via new components without touching existing systems (when the mechanic is truly orthogonal). |
| 2 | Functional | Equally good for moves (data-driven). Falls behind for characters because unique mechanics become switch-statement branches in shared functions. |
| 3 | OOP + HSM | Moves are fine (JSON data). Characters seem easy but inheritance becomes a trap. The 5th character is pleasant; the 15th is painful. |

### 2. Handling Complex Animations and Combos

| Rank | Architecture | Rationale |
|------|-------------|-----------|
| 1 | OOP + HSM | The state machine is the natural home for combo logic. "Can cancel from this state into these states" is literally what state machines do. The problem is *scale*, not *fit*. |
| 2 | Functional | Sequential update pipeline maps well to fighting game frame logic. Cancel rules are data-driven. Cross-frame state coupling is explicit, which is actually good for reasoning about combos. |
| 3 | ECS | Cancel logic doesn't have a natural home. It's the intersection of input, state, collision, and timing — the exact thing ECS is worst at. Ends up as a monolith system anyway. |

### 3. Risk of Becoming Messy

| Rank | Architecture | Rationale |
|------|-------------|-----------|
| 1 | Functional | Immutability is the strongest structural defense against mess. Pure functions can't accrue hidden state. The mess that does accumulate (side-effect boundary) is contained to a known location. |
| 2 | ECS | Mess is distributed (system order coupling, marker component sprawl, FSM component bloat) but at least it's discoverable through component/system auditing. |
| 3 | OOP + HSM | Mess is inevitable and structural. Inheritance hierarchies rot. Cross-cutting concerns have no good home. God objects emerge naturally. |

### 4. Ease of Debugging

| Rank | Architecture | Rationale |
|------|-------------|-----------|
| 1 | Functional | Full state snapshots, deterministic replay, diffable frames. The gold standard for debugging frame-sensitive games. |
| 2 | OOP + HSM | Named state transitions are immediately meaningful. Breakpoints work intuitively. Falls apart for network/replay debugging. |
| 3 | ECS | System-order bugs are invisible in isolation. Requires whole-frame tracing. The most likely architecture to produce bugs that "shouldn't be possible." |

### Overall Ranking

| Rank | Architecture | Score Profile |
|------|-------------|---------------|
| **1** | **Functional-Immutable** | Wins debugging and mess-resistance decisively. Competitive on extensibility. Combo handling is good with minor friction on cross-fighter mechanics. The right long-term architecture for a competitive fighting game. |
| **2** | **OOP + HSM** | Best intuition and fastest to prototype. Combo logic is natural. But the inheritance tax comes due eventually, and rollback is a serious retrofit. Good for proving the game is fun; bad for shipping it. |
| **3** | **ECS** | The wrong tool for this job. Pays complexity costs for scaling benefits (many entities) that a fighting game doesn't need. The FSM-in-ECS impedance mismatch is a persistent source of friction. Would only rank higher if the game expands to 4-player, tag team, or heavy stage-hazard formats. |

---

## Suggested Improvements

### For Architecture 1 (OOP + HSM)

**Replace inheritance with composition for fighters.** `Fighter` should not be a base class. It should be a concrete class that *has* a `CharacterDef` (data) and a `MechanicSet` (behaviors). Character-specific mechanics become plugins, not subclasses:

```
Fighter {
  characterDef: CharacterDef        // frame data, move list — pure data
  mechanics: CharacterMechanic[]    // charge tracking, puppet control — behaviors
  stateMachine: StateMachine        // generic, data-driven transitions
}
```

**Extract a CancelSystem.** Don't let `AttackState` own cancel logic. Create a dedicated `CancelTable` (data) and `CancelResolver` (logic) that the state machine consults. This is the single highest-value refactor for long-term maintainability.

**Make state serializable.** Every state should implement `serialize(): StateSnapshot` and `static deserialize(snapshot): State`. This is painful to retrofit but necessary for rollback and replay.

### For Architecture 2 (ECS)

**Don't use pure ECS. Use an archetypal ECS with bundles.** Define archetypes like `FighterBundle = [Position, Velocity, Health, FSM, InputState, ...]` so that "what components does a fighter have?" is answered in one place, not scattered across prefab functions.

**Accept the FSM as a first-class concept, not a component.** The FSM component will grow to hold half the game state. Instead, make the state machine a proper subsystem with its own internal structure, and let ECS handle the parts it's good at (spatial queries, component-based filtering for projectiles/hazards).

**Introduce explicit system phases.** Instead of a flat list of 12 systems, group them: `InputPhase → SimulationPhase → CollisionPhase → ReactionPhase → RenderPhase`. This makes the ordering less fragile and gives cancel logic a defined home (between Collision and Reaction phases).

### For Architecture 3 (Functional-Immutable)

**Use Immer or a custom produce() function.** The nested spread problem is real and it will erode developer morale. A structural sharing library pays for itself immediately:

```typescript
const next = produce(fighter, draft => {
  draft.activeMove.currentFrame += 1
  draft.meter += 5
})
```

This preserves immutability semantics while making updates readable.

**Model cross-fighter interactions explicitly.** Don't pretend fighters update independently. Add a dedicated `resolveInteractions(f0, f1) → [f0', f1']` phase that handles throws, clashes, proximity blocking, and any mechanic requiring both fighters. Make it a named phase in the pipeline so developers know where to put this logic.

**Pull hit stop / hit freeze into game state, not render.** Define a `frozen: number` field on the game state. When `frozen > 0`, the update function skips the simulation phases and just decrements the counter. This keeps determinism intact and prevents the render boundary from leaking gameplay logic.

**Add a lightweight event bus for VFX/audio.** The `events` array in `GameState` works for simple cases but will need structure. Events should be typed, tagged with the frame they occurred on, and consumed/cleared by the render layer. Consider making the render layer stateful (particle systems, audio mixer) while keeping game logic pure — this is an acceptable asymmetry.

---

## Recommended Hybrid Architecture

None of these three architectures is ideal alone. Here's what I'd actually build:

### Core: Functional-Immutable Game State + Data-Driven State Machine + Render Layer with Controlled Mutation

```
┌─────────────────────────────────────────────────────────┐
│                      GAME LOOP                          │
│                                                         │
│  inputs = readInput()           ← side effect boundary  │
│  nextState = simulate(state, inputs)   ← PURE           │
│  history.push(nextState)        ← rollback ring buffer  │
│  renderLayer.sync(nextState)    ← side effect boundary  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Layer 1 — Immutable Game State (from Architecture 3)**

The game state is a single immutable value. This is non-negotiable for rollback, replay, and testability. But simplify the type hierarchy:

```typescript
type GameState = {
  frame: number
  fighters: [FighterState, FighterState]
  projectiles: ProjectileState[]
  roundState: RoundState
  hitstop: number                    // global freeze frames remaining
  events: FrameEvent[]               // consumed by render layer
}

type FighterState = {
  position: Vec2
  velocity: Vec2
  facing: -1 | 1
  health: number
  meter: number
  stun: { type: 'hit' | 'block'; remaining: number } | null
  fsm: { stateId: string; frame: number }
  activeMove: { moveId: string; frame: number; hitConfirmed: boolean } | null
  inputBuffer: InputCommand[]
  characterId: string
  resources: Record<string, number>  // character-specific gauges
  flags: Set<string>                 // "airborne", "armor", "otg-used", etc.
}
```

Key design decisions:
- **`resources: Record<string, number>`** — generic gauge bag. Zato's puppet meter, Potemkin's heat gauge, whatever. No need to extend the type per character.
- **`flags: Set<string>`** — replaces marker components AND boolean fields. Cheaper than a component system and just as queryable. `fighter.flags.has("super-armor")` is as clear as checking for a SuperArmor component.
- **`hitConfirmed`** on the move — explicit cross-frame coupling for cancel logic. No hidden state.

**Layer 2 — Data-Driven State Machine (best of Architecture 1)**

State transitions are defined in data, not code:

```typescript
type TransitionRule = {
  from: string | string[]           // state(s) this rule applies in
  input: InputPattern               // what the player must input
  to: string                        // target state
  moveId?: string                   // if transitioning into an attack
  conditions?: Condition[]          // "grounded", "meter >= 50", "hitConfirmed"
  priority?: number                 // higher priority wins ties
}

type CancelRule = {
  from: string                      // the move being cancelled from
  into: string[]                    // moves that can cancel into
  window: [number, number]          // frame range where cancel is allowed
  onHit: boolean                    // only if the move connected
  onBlock: boolean                  // only if the move was blocked
  onWhiff: boolean                  // even if the move missed
}
```

The state machine itself is a pure function:

```typescript
function resolveTransition(
  fighter: FighterState,
  opponent: FighterState,  // needed for proximity block, throw checks
  rules: TransitionRule[],
  cancelRules: CancelRule[]
): FighterState
```

This keeps the intuitive mental model of HSM (states with transitions) without inheritance. Adding a move = adding data. Adding a cancel route = adding data. The state machine engine is generic.

**Layer 3 — Phased Simulation Pipeline (improved Architecture 3)**

```typescript
function simulate(state: GameState, inputs: [Input, Input]): GameState {
  if (state.hitstop > 0) {
    return { ...state, hitstop: state.hitstop - 1, events: [] }
  }

  return pipe(state,
    bufferInputs(inputs),
    resolveInteractions,          // throws, clashes — BOTH fighters at once
    transitionStates,             // FSM transitions from data tables
    applyMovement,
    applyGravity,
    advanceAttacks,               // frame counters, hitbox activation
    resolveCollisions,            // hitbox/hurtbox overlap → events
    applyHitEvents,               // damage, hitstun, meter gain
    resolveCancels,               // check cancel windows, buffer next move
    resolvePushboxes,
    advanceFrame
  )
}
```

Key difference from pure Architecture 3: **`resolveInteractions` runs early and handles both fighters together.** This is where throws, proximity blocking, cross-ups, and clashes live. It's not `fighters.map()` — it's explicit pair logic, and that's OK.

**Layer 4 — Stateful Render Layer (pragmatic concession)**

The render layer is allowed to be stateful and mutable. It owns:
- Particle systems
- Audio mixer
- Screen shake state
- Animation blend state
- Hit spark lifetimes

It syncs from `GameState` each frame:

```typescript
class RenderLayer {
  sync(state: GameState) {
    for (const fighter of state.fighters) {
      this.animators[i].syncTo(fighter.fsm.stateId, fighter.activeMove, fighter.fsm.frame)
    }
    for (const event of state.events) {
      this.handleEvent(event)  // spawn particles, play sounds, etc.
    }
    this.draw()
  }
}
```

This is a deliberate firewall: game logic is pure and deterministic (for rollback), presentation is stateful and lossy (fine — re-sync from any game state and the visuals converge in 1-2 frames).

**Layer 5 — Character Definition as Pure Data (best of ECS philosophy)**

```typescript
const RYU: CharacterDef = {
  id: "ryu",
  moves: {
    "st.LP": { startup: 4, active: 3, recovery: 7, damage: 30, ... },
    "cr.HP": { startup: 7, active: 4, recovery: 18, damage: 90, ... },
    "236P":  { startup: 12, active: 3, recovery: 22, damage: 70, type: "projectile", ... },
  },
  transitions: [
    { from: "idle", input: "6", to: "walkForward" },
    { from: "idle", input: "LP", to: "attack", moveId: "st.LP" },
    { from: ["idle", "walk*"], input: "236P", to: "attack", moveId: "236P" },
    // ...
  ],
  cancels: [
    { from: "st.LP", into: ["st.MP", "cr.MP"], window: [0, 99], onHit: true, onBlock: true, onWhiff: false },
    { from: "st.LP", into: ["236P", "214K"], window: [0, 99], onHit: true, onBlock: true, onWhiff: true },
    // ...
  ],
  resources: {},  // character-specific gauges defined here
  mechanics: [],  // hooks for character-specific logic
}
```

Adding a character is: define this object + provide sprite assets. No classes. No inheritance. No systems. For 90% of characters, `mechanics: []` stays empty.

For the 10% that need custom logic (Zato, Ice Climbers), `mechanics` is an array of named hooks that the simulation pipeline calls at defined extension points:

```typescript
type CharacterMechanic = {
  id: string
  phase: "preTransition" | "postTransition" | "onHit" | "onHurt" | ...
  apply: (fighter: FighterState, context: MechanicContext) => FighterState
}
```

These are pure functions that slot into the pipeline. They're isolated, testable, and don't pollute the generic logic. This is the Strategy pattern done right — explicit dispatch points, pure function implementations, data-driven registration.

### Why This Hybrid Works

| Concern | How the hybrid handles it |
|---|---|
| **Rollback** | Immutable game state. Snapshot = store the value. Restore = use it. Trivial. |
| **Adding moves** | Add an entry to the character's `moves` and `cancels` objects. Zero code changes. |
| **Adding characters** | Define a `CharacterDef` object. For standard characters, no code. For unique mechanics, add pure function hooks. |
| **Combos / cancels** | First-class `CancelRule` data type with explicit windows, hit/block/whiff conditions. The simulation pipeline has a dedicated `resolveCancels` phase. |
| **Cross-fighter interaction** | Dedicated `resolveInteractions` phase that takes both fighters. No pretending they're independent. |
| **Debugging** | Full state snapshots from the functional core. State diffs between frames. Deterministic replay. Named pipeline phases for tracing. |
| **Animation** | Render layer syncs from game state. Animation never drives gameplay. Blend/transition is a presentation concern, kept out of simulation. |
| **Mess resistance** | Pure functions in the core prevent hidden state. Character-specific logic isolated in named mechanic hooks. Cancel rules in data, not code. The only mutable layer is presentation, which is inherently lossy and resyncable. |
| **Prototype speed** | Start with `simulate` as a single function with inline phases. Extract phases as they grow. The architecture supports incremental complexity — you don't need all of this on day 1. |

### What This Gives Up

- **Not a "pure" anything.** Functional purists will object to the mutable render layer. ECS advocates will miss the query system. OOP devs will want classes. The hybrid is pragmatic, not ideological.
- **The mechanics hook system could become a mini-plugin architecture** if not kept disciplined. Limit it to the defined extension points. Don't let it become a generic event system.
- **The `flags: Set<string>` is stringly-typed.** Use a union type or enum in practice — the document uses strings for readability.
