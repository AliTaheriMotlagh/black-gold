/**
 * Real-world geography of the Middle East, simplified for gameplay.
 * All coordinates are [longitude, latitude] in degrees (WGS84, equirectangular projection).
 */

export type LL = readonly [number, number];
export interface Localized {
  en: string;
  fa: string;
}

export const LON_MIN = 26;
export const LON_MAX = 64;
export const LAT_MIN = 12;
export const LAT_MAX = 42;
/** Gameplay grid resolution. */
export const CELLS_PER_DEG = 5;
export const GRID_W = (LON_MAX - LON_MIN) * CELLS_PER_DEG; // 190
export const GRID_H = (LAT_MAX - LAT_MIN) * CELLS_PER_DEG; // 150
/** World units per gameplay cell. */
export const CELL = 2;
export const WORLD_W = GRID_W * CELL;
export const WORLD_H = GRID_H * CELL;
/** World units per degree. */
export const UNITS_PER_DEG = CELLS_PER_DEG * CELL;

/** World space: +x = east, +z = south, origin at north-west corner. */
export function lonLatToWorld(lon: number, lat: number): { x: number; z: number } {
  return { x: (lon - LON_MIN) * UNITS_PER_DEG, z: (LAT_MAX - lat) * UNITS_PER_DEG };
}

export function worldToLonLat(x: number, z: number): { lon: number; lat: number } {
  return { lon: LON_MIN + x / UNITS_PER_DEG, lat: LAT_MAX - z / UNITS_PER_DEG };
}

export interface Sea {
  name: Localized;
  label: LL;
  labelSize: number;
  ring: LL[];
}

/** Water bodies. Rings may extend beyond map bounds. Even-odd fill. */
export const SEAS: Sea[] = [
  {
    name: { en: 'Mediterranean Sea', fa: 'دریای مدیترانه' },
    label: [29.2, 33.6],
    labelSize: 1.4,
    ring: [
      [20, 30.9], [29, 30.9], [30.5, 31.4], [32.3, 31.3], [34.2, 31.3], [34.75, 32.1], [35.0, 32.8],
      [35.5, 33.9], [35.8, 34.4], [35.8, 35.5], [36.1, 36.6], [35.5, 36.8], [34.6, 36.8], [33.5, 36.2],
      [32.8, 36.0], [31.5, 36.6], [30.7, 36.85], [30.4, 36.3], [29.5, 36.2], [28.0, 36.7], [27.3, 37.4],
      [26.8, 38.4], [26.6, 39.3], [26.2, 40.0], [20, 40.2],
    ],
  },
  {
    name: { en: 'Black Sea', fa: 'دریای سیاه' },
    label: [35.5, 42.6],
    labelSize: 1.2,
    ring: [
      [27.5, 44], [41.8, 44], [41.6, 41.6], [39.7, 41.0], [37.9, 41.0], [36.3, 41.3], [35.1, 42.05],
      [33.3, 41.95], [31.5, 41.25], [29.1, 41.2], [28.0, 41.4],
    ],
  },
  {
    name: { en: 'Caspian Sea', fa: 'دریای خزر' },
    label: [51.0, 39.9],
    labelSize: 1.2,
    ring: [
      [47.5, 44], [48.6, 41.8], [49.6, 40.6], [50.3, 40.3], [49.4, 40.0], [49.0, 39.0], [48.9, 38.4],
      [49.1, 37.6], [50.3, 37.1], [51.5, 36.8], [53.0, 36.85], [54.0, 36.9], [53.9, 37.3], [53.8, 38.5],
      [53.1, 39.3], [53.6, 40.0], [52.8, 40.5], [52.8, 41.2], [53.0, 42.0], [52.0, 44],
    ],
  },
  {
    name: { en: 'Persian Gulf', fa: 'خلیج فارس' },
    label: [51.6, 27.4],
    labelSize: 1.1,
    // One ring covering the Persian Gulf, Gulf of Oman, Arabian Sea, Gulf of Aden and Red Sea.
    ring: [
      [48.0, 30.0], [49.2, 30.1], [50.2, 29.6], [50.8, 28.95], [51.4, 27.9], [52.6, 27.4], [54.0, 26.7],
      [55.3, 26.6], [56.3, 27.2], [57.0, 26.3], [57.8, 25.65], [59.5, 25.4], [60.6, 25.3], [62.3, 25.1],
      [66, 25.2], [66, 9], [45, 9],
      [43.3, 11.6], [43.3, 12.4], [42.7, 13.0], [41.2, 14.5], [39.5, 15.6], [38.6, 18.0], [37.2, 19.6],
      [36.9, 21.5], [36.6, 22.0], [35.5, 23.9], [34.9, 25.1], [34.3, 26.1], [33.9, 26.7], [33.5, 27.6],
      [32.6, 29.9], [33.2, 28.6], [34.3, 27.8], [34.45, 28.4], [34.95, 29.5], [34.8, 28.2], [35.6, 27.3],
      [36.6, 25.9], [38.1, 24.1], [39.2, 21.5], [40.9, 19.2], [41.8, 17.9], [42.6, 16.5], [42.8, 14.8],
      [43.5, 12.6], [45.0, 12.8], [46.0, 13.4], [49.0, 14.5], [52.2, 15.6], [55.0, 17.0], [56.6, 17.9],
      [57.7, 18.9], [58.7, 20.4], [59.8, 22.5], [58.6, 23.6], [56.7, 24.4], [56.4, 25.1], [56.3, 26.4],
      [55.9, 25.7], [55.3, 25.2], [54.4, 24.5], [52.5, 24.2], [51.6, 24.3], [51.6, 25.3], [51.5, 26.1],
      [51.1, 26.0], [50.8, 24.75], [50.5, 25.5], [50.2, 26.0], [49.6, 27.0], [48.9, 27.6], [48.4, 28.5],
      [47.9, 29.4],
    ],
  },
];

/** Extra sea labels (no geometry of their own). */
export const SEA_LABELS: { name: Localized; label: LL; labelSize: number }[] = [
  { name: { en: 'Red Sea', fa: 'دریای سرخ' }, label: [38.4, 20.6], labelSize: 1.0 },
  { name: { en: 'Arabian Sea', fa: 'دریای عرب' }, label: [61.0, 17.0], labelSize: 1.4 },
  { name: { en: 'Gulf of Oman', fa: 'دریای عمان' }, label: [59.6, 24.3], labelSize: 0.8 },
  { name: { en: 'Gulf of Aden', fa: 'خلیج عدن' }, label: [48.5, 12.9], labelSize: 0.8 },
  { name: { en: 'Strait of Hormuz', fa: 'تنگه هرمز' }, label: [56.6, 26.75], labelSize: 0.55 },
];

export const ISLANDS: LL[][] = [
  // Cyprus
  [[32.3, 35.0], [33.0, 35.4], [34.6, 35.7], [34.0, 35.0], [33.0, 34.6], [32.4, 34.8]],
  // Qeshm
  [[55.3, 26.75], [56.25, 26.95], [56.3, 26.85], [55.4, 26.6]],
  // Bahrain
  [[50.45, 26.25], [50.65, 26.25], [50.6, 25.8], [50.45, 25.85]],
  // Socotra (partially in view)
  [[53.3, 12.7], [54.5, 12.7], [54.5, 12.3], [53.3, 12.3]],
];

export interface Polyline {
  name: Localized;
  path: LL[];
  /** Height in world units (ridges) or width in degrees (rivers). */
  height: number;
  width: number;
}

export const RIVERS: Polyline[] = [
  {
    name: { en: 'Euphrates', fa: 'فرات' },
    height: 0,
    width: 0.16,
    path: [
      [39.5, 39.2], [38.5, 37.8], [38.0, 36.8], [38.3, 36.0], [39.0, 35.9], [40.1, 35.2], [41.0, 34.4],
      [42.0, 34.0], [43.3, 33.4], [44.3, 32.5], [45.5, 31.3], [46.5, 30.9], [47.4, 30.9], [48.0, 30.2],
    ],
  },
  {
    name: { en: 'Tigris', fa: 'دجله' },
    height: 0,
    width: 0.15,
    path: [
      [40.2, 38.4], [40.2, 37.9], [42.1, 37.3], [43.1, 36.3], [43.5, 35.0], [44.2, 33.9], [44.4, 33.3],
      [45.5, 32.5], [46.4, 31.9], [47.2, 31.0], [47.4, 30.9],
    ],
  },
  {
    name: { en: 'Nile', fa: 'نیل' },
    height: 0,
    width: 0.16,
    path: [
      [32.5, 12.0], [32.5, 15.6], [34.0, 17.7], [33.4, 18.6], [32.0, 18.6], [30.5, 19.4], [30.6, 20.6],
      [31.3, 21.8], [32.9, 24.1], [32.65, 25.7], [32.7, 26.2], [31.2, 27.2], [30.8, 28.6], [31.25, 30.05],
      [30.9, 31.0], [31.6, 31.4],
    ],
  },
  {
    name: { en: 'Karun', fa: 'کارون' },
    height: 0,
    width: 0.12,
    path: [[50.2, 32.4], [49.4, 32.0], [48.7, 31.3], [48.25, 30.3]],
  },
  {
    name: { en: 'Aras', fa: 'ارس' },
    height: 0,
    width: 0.1,
    path: [[43.0, 40.2], [44.6, 39.8], [45.6, 39.2], [46.6, 38.9], [48.0, 39.6], [49.0, 39.9]],
  },
];

/** Mountain ridges. Gaps between segments are intentional mountain passes. */
export const RIDGES: Polyline[] = [
  { name: { en: 'Zagros (north)', fa: 'زاگرس شمالی' }, height: 11, width: 0.55, path: [[43.8, 38.2], [44.9, 36.9], [46.0, 35.3]] },
  { name: { en: 'Zagros (central)', fa: 'زاگرس مرکزی' }, height: 13, width: 0.6, path: [[46.9, 34.0], [48.2, 33.1], [49.6, 32.2], [50.6, 31.4]] },
  { name: { en: 'Zagros (south)', fa: 'زاگرس جنوبی' }, height: 10, width: 0.55, path: [[51.4, 30.4], [52.9, 29.6], [54.6, 28.8], [56.6, 28.3]] },
  { name: { en: 'Alborz', fa: 'البرز' }, height: 14, width: 0.4, path: [[48.8, 37.0], [50.2, 36.4], [51.6, 35.95], [53.0, 36.3], [54.8, 36.8], [56.4, 37.3]] },
  { name: { en: 'Damavand', fa: 'دماوند' }, height: 9, width: 0.18, path: [[52.1, 35.95], [52.12, 35.96]] },
  { name: { en: 'Taurus', fa: 'توروس' }, height: 11, width: 0.5, path: [[29.6, 37.2], [31.6, 37.3], [33.4, 37.4], [35.4, 37.6]] },
  { name: { en: 'Eastern Taurus', fa: 'توروس شرقی' }, height: 11, width: 0.5, path: [[37.4, 38.1], [39.5, 38.6], [42.0, 38.6]] },
  { name: { en: 'Pontic', fa: 'پونتیک' }, height: 9, width: 0.45, path: [[33.5, 41.0], [36.0, 40.7], [38.5, 40.5], [41.2, 40.9]] },
  { name: { en: 'Caucasus', fa: 'قفقاز' }, height: 15, width: 0.5, path: [[40.8, 43.0], [43.5, 42.9], [46.0, 42.0], [48.5, 41.3]] },
  { name: { en: 'Lebanon', fa: 'لبنان' }, height: 7, width: 0.25, path: [[35.6, 33.2], [36.0, 34.1], [36.3, 34.6]] },
  { name: { en: 'Hejaz', fa: 'حجاز' }, height: 8, width: 0.45, path: [[35.6, 28.6], [36.8, 26.6], [38.3, 24.6]] },
  { name: { en: 'Asir', fa: 'عسیر' }, height: 10, width: 0.5, path: [[40.0, 21.2], [41.6, 18.8], [43.3, 15.8], [44.2, 13.6]] },
  { name: { en: 'Hajar', fa: 'حجر' }, height: 9, width: 0.35, path: [[56.15, 25.9], [56.35, 24.6], [57.1, 23.0], [58.5, 22.3]] },
  { name: { en: 'Sinai', fa: 'سینا' }, height: 7, width: 0.3, path: [[33.8, 28.5], [34.0, 28.9]] },
  { name: { en: 'Red Sea Hills', fa: 'کوه‌های دریای سرخ' }, height: 7, width: 0.4, path: [[33.0, 27.6], [34.2, 25.4], [35.8, 22.6], [36.5, 19.6]] },
  { name: { en: 'Makran', fa: 'مکران' }, height: 7, width: 0.45, path: [[57.6, 26.8], [60.0, 26.3], [63.5, 26.6]] },
  { name: { en: 'Kopet Dag', fa: 'کپه‌داغ' }, height: 9, width: 0.4, path: [[56.0, 38.4], [58.0, 37.7], [60.5, 36.6]] },
  { name: { en: 'Hindu Kush foothills', fa: 'کوهپایه‌های هندوکش' }, height: 9, width: 0.6, path: [[63.0, 35.2], [64.5, 34.8]] },
];

export interface Plateau {
  center: LL;
  radius: LL; // [lon radius, lat radius]
  height: number;
}

export const PLATEAUS: Plateau[] = [
  { center: [55.5, 32.0], radius: [6.5, 4.0], height: 3.2 }, // Iranian plateau
  { center: [34.0, 39.0], radius: [6.0, 2.0], height: 3.4 }, // Anatolian plateau
  { center: [43.5, 39.5], radius: [3.5, 1.7], height: 4.8 }, // Armenian highlands
  { center: [44.5, 15.0], radius: [2.0, 2.0], height: 3.6 }, // Yemen highlands
  { center: [44.5, 24.5], radius: [4.5, 3.5], height: 1.4 }, // Najd
  { center: [38.0, 32.0], radius: [3.0, 2.0], height: 1.1 }, // Syrian/Jordan plateau
];

/** Sand-sea regions that get dune ripples. */
export const DUNE_SEAS: Plateau[] = [
  { center: [50.0, 20.0], radius: [5.5, 2.7], height: 1 }, // Rub' al Khali
  { center: [41.5, 28.2], radius: [2.2, 1.0], height: 1 }, // Nafud
  { center: [28.5, 26.0], radius: [3.5, 4.5], height: 1 }, // Great Sand Sea
  { center: [55.5, 33.6], radius: [1.8, 1.0], height: 0.6 }, // Dasht-e Kavir
  { center: [58.5, 30.0], radius: [1.6, 1.4], height: 0.8 }, // Dasht-e Lut
];

export interface OilFieldDef {
  id: string;
  name: Localized;
  ll: LL;
  richness: number;
}

export const OIL_FIELDS: OilFieldDef[] = [
  { id: 'ghawar', name: { en: 'Ghawar', fa: 'غوار' }, ll: [49.3, 25.4], richness: 1.6 },
  { id: 'abqaiq', name: { en: 'Abqaiq', fa: 'ابقیق' }, ll: [49.67, 25.94], richness: 1.1 },
  { id: 'khurais', name: { en: 'Khurais', fa: 'خریص' }, ll: [48.0, 25.1], richness: 1.0 },
  { id: 'safaniya', name: { en: 'Safaniya', fa: 'سفانیه' }, ll: [48.4, 27.9], richness: 1.2 },
  { id: 'burgan', name: { en: 'Burgan', fa: 'برقان' }, ll: [47.95, 28.95], richness: 1.4 },
  { id: 'rumaila', name: { en: 'Rumaila', fa: 'رمیله' }, ll: [47.35, 30.35], richness: 1.4 },
  { id: 'kirkuk', name: { en: 'Kirkuk', fa: 'کرکوک' }, ll: [44.4, 35.47], richness: 1.2 },
  { id: 'ahvaz', name: { en: 'Ahvaz', fa: 'اهواز' }, ll: [48.95, 31.0], richness: 1.3 },
  { id: 'masjed', name: { en: 'Masjed Soleyman', fa: 'مسجد سلیمان' }, ll: [49.3, 31.95], richness: 0.9 },
  { id: 'gachsaran', name: { en: 'Gachsaran', fa: 'گچساران' }, ll: [50.6, 30.2], richness: 1.1 },
  { id: 'southpars', name: { en: 'South Pars', fa: 'پارس جنوبی' }, ll: [52.6, 27.55], richness: 1.5 },
  { id: 'dukhan', name: { en: 'Dukhan', fa: 'دخان' }, ll: [50.85, 25.42], richness: 1.0 },
  { id: 'bab', name: { en: 'Bab', fa: 'باب' }, ll: [53.6, 23.7], richness: 1.1 },
  { id: 'shaybah', name: { en: 'Shaybah', fa: 'شیبه' }, ll: [54.0, 22.5], richness: 1.0 },
  { id: 'fahud', name: { en: 'Fahud', fa: 'فهود' }, ll: [56.45, 22.35], richness: 0.9 },
  { id: 'marib', name: { en: 'Marib', fa: 'مأرب' }, ll: [45.4, 15.6], richness: 0.8 },
  { id: 'deirezzor', name: { en: 'Deir ez-Zor', fa: 'دیرالزور' }, ll: [40.6, 35.15], richness: 0.9 },
  { id: 'absheron', name: { en: 'Absheron', fa: 'آبشرون' }, ll: [49.3, 40.3], richness: 1.1 },
  { id: 'batman', name: { en: 'Batman', fa: 'باتمان' }, ll: [41.1, 37.85], richness: 0.7 },
  { id: 'suez', name: { en: 'Gulf of Suez', fa: 'خلیج سوئز' }, ll: [32.3, 29.3], richness: 0.9 },
  { id: 'westerndesert', name: { en: 'Western Desert', fa: 'صحرای غربی' }, ll: [28.6, 30.2], richness: 0.9 },
  { id: 'palmyra', name: { en: 'Palmyra', fa: 'تدمر' }, ll: [38.3, 34.5], richness: 0.7 },
  { id: 'kharg', name: { en: 'Bushehr', fa: 'بوشهر' }, ll: [51.3, 29.0], richness: 1.0 },
  { id: 'anatolia', name: { en: 'Central Anatolia', fa: 'آناتولی مرکزی' }, ll: [35.5, 38.9], richness: 0.6 },
  { id: 'nile', name: { en: 'Upper Nile', fa: 'نیل علیا' }, ll: [30.7, 27.0], richness: 0.7 },
];

export interface CityDef {
  id: string;
  name: Localized;
  ll: LL;
  capital: boolean;
}

/** Major urban centers (religious holy cities intentionally excluded from play). */
export const CITIES: CityDef[] = [
  { id: 'cairo', name: { en: 'Cairo', fa: 'قاهره' }, ll: [31.24, 30.04], capital: true },
  { id: 'alexandria', name: { en: 'Alexandria', fa: 'اسکندریه' }, ll: [29.92, 31.1], capital: false },
  { id: 'aswan', name: { en: 'Aswan', fa: 'اسوان' }, ll: [32.9, 24.09], capital: false },
  { id: 'khartoum', name: { en: 'Khartoum', fa: 'خارطوم' }, ll: [32.53, 15.5], capital: true },
  { id: 'istanbul', name: { en: 'Istanbul', fa: 'استانبول' }, ll: [28.98, 40.9], capital: false },
  { id: 'ankara', name: { en: 'Ankara', fa: 'آنکارا' }, ll: [32.85, 39.93], capital: true },
  { id: 'izmir', name: { en: 'Izmir', fa: 'ازمیر' }, ll: [27.3, 38.42], capital: false },
  { id: 'adana', name: { en: 'Adana', fa: 'آدانا' }, ll: [35.32, 37.05], capital: false },
  { id: 'aleppo', name: { en: 'Aleppo', fa: 'حلب' }, ll: [37.16, 36.2], capital: false },
  { id: 'damascus', name: { en: 'Damascus', fa: 'دمشق' }, ll: [36.29, 33.51], capital: true },
  { id: 'beirut', name: { en: 'Beirut', fa: 'بیروت' }, ll: [35.6, 33.89], capital: true },
  { id: 'amman', name: { en: 'Amman', fa: 'امان' }, ll: [35.93, 31.95], capital: true },
  { id: 'baghdad', name: { en: 'Baghdad', fa: 'بغداد' }, ll: [44.36, 33.31], capital: true },
  { id: 'mosul', name: { en: 'Mosul', fa: 'موصل' }, ll: [43.13, 36.34], capital: false },
  { id: 'basra', name: { en: 'Basra', fa: 'بصره' }, ll: [47.78, 30.51], capital: false },
  { id: 'tehran', name: { en: 'Tehran', fa: 'تهران' }, ll: [51.39, 35.35], capital: true },
  { id: 'tabriz', name: { en: 'Tabriz', fa: 'تبریز' }, ll: [46.29, 38.08], capital: false },
  { id: 'isfahan', name: { en: 'Isfahan', fa: 'اصفهان' }, ll: [51.67, 32.65], capital: false },
  { id: 'shiraz', name: { en: 'Shiraz', fa: 'شیراز' }, ll: [52.53, 29.59], capital: false },
  { id: 'kerman', name: { en: 'Kerman', fa: 'کرمان' }, ll: [57.08, 30.28], capital: false },
  { id: 'bandarabbas', name: { en: 'Bandar Abbas', fa: 'بندرعباس' }, ll: [56.27, 27.3], capital: false },
  { id: 'baku', name: { en: 'Baku', fa: 'باکو' }, ll: [49.6, 40.45], capital: true },
  { id: 'yerevan', name: { en: 'Yerevan', fa: 'ایروان' }, ll: [44.51, 40.18], capital: true },
  { id: 'kuwait', name: { en: 'Kuwait City', fa: 'کویت' }, ll: [47.9, 29.3], capital: true },
  { id: 'riyadh', name: { en: 'Riyadh', fa: 'ریاض' }, ll: [46.68, 24.71], capital: true },
  { id: 'jeddah', name: { en: 'Jeddah', fa: 'جده' }, ll: [39.3, 21.49], capital: false },
  { id: 'dammam', name: { en: 'Dammam', fa: 'دمام' }, ll: [50.0, 26.4], capital: false },
  { id: 'doha', name: { en: 'Doha', fa: 'دوحه' }, ll: [51.45, 25.29], capital: true },
  { id: 'dubai', name: { en: 'Dubai', fa: 'دبی' }, ll: [55.27, 25.1], capital: false },
  { id: 'abudhabi', name: { en: 'Abu Dhabi', fa: 'ابوظبی' }, ll: [54.37, 24.3], capital: true },
  { id: 'muscat', name: { en: 'Muscat', fa: 'مسقط' }, ll: [58.3, 23.5], capital: true },
  { id: 'sanaa', name: { en: "Sana'a", fa: 'صنعا' }, ll: [44.19, 15.37], capital: true },
  { id: 'aden', name: { en: 'Aden', fa: 'عدن' }, ll: [45.03, 12.95], capital: false },
  { id: 'herat', name: { en: 'Herat', fa: 'هرات' }, ll: [62.2, 34.35], capital: false },
];

export interface StartRegion {
  id: string;
  name: Localized;
  ll: LL;
}

/** Geographic (not national) starting regions. */
export const START_REGIONS: StartRegion[] = [
  { id: 'mesopotamia', name: { en: 'Mesopotamia', fa: 'میان‌رودان' }, ll: [43.4, 32.4] },
  { id: 'khuzestan', name: { en: 'Zagros Foothills', fa: 'دامنه‌های زاگرس' }, ll: [49.7, 30.9] },
  { id: 'arabia', name: { en: 'Eastern Arabia', fa: 'شرق عربستان' }, ll: [48.3, 24.4] },
  { id: 'levant', name: { en: 'Syrian Desert', fa: 'بادیه شام' }, ll: [38.0, 33.2] },
  { id: 'anatolia', name: { en: 'Anatolian Highlands', fa: 'ارتفاعات آناتولی' }, ll: [36.6, 38.9] },
  { id: 'nile', name: { en: 'Nile Valley', fa: 'دره نیل' }, ll: [29.6, 28.7] },
];

// ---------------------------------------------------------------------------
// Geometry helpers (pure)

export function pointInRing(lon: number, lat: number, ring: readonly LL[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function isSea(lon: number, lat: number): boolean {
  let sea = false;
  for (const s of SEAS) if (pointInRing(lon, lat, s.ring)) sea = !sea;
  if (!sea) return false;
  for (const isl of ISLANDS) if (pointInRing(lon, lat, isl)) return false;
  return true;
}

/** Distance in degrees from point to polyline. */
export function distToPolyline(lon: number, lat: number, path: readonly LL[]): number {
  let best = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, ay] = path[i];
    const [bx, by] = path[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1e-9;
    let t = ((lon - ax) * dx + (lat - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + t * dx - lon;
    const py = ay + t * dy - lat;
    const d = px * px + py * py;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}
