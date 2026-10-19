import type { I18nKey } from '../i18n';
import type { World } from './World';
import { type AchievementId, type Profile, unlock } from '../meta/profile';

export interface Objective {
  id: string;
  key: I18nKey;
  reward: number;
  done: boolean;
  check: (w: World) => boolean;
}

const playerBuilt = (w: World, kind: Parameters<World['hasBuilding']>[1]) => w.hasBuilding(w.playerTeam, kind);

/** Guided objectives (tutorial-ish progression with credit rewards) + achievement tracking. */
export class Progression {
  readonly objectives: Objective[] = [
    { id: 'power', key: 'obj.power', reward: 200, done: false, check: (w) => playerBuilt(w, 'power') },
    { id: 'barracks', key: 'obj.barracks', reward: 200, done: false, check: (w) => playerBuilt(w, 'barracks') },
    { id: 'derrick', key: 'obj.derrick', reward: 300, done: false, check: (w) => playerBuilt(w, 'derrick') },
    { id: 'sell', key: 'obj.sell', reward: 150, done: false, check: (w) => w.teams[w.playerTeam].stats.oilSold > 0 },
    { id: 'army', key: 'obj.army', reward: 400, done: false, check: (w) => w.teams[w.playerTeam].stats.unitsBuilt >= 8 },
    { id: 'city', key: 'obj.city', reward: 500, done: false, check: (w) => w.cities.some((c) => c.owner === w.playerTeam) },
    { id: 'factory', key: 'obj.factory', reward: 400, done: false, check: (w) => playerBuilt(w, 'factory') },
    { id: 'derricks3', key: 'obj.derricks3', reward: 600, done: false, check: (w) => w.teamBuildings(w.playerTeam, 'derrick').length >= 3 },
    { id: 'destroy', key: 'obj.destroy', reward: 600, done: false, check: (w) => w.teams[w.playerTeam].stats.buildingsDestroyed > 0 },
    { id: 'silo', key: 'obj.silo', reward: 800, done: false, check: (w) => playerBuilt(w, 'silo') },
  ];
  private timer = 0;
  onObjective: (o: Objective) => void = () => {};
  onAchievement: (id: AchievementId) => void = () => {};
  readonly earned: AchievementId[] = [];

  constructor(private world: World, private profile: Profile) {
    world.on((e) => {
      const p = world.playerTeam;
      if (e.type === 'kill' && e.team === p && !e.building) this.grant('firstBlood');
      if (e.type === 'intercept' && e.team === p) this.grant('ironDome');
      if (e.type === 'missileHit' && e.team === p) this.grant('nuke');
      if (e.type === 'sold' && e.team === p && e.price >= 100) this.grant('tycoon');
    });
  }

  /** The next few unfinished objectives to show. */
  visible(count = 3) {
    return this.objectives.filter((o) => !o.done).slice(0, count);
  }

  update(dt: number) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 1;
    const w = this.world;
    const team = w.teams[w.playerTeam];
    for (const o of this.objectives) {
      if (o.done || !o.check(w)) continue;
      o.done = true;
      team.credits += o.reward;
      this.onObjective(o);
    }
    if (w.teamBuildings(w.playerTeam, 'derrick').length >= 5) this.grant('oilBaron');
    if (w.cities.filter((c) => c.owner === w.playerTeam).length >= 5) this.grant('conqueror');
    if (team.stats.kills >= 50) this.grant('annihilator');
  }

  grant(id: AchievementId) {
    if (unlock(this.profile, id)) {
      this.earned.push(id);
      this.onAchievement(id);
    }
  }
}
