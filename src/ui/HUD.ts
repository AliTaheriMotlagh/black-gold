import { BUILD_ORDER, BUILDINGS, ECONOMY, UNIT_ORDER, UNITS, type BuildingKind, type UnitKind } from '../game/config';
import type { Building, Entity, Unit } from '../game/entities';
import type { World } from '../game/World';
import type { Stage } from '../render/Stage';
import type { Controller } from '../input/Controller';
import type { Input } from '../input/Input';
import type { AudioEngine } from '../audio/audio';
import type { Progression } from '../game/objectives';
import type { CrisisInfo } from '../game/events';
import { ACHIEVEMENTS, type AchievementId, achDesc, achName } from '../meta/profile';
import { type I18nKey, fmtTime, loc, num, t } from '../i18n';
import { en } from '../i18n/en';
import { h, svgIcon } from './dom';
import { Minimap } from './Minimap';

type Tab = 'build' | 'units' | 'market';

export interface HUDCallbacks {
  onPause: () => void;
  onSpeed: () => number;
  onFullscreen: () => void;
}

const isKey = (s: string): s is I18nKey => s in en;

export class HUD {
  readonly root: HTMLDivElement;
  readonly minimap: Minimap;
  private tab: Tab = 'build';
  private els!: {
    credits: HTMLElement;
    oil: HTMLElement;
    power: HTMLElement;
    powerWrap: HTMLElement;
    pop: HTMLElement;
    price: HTMLElement;
    trend: HTMLElement;
    spark: HTMLCanvasElement;
    chips: HTMLElement;
    time: HTMLElement;
    speed: HTMLElement;
    tabBody: HTMLElement;
    cmd: HTMLElement;
    tabs: Record<Tab, HTMLButtonElement>;
    sel: HTMLElement;
    toasts: HTMLElement;
    objectives: HTMLElement;
    modebar: HTMLElement;
    fabs: HTMLElement;
    fps: HTMLElement;
    minimapWrap: HTMLElement;
    storm: HTMLElement;
  };
  private cards = new Map<string, { el: HTMLElement; badge: HTMLElement; prog: HTMLElement; kind: string; unit: boolean }>();
  private marketEls: { price: HTMLElement; value: HTMLElement; eff: HTMLElement; chart: HTMLCanvasElement; auto: HTMLElement } | null = null;
  private tick = 0;
  private cache = new Map<string, string>();
  private tooltip: HTMLElement | null = null;
  private selKey = '';
  private selHp: HTMLElement[] = [];
  private selDyn: (() => void) | null = null;
  private fpsAcc = { frames: 0, time: 0 };
  showFps = false;

  constructor(
    private world: World,
    private stage: Stage,
    private ctl: Controller,
    private input: Input,
    private audio: AudioEngine,
    private thumbs: Record<string, string>,
    private progression: Progression,
    private cb: HUDCallbacks,
  ) {
    this.root = h('div', { class: 'hud' });
    this.minimap = new Minimap(world, stage, ctl);
    this.build();
    ctl.onChange = () => this.onSelection();
  }

  rebuild() {
    this.root.innerHTML = '';
    this.cards.clear();
    this.cache.clear();
    this.selKey = '';
    this.build();
    this.onSelection();
  }

  private build() {
    const credits = h('b', null, '0');
    const oil = h('b', null, '0');
    const power = h('b', null, '0');
    const pop = h('b', null, '0');
    const powerWrap = h('div', { class: 'res power panel', title: t('hud.power') }, svgIcon('power'), power);
    const price = h('span', { class: 'price' }, '$0');
    const trend = h('span', { class: 'trend' }, '');
    const spark = h('canvas', { width: 140, height: 52 });
    const chips = h('div', { class: 'crisis-chips' });
    const time = h('span', null, '0:00');
    const speed = h('span', null, '1×');

    const topbar = h(
      'div',
      { class: 'topbar' },
      h(
        'div',
        { class: 'res-group' },
        h('div', { class: 'res credits panel', title: t('hud.credits') }, svgIcon('credits'), credits),
        h('div', { class: 'res oil panel', title: t('hud.oil') }, svgIcon('oil'), oil),
        powerWrap,
        h('div', { class: 'res pop panel', title: t('hud.pop') }, svgIcon('pop'), pop),
      ),
      h('div', { class: 'ticker panel', title: t('hud.price'), onclick: () => this.setTab('market') }, h('span', { class: 'lbl' }, t('hud.price')), price, trend, spark),
      chips,
      h('div', { class: 'spacer' }),
      h(
        'div',
        { class: 'top-actions' },
        h('div', { class: 'res panel' }, svgIcon('clock'), time),
        h('button', { class: 'btn small', onclick: () => (speed.textContent = `${this.cb.onSpeed()}×`), title: t('hud.speed') }, svgIcon('speed'), speed),
        h('button', { class: 'btn small icon-only', onclick: () => this.cb.onFullscreen(), title: t('menu.fullscreen') }, svgIcon('fullscreen')),
        h('button', { class: 'btn small icon-only', onclick: () => this.cb.onPause(), title: t('menu.paused') }, svgIcon('pause')),
      ),
    );

    // Sidebar / bottom sheet
    const tabs = {
      build: h('button', { class: 'tab', onclick: () => this.setTab('build') }, svgIcon('build'), h('span', { class: 'lbl' }, t('hud.build'))),
      units: h('button', { class: 'tab', onclick: () => this.setTab('units') }, svgIcon('army'), h('span', { class: 'lbl' }, t('hud.units'))),
      market: h('button', { class: 'tab', onclick: () => this.setTab('market') }, svgIcon('market'), h('span', { class: 'lbl' }, t('hud.market'))),
    };
    const tabBody = h('div', { class: 'tab-body' });
    const sel = h('div', { class: 'selpanel panel hidden' });
    const toasts = h('div', { class: 'toasts' });
    const objectives = h('div', { class: 'objectives panel' });
    const modebar = h('div', { class: 'modebar panel', style: 'display:none' });
    const fps = h('div', { class: 'fps' });

    const fab = (icon: Parameters<typeof svgIcon>[0], label: I18nKey, fn: (el: HTMLElement) => void) => {
      const el: HTMLElement = h('button', { class: 'fab', 'aria-label': t(label) }, svgIcon(icon), h('small', null, t(label)));
      el.addEventListener('click', () => {
        this.audio.play('click');
        fn(el);
      });
      return el;
    };
    const fabs = h(
      'div',
      { class: 'fab-row' },
      fab('all', 'hud.selectAll', () => this.ctl.selectAllArmy()),
      fab('box', 'hud.boxSelect', (el) => {
        this.input.boxMode = !this.input.boxMode;
        el.classList.toggle('on', this.input.boxMode);
      }),
      fab('target', 'hud.attackMove', () => this.ctl.startAttackMove()),
      fab('stop', 'hud.stop', () => this.ctl.stop()),
    );

    const rotateHint = h('div', { class: 'rotate-hint panel' }, '↻ Landscape');
    const storm = h('div', { class: 'storm-overlay' });
    // On touch layouts the quick actions live in the bottom bar next to the tabs.
    const cmd = h('div', { class: 'cmd panel' }, h('div', { class: 'tabs' }, tabs.build, tabs.units, tabs.market, fabs), tabBody);
    const minimapWrap = h('div', { class: 'minimap-wrap panel' }, this.minimap.canvas);
    const sidebar = h('div', { class: 'sidebar' }, minimapWrap, cmd);

    this.root.append(storm, topbar, sidebar, sel, objectives, toasts, modebar, fps, rotateHint);
    this.els = { credits, oil, power, powerWrap, pop, price, trend, spark, chips, time, speed, tabBody, cmd, tabs, sel, toasts, objectives, modebar, fabs, fps, minimapWrap, storm };
    fabs.addEventListener('pointerdown', (e) => e.stopPropagation());
    minimapWrap.addEventListener('dblclick', () => minimapWrap.classList.toggle('collapsed'));
    this.setTab(this.tab, true);
    this.renderObjectives();
  }

  private setTab(tab: Tab, force = false) {
    const coarse = window.matchMedia('(max-width: 1100px), (pointer: coarse)').matches;
    if (!force && coarse && this.tab === tab) {
      // On mobile, tapping the active tab collapses the sheet.
      this.setSheet(this.els.cmd.classList.contains('closed'));
      return;
    }
    this.setSheet(true);
    this.tab = tab;
    for (const [k, el] of Object.entries(this.els.tabs)) el.classList.toggle('on', k === tab);
    this.cards.clear();
    this.marketEls = null;
    const body = this.els.tabBody;
    body.innerHTML = '';
    if (tab === 'build') body.append(this.renderBuildGrid());
    else if (tab === 'units') body.append(this.renderUnitGrid());
    else body.append(this.renderMarket());
    this.refreshCards();
    if (!force) this.audio.play('click');
  }

  private setSheet(open: boolean) {
    this.els.cmd.classList.toggle('closed', !open);
    this.root.classList.toggle('sheet-closed', !open);
  }

  private card(key: string, kind: string, unit: boolean, onClick: () => void, onCancel?: () => void) {
    const def = unit ? UNITS[kind as UnitKind] : BUILDINGS[kind as BuildingKind];
    const badge = h('span', { class: 'badge', style: 'display:none' });
    const prog = h('div', { class: 'prog' });
    const el = h(
      'button',
      { class: 'card' },
      prog,
      this.thumbs[kind] ? h('img', { src: this.thumbs[kind], alt: '', draggable: 'false' }) : null,
      h('span', { class: 'name' }, t(`${unit ? 'unit' : 'bld'}.${kind}` as I18nKey)),
      h('span', { class: 'cost' }, `$${num(def.cost)}`, def.oil ? h('span', { class: 'oilc' }, ` · ${num(def.oil)}🛢`) : null),
      badge,
    );
    el.addEventListener('click', () => onClick());
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      onCancel?.();
    });
    // Long-press cancel on touch
    let lp: number | null = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' && onCancel) lp = window.setTimeout(() => {
        onCancel();
        this.ctl.vibrate(30);
        lp = null;
      }, 550);
    });
    const clear = () => {
      if (lp !== null) clearTimeout(lp);
      lp = null;
    };
    el.addEventListener('pointerup', clear);
    el.addEventListener('pointerleave', clear);
    el.addEventListener('pointerenter', (e) => e.pointerType === 'mouse' && this.showTooltip(el, kind, unit));
    el.addEventListener('pointerleave', () => this.hideTooltip());
    this.cards.set(key, { el, badge, prog, kind, unit });
    return el;
  }

  private renderBuildGrid() {
    const grid = h('div', { class: 'grid' });
    for (const kind of BUILD_ORDER) {
      grid.append(
        this.card(`b:${kind}`, kind, false, () => {
          const w = this.world;
          const team = w.playerTeam;
          const def = BUILDINGS[kind];
          const missing = w.requirementsMet(team, kind);
          if (missing.length) return this.toast('hud.requires', 'bad', `${t('hud.requires')}: ${missing.map((m) => t(`bld.${m}` as I18nKey)).join(', ')}`);
          if (w.atLimit(team, kind)) return this.toast('hud.limit', 'bad');
          if (w.teams[team].credits < def.cost) return this.toast('hud.noFunds', 'bad');
          if (w.teams[team].oil < def.oil) return this.toast('hud.noOil', 'bad');
          this.audio.play('click');
          this.ctl.startPlacement(kind);
          if (window.matchMedia('(max-width: 1100px), (pointer: coarse)').matches) this.setSheet(false);
        }),
      );
    }
    return grid;
  }

  private renderUnitGrid() {
    const grid = h('div', { class: 'grid' });
    for (const kind of UNIT_ORDER) {
      grid.append(
        this.card(
          `u:${kind}`,
          kind,
          true,
          () => {
            if (this.world.queueUnit(this.world.playerTeam, kind)) this.ctl.vibrate(10);
          },
          () => this.world.cancelUnit(this.world.playerTeam, kind),
        ),
      );
    }
    return grid;
  }

  private renderMarket() {
    const price = h('span', null, '');
    const value = h('div', { class: 'muted' });
    const eff = h('div', { class: 'muted' });
    const chart = h('canvas', { width: 560, height: 180 });
    const auto = h('div', { class: 'switch' });
    const team = this.world.teams[this.world.playerTeam];
    auto.classList.toggle('on', team.autoSell);
    const wrap = h(
      'div',
      { class: 'market' },
      h('div', { class: 'big-price' }, h('span', null, t('hud.price')), price),
      chart,
      value,
      eff,
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn small', onclick: () => this.sell(0.25) }, svgIcon('sell'), t('hud.sell25')),
        h('button', { class: 'btn small primary', onclick: () => this.sell(1) }, svgIcon('dollar'), t('hud.sellAll')),
      ),
      h(
        'div',
        {
          class: 'toggle',
          onclick: () => {
            team.autoSell = !team.autoSell;
            auto.classList.toggle('on', team.autoSell);
            this.audio.play('click');
          },
        },
        h('span', null, t('hud.autoSell')),
        auto,
      ),
    );
    this.marketEls = { price, value, eff, chart, auto };
    return wrap;
  }

  private sell(frac: number) {
    const credits = this.world.sellOil(this.world.playerTeam, frac);
    if (credits > 0) {
      const r = this.els.credits.getBoundingClientRect();
      this.floating(`+$${num(credits)}`, r.left, r.bottom);
      this.ctl.vibrate(15);
    }
  }

  private showTooltip(anchor: HTMLElement, kind: string, unit: boolean) {
    this.hideTooltip();
    const w = this.world;
    const team = w.playerTeam;
    const name = t(`${unit ? 'unit' : 'bld'}.${kind}` as I18nKey);
    const desc = t(`${unit ? 'unit' : 'bld'}.${kind}.desc` as I18nKey);
    let req = '';
    if (unit) {
      const p = UNITS[kind as UnitKind].producer;
      if (!w.hasBuilding(team, p)) req = `${t('hud.requires')}: ${t(`bld.${p}` as I18nKey)}`;
    } else {
      const missing = w.requirementsMet(team, kind as BuildingKind);
      if (missing.length) req = `${t('hud.requires')}: ${missing.map((m) => t(`bld.${m}` as I18nKey)).join(', ')}`;
    }
    const def = unit ? UNITS[kind as UnitKind] : BUILDINGS[kind as BuildingKind];
    const stats = unit
      ? `❤ ${num(def.hp)} · ⚔ ${num((def as (typeof UNITS)[UnitKind]).weapon.damage)} · ⏱ ${num(def.buildTime)}s`
      : `❤ ${num(def.hp)} · ⚡ ${(def as (typeof BUILDINGS)[BuildingKind]).power > 0 ? '+' : ''}${num((def as (typeof BUILDINGS)[BuildingKind]).power)}`;
    const tip = h('div', { class: 'tooltip panel' }, h('b', null, name), h('div', null, desc), h('div', { style: 'color:var(--muted);margin-top:4px' }, stats), req ? h('div', { class: 'req' }, req) : null);
    document.body.append(tip);
    const r = anchor.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    let x = r.left - tr.width - 10;
    if (x < 8) x = r.right + 10;
    tip.style.left = `${Math.min(window.innerWidth - tr.width - 8, Math.max(8, x))}px`;
    tip.style.top = `${Math.max(8, Math.min(window.innerHeight - tr.height - 8, r.top))}px`;
    this.tooltip = tip;
  }

  private hideTooltip() {
    this.tooltip?.remove();
    this.tooltip = null;
  }

  // ---------------------------------------------------------------------------
  // Selection panel

  onSelection() {
    const sel = this.ctl.selection;
    const key = `${this.ctl.mode}|${sel.map((e) => e.id).join(',')}`;
    this.renderModebar();
    if (key === this.selKey) return;
    this.selKey = key;
    const panel = this.els.sel;
    panel.innerHTML = '';
    this.selHp = [];
    this.selDyn = null;
    if (!sel.length) {
      panel.classList.add('hidden');
      return;
    }
    panel.classList.remove('hidden');
    const actions = h('div', { class: 'sel-actions' });
    const btn = (icon: Parameters<typeof svgIcon>[0], label: I18nKey, fn: () => void, cls = '') =>
      h('button', { class: `btn small ${cls}`, onclick: () => (this.audio.play('click'), fn()) }, svgIcon(icon), t(label));
    const own = sel.filter((e) => e.team === this.world.playerTeam);
    const units = own.filter((e): e is Unit => e.isUnit);

    if (sel.length === 1) {
      const e = sel[0];
      const kindKey = (e.isUnit ? `unit.${e.kind}` : `bld.${e.kind}`) as I18nKey;
      const hp = h('div', null);
      this.selHp.push(hp);
      const status = h('div', { class: 'desc' });
      const info = h(
        'div',
        { class: 'selinfo' },
        h('div', { class: 'nm' }, t(kindKey), e.isUnit && e.vet ? h('span', { class: 'stars' }, '★'.repeat(e.vet)) : null),
        h('div', { class: 'hpbar' }, hp),
        e.team === this.world.playerTeam ? h('div', { class: 'desc' }, t(`${kindKey}.desc` as I18nKey)) : h('div', { class: 'desc', style: `color:${this.world.teams[e.team].theme.css}` }, loc(this.world.teams[e.team].theme.name)),
        status,
        actions,
      );
      panel.append(h('div', { class: 'portrait' }, this.thumbs[e.kind] ? h('img', { src: this.thumbs[e.kind], alt: '' }) : null), info);
      if (e.team === this.world.playerTeam) {
        if (e.isUnit) {
          actions.append(btn('stop', 'hud.stop', () => this.ctl.stop()), btn('target', 'hud.attackMove', () => this.ctl.startAttackMove()));
          this.selDyn = () => this.setText(status, 'sel-status', e.kills ? `${t('hud.kills')}: ${num(e.kills)}` : '');
        } else {
          const b = e as Building;
          if (b.def.produces) actions.append(btn('flag', 'hud.rally', () => this.ctl.startRally()));
          if (b.kind === 'silo') {
            const launch = btn('missile', 'hud.launch', () => this.ctl.startMissile(b), 'primary');
            actions.append(launch);
            this.selDyn = () => {
              const ready = this.world.siloReady(b);
              (launch as HTMLButtonElement).disabled = !ready;
              this.setText(status, 'sel-status', ready ? `🚀 ${t('hud.ready')}` : `${t('hud.charging')} ${num((b.siloCharge / ECONOMY.siloCharge) * 100)}%`);
            };
          } else {
            this.selDyn = () => {
              let s = '';
              if (!b.built) s = `🏗 ${num(b.progress * 100)}%`;
              else if (b.queue.length) s = `${t('hud.queue')}: ${b.queue.map((q) => t(`unit.${q}` as I18nKey)).join(', ')}`;
              else if (b.oilField) s = `${loc(b.oilField.def.name)} · 🛢 +${(ECONOMY.derrickOil * b.oilField.def.richness).toFixed(1)}/s`;
              this.setText(status, 'sel-status', s);
            };
          }
          if (b.kind !== 'hq') actions.append(btn('dollar', 'hud.sellBuilding', () => this.world.sellBuilding(b), 'danger'));
        }
      }
    } else {
      const counts = new Map<string, Entity[]>();
      for (const e of own) {
        const arr = counts.get(e.kind) ?? [];
        arr.push(e);
        counts.set(e.kind, arr);
      }
      const multi = h('div', { class: 'multi' });
      for (const [kind, list] of counts) {
        multi.append(
          h(
            'button',
            { class: 'mi', title: t(`${list[0].isUnit ? 'unit' : 'bld'}.${kind}` as I18nKey), onclick: () => this.ctl.setSelection(list) },
            this.thumbs[kind] ? h('img', { src: this.thumbs[kind], alt: '' }) : null,
            h('b', null, num(list.length)),
          ),
        );
      }
      const hp = h('div', null);
      this.selHp.push(hp);
      panel.append(h('div', { class: 'selinfo' }, h('div', { class: 'nm' }, `${t('hud.selected')}: ${num(own.length)}`), h('div', { class: 'hpbar' }, hp), multi, actions));
      if (units.length) actions.append(btn('stop', 'hud.stop', () => this.ctl.stop()), btn('target', 'hud.attackMove', () => this.ctl.startAttackMove()));
    }
    actions.append(btn('close', 'hud.deselect', () => this.ctl.setSelection([]), 'ghost'));
    this.updateSelection();
  }

  private updateSelection() {
    const sel = this.ctl.selection;
    if (!sel.length) return;
    let hp = 0;
    let max = 0;
    for (const e of sel) {
      hp += Math.max(0, e.hp);
      max += e.maxHp;
    }
    const frac = max ? hp / max : 0;
    for (const el of this.selHp) {
      el.style.width = `${frac * 100}%`;
      el.style.background = frac > 0.6 ? 'var(--good)' : frac > 0.3 ? 'var(--warn)' : 'var(--bad)';
    }
    this.selDyn?.();
  }

  private renderModebar() {
    const bar = this.els.modebar;
    const mode = this.ctl.mode;
    // Only rebuild when the content changes, so taps on its buttons are never lost.
    const key = `${mode}|${this.ctl.placeKind}|${this.ctl.placeValid}`;
    if (this.cache.get('modebar') === key) return;
    this.cache.set('modebar', key);
    if (mode === 'normal') {
      bar.style.display = 'none';
      return;
    }
    bar.style.display = 'flex';
    bar.innerHTML = '';
    const cancel = h('button', { class: 'btn small ghost', onclick: () => this.ctl.cancelMode() }, svgIcon('close'), t('hud.cancel'));
    if (mode === 'place') {
      const valid = this.ctl.placeValid;
      const kind = this.ctl.placeKind!;
      const msg = BUILDINGS[kind].onOil ? t('hud.placeOil') : valid ? t('hud.placeHint') : t('hud.invalidPlace');
      bar.append(
        h('span', { class: `msg ${valid ? '' : 'bad'}` }, `${t(`bld.${kind}` as I18nKey)} — ${msg}`),
        h('button', { class: 'btn small primary touch-only', disabled: !valid, onclick: () => this.ctl.confirmPlacement() }, svgIcon('check'), t('hud.place')),
        cancel,
      );
    } else if (mode === 'missile') {
      bar.append(h('span', { class: 'msg bad' }, `🚀 ${t('hud.selectTarget')}`), cancel);
    } else if (mode === 'attackMove') {
      bar.append(h('span', { class: 'msg' }, `${t('hud.attackMove')} — ${t('hud.selectTarget')}`), cancel);
    } else if (mode === 'rally') {
      bar.append(h('span', { class: 'msg' }, `${t('hud.rally')} — ${t('hud.selectTarget')}`), cancel);
    }
  }

  // ---------------------------------------------------------------------------
  // Notifications

  toast(key: I18nKey, tone: 'info' | 'good' | 'bad' | 'warn', extra?: string, at?: { x: number; z: number }) {
    const text = extra ? (isKey(extra) ? `${t(key)}: ${t(extra)}` : extra) : t(key);
    const icon = tone === 'good' ? '✔' : tone === 'bad' ? '✖' : tone === 'warn' ? '⚠' : 'ℹ';
    const el = h('div', { class: `toast ${tone}` }, h('span', null, icon), text);
    if (at) {
      el.addEventListener('click', () => this.stage.rig.focus(at.x, at.z));
      if (tone === 'warn' || tone === 'bad') this.minimap.ping(at.x, at.z);
    }
    const box = this.els.toasts;
    while (box.children.length >= 4) box.firstElementChild?.remove();
    box.append(el);
    window.setTimeout(() => {
      el.classList.add('out');
      window.setTimeout(() => el.remove(), 300);
    }, 3200);
    if (tone === 'bad' && key !== 'hud.noFunds') this.audio.play('error');
  }

  crisis(info: CrisisInfo) {
    const banner = h('div', { class: 'banner panel' }, h('div', { class: 'ic' }, info.icon), h('div', { class: 'tt' }, t(info.title)), h('div', { class: 'dd' }, t(info.desc)));
    this.root.append(banner);
    this.audio.play('alert');
    window.setTimeout(() => {
      banner.classList.add('out');
      window.setTimeout(() => banner.remove(), 500);
    }, 4200);
  }

  medal(id: AchievementId) {
    const a = ACHIEVEMENTS.find((x) => x.id === id)!;
    const el = h('div', { class: 'medal-pop panel' }, h('div', { class: 'mi' }, a.icon), h('div', null, h('div', { class: 'ml' }, t('ach.unlocked')), h('div', { class: 'mn' }, t(achName(id))), h('div', { class: 'desc', style: 'color:var(--muted);font-size:12px' }, t(achDesc(id)))));
    this.root.append(el);
    this.audio.play('achievement');
    this.ctl.vibrate(40);
    window.setTimeout(() => {
      el.classList.add('out');
      el.style.animation = 'bannerOut .5s ease both';
      window.setTimeout(() => el.remove(), 500);
    }, 3800);
  }

  objectiveDone(key: I18nKey, reward: number) {
    this.toast('msg.objective', 'good', `${t(key)} (+$${num(reward)})`);
    this.audio.play('complete');
    const r = this.els.credits.getBoundingClientRect();
    this.floating(`+$${num(reward)}`, r.left, r.bottom);
    this.renderObjectives();
  }

  floating(text: string, x: number, y: number) {
    const el = h('div', { class: 'floating', style: `left:${x}px;top:${y}px` }, text);
    document.body.append(el);
    window.setTimeout(() => el.remove(), 1400);
  }

  private renderObjectives() {
    const el = this.els.objectives;
    el.innerHTML = '';
    const list = this.progression.visible(3);
    if (!list.length) {
      el.style.display = 'none';
      return;
    }
    el.style.display = '';
    const header = h('h4', { onclick: () => el.classList.toggle('collapsed') }, t('hud.objectives'), svgIcon('chevron'));
    el.append(header);
    for (const o of list) el.append(h('div', { class: 'obj' }, h('span', { class: 'box' }), h('span', null, t(o.key)), h('span', { class: 'reward' }, `+$${num(o.reward)}`)));
  }

  // ---------------------------------------------------------------------------
  // Frame update

  private setText(el: HTMLElement, key: string, text: string) {
    if (this.cache.get(key) === text) return;
    this.cache.set(key, text);
    el.textContent = text;
  }

  update(dt: number) {
    this.minimap.update(dt);
    const storm = this.world.crises.sandstorm;
    this.els.storm.style.opacity = storm > 0.01 ? (storm * 0.75).toFixed(3) : '0';
    this.fpsAcc.frames++;
    this.fpsAcc.time += dt;
    this.tick -= dt;
    if (this.tick > 0) return;
    this.tick = 0.1;
    const w = this.world;
    const team = w.teams[w.playerTeam];
    const e = this.els;
    this.setText(e.credits, 'credits', `${num(team.credits)}`);
    this.setText(e.oil, 'oil', `${num(team.oil)}`);
    this.setText(e.power, 'power', `${num(team.powerProd)}/${num(team.powerUse)}`);
    e.powerWrap.classList.toggle('low', team.powerUse > team.powerProd);
    this.setText(e.pop, 'pop', `${num(team.pop)}/${num(ECONOMY.popCap)}`);
    this.setText(e.price, 'price', `$${num(w.market.price)}`);
    const tr = w.market.trend;
    this.setText(e.trend, 'trend', tr > 0.5 ? '▲' : tr < -0.5 ? '▼' : '');
    e.trend.className = `trend ${tr > 0.5 ? 'up' : tr < -0.5 ? 'down' : ''}`;
    this.setText(e.time, 'time', fmtTime(w.time));
    this.drawSpark(e.spark, w.market.history, false);

    // Crisis chips
    const chipKey = w.crises.active.map((c) => `${c.kind}${Math.ceil(c.remaining)}`).join('|');
    if (this.cache.get('chips') !== chipKey) {
      this.cache.set('chips', chipKey);
      e.chips.innerHTML = '';
      for (const c of w.crises.active)
        e.chips.append(h('div', { class: 'chip', title: t(c.desc) }, h('span', null, c.icon), h('span', { class: 'txt' }, t(c.title)), h('span', null, fmtTime(c.remaining))));
    }

    this.refreshCards();
    if (this.marketEls) {
      const m = this.marketEls;
      this.setText(m.price, 'm-price', `$${(w.market.price * team.priceMod).toFixed(1)}`);
      this.setText(m.value, 'm-value', `${t('hud.oil')}: ${num(team.oil)} 🛢 → $${num(w.oilValue(w.playerTeam, team.oil))}`);
      this.setText(m.eff, 'm-eff', `${t('bld.refinery')}: ${num(w.sellEfficiency(w.playerTeam) * 100)}% · ${t('hud.income')}: +$${num(team.incomeRate)}/s`);
      this.drawSpark(m.chart, w.market.history, true);
    }
    this.updateSelection();
    this.renderModebar();
    if (this.showFps) {
      const fps = this.fpsAcc.frames / Math.max(0.001, this.fpsAcc.time);
      this.setText(e.fps, 'fps', `${fps.toFixed(0)} FPS · ${w.units.length} units · ${w.projectiles.count} proj`);
    } else this.setText(e.fps, 'fps', '');
    this.fpsAcc = { frames: 0, time: 0 };
    if (this.progression.visible(3).map((o) => o.id).join() !== this.cache.get('obj')) {
      this.cache.set('obj', this.progression.visible(3).map((o) => o.id).join());
      this.renderObjectives();
    }
  }

  private refreshCards() {
    const w = this.world;
    const team = w.teams[w.playerTeam];
    for (const [, c] of this.cards) {
      if (c.unit) {
        const kind = c.kind as UnitKind;
        const def = UNITS[kind];
        const available = w.unitRequirementMet(w.playerTeam, kind);
        c.el.classList.toggle('disabled', !available);
        c.el.classList.toggle('unaffordable', team.credits < def.cost || team.oil < def.oil);
        const q = w.queuedCount(w.playerTeam, kind);
        c.badge.style.display = q ? '' : 'none';
        if (q) c.badge.textContent = num(q);
        const p = w.queueProgress(w.playerTeam, kind);
        c.prog.style.setProperty('--p', p >= 0 ? `${p * 100}%` : '0%');
      } else {
        const kind = c.kind as BuildingKind;
        const def = BUILDINGS[kind];
        const locked = w.requirementsMet(w.playerTeam, kind).length > 0 || w.atLimit(w.playerTeam, kind);
        c.el.classList.toggle('disabled', locked);
        c.el.classList.toggle('unaffordable', team.credits < def.cost || team.oil < def.oil);
        c.el.classList.toggle('selected', this.ctl.mode === 'place' && this.ctl.placeKind === kind);
        const n = w.teamBuildings(w.playerTeam, kind, false).length;
        c.badge.style.display = n ? '' : 'none';
        if (n) c.badge.textContent = num(n);
      }
    }
  }

  private drawSpark(c: HTMLCanvasElement, data: number[], big: boolean) {
    const ctx = c.getContext('2d');
    if (!ctx || data.length < 2) return;
    const W = c.width;
    const H = c.height;
    ctx.clearRect(0, 0, W, H);
    const min = Math.min(...data) * 0.97;
    const max = Math.max(...data) * 1.03;
    const x = (i: number) => (i / (data.length - 1)) * W;
    const y = (v: number) => H - ((v - min) / (max - min || 1)) * H;
    const up = data[data.length - 1] >= data[0];
    const col = up ? '#4ade80' : '#f87171';
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, up ? 'rgba(74,222,128,0.35)' : 'rgba(248,113,113,0.35)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    data.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.beginPath();
    data.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    ctx.strokeStyle = col;
    ctx.lineWidth = big ? 3 : 2.5;
    ctx.stroke();
    if (big) {
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, y(avg));
      ctx.lineTo(W, y(avg));
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  destroy() {
    this.hideTooltip();
    this.root.remove();
  }
}
