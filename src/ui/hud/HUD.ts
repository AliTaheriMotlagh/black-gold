/**
 * In-game HUD root: top resource bar, alert feed, crisis ticker, minimap, selection
 * panel, command panel and diplomacy drawer. Layout adapts to phones, tablets and
 * desktops in CSS; this file only manages state.
 */
import type { Game } from '../../game/Game';
import type { SimEvent } from '../../sim/world';
import { h, svgIcon } from '../dom';
import { compact, fmtTime, loc, num, t, type I18nKey, digits } from '../../i18n';
import { Minimap } from './Minimap';
import { SelectionPanel } from './SelectionPanel';
import { CommandPanel } from './CommandPanel';
import { DiplomacyPanel } from './DiplomacyPanel';
import { audio } from '../../audio/audio';
import { BUILDINGS } from '../../sim/defs';

type AlertEvent = Extract<SimEvent, { t: 'alert' }>;

export class HUD {
  readonly root: HTMLDivElement;
  readonly minimap: Minimap;
  readonly sel: SelectionPanel;
  readonly cmd: CommandPanel;
  readonly diplo: DiplomacyPanel;
  private acc = 0;
  private els: Record<string, HTMLElement> = {};
  private feed: HTMLDivElement;
  private ticker: HTMLDivElement;
  private placebar: HTMLDivElement;
  private status: HTMLDivElement;
  private fpsEl: HTMLDivElement;
  private frames = 0;
  private fpsT = 0;
  showFps = false;
  private alertRate = new Map<string, number>();

  constructor(
    readonly game: Game,
    parent: HTMLElement,
  ) {
    const world = game.world;
    const me = world.countries[game.session.local];
    const res = (key: string, icon: Parameters<typeof svgIcon>[0], title: I18nKey) => {
      const v = h('b', { class: 'v' });
      const sub = h('small', { class: 's' });
      this.els[key] = v;
      this.els[key + 'Sub'] = sub;
      const el = h('div', { class: `res ${key}`, title: t(title) }, svgIcon(icon), h('span', { class: 'col' }, v, sub));
      this.els[key + 'Box'] = el;
      return el;
    };
    const meter = (key: string, icon: Parameters<typeof svgIcon>[0], title: I18nKey) => {
      const fill = h('i');
      this.els[key] = fill;
      return h('div', { class: `meter ${key}`, title: t(title) }, svgIcon(icon), h('span', { class: 'bar' }, fill));
    };
    const spark = h('canvas', { class: 'spark', width: 72, height: 22 });
    this.els.spark = spark;
    this.els.clock = h('span', { class: 'clock' });
    this.els.speed = h('button', { class: 'btn ghost speed', title: t('hud.speedX'), onclick: () => this.cycleSpeed() });
    this.els.diploBadge = h('span', { class: 'badge' });
    const top = h(
      'header',
      { class: 'topbar' },
      h('div', { class: 'nation', style: `--c:${me.meta.color}` }, h('span', { class: 'flag' }), h('b', null, loc(me.meta.name)), (this.els.tier = h('span', { class: 'tier' }))),
      res('funds', 'dollar', 'hud.funds'),
      res('oil', 'oil', 'hud.oil'),
      res('power', 'bolt', 'hud.power'),
      res('supply', 'supply', 'hud.supply'),
      h('div', { class: 'res price', title: t('hud.price') }, h('span', { class: 'col' }, (this.els.price = h('b', { class: 'v' })), h('small', { class: 's' }, 'Brent')), spark),
      h('div', { class: 'meters' }, meter('stability', 'stability', 'hud.stability'), meter('reputation', 'opinion', 'hud.reputation')),
      h('div', { class: 'spacer' }),
      h('button', { class: 'btn ghost diplo-btn', title: t('hud.diplomacy'), onclick: () => this.diplo.toggle() }, svgIcon('handshake'), h('span', { class: 'lbl' }, t('hud.diplomacy')), this.els.diploBadge),
      this.els.clock,
      game.session.multiplayer ? null : this.els.speed,
      h('button', { class: 'btn ghost', title: t('hud.menu'), onclick: () => game.hooks.onPause() }, svgIcon('pause')),
    );
    this.feed = h('div', { class: 'alert-feed', role: 'log', 'aria-live': 'polite' });
    this.ticker = h('div', { class: 'crisis-ticker' });
    this.placebar = h('div', { class: 'placebar' });
    this.status = h('div', { class: 'net-status' });
    this.fpsEl = h('div', { class: 'fps' });
    this.minimap = new Minimap(game);
    this.sel = new SelectionPanel(game);
    this.cmd = new CommandPanel(game);
    this.diplo = new DiplomacyPanel(game);
    this.root = h('div', { class: 'hud' }, top, this.feed, this.ticker, this.minimap.root, this.sel.root, this.cmd.root, this.placebar, this.status, this.fpsEl, this.diplo.root);
    parent.prepend(this.root);
    game.ctl.onChange = () => {
      this.sel.refresh();
      this.cmd.refresh();
      this.renderPlacebar();
    };
    this.showFps = game.settings.showFps;
    this.refresh();
  }

  private cycleSpeed() {
    const s = this.game.session;
    const speeds = [1, 2, 4, 8];
    s.speed = speeds[(speeds.indexOf(s.speed) + 1) % speeds.length];
    audio.play('click');
    this.updateTop();
  }

  hotkey(code: string, e: KeyboardEvent): boolean {
    if (code === 'Tab') {
      this.diplo.toggle();
      return true;
    }
    return this.cmd.hotkey(code, e) || this.sel.hotkey(code, e);
  }

  /** Immediate refresh after state changes. */
  refresh() {
    this.updateTop();
    this.sel.refresh();
    this.cmd.refresh();
    this.diplo.refresh();
    this.renderPlacebar();
  }

  update(dt: number) {
    this.frames++;
    this.fpsT += dt;
    if (this.fpsT >= 0.5) {
      this.fpsEl.textContent = this.showFps ? `${Math.round(this.frames / this.fpsT)} FPS` : '';
      this.frames = 0;
      this.fpsT = 0;
    }
    this.minimap.update(dt);
    this.acc += dt;
    if (this.acc < 0.12) return;
    this.acc = 0;
    this.game.ctl.prune();
    this.updateTop();
    this.sel.update();
    this.cmd.update();
    this.diplo.update();
    const st = this.game.session.status;
    this.status.textContent = st;
    this.status.classList.toggle('on', !!st);
  }

  private updateTop() {
    const w = this.game.world;
    const c = w.countries[this.game.session.local];
    const E = this.els;
    E.funds.textContent = `$${compact(c.funds)}M`;
    E.fundsSub.textContent = `+${compact(c.incomeRate * 60)}${t('hud.perMin')}`;
    E.oil.textContent = compact(c.oil);
    E.oilSub.textContent = t('common.bbl');
    E.power.textContent = `${num(c.powerUse)}/${num(c.powerProd)}`;
    E.powerSub.textContent = t('common.mw');
    E.powerBox.classList.toggle('bad', c.lowPower);
    E.supply.textContent = `${num(c.supply)}/${num(c.supplyCap)}`;
    E.supplyBox.classList.toggle('warn', c.supply >= c.supplyCap - 2);
    E.price.textContent = `$${digits(w.market.price.toFixed(1))}`;
    E.stability.style.width = `${c.stability}%`;
    E.stability.parentElement!.parentElement!.classList.toggle('bad', c.stability < 30);
    E.reputation.style.width = `${c.reputation}%`;
    E.reputation.parentElement!.parentElement!.classList.toggle('bad', c.reputation < 25);
    E.tier.textContent = `T${digits(String(c.tier))}`;
    E.clock.textContent = fmtTime(w.time);
    E.speed.textContent = `${digits(String(this.game.session.speed))}×`;
    const props = w.dip.proposals.filter((p) => p.to === c.idx).length;
    E.diploBadge.textContent = props ? digits(String(props)) : '';
    E.diploBadge.classList.toggle('on', props > 0);
    this.drawSpark(w.market.history);
  }

  private drawSpark(hist: number[]) {
    const cv = this.els.spark as HTMLCanvasElement;
    const ctx = cv.getContext('2d')!;
    const W = cv.width;
    const H = cv.height;
    ctx.clearRect(0, 0, W, H);
    const pts = hist.slice(-40);
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of pts) {
      lo = Math.min(lo, p);
      hi = Math.max(hi, p);
    }
    if (hi - lo < 4) {
      hi += 2;
      lo -= 2;
    }
    const up = pts[pts.length - 1] >= pts[0];
    ctx.strokeStyle = up ? '#4ade80' : '#f87171';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = (i / (pts.length - 1)) * (W - 2) + 1;
      const y = H - 2 - ((p - lo) / (hi - lo)) * (H - 4);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.stroke();
  }

  /** Compact alert pill. Rate-limited per key; tap to jump. */
  alert(e: AlertEvent) {
    const now = performance.now();
    if (now - (this.alertRate.get(e.key) ?? 0) < (e.key === 'unitReady' ? 900 : 2500)) return;
    this.alertRate.set(e.key, now);
    let text = t(`alert.${e.key}` as I18nKey);
    const w = this.game.world;
    const arg = e.arg ?? '';
    const isoName = (iso: string) => {
      const c = w.byIso.get(iso);
      return c ? loc(c.meta.name) : iso;
    };
    switch (e.key) {
      case 'buildComplete':
      case 'unitReady':
      case 'researchDone':
        text = `${text}: ${t(arg as I18nKey)}`;
        break;
      case 'tierUp':
        text = `${text}: T${digits(arg)}`;
        break;
      case 'cityCaptured':
      case 'cityLost':
        text = `${text}: ${loc(w.theater.meta.cities[Number(arg)].name)}`;
        break;
      case 'warOnUs':
      case 'allianceBroken':
      case 'sanctioned':
      case 'eliminated':
        text = `${isoName(arg)} ${text}`;
        break;
      case 'borderViolation':
      case 'peace':
      case 'alliance':
        text = `${text} — ${isoName(arg)}`;
        break;
      case 'warDeclared':
      case 'callToArms': {
        const [a, b] = arg.split('>');
        text = `${text}: ${isoName(a)} ⟶ ${isoName(b)}`;
        break;
      }
      case 'proposal': {
        const [kind, iso] = arg.split(':');
        text = `${isoName(iso)} ${t('diplo.offers')} ${t(`diplo.propose.${kind}` as I18nKey)}`;
        this.diplo.refresh();
        break;
      }
      case 'rejected': {
        const [kind, iso] = arg.split(':');
        text = `${text}: ${t(`diplo.propose.${kind}` as I18nKey)} — ${isoName(iso)}`;
        break;
      }
      case 'missileInbound':
        text = `${text} ${t(`strike.${arg}` as I18nKey) ?? ''}`;
        break;
      case 'rankUp':
        text = `${text} (${t(`rank.${Math.min(9, Number(arg))}` as I18nKey)})`;
        break;
    }
    const pill = h(
      'button',
      {
        class: `pill ${e.tone}`,
        onclick: () => {
          if (e.key === 'proposal') this.diplo.open();
          else if (e.x !== undefined && e.z !== undefined) this.game.view.rig.focus(e.x, e.z, Math.min(this.game.view.rig.goal.dist, 25));
          pill.remove();
        },
      },
      h('i', { class: 'dot' }),
      text,
    );
    this.feed.prepend(pill);
    const max = matchMedia('(max-width: 900px), (max-height: 520px)').matches ? 2 : 5;
    while (this.feed.children.length > max) this.feed.lastElementChild?.remove();
    setTimeout(() => pill.classList.add('out'), e.tone === 'bad' ? 7000 : 4500);
    setTimeout(() => pill.remove(), e.tone === 'bad' ? 7600 : 5100);
  }

  crisis(id: string) {
    const item = h('div', { class: 'crisis' }, svgIcon('alert'), h('b', null, t(`crisis.${id}` as I18nKey)), h('span', null, t(`crisis.${id}.desc` as I18nKey)));
    this.ticker.replaceChildren(item);
    this.ticker.classList.add('on');
    audio.play('alert', { volume: 0.6 });
    setTimeout(() => this.ticker.classList.remove('on'), 9000);
  }

  private renderPlacebar() {
    const ctl = this.game.ctl;
    const m = ctl.mode;
    const touch = matchMedia('(pointer: coarse)').matches;
    this.placebar.replaceChildren();
    if (m.kind === 'normal') {
      this.placebar.classList.remove('on');
      return;
    }
    let label = '';
    if (m.kind === 'place') label = `${t(`bld.${m.building}` as I18nKey)} — $${num(BUILDINGS[m.building].cost)}M · ${touch ? t('hud.tapToPlace') : t('hud.clickToPlace')}`;
    else if (m.kind === 'attackMove') label = t('hud.attackMove');
    else label = t('hud.chooseTarget');
    this.placebar.append(h('span', null, label));
    if (m.kind === 'place' && touch)
      this.placebar.append(
        h('button', { class: 'btn primary', disabled: !ctl.ghostPos, onclick: () => ctl.confirmPlacement() }, svgIcon('check'), t('hud.confirm')),
      );
    this.placebar.append(h('button', { class: 'btn', onclick: () => ctl.setMode({ kind: 'normal' }) }, svgIcon('x'), t('hud.cancel')));
    this.placebar.classList.add('on');
  }

  dispose() {
    this.root.remove();
    this.minimap.dispose();
  }
}
