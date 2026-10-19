/**
 * Menu screens: main, campaign setup (interactive nation picker), multiplayer lobby,
 * settings, field manual, career, how to play, pause and end-of-war debrief.
 */
import type { App } from '../../main';
import type { Settings } from '../../meta/settings';
import { saveSettings } from '../../meta/settings';
import { h, svgIcon } from '../dom';
import { compact, digits, getLang, loc, num, t, type I18nKey } from '../../i18n';
import { RANK_XP, rankOf, rankProgress } from '../../meta/profile';
import { BUILDINGS, BUILD_ORDER, POWERS, RESEARCH, UNITS, UNIT_IDS } from '../../sim/defs';
import { thumb } from '../thumbs';
import { audio } from '../../audio/audio';
import type { Difficulty } from '../../sim/country';
import { LobbyClient, LobbyHost, type LobbySettings, type LobbyState } from '../../net/Lockstep';
import { LocalTransport, PeerTransport, randomCode } from '../../net/Transport';
import type { CountryMeta } from '../../geo/theater';

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard', 'brutal'];
const FUNDS = [3000, 5000, 8000, 12000];
const LIMITS = [0, 1800, 3600, 5400];

/** Real-world blocs shown on the country card (informational). */
const BLOC_ALLIES: Record<string, string[]> = {
  SAU: ['ARE', 'KWT', 'QAT', 'BHR', 'OMN', 'EGY'],
  ARE: ['SAU', 'KWT', 'QAT', 'BHR', 'OMN', 'ISR'],
  KWT: ['SAU', 'ARE', 'QAT', 'BHR', 'OMN'],
  QAT: ['SAU', 'ARE', 'KWT', 'BHR', 'OMN'],
  BHR: ['SAU', 'ARE', 'KWT', 'QAT', 'OMN', 'ISR'],
  OMN: ['SAU', 'ARE', 'KWT', 'QAT', 'BHR'],
  TUR: ['AZE'],
  AZE: ['TUR'],
  ISR: ['ARE', 'BHR', 'EGY', 'JOR'],
  EGY: ['SAU', 'ISR', 'JOR'],
  JOR: ['ISR', 'EGY'],
  IRN: ['IRQ', 'ARM'],
  IRQ: ['IRN'],
  ARM: ['IRN'],
};
const BLOC_RIVALS: Record<string, string[]> = {
  IRN: ['ISR', 'SAU', 'ARE'],
  ISR: ['IRN', 'YEM', 'LBN', 'SYR', 'PSX'],
  YEM: ['SAU', 'ISR'],
  SAU: ['YEM', 'IRN'],
  ARM: ['AZE'],
  AZE: ['ARM'],
  TUR: ['CYP', 'SYR'],
  CYP: ['TUR'],
  LBN: ['ISR'],
  SYR: ['ISR', 'TUR'],
  PSX: ['ISR'],
  ARE: ['IRN'],
};

export class Menus {
  private root: HTMLDivElement;
  private host: LobbyHost | null = null;
  private client: LobbyClient | null = null;

  constructor(readonly app: App) {
    this.root = h('div', { class: 'menus' });
    document.getElementById('ui-root')!.append(this.root);
  }

  clear() {
    this.root.replaceChildren();
    this.app.menuMap.setInteractive(false);
  }

  private show(el: HTMLElement) {
    this.root.replaceChildren(el);
  }

  private settingsObj(): Settings {
    return this.app.settings;
  }

  private click() {
    audio.unlock();
    audio.play('click');
  }

  private item(icon: Parameters<typeof svgIcon>[0], label: I18nKey, fn: () => void, primary = false) {
    return h(
      'button',
      {
        class: `menu-item${primary ? ' primary' : ''}`,
        onclick: () => {
          this.click();
          fn();
        },
      },
      svgIcon(icon),
      t(label),
    );
  }

  private head(title: I18nKey, back: () => void) {
    return h(
      'div',
      { class: 'panel-head' },
      h('button', { class: 'btn icon ghost', title: t('menu.back'), onclick: () => (this.click(), back()) }, svgIcon(getLang() === 'fa' ? 'chevron' : 'chevron')),
      h('h2', null, t(title)),
    );
  }

  // ---------------------------------------------------------------------------

  main() {
    const app = this.app;
    app.menuMap.setInteractive(false);
    app.menuMap.flyover();
    const p = app.profile;
    const r = rankOf(p.xp);
    const langBtn = h('button', { class: 'btn ghost', onclick: () => (this.click(), app.setLanguage(getLang() === 'fa' ? 'en' : 'fa'), this.main()) }, svgIcon('globe'), getLang() === 'fa' ? 'English' : 'فارسی');
    const fsBtn = h('button', { class: 'btn ghost', title: t('menu.fullscreen'), onclick: () => toggleFullscreen() }, svgIcon('fullscreen'));
    this.show(
      h(
        'div',
        { class: 'screen' },
        h(
          'div',
          { class: 'main-menu' },
          h('div', { class: 'title-block' }, h('h1', { class: 'title' }, t('app.title')), h('p', { class: 'subtitle' }, t('app.subtitle')), h('p', { class: 'tagline' }, t('app.tagline'))),
          h(
            'div',
            { class: 'menu-list' },
            this.item('play', 'menu.singleplayer', () => this.setup(), true),
            this.item('users', 'menu.multiplayer', () => this.multiplayer()),
            this.item('book', 'menu.codex', () => this.codex()),
            this.item('medal', 'menu.career', () => this.career()),
            this.item('gear', 'menu.settings', () => this.settings(() => this.main())),
            this.item('map', 'menu.howto', () => this.howto(() => this.main())),
          ),
          h(
            'div',
            { class: 'rank-card' },
            h('div', { class: 'rank-badge' }, digits(String(r + 1))),
            h('div', { class: 'info' }, h('b', null, t(`rank.${r}` as I18nKey)), h('div', { class: 'xpbar' }, h('i', { style: `width:${rankProgress(p.xp) * 100}%` })), h('small', { class: 'muted' }, `${num(p.xp)} XP`)),
          ),
          h('div', { class: 'menu-foot' }, langBtn, fsBtn, h('span', { class: 'grow' }), h('span', null, `${t('menu.version')} 2.0`)),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Single-player setup with the interactive map

  setup() {
    const app = this.app;
    const th = app.theater;
    const prefs = { ...app.settings.setup, rivals: [...app.settings.setup.rivals] };
    const playable = th.meta.countries.filter((c) => c.playable).sort((a, b) => countryPop(th, b.idx) - countryPop(th, a.idx));
    const listEl = h('div', { class: 'country-list' });
    const card = h('div', { class: 'country-card' });
    const optionsEl = h('div', { class: 'panel-body' });
    const byIso = (iso: string) => th.meta.countries.find((c) => c.iso === iso);

    const select = (iso: string, fly = true) => {
      prefs.country = iso;
      prefs.rivals = prefs.rivals.filter((r) => r !== iso);
      if (!prefs.rivals.length) prefs.rivals = suggestRivals(iso).filter((r) => r !== iso).slice(0, 3);
      const m = byIso(iso)!;
      app.menuMap.highlight(m.idx, prefs.rivals.map((r) => byIso(r)?.idx ?? 0));
      if (fly) app.menuMap.focusCountry(m.idx);
      renderList();
      renderCard();
      renderOptions();
    };
    app.menuMap.onPick = (idx) => {
      const m = th.meta.countries.find((c) => c.idx === idx);
      if (m?.playable) {
        this.click();
        select(m.iso, false);
      }
    };

    const renderList = () => {
      listEl.replaceChildren(
        ...playable.map((c) =>
          h(
            'button',
            { class: `country-item${c.iso === prefs.country ? ' on' : ''}`, style: `--c:${c.color}`, onclick: () => (this.click(), select(c.iso)) },
            h('span', { class: 'flag' }),
            h('span', { class: 'nm' }, h('b', null, loc(c.name)), h('small', null, `${compact(countryPop(th, c.idx))} · ${digits(String(th.meta.cities.filter((x) => x.country === c.idx).length))} ${t('setup.cities')}`)),
            h('span', { class: 'stats' }, `🛢 ${digits(String(countryOil(app, c.idx)))}`),
          ),
        ),
      );
      listEl.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
    };

    const renderCard = () => {
      const m = byIso(prefs.country)!;
      const cap = m.capital !== undefined ? th.meta.cities[m.capital] : null;
      const chip = (iso: string, cls: string) => {
        const c = byIso(iso);
        return c ? h('span', { class: `bloc ${cls}`, style: `--c:${c.color}` }, h('i'), loc(c.name)) : null;
      };
      const parts: (HTMLElement | null)[] = [
        h('h3', { style: `--c:${m.color}` }, h('span', { class: 'flag' }), loc(m.name)),
        cap ? h('small', { class: 'muted' }, `★ ${loc(cap.name)}`) : null,
        h(
          'div',
          { class: 'facts' },
          h('div', { class: 'fact' }, h('span', null, t('setup.population')), h('b', null, compact(countryPop(th, m.idx)))),
          h('div', { class: 'fact' }, h('span', null, t('setup.cities')), h('b', null, digits(String(th.meta.cities.filter((x) => x.country === m.idx).length)))),
          h('div', { class: 'fact' }, h('span', null, t('setup.oilFields')), h('b', null, digits(String(countryOil(app, m.idx))))),
        ),
        (BLOC_ALLIES[m.iso] ?? []).length ? h('div', { class: 'field' }, h('span', { class: 'label' }, t('setup.allies')), h('div', { class: 'blocs' }, ...(BLOC_ALLIES[m.iso] ?? []).map((i) => chip(i, 'ally')))) : null,
        (BLOC_RIVALS[m.iso] ?? []).length ? h('div', { class: 'field' }, h('span', { class: 'label' }, t('setup.rivalsOf')), h('div', { class: 'blocs' }, ...(BLOC_RIVALS[m.iso] ?? []).map((i) => chip(i, 'rival')))) : null,
      ];
      card.replaceChildren(...parts.filter((x): x is HTMLElement => !!x));
    };

    const seg = <T extends string | number>(values: T[], cur: T, label: (v: T) => string, set: (v: T) => void) =>
      h('div', { class: 'seg' }, ...values.map((v) => h('button', { class: v === cur ? 'on' : '', onclick: () => (this.click(), set(v), renderOptions()) }, label(v))));

    const renderOptions = () => {
      const majors = playable.filter((c) => c.iso !== prefs.country);
      optionsEl.replaceChildren(
        h(
          'div',
          { class: 'field' },
          h('span', { class: 'label' }, t('setup.rivals')),
          h(
            'div',
            { class: 'chips' },
            ...majors.slice(0, 18).map((c) =>
              h(
                'button',
                {
                  class: `chip-toggle${prefs.rivals.includes(c.iso) ? ' on' : ''}`,
                  style: `--c:${c.color}`,
                  disabled: !prefs.rivals.includes(c.iso) && prefs.rivals.length >= 6,
                  onclick: () => {
                    this.click();
                    prefs.rivals = prefs.rivals.includes(c.iso) ? prefs.rivals.filter((r) => r !== c.iso) : [...prefs.rivals, c.iso];
                    app.menuMap.highlight(byIso(prefs.country)!.idx, prefs.rivals.map((r) => byIso(r)?.idx ?? 0));
                    renderOptions();
                  },
                },
                h('i'),
                loc(c.name),
              ),
            ),
          ),
          h('span', { class: 'hint' }, t('setup.rivalsHint')),
        ),
        h('div', { class: 'field' }, h('span', { class: 'label' }, t('setup.difficulty')), seg(DIFFS, prefs.difficulty, (d) => t(`diff.${d}` as I18nKey), (d) => (prefs.difficulty = d))),
        h(
          'div',
          { class: 'field' },
          h('span', { class: 'label' }, t('setup.scenario')),
          seg<'realistic' | 'sandbox'>(['realistic', 'sandbox'], prefs.scenario, (s) => t(`setup.${s}` as I18nKey), (s) => (prefs.scenario = s)),
          h('span', { class: 'hint' }, t(prefs.scenario === 'realistic' ? 'setup.realisticDesc' : 'setup.sandboxDesc')),
        ),
        h('div', { class: 'field' }, h('span', { class: 'label' }, t('setup.funds')), seg(FUNDS, prefs.funds, (f) => `$${compact(f)}M`, (f) => (prefs.funds = f))),
        h('div', { class: 'field' }, h('span', { class: 'label' }, t('setup.timeLimit')), seg(LIMITS, prefs.timeLimit, (l) => (l ? `${digits(String(l / 60))} ${t('common.min')}` : t('setup.noLimit')), (l) => (prefs.timeLimit = l))),
        h('label', { class: 'toggle' }, (() => {
          const i = h('input', { type: 'checkbox' }) as HTMLInputElement;
          i.checked = prefs.events;
          i.onchange = () => (prefs.events = i.checked);
          return i;
        })(), h('span', null, t('setup.events'))),
        h('button', { class: 'btn gold start-btn', onclick: () => (this.click(), app.startSingle(prefs)) }, svgIcon('play'), t('setup.start')),
      );
    };

    this.show(
      h(
        'div',
        { class: 'screen', style: 'pointer-events:none' },
        h(
          'div',
          { class: 'setup' },
          h('div', { class: 'col panel', style: 'pointer-events:auto' }, this.head('setup.country', () => this.main()), h('div', { class: 'panel-body', style: 'padding-bottom:0' }, h('span', { class: 'hint muted' }, t('setup.countryHint'))), listEl),
          h('div', { class: 'col map-col' }),
          h('div', { class: 'col panel', style: 'pointer-events:auto; overflow:auto' }, card, optionsEl),
        ),
      ),
    );
    app.menuMap.setInteractive(true);
    select(prefs.country);
  }

  // ---------------------------------------------------------------------------
  // Multiplayer

  multiplayer(joinCode?: string) {
    const app = this.app;
    app.menuMap.setInteractive(false);
    const s = this.settingsObj();
    const name = h('input', { class: 'text-input', maxLength: 24, placeholder: t('mp.name'), value: s.name || '' }) as HTMLInputElement;
    const code = h('input', { class: 'text-input code', maxLength: 6, placeholder: 'ABC123', value: joinCode ?? '' }) as HTMLInputElement;
    const err = h('p', { class: 'muted' });
    const saveName = () => {
      s.name = name.value.trim().slice(0, 24);
      saveSettings(s);
    };
    const transport = () => (new URLSearchParams(location.search).get('local') ? new LocalTransport() : new PeerTransport());
    const hostBtn = h('button', { class: 'btn primary', onclick: async () => {
      this.click();
      saveName();
      err.textContent = t('mp.connecting');
      const settings: LobbySettings = { difficulty: s.setup.difficulty, scenario: s.setup.scenario, funds: s.setup.funds, events: s.setup.events, timeLimit: s.setup.timeLimit, rivals: s.setup.rivals };
      const host = new LobbyHost(transport(), randomCode(), app.theater, s.name || 'Host', s.setup.country, settings);
      try {
        await host.open();
        this.host = host;
        this.lobby();
      } catch (e) {
        host.close();
        err.textContent = `${t('mp.failed')} (${(e as Error).message})`;
      }
    } }, svgIcon('flag'), t('mp.host'));
    const join = async () => {
      this.click();
      saveName();
      const c = code.value.trim().toUpperCase();
      if (c.length < 4) return;
      err.textContent = t('mp.connecting');
      const client = new LobbyClient(transport(), c, app.theater, s.name || 'Commander');
      try {
        await client.connect();
        this.client = client;
        this.lobby();
      } catch (e) {
        client.close();
        err.textContent = `${t('mp.failed')} (${(e as Error).message})`;
      }
    };
    const joinBtn = h('button', { class: 'btn', onclick: join }, svgIcon('link'), t('mp.joinBtn'));
    this.show(
      h(
        'div',
        { class: 'screen center' },
        h(
          'div',
          { class: 'panel modal' },
          this.head('mp.title', () => this.main()),
          h(
            'div',
            { class: 'panel-body' },
            h('p', { class: 'muted', style: 'margin:0' }, t('mp.p2p')),
            h('div', { class: 'field' }, h('label', null, t('mp.name')), name),
            hostBtn,
            h('div', { class: 'field' }, h('label', null, t('mp.join')), h('div', { style: 'display:flex;gap:8px' }, code, joinBtn)),
            err,
          ),
        ),
      ),
    );
    if (joinCode) void join();
  }

  private lobby() {
    const app = this.app;
    const host = this.host;
    const client = this.client;
    const playersEl = h('div', { class: 'players' });
    const log = h('div', { class: 'log' });
    const optsEl = h('div', { class: 'panel-body' });
    const status = h('p', { class: 'muted' });
    const th = app.theater;
    const playable = th.meta.countries.filter((c) => c.playable);
    const mySlot = () => (host ? 0 : client!.slot);
    const leave = () => {
      host?.close();
      client?.close();
      this.host = null;
      this.client = null;
      this.main();
    };
    const addChat = (from: string, text: string) => {
      log.append(h('div', null, h('b', null, `${from}: `), text));
      log.scrollTop = log.scrollHeight;
      audio.play('click', { volume: 0.4 });
    };
    const render = (state: LobbyState) => {
      const me = state.players.find((p) => p.slot === mySlot());
      playersEl.replaceChildren(
        ...state.players.map((p) => {
          const c = playable.find((x) => x.iso === p.country);
          return h(
            'div',
            { class: 'player', style: `--c:${c?.color ?? '#888'}` },
            h('span', { class: 'flag' }),
            h('span', { class: 'nm' }, p.name, p.host ? h('span', { class: 'tag' }, t('mp.hostTag')) : null, p.slot === mySlot() ? h('span', { class: 'tag' }, t('mp.you')) : null),
            h('span', { class: 'muted' }, c ? loc(c.name) : p.country),
            p.ping ? h('small', { class: 'muted' }, `${digits(String(p.ping))}ms`) : null,
            h('span', { class: `ready${p.ready ? ' on' : ''}` }, p.ready ? t('mp.ready') : t('mp.notReady')),
            host && !p.host ? h('button', { class: 'btn ghost', onclick: () => host.kick(p.slot) }, t('mp.kick')) : null,
          );
        }),
      );
      const taken = new Set(state.players.filter((p) => p.slot !== mySlot()).map((p) => p.country));
      const pick = h('select', { class: 'text-input' }, ...playable.map((c) => h('option', { value: c.iso, selected: me?.country === c.iso, disabled: taken.has(c.iso) }, loc(c.name) + (taken.has(c.iso) ? ` (${t('mp.taken')})` : '')))) as HTMLSelectElement;
      pick.onchange = () => (host ? host.setHostCountry(pick.value) : client!.pick(pick.value));
      const st = state.settings;
      const controls: HTMLElement[] = [h('div', { class: 'field' }, h('label', null, t('mp.pick')), pick)];
      if (host) {
        const seg = <T extends string | number>(values: T[], cur: T, label: (v: T) => string, key: keyof LobbySettings) =>
          h('div', { class: 'seg' }, ...values.map((v) => h('button', { class: v === cur ? 'on' : '', onclick: () => host.updateSettings({ [key]: v } as Partial<LobbySettings>) }, label(v))));
        controls.push(
          h('div', { class: 'field' }, h('label', null, t('setup.difficulty')), seg(DIFFS, st.difficulty, (d) => t(`diff.${d}` as I18nKey), 'difficulty')),
          h('div', { class: 'field' }, h('label', null, t('setup.scenario')), seg<'realistic' | 'sandbox'>(['realistic', 'sandbox'], st.scenario, (x) => t(`setup.${x}` as I18nKey), 'scenario')),
          h('div', { class: 'field' }, h('label', null, t('setup.funds')), seg(FUNDS, st.funds, (f) => `$${compact(f)}M`, 'funds')),
          h(
            'div',
            { class: 'field' },
            h('label', null, t('setup.rivals')),
            h(
              'div',
              { class: 'chips' },
              ...playable.slice(0, 16).map((c) =>
                h(
                  'button',
                  { class: `chip-toggle${st.rivals.includes(c.iso) ? ' on' : ''}`, style: `--c:${c.color}`, onclick: () => host.updateSettings({ rivals: st.rivals.includes(c.iso) ? st.rivals.filter((r) => r !== c.iso) : [...st.rivals, c.iso].slice(0, 6) }) },
                  h('i'),
                  loc(c.name),
                ),
              ),
            ),
          ),
          h('button', { class: 'btn gold start-btn', disabled: !host.allReady, onclick: () => (this.click(), host.start()) }, svgIcon('play'), t('mp.start')),
        );
        if (!host.allReady) controls.push(h('small', { class: 'muted' }, t('mp.needReady')));
      } else {
        controls.push(
          h('p', { class: 'muted' }, `${t(`diff.${st.difficulty}` as I18nKey)} · ${t(`setup.${st.scenario}` as I18nKey)} · $${compact(st.funds)}M`),
          h('button', { class: `btn ${me?.ready ? '' : 'primary'}`, onclick: () => client!.ready(!me?.ready) }, svgIcon('check'), me?.ready ? t('mp.notReady') : t('mp.ready')),
        );
      }
      optsEl.replaceChildren(...controls);
    };
    const roomCode = host ? host.code : client!.code;
    const link = `${location.origin}/play/?room=${roomCode}`;
    const copyBtn = h('button', { class: 'btn', onclick: async () => {
      try {
        if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: t('app.title'), url: link });
        else await navigator.clipboard.writeText(link);
        status.textContent = t('mp.copied');
      } catch {
        status.textContent = link;
      }
    } }, svgIcon('link'), t('mp.copy'));
    const input = h('input', { class: 'text-input', placeholder: t('mp.chat'), maxLength: 200 }) as HTMLInputElement;
    const form = h('form', { onsubmit: (e: Event) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return;
      input.value = '';
      if (host) host.chat(host.state.players[0].name, v);
      else client!.chat(v);
    } }, input, h('button', { class: 'btn', type: 'submit' }, t('mp.send')));
    this.show(
      h(
        'div',
        { class: 'screen center' },
        h(
          'div',
          { class: 'panel modal wide' },
          this.head('mp.title', leave),
          h(
            'div',
            { class: 'panel-body lobby' },
            h('div', { style: 'display:flex;flex-direction:column;gap:12px' }, h('div', { class: 'room-code' }, h('span', { class: 'muted' }, t('mp.code')), h('b', null, roomCode), copyBtn), status, h('h3', { class: 'muted', style: 'margin:0' }, t('mp.players')), playersEl, optsEl),
            h('div', { class: 'chat' }, log, form),
          ),
        ),
      ),
    );
    const onStart = (info: Parameters<App['startNetwork']>[0]) => app.startNetwork(info);
    if (host) {
      host.onLobby = render;
      host.onChat = addChat;
      host.onStart = onStart;
      host.onDrop = (n) => addChat('⚠', `${n} ${t('mp.dropped')}`);
      host.onDesync = () => app.game?.hud.alert({ t: 'alert', to: 0, key: 'crisis', tone: 'bad', arg: t('mp.desync') });
      render(host.state);
    } else {
      client!.onLobby = render;
      client!.onChat = addChat;
      client!.onStart = onStart;
      client!.onClosed = (reason) => {
        if (app.game) app.game.hud.crisis('summit');
        else {
          status.textContent = reason === 'hostLeft' ? t('mp.hostLeft') : `${t('mp.failed')} (${reason})`;
        }
      };
      if (client!.state) render(client!.state);
      else playersEl.append(h('p', { class: 'muted' }, t('mp.waiting')));
    }
  }

  // ---------------------------------------------------------------------------

  settings(back: () => void) {
    const app = this.app;
    const s = app.settings;
    const save = () => saveSettings(s);
    const seg = <T extends string | number | null>(values: T[], cur: T, label: (v: T) => string, set: (v: T) => void) =>
      h('div', { class: 'seg' }, ...values.map((v) => h('button', { class: v === cur ? 'on' : '', onclick: () => (this.click(), set(v), save(), this.settings(back)) }, label(v))));
    const slider = (label: I18nKey, key: 'master' | 'music' | 'sfx') => {
      const out = h('output', null, `${Math.round(s[key] * 100)}%`);
      const input = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: s[key] }) as HTMLInputElement;
      input.oninput = () => {
        s[key] = Number(input.value);
        out.textContent = `${Math.round(s[key] * 100)}%`;
        audio.setVolumes({ master: s.master, music: s.music, sfx: s.sfx });
        save();
      };
      return h('div', { class: 'field' }, h('label', null, t(label)), h('div', { class: 'slider' }, input, out));
    };
    const toggle = (label: I18nKey, key: 'edgeScroll' | 'haptics' | 'showFps' | 'labels') => {
      const i = h('input', { type: 'checkbox' }) as HTMLInputElement;
      i.checked = s[key];
      i.onchange = () => {
        s[key] = i.checked;
        save();
        if (app.game) {
          if (key === 'labels') app.game.layers.showLabels = i.checked;
          if (key === 'showFps') app.game.hud.showFps = i.checked;
          if (key === 'haptics') app.game.ctl.haptics = i.checked;
          if (key === 'edgeScroll') app.game.input.edgeScroll = i.checked;
        }
      };
      return h('label', { class: 'toggle' }, i, h('span', null, t(label)));
    };
    this.show(
      h(
        'div',
        { class: 'screen center' },
        h(
          'div',
          { class: 'panel modal' },
          this.head('settings.title', back),
          h(
            'div',
            { class: 'panel-body' },
            h('div', { class: 'field' }, h('label', null, t('settings.quality')), seg([null, 'low', 'medium', 'high'] as const, s.quality, (q) => t(q ? (`settings.${q}` as I18nKey) : 'settings.auto'), (q) => (s.quality = q)), h('span', { class: 'hint' }, t('settings.restart'))),
            h(
              'div',
              { class: 'field' },
              h('label', null, t('settings.imagery')),
              seg(['s2', 'gibs', 'base'] as const, s.imagery, (v) => t(`settings.imagery.${v}` as I18nKey), (v) => {
                s.imagery = v;
                app.view.terrain.setImagery(v);
              }),
              h('span', { class: 'hint' }, t('settings.imageryNote')),
            ),
            slider('settings.master', 'master'),
            slider('settings.music', 'music'),
            slider('settings.sfx', 'sfx'),
            h('div', { class: 'field' }, h('label', null, t('settings.uiScale')), seg([0.9, 1, 1.15, 1.3], s.uiScale, (v) => `${Math.round(v * 100)}%`, (v) => {
              s.uiScale = v;
              document.documentElement.style.setProperty('--ui', String(v));
            })),
            h('div', { class: 'field' }, h('label', null, t('settings.controls')), toggle('settings.edgeScroll', 'edgeScroll'), toggle('settings.haptics', 'haptics'), toggle('settings.labels', 'labels'), toggle('settings.fps', 'showFps')),
            h('div', { class: 'field' }, h('label', null, t('settings.language')), seg(['en', 'fa'] as const, getLang(), (l) => (l === 'fa' ? 'فارسی' : 'English'), (l) => app.setLanguage(l))),
            h('div', { class: 'field' }, h('label', null, t('settings.credits')), h('p', { class: 'attrib' }, app.theater.meta.attribution, h('br'), 'Sentinel-2 cloudless © EOX IT Services (contains modified Copernicus Sentinel data). Three.js, PeerJS. Fonts: Rajdhani, Vazirmatn.')),
          ),
        ),
      ),
    );
  }

  howto(back: () => void) {
    const sec = (n: number) => h('section', null, h('h3', null, t(`howto.${n}t` as I18nKey)), h('p', null, t(`howto.${n}` as I18nKey)));
    this.show(h('div', { class: 'screen center' }, h('div', { class: 'panel modal wide' }, this.head('howto.title', back), h('div', { class: 'panel-body' }, h('div', { class: 'howto' }, ...[1, 2, 3, 4, 5, 6, 7].map(sec))))));
  }

  codex(tab: 'units' | 'buildings' | 'tech' | 'powers' = 'units') {
    const tabs = h(
      'div',
      { class: 'seg' },
      ...(['units', 'buildings', 'tech', 'powers'] as const).map((k) => h('button', { class: k === tab ? 'on' : '', onclick: () => (this.click(), this.codex(k)) }, t(`codex.${k === 'tech' ? 'tech' : k}` as I18nKey))),
    );
    const grid = h('div', { class: 'codex-grid' });
    const chip = (s: string) => h('span', { class: 'chip' }, s);
    if (tab === 'units')
      for (const id of UNIT_IDS) {
        const d = UNITS[id];
        const range = d.weapons.reduce((m, w) => Math.max(m, w.range), 0);
        grid.append(
          h(
            'div',
            { class: 'codex-card' },
            h('img', { src: thumb(`unit.${id}`), alt: '' }),
            h(
              'div',
              { class: 'txt' },
              h('b', null, t(`unit.${id}` as I18nKey)),
              h('p', null, t(`unit.${id}.desc` as I18nKey)),
              h('div', { class: 'specs' }, chip(`$${num(d.cost)}M`), chip(`${t('hud.hp')} ${num(d.hp)}`), range ? chip(`${t('hud.range')} ${digits(String(range))} ${t('common.km')}`) : null, chip(`T${digits(String(d.tier))}`), chip(t(`bld.${d.producers[0]}` as I18nKey))),
            ),
          ),
        );
      }
    else if (tab === 'buildings')
      for (const id of ['hq', ...BUILD_ORDER]) {
        const d = BUILDINGS[id];
        grid.append(
          h(
            'div',
            { class: 'codex-card' },
            h('img', { src: thumb(`bld.${id}`), alt: '' }),
            h('div', { class: 'txt' }, h('b', null, t(`bld.${id}` as I18nKey)), h('p', null, t(`bld.${id}.desc` as I18nKey)), h('div', { class: 'specs' }, chip(`$${num(d.cost)}M`), chip(`${d.power > 0 ? '+' : ''}${num(d.power)} ${t('common.mw')}`), chip(`T${digits(String(d.tier))}`))),
          ),
        );
      }
    else if (tab === 'tech')
      for (const r of RESEARCH)
        grid.append(h('div', { class: 'codex-card' }, svgIcon(r.icon as never), h('div', { class: 'txt' }, h('b', null, t(`res.${r.id}` as I18nKey)), h('p', null, t(`res.${r.id}.desc` as I18nKey)), h('div', { class: 'specs' }, chip(`$${num(r.cost)}M`), chip(`T${digits(String(r.tier))}`)))));
    else
      for (const p of POWERS)
        grid.append(h('div', { class: 'codex-card' }, svgIcon(p.icon as never), h('div', { class: 'txt' }, h('b', null, t(`pow.${p.id}` as I18nKey)), h('p', null, t(`pow.${p.id}.desc` as I18nKey)), h('div', { class: 'specs' }, chip(`${digits(String(p.points))}★`), chip(`${digits(String(p.cooldown))}${t('common.sec')}`)))));
    this.show(h('div', { class: 'screen center' }, h('div', { class: 'panel modal wide' }, this.head('codex.title', () => this.main()), h('div', { class: 'panel-body' }, tabs, grid))));
  }

  career() {
    const p = this.app.profile;
    const r = rankOf(p.xp);
    const stat = (label: I18nKey, v: string) => h('div', { class: 'stat' }, h('span', null, t(label)), h('b', null, v));
    this.show(
      h(
        'div',
        { class: 'screen center' },
        h(
          'div',
          { class: 'panel modal' },
          this.head('career.title', () => this.main()),
          h(
            'div',
            { class: 'panel-body' },
            h('div', { class: 'rank-card', style: 'max-width:none' }, h('div', { class: 'rank-badge' }, digits(String(r + 1))), h('div', { class: 'info' }, h('b', null, t(`rank.${r}` as I18nKey)), h('div', { class: 'xpbar' }, h('i', { style: `width:${rankProgress(p.xp) * 100}%` })), h('small', { class: 'muted' }, `${num(p.xp)} / ${num(RANK_XP[Math.min(RANK_XP.length - 1, r + 1)])} XP`))),
            h('div', { class: 'stat-grid' }, stat('career.games', num(p.games)), stat('career.wins', num(p.wins)), stat('career.best', num(p.bestScore))),
          ),
        ),
      ),
    );
  }

  pause() {
    const app = this.app;
    const show = () =>
      this.show(
        h(
          'div',
          { class: 'screen center' },
          h(
            'div',
            { class: 'panel modal', style: 'max-width:380px' },
            h('div', { class: 'panel-head' }, h('h2', null, t('menu.paused'))),
            h(
              'div',
              { class: 'panel-body' },
              h('div', { class: 'menu-list', style: 'max-width:none' }, this.item('play', 'menu.resume', () => app.resume(), true), this.item('gear', 'menu.settings', () => this.settings(show)), this.item('map', 'menu.howto', () => this.howto(show)), this.item('flag', 'menu.surrender', () => app.surrender()), this.item('home', 'menu.quit', () => app.quit())),
            ),
          ),
        ),
      );
    show();
  }

  end(r: { victory: boolean; winners: number[]; score: number; xp: number; rankBefore: number }) {
    const app = this.app;
    const game = app.game!;
    const w = game.world;
    const me = w.countries[game.session.local];
    const s = me.stats;
    const stat = (label: I18nKey, v: string) => h('div', { class: 'stat' }, h('span', null, t(label)), h('b', null, v));
    const rankAfter = rankOf(app.profile.xp);
    this.show(
      h(
        'div',
        { class: 'screen center' },
        h(
          'div',
          { class: 'panel modal wide' },
          h('div', { class: `end-banner ${r.victory ? 'victory' : 'defeat'}` }, h('h1', null, t(r.victory ? 'end.victory' : 'end.defeat')), r.winners.length ? h('p', { class: 'muted' }, `${t('end.winners')}: ${r.winners.map((i) => loc(w.countries[i].meta.name)).join(' · ')}`) : null),
          h(
            'div',
            { class: 'panel-body' },
            h(
              'div',
              { class: 'stat-grid' },
              stat('end.score', num(r.score)),
              stat('end.time', `${digits(String(Math.floor(w.time / 60)))} ${t('common.min')}`),
              stat('end.kills', num(s.kills)),
              stat('end.lost', num(s.unitsLost)),
              stat('end.buildings', num(s.buildingsDestroyed)),
              stat('end.cities', num(s.citiesCaptured)),
              stat('end.earned', `$${compact(s.earned)}M`),
              stat('end.missiles', num(s.missilesFired)),
              stat('end.intercepts', num(s.intercepts)),
              stat('end.xp', `+${num(r.xp)}`),
            ),
            rankAfter > r.rankBefore ? h('p', { style: 'color:var(--gold);font:700 16px var(--font)' }, `${t('end.rankUp')} ${t(`rank.${rankAfter}` as I18nKey)}`) : null,
            h(
              'div',
              { class: 'actions-row' },
              h('button', { class: 'btn ghost', onclick: () => (this.clear(), game.input.enabled = true) }, t('end.spectate')),
              game.session.multiplayer ? null : h('button', { class: 'btn', onclick: () => app.restart() }, t('end.again')),
              h('button', { class: 'btn gold', onclick: () => app.quit() }, t('end.menu')),
            ),
          ),
        ),
      ),
    );
  }
}

function countryPop(th: { meta: { cities: { country: number; pop: number }[] } }, idx: number) {
  let p = 0;
  for (const c of th.meta.cities) if (c.country === idx) p += c.pop;
  return p;
}

function countryOil(app: App, idx: number) {
  const th = app.theater;
  let n = 0;
  for (const f of th.meta.oil) {
    const c = th.countryAt(f.x, f.z);
    if (c === idx) n++;
    else if (f.offshore) {
      // Offshore: nearest coast decides (approximate with a small search).
      for (let r = 4; r < 120; r += 4) {
        const owner = [th.countryAt(f.x + r, f.z), th.countryAt(f.x - r, f.z), th.countryAt(f.x, f.z + r), th.countryAt(f.x, f.z - r)].find((o) => o);
        if (owner) {
          if (owner === idx) n++;
          break;
        }
      }
    }
  }
  return n;
}

function suggestRivals(iso: string): string[] {
  const base = BLOC_RIVALS[iso] ?? [];
  const majors = ['IRN', 'SAU', 'TUR', 'ISR', 'EGY', 'IRQ'];
  return [...base.filter((b) => majors.includes(b) || ['ARE', 'YEM', 'SYR', 'AZE', 'ARM'].includes(b)), ...majors.filter((m) => m !== iso && !base.includes(m))];
}

function toggleFullscreen() {
  const doc = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  if (document.fullscreenElement || doc.webkitFullscreenElement) {
    (document.exitFullscreen ?? doc.webkitExitFullscreen)?.call(document);
    return;
  }
  const req = el.requestFullscreen?.bind(el) ?? el.webkitRequestFullscreen?.bind(el);
  Promise.resolve(req?.())
    .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })?.lock?.('landscape'))
    .catch(() => {});
}

export type { CountryMeta };
