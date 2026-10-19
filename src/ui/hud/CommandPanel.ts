/**
 * Command panel: Build / Forces / Research / Powers / Market. Docked on desktop,
 * a bottom sheet on phones. Cards show the 3D portrait, cost, lock reason, queue
 * count and progress.
 */
import type { Game } from '../../game/Game';
import { BUILDINGS, POWERS, RESEARCH, TIER_UPGRADE, UNITS, UNIT_IDS, type Category } from '../../sim/defs';
import { h, svgIcon, type ICONS } from '../dom';
import { compact, digits, num, t, type I18nKey } from '../../i18n';
import { thumb } from '../thumbs';
import { audio } from '../../audio/audio';
import { oilValue, sellEfficiency } from '../../sim/systems/economy';

type Tab = 'build' | 'army' | 'research' | 'powers' | 'market';
type IconName = keyof typeof ICONS;

const BUILD_GROUPS: { title: I18nKey; ids: string[] }[] = [
  { title: 'hud.economy', ids: ['power', 'derrick', 'refinery', 'depot', 'nuclear'] },
  { title: 'hud.production', ids: ['barracks', 'factory', 'dronefac', 'airbase', 'shipyard', 'fob'] },
  { title: 'hud.defense', ids: ['bunker', 'cram', 'radar', 'samsite', 'laser'] },
  { title: 'hud.strategic', ids: ['research', 'silo'] },
];

const CATS: { id: Category; icon: IconName; title: I18nKey }[] = [
  { id: 'infantry', icon: 'infantry', title: 'hud.infantry' },
  { id: 'vehicle', icon: 'tank', title: 'hud.vehicle' },
  { id: 'drone', icon: 'drone', title: 'hud.drone' },
  { id: 'air', icon: 'jet', title: 'hud.air' },
  { id: 'naval', icon: 'ship', title: 'hud.naval' },
];

interface Card {
  el: HTMLButtonElement;
  update: () => void;
}

export class CommandPanel {
  readonly root: HTMLElement;
  private tabs: HTMLDivElement;
  private body: HTMLDivElement;
  private tab: Tab = 'build';
  private cat: Category = 'infantry';
  private cards: Card[] = [];
  private open: boolean;
  private buildKeyUntil = 0;
  private sig = '';

  constructor(readonly game: Game) {
    this.open = !matchMedia('(max-width: 900px), (max-height: 520px)').matches;
    this.tabs = h('div', { class: 'cmd-tabs', role: 'tablist' });
    this.body = h('div', { class: 'cmd-body' });
    this.root = h('section', { class: 'cmdpanel' }, this.tabs, h('div', { class: 'sheet' }, this.body));
    this.renderTabs();
    this.render();
  }

  private renderTabs() {
    const tab = (id: Tab, icon: IconName, label: I18nKey) =>
      h(
        'button',
        {
          class: `tab${this.tab === id ? ' on' : ''}`,
          role: 'tab',
          onclick: () => {
            audio.play('click');
            if (this.tab === id) this.setOpen(!this.open);
            else {
              this.tab = id;
              this.setOpen(true);
            }
            this.renderTabs();
            this.render();
          },
        },
        svgIcon(icon),
        h('span', { class: 'lbl' }, t(label)),
      );
    this.tabs.replaceChildren(tab('build', 'build', 'hud.build'), tab('army', 'army', 'hud.army'), tab('research', 'flask', 'hud.research'), tab('powers', 'star', 'hud.powers'), tab('market', 'market', 'hud.market'));
    this.root.classList.toggle('open', this.open);
  }

  private setOpen(o: boolean) {
    this.open = o;
    this.root.classList.toggle('open', o);
  }

  refresh() {
    this.sig = '';
    this.update();
  }

  update() {
    // Producer-driven auto tab: selecting a factory shows its units.
    const sel = this.game.ctl.selected();
    const sig = `${this.tab}|${this.cat}|${sel.map((e) => e.id).join(',')}|${this.game.world.countries[this.game.session.local].tier}|${this.game.world.countries[this.game.session.local].researched.length}|${this.game.world.countries[this.game.session.local].powers.length}`;
    if (sig !== this.sig) {
      const b = sel.length === 1 && !sel[0].isUnit && sel[0].owner === this.game.session.local ? sel[0] : null;
      if (b && b.def.produces && this.sig.split('|')[2] !== String(b.id)) {
        const firstCat = UNITS[b.def.produces[0]].category;
        if (b.def.id !== 'hq') {
          this.tab = 'army';
          this.cat = firstCat;
          this.renderTabs();
        }
      }
      if (b && b.def.research_ && this.sig.split('|')[2] !== String(b.id)) {
        this.tab = 'research';
        this.renderTabs();
      }
      this.sig = sig;
      this.render();
    }
    for (const c of this.cards) c.update();
  }

  hotkey(code: string, e: KeyboardEvent): boolean {
    const now = performance.now();
    if (code === 'KeyB' && !e.ctrlKey) {
      this.tab = 'build';
      this.setOpen(true);
      this.renderTabs();
      this.render();
      this.buildKeyUntil = now + 2500;
      return true;
    }
    if (!code.startsWith('Key')) return false;
    const letter = code.slice(3);
    if (now < this.buildKeyUntil) {
      const id = Object.values(BUILDINGS).find((b) => b.hotkey === letter && b.id !== 'hq')?.id;
      this.buildKeyUntil = 0;
      if (id) {
        this.game.ctl.beginPlacement(id);
        return true;
      }
    }
    // With a producer selected, its unit hotkeys train.
    const sel = this.game.ctl.selected();
    const b = sel.length === 1 && !sel[0].isUnit && sel[0].owner === this.game.session.local ? sel[0] : null;
    if (b?.def.produces) {
      const kind = b.def.produces.find((k) => UNITS[k].hotkey === letter);
      if (kind) {
        this.game.session.issue({ k: 'train', kind, n: e.shiftKey ? 5 : 1, at: b.id });
        audio.play('click');
        return true;
      }
    }
    return false;
  }

  private render() {
    this.cards = [];
    this.body.replaceChildren();
    switch (this.tab) {
      case 'build':
        for (const g of BUILD_GROUPS) {
          this.body.append(h('div', { class: 'grp' }, t(g.title)));
          const grid = h('div', { class: 'grid' });
          for (const id of g.ids) grid.append(this.buildCard(id).el);
          this.body.append(grid);
        }
        break;
      case 'army': {
        const cats = h('div', { class: 'cats' });
        for (const c of CATS)
          cats.append(
            h(
              'button',
              {
                class: `cat${this.cat === c.id ? ' on' : ''}`,
                title: t(c.title),
                onclick: () => {
                  this.cat = c.id;
                  this.render();
                },
              },
              svgIcon(c.icon),
              h('span', { class: 'lbl' }, t(c.title)),
            ),
          );
        this.body.append(cats);
        const grid = h('div', { class: 'grid' });
        for (const id of UNIT_IDS) if (UNITS[id].category === this.cat) grid.append(this.unitCard(id).el);
        this.body.append(grid);
        break;
      }
      case 'research':
        this.renderResearch();
        break;
      case 'powers':
        this.renderPowers();
        break;
      case 'market':
        this.renderMarket();
        break;
    }
  }

  private card(key: string, title: string, onClick: () => void, onCancel?: () => void): { el: HTMLButtonElement; cost: HTMLElement; badge: HTMLElement; prog: HTMLElement; lock: HTMLElement } {
    const cost = h('span', { class: 'cost' });
    const badge = h('b', { class: 'badge' });
    const prog = h('i', { class: 'prog' });
    const lock = h('span', { class: 'lock' });
    const el = h(
      'button',
      {
        class: 'card',
        title,
        onclick: (e: MouseEvent) => {
          if (el.classList.contains('locked')) {
            audio.play('error');
            return;
          }
          audio.play('click');
          onClick.call(null);
          void e;
        },
        oncontextmenu: (e: MouseEvent) => {
          e.preventDefault();
          onCancel?.();
        },
      },
      h('img', { src: thumb(key), alt: '', loading: 'lazy' }),
      h('span', { class: 'nm' }, title),
      cost,
      badge,
      prog,
      lock,
    );
    // Long-press to cancel on touch.
    let timer = 0;
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch' || !onCancel) return;
      timer = window.setTimeout(() => {
        onCancel();
        this.game.ctl.vibrate(30);
      }, 550);
    });
    el.addEventListener('pointerup', () => clearTimeout(timer));
    el.addEventListener('pointerleave', () => clearTimeout(timer));
    return { el, cost, badge, prog, lock };
  }

  private buildCard(id: string): Card {
    const game = this.game;
    const def = BUILDINGS[id];
    const c = this.card(`bld.${id}`, t(`bld.${id}` as I18nKey), () => game.ctl.beginPlacement(id));
    c.el.title = `${t(`bld.${id}` as I18nKey)} [B,${def.hotkey}]\n${t(`bld.${id}.desc` as I18nKey)}`;
    const card: Card = {
      el: c.el,
      update: () => {
        const w = game.world;
        const me = w.countries[game.session.local];
        const missing = w.missingRequirements(me.idx, def.requires);
        let lock = '';
        if (def.tier > me.tier) lock = `T${def.tier}`;
        else if (def.research && !me.has(def.research)) lock = t(`res.${def.research}` as I18nKey);
        else if (missing.length) lock = t(`bld.${missing[0]}` as I18nKey);
        else if (def.limit !== undefined && w.countBuildings(me.idx, id) >= def.limit) lock = '✓';
        c.el.classList.toggle('locked', !!lock);
        c.lock.textContent = lock;
        c.cost.textContent = `$${compact(def.cost)}M${def.oil ? ` · ${num(def.oil)}🛢` : ''}`;
        c.cost.classList.toggle('short', me.funds < def.cost);
        const n = w.countBuildings(me.idx, id);
        c.badge.textContent = n ? digits(String(n)) : '';
      },
    };
    this.cards.push(card);
    return card;
  }

  private unitCard(id: string): Card {
    const game = this.game;
    const def = UNITS[id];
    const c = this.card(
      `unit.${id}`,
      t(`unit.${id}` as I18nKey),
      () => game.session.issue({ k: 'train', kind: id, n: 1 }),
      () => game.session.issue({ k: 'cancel', kind: id }),
    );
    c.el.title = `${t(`unit.${id}` as I18nKey)} [${def.hotkey}]\n${t(`unit.${id}.desc` as I18nKey)}`;
    c.el.addEventListener('click', (e) => {
      if (e.shiftKey) game.session.issue({ k: 'train', kind: id, n: 4 });
    });
    const card: Card = {
      el: c.el,
      update: () => {
        const w = game.world;
        const me = w.countries[game.session.local];
        let lock = '';
        const hasProducer = w.buildings.some((b) => b.alive && b.built && b.owner === me.idx && b.def.produces?.includes(id));
        if (def.tier > me.tier) lock = `T${def.tier}`;
        else if (def.research && !me.has(def.research)) lock = t(`res.${def.research}` as I18nKey);
        else if (!hasProducer) lock = t(`bld.${def.producers[0]}` as I18nKey);
        c.el.classList.toggle('locked', !!lock);
        c.lock.textContent = lock;
        c.cost.textContent = `$${compact(def.cost)}M${def.oil ? ` · ${num(def.oil)}🛢` : ''}`;
        c.cost.classList.toggle('short', me.funds < def.cost);
        let queued = 0;
        let prog = -1;
        for (const b of w.buildings) {
          if (!b.alive || b.owner !== me.idx) continue;
          for (const q of b.queue) if (q === id) queued++;
          if (b.queue[0] === id) prog = Math.max(prog, b.prodTime / def.time);
        }
        c.badge.textContent = queued ? digits(String(queued)) : '';
        c.prog.style.width = prog >= 0 ? `${prog * 100}%` : '0';
      },
    };
    this.cards.push(card);
    return card;
  }

  private renderResearch() {
    const game = this.game;
    const me = () => game.world.countries[game.session.local];
    // Tech level upgrade
    const tierRow = h('div', { class: 'tier-row' });
    const tierUpdate = () => {
      const c = me();
      const hq = game.world.buildings.find((b) => b.alive && b.owner === c.idx && b.def.id === 'hq');
      tierRow.replaceChildren(
        h('div', { class: 'tiers' }, ...[1, 2, 3].map((n) => h('span', { class: `t${c.tier >= n ? ' on' : ''}` }, `T${digits(String(n))}`))),
      );
      if (c.tier < 3) {
        const next = (c.tier + 1) as 2 | 3;
        const def = TIER_UPGRADE[next];
        const missing = game.world.missingRequirements(c.idx, [...def.requires]);
        const btn = h(
          'button',
          { class: 'btn primary', disabled: !!hq?.upgrade || missing.length > 0 || c.funds < def.cost, onclick: () => game.session.issue({ k: 'tier' }) },
          svgIcon('upgrade'),
          hq?.upgrade ? `${t('hud.upgrading')} ${Math.round((hq.upgradeT / def.time) * 100)}%` : `${t('hud.upgrade')} → T${digits(String(next))} · $${compact(def.cost)}M`,
        );
        tierRow.append(btn);
        if (missing.length) tierRow.append(h('small', { class: 'muted' }, `${t('hud.requires')}: ${missing.map((m) => t(`bld.${m}` as I18nKey)).join(', ')}`));
      }
    };
    this.cards.push({ el: tierRow as unknown as HTMLButtonElement, update: tierUpdate });
    this.body.append(tierRow);
    const grid = h('div', { class: 'list' });
    for (const r of RESEARCH) {
      const prog = h('i', { class: 'prog' });
      const state = h('span', { class: 'state' });
      const el = h(
        'button',
        { class: 'row', onclick: () => game.session.issue({ k: 'research', id: r.id }) },
        svgIcon(r.icon as IconName),
        h('span', { class: 'txt' }, h('b', null, t(`res.${r.id}` as I18nKey)), h('small', null, t(`res.${r.id}.desc` as I18nKey))),
        state,
        prog,
      );
      this.cards.push({
        el,
        update: () => {
          const c = me();
          const lab = game.world.buildings.find((b) => b.alive && b.owner === c.idx && b.research === r.id);
          const done = c.has(r.id);
          el.classList.toggle('done', done);
          el.classList.toggle('locked', !done && (r.tier > c.tier || !game.world.hasBuilding(c.idx, 'research')));
          state.textContent = done ? t('hud.researched') : lab ? `${Math.round((lab.researchT / r.time) * 100)}%` : r.tier > c.tier ? `T${digits(String(r.tier))}` : `$${compact(r.cost)}M`;
          prog.style.width = lab ? `${(lab.researchT / r.time) * 100}%` : done ? '100%' : '0';
        },
      });
      grid.append(el);
    }
    this.body.append(grid);
  }

  private renderPowers() {
    const game = this.game;
    const pts = h('div', { class: 'points' });
    this.cards.push({
      el: pts as unknown as HTMLButtonElement,
      update: () => {
        const c = game.world.countries[game.session.local];
        pts.textContent = `${t('hud.points')}: ${digits(String(c.points))} · ${t(`rank.${Math.min(9, c.rank)}` as I18nKey)}`;
      },
    });
    this.body.append(pts);
    const list = h('div', { class: 'list' });
    for (const p of POWERS) {
      const state = h('span', { class: 'state' });
      const prog = h('i', { class: 'prog' });
      const el = h(
        'button',
        {
          class: 'row',
          onclick: () => {
            const c = game.world.countries[game.session.local];
            if (!c.powers.includes(p.id)) game.session.issue({ k: 'unlock', id: p.id });
            else if ((c.powerCd[p.id] ?? 0) <= 0) {
              if (p.id === 'cyber') {
                const enemy = game.world.countries.find((o) => o.alive && game.world.isEnemy(c.idx, o.idx) && o.major);
                if (enemy) game.session.issue({ k: 'power', id: p.id, x: 0, z: 0, target: enemy.idx });
              } else game.ctl.setMode({ kind: 'power', id: p.id });
            }
          },
        },
        svgIcon(p.icon as IconName),
        h('span', { class: 'txt' }, h('b', null, t(`pow.${p.id}` as I18nKey)), h('small', null, t(`pow.${p.id}.desc` as I18nKey))),
        state,
        prog,
      );
      this.cards.push({
        el,
        update: () => {
          const c = game.world.countries[game.session.local];
          const have = c.powers.includes(p.id);
          const cd = c.powerCd[p.id] ?? 0;
          el.classList.toggle('locked', !have && c.points < p.points);
          el.classList.toggle('done', have && cd <= 0);
          state.textContent = !have ? `${t('hud.unlock')} · ${digits(String(p.points))}★` : cd > 0 ? `${digits(String(Math.ceil(cd)))}${t('common.sec')}` : t('hud.use');
          prog.style.width = have && cd > 0 ? `${(1 - cd / p.cooldown) * 100}%` : '0';
        },
      });
      list.append(el);
    }
    this.body.append(list);
  }

  private renderMarket() {
    const game = this.game;
    const chart = h('canvas', { class: 'chart', width: 300, height: 90 });
    const info = h('div', { class: 'mkt-info' });
    const auto = h('input', { type: 'checkbox' }) as HTMLInputElement;
    auto.addEventListener('change', () => game.session.issue({ k: 'autoSell', on: auto.checked }));
    this.body.append(
      chart,
      info,
      h(
        'div',
        { class: 'mkt-actions' },
        h('button', { class: 'btn primary', onclick: () => game.session.issue({ k: 'sellOil', frac: 1 }) }, svgIcon('sell'), t('hud.sellAll')),
        h('button', { class: 'btn', onclick: () => game.session.issue({ k: 'sellOil', frac: 0.5 }) }, t('hud.sellHalf')),
        h('label', { class: 'toggle' }, auto, h('span', null, t('hud.autoSell'))),
      ),
    );
    this.cards.push({
      el: info as unknown as HTMLButtonElement,
      update: () => {
        const w = game.world;
        const c = w.countries[game.session.local];
        auto.checked = c.autoSell;
        info.replaceChildren(
          h('div', null, h('span', null, t('hud.price')), h('b', null, `$${digits(w.market.price.toFixed(2))}`)),
          h('div', null, h('span', null, t('hud.oil')), h('b', null, `${num(c.oil)} ${t('common.bbl')} ≈ $${compact(oilValue(w, c, c.oil))}M`)),
          h('div', null, h('span', null, '×'), h('b', null, `${digits((sellEfficiency(w, c) * 100).toFixed(0))}%`)),
        );
        const ctx = chart.getContext('2d')!;
        const W = chart.width;
        const H = chart.height;
        ctx.clearRect(0, 0, W, H);
        const hist = w.market.history;
        let lo = Infinity;
        let hi = -Infinity;
        for (const p of hist) {
          lo = Math.min(lo, p);
          hi = Math.max(hi, p);
        }
        lo -= 3;
        hi += 3;
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        for (let i = 1; i < 4; i++) {
          ctx.beginPath();
          ctx.moveTo(0, (H * i) / 4);
          ctx.lineTo(W, (H * i) / 4);
          ctx.stroke();
        }
        const grad = ctx.createLinearGradient(0, 0, 0, H);
        grad.addColorStop(0, 'rgba(245,197,66,0.35)');
        grad.addColorStop(1, 'rgba(245,197,66,0)');
        ctx.beginPath();
        hist.forEach((p, i) => {
          const x = (i / (hist.length - 1)) * W;
          const y = H - ((p - lo) / (hi - lo)) * H;
          if (i) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        });
        ctx.strokeStyle = '#f5c542';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.lineTo(W, H);
        ctx.lineTo(0, H);
        ctx.fillStyle = grad;
        ctx.fill();
      },
    });
  }
}
