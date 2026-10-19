/**
 * A Session drives the simulation. LocalSession runs ticks from the frame clock;
 * LockstepSession (multiplayer) only runs ticks whose command turns have arrived from
 * the host. Game code talks to both through this interface.
 */
import type { World, SimEvent } from '../sim/world';
import type { Command, CommandBody } from '../sim/commands';
import { DT } from '../sim/defs';

export interface Session {
  readonly world: World;
  readonly local: number;
  readonly multiplayer: boolean;
  speed: number;
  paused: boolean;
  /** Human-readable status when the sim is stalled (e.g. waiting for a peer). */
  status: string;
  onTick: (events: SimEvent[]) => void;
  issue(cmd: CommandBody): void;
  /** Advance with real time; returns the interpolation alpha in [0, 1). */
  advance(dt: number): number;
  dispose(): void;
}

export class LocalSession implements Session {
  readonly multiplayer = false;
  speed = 1;
  paused = false;
  status = '';
  onTick: (events: SimEvent[]) => void = () => {};
  private acc = 0;
  private pending: Command[] = [];

  constructor(
    readonly world: World,
    readonly local: number,
  ) {}

  issue(cmd: CommandBody) {
    this.pending.push({ ...cmd, c: this.local } as Command);
  }

  advance(dt: number): number {
    if (this.paused) return this.acc / DT;
    this.acc += dt * this.speed;
    let steps = 0;
    // Never spiral: cap catch-up work per frame.
    while (this.acc >= DT && steps < 12) {
      const cmds = this.pending;
      this.pending = [];
      this.world.step(cmds);
      this.onTick(this.world.events);
      this.acc -= DT;
      steps++;
    }
    if (steps >= 12) this.acc = Math.min(this.acc, DT);
    return this.acc / DT;
  }

  dispose() {}
}
