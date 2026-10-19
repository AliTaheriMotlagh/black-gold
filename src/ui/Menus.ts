import { START_REGIONS, WORLD_H, WORLD_W, lonLatToWorld } from '../geo/geography';
import type { Difficulty, MatchSettings } from '../game/config';
import type { TeamStats } from '../game/entities';
import { type I18nKey, type Lang, fmtTime, getLang, loc, num, t } from '../i18n';
import { ACHIEVEMENTS, type AchievementId, type Profile, RANK_XP, achDesc, achName, rankOf, rankProgress } from '../meta/profile';
import type { Quality, Settings } from '../meta/settings';
import { h, svgIcon } from './dom';

export interface MenuHost {
  click: () => void;
}

/** Full-screen menus layered above the 3D scene. */
export class Menus {
  readonly root: HTMLDivElement;
  constructor(private host: MenuHost) {
    this.root = h('div', { class: 'menus' });
  }

  clear() {
    this.root.innerHTML = '';
  }

  private show(el: HTMLElement) {
    this.root.innerHTML = '';
    this.root.append(el);
  }

  private btn(label: string, icon: Parameters<typeof svgIcon>[0] | null, fn: () => void, cls = '') {
    return h(
      'button',
      {
        class: `btn ${cls}`,
        onclick: () => {
          this.host.click();
          fn();
        },
      },
      icon ? svgIcon(icon) : null,
      label,
    );
  }

  main(opts: { profile: Profile; onPlay: () => void; onSettings: () => void; onHowTo: () => void; onCareer: () => void; onLang: (l: Lang) => void; onFullscreen: () => void }) {
    const p = opts.profile;
    const rank = rankOf(p.xp);
    const other: Lang = getLang() === 'fa' ? 'en' : 'fa';
    const el = h(
      'div',
      { class: 'screen vignette main-menu' },
      h(
        'div',
        { class: 'mm-top' },
        this.btn(other === 'fa' ? 'فارسی' : 'English', 'globe', () => opts.onLang(other), 'small ghost'),
        this.btn('', 'fullscreen', opts.onFullscreen, 'small ghost icon-only'),
      ),
      h(
        'div',
        { class: 'mm-center' },
        h('div', { class: 'title-block' }, h('div', { class: 'title' }, t('app.title')), h('div', { class: 'subtitle' }, t('app.subtitle')), h('div', { class: 'tagline' }, t('app.tagline'))),
        h(
          'div',
          { class: 'menu-buttons' },
          this.btn(t('menu.play'), 'play', opts.onPlay, 'primary'),
          this.btn(t('menu.profile'), 'medal', opts.onCareer),
          this.btn(t('menu.howto'), 'book', opts.onHowTo),
          this.btn(t('menu.settings'), 'gear', opts.onSettings),
        ),
      ),
      h(
        'div',
        { class: 'mm-bottom' },
        h(
          'div',
          { class: 'rank-badge', onclick: opts.onCareer },
          h('div', { class: 'rank-insignia' }, num(rank + 1)),
          h('div', null, h('div', { style: 'font-weight:700;color:var(--text)' }, t(`rank.${rank}` as I18nKey)), h('div', null, `${num(p.xp)} XP`), h('div', { class: 'xpbar' }, h('div', { style: `width:${rankProgress(p.xp) * 100}%` }))),
        ),
        h('div', null, 'v1.0 · Three.js · WebGL'),
      ),
    );
    this.show(el);
  }

  setup(minimap: HTMLCanvasElement, initial: MatchSettings, onStart: (m: MatchSettings) => void, onBack: () => void) {
    const m = { ...initial };
    const mapCanvas = h('canvas', { width: minimap.width * 2, height: minimap.height * 2 });
    const ctx = mapCanvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(minimap, 0, 0, mapCanvas.width, mapCanvas.height);
    const map = h('div', { class: 'region-map' }, mapCanvas);
    const dots: HTMLElement[] = [];
    const regionName = h('div', { style: 'margin-top:8px;font-weight:700;color:var(--gold);font-size:18px' });
    const renderDots = () => {
      dots.forEach((d) => d.classList.toggle('sel', d.dataset.id === m.startRegion));
      regionName.textContent = loc(START_REGIONS.find((r) => r.id === m.startRegion)!.name);
    };
    for (const r of START_REGIONS) {
      const w = lonLatToWorld(r.ll[0], r.ll[1]);
      const d = h(
        'button',
        {
          class: 'region-dot',
          style: `left:${(w.x / WORLD_W) * 100}%;top:${(w.z / WORLD_H) * 100}%`,
          onclick: () => {
            this.host.click();
            m.startRegion = r.id;
            renderDots();
          },
        },
        h('i'),
        h('span', null, loc(r.name)),
      );
      d.dataset.id = r.id;
      dots.push(d);
      map.append(d);
    }
    renderDots();

    const seg = <T extends string | number>(options: { v: T; label: string }[], get: () => T, set: (v: T) => void) => {
      const wrap = h('div', { class: 'segmented' });
      const render = () => {
        wrap.innerHTML = '';
        for (const o of options)
          wrap.append(
            h(
              'button',
              {
                class: `btn small ${get() === o.v ? 'active' : ''}`,
                onclick: () => {
                  this.host.click();
                  set(o.v);
                  render();
                },
              },
              o.label,
            ),
          );
      };
      render();
      return wrap;
    };

    const el = h(
      'div',
      { class: 'screen dim' },
      h(
        'div',
        { class: 'dialog panel' },
        h('h2', null, svgIcon('map'), t('setup.title')),
        h(
          'div',
          { class: 'setup-grid' },
          h('div', null, h('div', { class: 'field' }, h('span', { class: 'label' }, t('region.select')), map, regionName)),
          h(
            'div',
            null,
            h('div', { class: 'field' }, h('span', { class: 'label' }, t('setup.opponents')), seg([1, 2, 3].map((v) => ({ v, label: num(v) })), () => m.opponents, (v) => (m.opponents = v))),
            h(
              'div',
              { class: 'field' },
              h('span', { class: 'label' }, t('setup.difficulty')),
              seg<Difficulty>(
                (['easy', 'normal', 'hard'] as Difficulty[]).map((v) => ({ v, label: t(`diff.${v}` as I18nKey) })),
                () => m.difficulty,
                (v) => (m.difficulty = v),
              ),
            ),
            h('div', { class: 'field' }, h('span', { class: 'label' }, t('setup.credits')), seg([2000, 3000, 5000, 10000].map((v) => ({ v, label: `$${num(v)}` })), () => m.startCredits, (v) => (m.startCredits = v))),
            h(
              'div',
              { class: 'field' },
              h('span', { class: 'label' }, t('setup.events')),
              seg(
                [
                  { v: 1, label: t('setup.on') },
                  { v: 0, label: t('setup.off') },
                ],
                () => (m.events ? 1 : 0),
                (v) => (m.events = v === 1),
              ),
            ),
          ),
        ),
        h('div', { class: 'dialog-actions' }, this.btn(t('menu.back'), null, onBack, 'ghost'), this.btn(t('menu.start'), 'play', () => onStart(m), 'primary')),
      ),
    );
    this.show(el);
  }

  settings(s: Settings, onChange: (s: Settings) => void, onBack: () => void) {
    const slider = (label: I18nKey, key: 'master' | 'music' | 'sfx') => {
      const input = h('input', { type: 'range', min: '0', max: '1', step: '0.05' }) as HTMLInputElement;
      input.value = String(s[key]);
      input.addEventListener('input', () => {
        s[key] = Number(input.value);
        onChange(s);
      });
      return h('div', { class: 'field' }, h('label', null, t(label)), input);
    };
    const toggle = (label: I18nKey, key: 'edgeScroll' | 'haptics' | 'showFps' | 'labels') => {
      const sw = h('div', { class: `switch ${s[key] ? 'on' : ''}` });
      return h(
        'div',
        {
          class: 'toggle',
          onclick: () => {
            this.host.click();
            s[key] = !s[key];
            sw.classList.toggle('on', s[key]);
            onChange(s);
          },
        },
        h('span', null, t(label)),
        sw,
      );
    };
    const quality = h('div', { class: 'segmented' });
    const renderQ = () => {
      quality.innerHTML = '';
      for (const q of ['low', 'medium', 'high'] as Quality[])
        quality.append(
          h(
            'button',
            {
              class: `btn small ${s.quality === q ? 'active' : ''}`,
              onclick: () => {
                this.host.click();
                s.quality = q;
                onChange(s);
                renderQ();
              },
            },
            t(`settings.quality.${q}` as I18nKey),
          ),
        );
    };
    renderQ();
    const lang = h('div', { class: 'segmented' });
    for (const l of ['en', 'fa'] as Lang[])
      lang.append(
        h(
          'button',
          {
            class: `btn small ${getLang() === l ? 'active' : ''}`,
            onclick: () => {
              this.host.click();
              s.lang = l;
              onChange(s);
            },
          },
          l === 'en' ? 'English' : 'فارسی',
        ),
      );
    const el = h(
      'div',
      { class: 'screen dim' },
      h(
        'div',
        { class: 'dialog panel', style: 'width:min(520px, calc(100vw - 24px))' },
        h('h2', null, svgIcon('gear'), t('settings.title')),
        h('div', { class: 'field' }, h('span', { class: 'label' }, t('menu.language')), lang),
        slider('settings.master', 'master'),
        slider('settings.music', 'music'),
        slider('settings.sfx', 'sfx'),
        h('div', { class: 'field' }, h('span', { class: 'label' }, t('settings.quality')), quality),
        toggle('settings.edgeScroll', 'edgeScroll'),
        toggle('settings.haptics', 'haptics'),
        toggle('settings.labels', 'labels'),
        toggle('settings.fps', 'showFps'),
        h('div', { class: 'dialog-actions' }, this.btn(t('menu.back'), null, onBack, 'primary')),
      ),
    );
    this.show(el);
  }

  howto(onBack: () => void) {
    const el = h(
      'div',
      { class: 'screen dim' },
      h(
        'div',
        { class: 'dialog panel' },
        h('h2', null, svgIcon('book'), t('howto.title')),
        h('p', null, t('howto.goal')),
        h('p', null, t('howto.economy')),
        h('p', null, t('howto.power')),
        h('p', null, t('howto.events')),
        h('h3', null, '🖱️ ', t('howto.desktop')),
        h('p', null, t('howto.desktopText')),
        h('h3', null, '👆 ', t('howto.touch')),
        h('p', null, t('howto.touchText')),
        h('div', { class: 'dialog-actions' }, this.btn(t('common.close'), null, onBack, 'primary')),
      ),
    );
    this.show(el);
  }

  career(p: Profile, onBack: () => void) {
    const rank = rankOf(p.xp);
    const next = RANK_XP[rank + 1];
    const el = h(
      'div',
      { class: 'screen dim' },
      h(
        'div',
        { class: 'dialog panel' },
        h('h2', null, svgIcon('medal'), t('profile.title')),
        h(
          'div',
          { class: 'rank-badge', style: 'margin-bottom:14px' },
          h('div', { class: 'rank-insignia' }, num(rank + 1)),
          h(
            'div',
            { style: 'flex:1' },
            h('div', { style: 'font-weight:800;font-size:20px' }, t(`rank.${rank}` as I18nKey)),
            h('div', { style: 'color:var(--muted)' }, `${num(p.xp)}${next ? ` / ${num(next)}` : ''} XP`),
            h('div', { class: 'xpbar', style: 'width:100%' }, h('div', { style: `width:${rankProgress(p.xp) * 100}%` })),
          ),
        ),
        h(
          'div',
          { class: 'stats' },
          stat(t('profile.games'), num(p.games)),
          stat(t('profile.wins'), num(p.wins)),
          stat(t('profile.best'), num(p.bestScore)),
          stat(t('profile.achievements'), `${num(p.achievements.length)}/${num(ACHIEVEMENTS.length)}`),
        ),
        h('h3', null, t('profile.achievements')),
        medalGrid(p.achievements, []),
        h('div', { class: 'dialog-actions' }, this.btn(t('menu.back'), null, onBack, 'primary')),
      ),
    );
    this.show(el);
  }

  pause(opts: { onResume: () => void; onSettings: () => void; onHowTo: () => void; onQuit: () => void }) {
    const el = h(
      'div',
      { class: 'screen dim' },
      h(
        'div',
        { class: 'dialog panel', style: 'width:min(380px, calc(100vw - 24px));text-align:center' },
        h('h2', { style: 'justify-content:center' }, svgIcon('pause'), t('menu.paused')),
        h(
          'div',
          { class: 'menu-buttons', style: 'min-width:0' },
          this.btn(t('menu.continue'), 'play', opts.onResume, 'primary'),
          this.btn(t('menu.howto'), 'book', opts.onHowTo),
          this.btn(t('menu.settings'), 'gear', opts.onSettings),
          this.btn(t('menu.quit'), 'home', opts.onQuit, 'danger'),
        ),
      ),
    );
    this.show(el);
  }

  end(opts: {
    victory: boolean;
    stats: TeamStats;
    time: number;
    cities: number;
    score: number;
    xp: number;
    profile: Profile;
    rankBefore: number;
    medals: AchievementId[];
    onAgain: () => void;
    onMenu: () => void;
  }) {
    const s = opts.stats;
    const rank = rankOf(opts.profile.xp);
    const bar = h('div', { style: 'width:0%' });
    const el = h(
      'div',
      { class: 'screen dim' },
      h(
        'div',
        { class: 'dialog panel' },
        h('div', { class: `end-title ${opts.victory ? 'win' : 'lose'}` }, t(opts.victory ? 'end.victory' : 'end.defeat')),
        h('p', { style: 'text-align:center;color:var(--sand)' }, t(opts.victory ? 'end.victoryText' : 'end.defeatText')),
        h('h3', null, t('end.stats')),
        h(
          'div',
          { class: 'stats' },
          stat(t('end.score'), num(opts.score)),
          stat(t('end.time'), fmtTime(opts.time)),
          stat(t('end.kills'), num(s.kills + s.buildingsDestroyed)),
          stat(t('end.unitsBuilt'), num(s.unitsBuilt)),
          stat(t('end.unitsLost'), num(s.unitsLost)),
          stat(t('end.oil'), num(s.oilPumped)),
          stat(t('end.earned'), `$${num(s.creditsEarned)}`),
          stat(t('end.cities'), num(opts.cities)),
        ),
        h(
          'div',
          { class: 'rank-badge', style: 'margin:10px 0' },
          h('div', { class: 'rank-insignia' }, num(rank + 1)),
          h(
            'div',
            { style: 'flex:1' },
            h('div', { style: 'font-weight:800' }, t(`rank.${rank}` as I18nKey), rank > opts.rankBefore ? h('span', { style: 'color:var(--gold);margin-inline-start:8px' }, `▲ ${t('end.rankUp')}`) : null),
            h('div', { style: 'color:var(--muted)' }, `+${num(opts.xp)} ${t('end.xp')}`),
            h('div', { class: 'xpbar', style: 'width:100%' }, bar),
          ),
        ),
        opts.medals.length ? h('h3', null, t('profile.achievements')) : null,
        opts.medals.length ? medalGrid(opts.medals, opts.medals, true) : null,
        h('div', { class: 'dialog-actions' }, this.btn(t('menu.quit'), 'home', opts.onMenu, 'ghost'), this.btn(t('menu.restart'), 'play', opts.onAgain, 'primary')),
      ),
    );
    this.show(el);
    requestAnimationFrame(() => requestAnimationFrame(() => (bar.style.width = `${rankProgress(opts.profile.xp) * 100}%`)));
  }
}

function stat(k: string, v: string) {
  return h('div', { class: 'stat' }, h('div', { class: 'k' }, k), h('div', { class: 'v' }, v));
}

function medalGrid(unlocked: AchievementId[], fresh: AchievementId[], onlyUnlocked = false) {
  const grid = h('div', { class: 'medals' });
  for (const a of ACHIEVEMENTS) {
    const has = unlocked.includes(a.id);
    if (onlyUnlocked && !has) continue;
    grid.append(
      h(
        'div',
        { class: `medal ${has ? '' : 'locked'} ${fresh.includes(a.id) ? 'new' : ''}` },
        h('div', { class: 'mic' }, a.icon),
        h('div', null, h('div', { class: 'mt' }, t(achName(a.id))), h('div', { class: 'md' }, t(achDesc(a.id)))),
      ),
    );
  }
  return grid;
}
