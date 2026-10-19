/**
 * Selection panel: portrait, health, status, production queue, and context actions.
 */
import type { Game } from '../../game/Game';
import type { Building, Entity, Unit } from '../../sim/entities';
import { RESEARCH, STRIKES, TIER_UPGRADE, UNITS, type StrikeKind } from '../../sim/defs';
import { h, svgIcon, type ICONS } from '../dom';
import { digits, loc, num, t, type I18nKey } from '../../i18n';
import { thumb } from '../thumbs';
import { audio } from '../../audio/audio';

type IconName = keyof typeof ICONS;

export class SelectionPanel {
  readonly root: HTMLElement;
  private info: HTMLDivElement;
  private actions: HTMLDivElement;
  private sig = '';
  private live: (() => void)[] = [];

  constructor(readonly game: Game) {
    this.info = h('div', { class: 'sel-info' });
    this.actions = h('div', { class: 'sel-actions' });
    this.root = h('section', { class: 'selpanel' }, this.info, this.actions);
  }

  private act(icon: IconName, label: I18nKey, fn: () => void, opts: { hot?: string; active?: boolean; disabled?: boolean; danger?: boolean } = {}) {
    return h(
      'button',
      {
        class: `act${opts.active ? ' active' : ''}${opts.danger ? ' danger' : ''}`,
        title: t(label) + (opts.hot ? ` [${opts.hot}]` : ''),
        disabled: opts.disabled,
        onclick: () => {
          audio.play('click');
          fn();
        },
      },
      svgIcon(icon),
      h('span', { class: 'lbl' }, t(label)),
      opts.hot ? h('kbd', null, opts.hot) : null,
    );
  }

  hotkey(code: string, _e: KeyboardEvent): boolean {
    const ctl = this.game.ctl;
    if (code === 'KeyX') {
      const s = ctl.selectedUnits().find((u) => u.def.strike);
      if (s) {
        ctl.beginStrike(s, s.def.strike!);
        return true;
      }
    }
    return false;
  }

  refresh() {
    this.sig = '';
    this.update();
  }

  update() {
    const ctl = this.game.ctl;
    const sel = ctl.selected();
    const sig = sel.map((e) => e.id).join(',') + '|' + ctl.mode.kind;
    if (sig !== this.sig) {
      this.sig = sig;
      this.render(sel);
    }
    for (const fn of this.live) fn();
  }

  private render(sel: Entity[]) {
    this.live = [];
    this.info.replaceChildren();
    this.actions.replaceChildren();
    this.root.classList.toggle('empty', sel.length === 0);
    const game = this.game;
    const ctl = game.ctl;
    if (!sel.length) {
      // Quick access when nothing is selected.
      this.actions.append(
        this.act('builder', 'hud.idleBuilders', () => {
          ctl.selectAll((u) => !!u.def.builder && u.order === 'idle');
          if (!ctl.selection.size) ctl.selectAll((u) => !!u.def.builder);
          ctl.focusSelection();
        }, { hot: '.' }),
        this.act('users', 'hud.selectArmy', () => ctl.selectAll((u) => !u.def.builder && u.def.weapons.length > 0)),
        this.act('home', 'bld.hq', () => {
          const c = game.world.countries[game.session.local];
          game.view.rig.focus(c.startX, c.startZ, 14);
        }),
      );
      return;
    }
    const first = sel[0];
    if (sel.length === 1) this.single(first);
    else this.group(sel);
    // Actions
    const units = sel.filter((e): e is Unit => e.isUnit && e.owner === game.session.local);
    if (units.length) {
      const mode = ctl.mode.kind;
      this.actions.append(
        this.act('crosshair', 'hud.attackMove', () => ctl.setMode(mode === 'attackMove' ? { kind: 'normal' } : { kind: 'attackMove' }), { hot: 'A', active: mode === 'attackMove' }),
        this.act('stop', 'hud.stop', () => ctl.stop(), { hot: 'S' }),
        this.act('hold', 'hud.hold', () => ctl.hold(), { hot: 'H' }),
      );
      if (units.some((u) => u.def.deploy)) this.actions.append(this.act('deploy', 'hud.deploy', () => ctl.deploy(), { hot: 'D' }));
      if (units.some((u) => u.isAir && !u.def.kamikaze)) this.actions.append(this.act('rtb', 'hud.rtb', () => ctl.rtb(), { hot: 'R' }));
      if (units.some((u) => u.def.kamikaze)) this.actions.append(this.act('target', 'hud.kamikaze', () => ctl.setMode({ kind: 'kamikaze' }), { active: mode === 'kamikaze' }));
      const striker = units.find((u) => u.def.strike);
      if (striker) this.strikeButtons(striker);
      this.actions.append(this.act('x', 'hud.cancel', () => ctl.clear()));
    } else if (!first.isUnit && first.owner === game.session.local) {
      const b = first;
      if (b.def.produces) this.actions.append(this.act('rally', 'hud.rally', () => ctl.setMode({ kind: 'rally' }), { active: ctl.mode.kind === 'rally' }));
      if (b.def.strike) this.strikeButtons(b);
      if (b.def.id === 'hq') {
        const c = game.world.countries[b.owner];
        const next = (c.tier + 1) as 2 | 3;
        if (c.tier < 3) {
          const def = TIER_UPGRADE[next];
          const btn = this.act('upgrade', 'hud.upgrade', () => game.session.issue({ k: 'tier' }), { disabled: !!b.upgrade });
          btn.title += ` → T${next} · $${num(def.cost)}M`;
          this.actions.append(btn);
        }
      }
      if (b.def.id !== 'hq') this.actions.append(this.act('sell', 'hud.sell', () => game.session.issue({ k: 'sell', id: b.id }), { danger: true }));
      this.actions.append(this.act('x', 'hud.cancel', () => ctl.clear()));
    }
  }

  private strikeButtons(e: Unit | Building) {
    const ctl = this.game.ctl;
    const c = this.game.world.countries[e.owner];
    const kinds: StrikeKind[] = [e.def.strike!];
    if (e.def.strike === 'ballistic' && c.has('hypersonic')) kinds.push('hypersonic');
    for (const k of kinds) {
      const label: I18nKey = k === 'cruise' ? 'hud.strikeCruise' : k === 'ballistic' ? 'hud.strikeBallistic' : 'hud.strikeHypersonic';
      const btn = this.act('missile', label, () => ctl.beginStrike(e, k), { hot: 'X', danger: true });
      const cd = h('i', { class: 'cd' });
      btn.append(cd);
      this.live.push(() => {
        const ready = e.strikeCd <= 0 && (e.isUnit || e.built);
        btn.toggleAttribute('disabled', !ready);
        cd.style.height = ready ? '0%' : `${Math.min(100, (e.strikeCd / (e.def.strikeReload ?? 60)) * 100)}%`;
        btn.title = `${t(label)} · $${num(STRIKES[k].cost)}M · ${num(STRIKES[k].range)} ${t('common.km')}`;
      });
      this.actions.append(btn);
    }
  }

  private single(e: Entity) {
    const game = this.game;
    const w = game.world;
    const owner = w.countries[e.owner];
    const key = e.isUnit ? `unit.${e.def.id}` : `bld.${e.def.id}`;
    const hpFill = h('i');
    const hpText = h('small');
    const status = h('div', { class: 'status' });
    const portrait = h('div', { class: 'portrait', style: `--c:${owner.meta.color}` }, h('img', { src: thumb(key), alt: '' }));
    this.info.append(
      portrait,
      h(
        'div',
        { class: 'meta' },
        h('div', { class: 'name' }, h('b', null, t(key as I18nKey)), h('span', { class: 'owner', style: `--c:${owner.meta.color}` }, loc(owner.meta.name))),
        h('div', { class: 'hp' }, h('span', { class: 'bar' }, hpFill), hpText),
        status,
      ),
    );
    this.live.push(() => {
      const f = Math.max(0, e.hp / e.maxHp);
      hpFill.style.width = `${f * 100}%`;
      hpFill.className = f > 0.6 ? 'ok' : f > 0.3 ? 'mid' : 'low';
      hpText.textContent = `${num(e.hp)}/${num(e.maxHp)}`;
      status.replaceChildren(...this.statusChips(e));
    });
    if (!e.isUnit && e.owner === game.session.local && e.def.produces) {
      const queue = h('div', { class: 'queue' });
      this.info.append(queue);
      let qsig = '';
      this.live.push(() => {
        const s = e.queue.join(',');
        if (s !== qsig) {
          qsig = s;
          queue.replaceChildren(
            ...e.queue.map((k, i) =>
              h(
                'button',
                { class: 'qitem', title: `${t(`unit.${k}` as I18nKey)} — ${t('hud.cancel')}`, onclick: () => game.session.issue({ k: 'cancel', kind: k, at: e.id }) },
                h('img', { src: thumb(`unit.${k}`), alt: '' }),
                i === 0 ? h('i', { class: 'prog' }) : null,
              ),
            ),
          );
        }
        const prog = queue.querySelector<HTMLElement>('.prog');
        if (prog && e.queue[0]) prog.style.width = `${(e.prodTime / UNITS[e.queue[0]].time) * 100}%`;
      });
    }
  }

  private statusChips(e: Entity): HTMLElement[] {
    const out: HTMLElement[] = [];
    const chip = (text: string, cls = '') => h('span', { class: `chip ${cls}` }, text);
    if (e.isUnit) {
      const u = e;
      if (u.vet) out.push(chip('★'.repeat(u.vet) + ' ' + t(u.vet === 1 ? 'hud.veteran' : u.vet === 2 ? 'hud.elite' : 'hud.heroic'), 'gold'));
      if (u.convoy) out.push(chip(t('hud.convoy'), 'blue'));
      if (u.deployed) out.push(chip(t('hud.deploy'), 'green'));
      if (u.fuel !== Infinity) out.push(chip(`⛽ ${Math.round((u.fuel / (u.def.endurance ?? 1)) * 100)}%`));
      for (const ws of u.weapons) if (ws.def.ammo) out.push(chip(`${digits(String(ws.ammo))}/${digits(String(ws.def.ammo))} ${ws.def.id.toUpperCase()}`));
      if (u.def.strike && u.strikeCd > 0) out.push(chip(`${t('hud.reload')} ${digits(String(Math.ceil(u.strikeCd)))}${t('common.sec')}`, 'warn'));
      if (u.emp > 0) out.push(chip('EMP', 'bad'));
      const r = u.def.weapons.reduce((m, w) => Math.max(m, w.range), 0);
      if (r) out.push(chip(`${t('hud.range')} ${digits(r >= 10 ? String(Math.round(r)) : r.toFixed(1))} ${t('common.km')}`));
    } else {
      const b = e;
      if (!b.built) out.push(chip(`${Math.round(b.progress * 100)}%${b.workers ? '' : ' · ' + t('hud.needBuilder')}`, b.workers ? 'blue' : 'warn'));
      if (b.research) {
        const r = RESEARCH.find((x) => x.id === b.research)!;
        out.push(chip(`${t('hud.researching')}: ${t(`res.${r.id}` as I18nKey)} ${Math.round((b.researchT / r.time) * 100)}%`, 'blue'));
      }
      if (b.upgrade) out.push(chip(`${t('hud.upgrading')} T${digits(String(b.upgrade))} ${Math.round((b.upgradeT / TIER_UPGRADE[b.upgrade as 2 | 3].time) * 100)}%`, 'blue'));
      if (b.def.strike) out.push(chip(b.strikeCd > 0 ? `${t('hud.reload')} ${digits(String(Math.ceil(b.strikeCd)))}${t('common.sec')}` : t('hud.ready'), b.strikeCd > 0 ? 'warn' : 'green'));
      if (b.def.power) out.push(chip(`${b.def.power > 0 ? '+' : ''}${num(b.def.power)} ${t('common.mw')}`));
      if (b.oilField >= 0) out.push(chip(`${digits((this.game.world.oil[b.oilField].rich * 1.5 * 60).toFixed(0))} ${t('common.bbl')}${t('hud.perMin')}`));
    }
    return out;
  }

  private group(sel: Entity[]) {
    const counts = new Map<string, Entity[]>();
    for (const e of sel) {
      const k = (e.isUnit ? 'unit.' : 'bld.') + e.def.id;
      const arr = counts.get(k) ?? [];
      arr.push(e);
      counts.set(k, arr);
    }
    const grid = h('div', { class: 'groupgrid' });
    for (const [k, arr] of counts) {
      grid.append(
        h(
          'button',
          { class: 'gitem', title: t(k as I18nKey), onclick: () => this.game.ctl.selectIds(arr.map((e) => e.id)) },
          h('img', { src: thumb(k), alt: '' }),
          h('b', null, digits(String(arr.length))),
        ),
      );
    }
    this.info.append(h('div', { class: 'groupcount' }, `${digits(String(sel.length))} ${t('hud.selected')}`), grid);
  }
}
