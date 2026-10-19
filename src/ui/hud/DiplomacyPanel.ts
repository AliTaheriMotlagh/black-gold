/**
 * Diplomacy drawer: own standing, incoming proposals, and every nation with relation,
 * tension, strength and treaty flags. Selecting a nation shows the available actions.
 */
import type { Game } from '../../game/Game';
import { Rel } from '../../sim/country';
import { h, svgIcon } from '../dom';
import { compact, digits, loc, t, type I18nKey } from '../../i18n';
import { hasCasusBelli, strength } from '../../sim/systems/diplomacy';
import { audio } from '../../audio/audio';
import { dist } from '../../sim/dmath';

const REL_KEY: Record<Rel, I18nKey> = {
  [Rel.War]: 'diplo.war',
  [Rel.Hostile]: 'diplo.hostile',
  [Rel.Neutral]: 'diplo.neutral',
  [Rel.Pact]: 'diplo.pact',
  [Rel.Alliance]: 'diplo.alliance',
};
const REL_CLS: Record<Rel, string> = { [Rel.War]: 'war', [Rel.Hostile]: 'hostile', [Rel.Neutral]: 'neutral', [Rel.Pact]: 'pact', [Rel.Alliance]: 'ally' };

export class DiplomacyPanel {
  readonly root: HTMLElement;
  private body: HTMLDivElement;
  private isOpen = false;
  private selected = 0;
  private filter: 'major' | 'near' | 'all' = 'major';
  private sig = '';

  constructor(readonly game: Game) {
    this.body = h('div', { class: 'dp-body' });
    this.root = h(
      'aside',
      { class: 'diplomacy', 'aria-hidden': 'true' },
      h('header', null, svgIcon('handshake'), h('h2', null, t('diplo.title')), h('button', { class: 'btn icon', title: t('common.close'), onclick: () => this.close() }, svgIcon('x'))),
      this.body,
    );
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open() {
    this.isOpen = true;
    this.root.classList.add('open');
    this.root.setAttribute('aria-hidden', 'false');
    audio.play('click');
    this.refresh();
  }

  close() {
    this.isOpen = false;
    this.root.classList.remove('open');
    this.root.setAttribute('aria-hidden', 'true');
  }

  refresh() {
    this.sig = '';
    this.update();
  }

  update() {
    if (!this.isOpen) return;
    const w = this.game.world;
    const me = this.game.session.local;
    const d = w.dip;
    let sig = `${this.selected}|${this.filter}|${d.proposals.length}|`;
    for (const c of w.countries) if (c.alive) sig += `${c.idx}:${d.get(me, c.idx)}:${Math.round(d.getTension(me, c.idx) / 5)}:${d.flag(d.trade, me, c.idx) ? 1 : 0}${d.flag(d.sanction, me, c.idx) ? 1 : 0}${d.flag(d.access, me, c.idx) ? 1 : 0},`;
    sig += Math.round(w.countries[me].reputation) + ':' + Math.round(w.countries[me].stability);
    if (sig === this.sig) return;
    this.sig = sig;
    this.render();
  }

  private render() {
    const game = this.game;
    const w = game.world;
    const meIdx = game.session.local;
    const me = w.countries[meIdx];
    const d = w.dip;
    const out: HTMLElement[] = [];
    const meter = (v: number, cls: string) => h('span', { class: `mbar ${cls}` }, h('i', { style: `width:${Math.max(0, Math.min(100, v))}%` }));
    out.push(
      h(
        'div',
        { class: 'dp-me', style: `--c:${me.meta.color}` },
        h('span', { class: 'flag' }),
        h('b', null, loc(me.meta.name)),
        h('div', { class: 'kv' }, h('span', null, t('hud.stability')), meter(me.stability, me.stability < 30 ? 'bad' : 'ok'), h('small', null, digits(String(Math.round(me.stability))))),
        h('div', { class: 'kv' }, h('span', null, t('hud.reputation')), meter(me.reputation, me.reputation < 25 ? 'bad' : 'ok'), h('small', null, digits(String(Math.round(me.reputation))))),
        me.reputation < 30 ? h('p', { class: 'warn' }, t('diplo.worldOpinion')) : null,
      ),
    );
    // Incoming proposals
    const incoming = d.proposals.filter((p) => p.to === meIdx);
    if (incoming.length) {
      out.push(h('h3', null, t('diplo.incoming')));
      for (const p of incoming) {
        const from = w.countries[p.from];
        out.push(
          h(
            'div',
            { class: 'proposal', style: `--c:${from.meta.color}` },
            h('span', { class: 'flag' }),
            h('span', { class: 'txt' }, h('b', null, loc(from.meta.name)), ` ${t('diplo.offers')} ${t(`diplo.propose.${p.kind}` as I18nKey)}`),
            h('button', { class: 'btn primary', onclick: () => game.session.issue({ k: 'respond', id: p.id, accept: true }) }, t('diplo.accept')),
            h('button', { class: 'btn', onclick: () => game.session.issue({ k: 'respond', id: p.id, accept: false }) }, t('diplo.decline')),
          ),
        );
      }
    }
    // Filters
    const fbtn = (id: typeof this.filter, label: I18nKey) =>
      h(
        'button',
        {
          class: `chipbtn${this.filter === id ? ' on' : ''}`,
          onclick: () => {
            this.filter = id;
            this.refresh();
          },
        },
        t(label),
      );
    out.push(h('div', { class: 'filters' }, fbtn('major', 'diplo.filterMajor'), fbtn('near', 'diplo.filterNear'), fbtn('all', 'diplo.filterAll')));
    // Nations
    const mine = strength(w, meIdx);
    const list = w.countries
      .filter((c) => c.alive && c.idx > 0 && c.idx !== meIdx)
      .filter((c) => this.filter === 'all' || (this.filter === 'major' ? c.major || d.get(meIdx, c.idx) !== Rel.Neutral : dist(me.startX, me.startZ, w.cities[c.meta.capital ?? 0]?.x ?? 0, w.cities[c.meta.capital ?? 0]?.z ?? 0) < 1300))
      .sort((a, b) => Number(b.major) - Number(a.major) || d.get(meIdx, a.idx) - d.get(meIdx, b.idx) || d.getTension(meIdx, b.idx) - d.getTension(meIdx, a.idx));
    const rows = h('div', { class: 'nations' });
    for (const c of list) {
      const rel = d.get(meIdx, c.idx);
      const ten = d.getTension(meIdx, c.idx);
      const st = strength(w, c.idx);
      const ratio = st / Math.max(1, mine);
      const row = h(
        'button',
        {
          class: `nation-row ${REL_CLS[rel]}${this.selected === c.idx ? ' sel' : ''}`,
          style: `--c:${c.meta.color}`,
          onclick: () => {
            this.selected = this.selected === c.idx ? 0 : c.idx;
            this.refresh();
          },
        },
        h('span', { class: 'flag' }),
        h('span', { class: 'nm' }, h('b', null, loc(c.meta.name)), h('small', null, c.controller === 'human' ? t('diplo.human') : c.major ? t('diplo.major') : t('diplo.minor'))),
        h('span', { class: `rel ${REL_CLS[rel]}` }, t(REL_KEY[rel])),
        h('span', { class: 'tension', title: t('diplo.tension') }, h('i', { style: `width:${ten}%` })),
        h('span', { class: 'str', title: t('diplo.strength') }, ratio > 1.5 ? '▲▲' : ratio > 1 ? '▲' : ratio > 0.6 ? '■' : '▼'),
        h(
          'span',
          { class: 'flags' },
          d.flag(d.trade, meIdx, c.idx) ? h('i', { title: t('diplo.trade') }, '⇄') : null,
          d.flag(d.access, meIdx, c.idx) ? h('i', { title: t('diplo.access') }, '⇢') : null,
          d.flag(d.sanction, meIdx, c.idx) || d.flag(d.sanction, c.idx, meIdx) ? h('i', { class: 'bad', title: t('diplo.sanctioned') }, '⊘') : null,
        ),
      );
      rows.append(row);
      if (this.selected === c.idx) rows.append(this.actions(c.idx));
    }
    out.push(rows);
    this.body.replaceChildren(...out);
  }

  private actions(target: number) {
    const game = this.game;
    const w = game.world;
    const me = game.session.local;
    const d = w.dip;
    const rel = d.get(me, target);
    const c = w.countries[target];
    const btn = (label: I18nKey, fn: () => void, cls = '') =>
      h(
        'button',
        {
          class: `btn ${cls}`,
          onclick: () => {
            fn();
            audio.play('diplomacy', { volume: 0.6 });
          },
        },
        t(label),
      );
    const box = h('div', { class: 'nation-actions' });
    const pending = (k: string) => d.proposals.some((p) => p.from === me && p.to === target && p.kind === k);
    if (rel === Rel.War) box.append(btn('diplo.proposePeace', () => game.session.issue({ k: 'propose', target, kind: 'peace' }), pending('peace') ? 'pending' : 'primary'));
    else {
      const justified = hasCasusBelli(w, me, target);
      const war = btn('diplo.declareWar', () => game.session.issue({ k: 'war', target }), 'danger');
      box.append(h('div', { class: 'war-box' }, war, h('small', { class: justified ? 'ok' : 'warn' }, t(justified ? 'diplo.casus' : 'diplo.noCasus'))));
      if (rel !== Rel.Alliance) box.append(btn('diplo.proposeAlliance', () => game.session.issue({ k: 'propose', target, kind: 'alliance' }), pending('alliance') ? 'pending' : ''));
      if (rel < Rel.Pact) box.append(btn('diplo.proposePact', () => game.session.issue({ k: 'propose', target, kind: 'pact' }), pending('pact') ? 'pending' : ''));
      if (rel >= Rel.Pact) box.append(btn('diplo.break', () => game.session.issue({ k: 'break', target })));
      if (!d.flag(d.trade, me, target)) box.append(btn('diplo.proposeTrade', () => game.session.issue({ k: 'propose', target, kind: 'trade' }), pending('trade') ? 'pending' : ''));
      if (!d.flag(d.access, me, target)) box.append(btn('diplo.requestAccess', () => game.session.issue({ k: 'propose', target, kind: 'access' }), pending('access') ? 'pending' : ''));
    }
    const sanctioned = d.flag(d.sanction, me, target);
    box.append(btn(sanctioned ? 'diplo.liftSanction' : 'diplo.sanction', () => game.session.issue({ k: 'sanction', target, on: !sanctioned })));
    box.append(
      h(
        'div',
        { class: 'kv small' },
        h('span', null, `${t('hud.stability')} ${digits(String(Math.round(c.stability)))} · ${t('hud.reputation')} ${digits(String(Math.round(c.reputation)))} · ${t('diplo.strength')} $${compact(strength(w, target))}M`),
      ),
    );
    const cap = c.meta.capital !== undefined ? w.cities[c.meta.capital] : null;
    if (cap) box.append(h('button', { class: 'btn ghost', onclick: () => game.view.rig.focus(cap.x, cap.z, 120) }, svgIcon('focus'), loc(w.theater.meta.cities[cap.idx].name)));
    return box;
  }
}
