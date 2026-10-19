/** Hand-curated inputs for bake-geo.ts. Coordinates are [lon, lat]. */

export const OIL_FIELDS_SRC: { name: string; ll: [number, number]; rich: number; gas?: boolean }[] = [
  { name: 'Ghawar', ll: [49.3, 25.4], rich: 2.0 },
  { name: 'Safaniya', ll: [48.9, 28.0], rich: 1.5 },
  { name: 'Khurais', ll: [48.0, 25.1], rich: 1.2 },
  { name: 'Shaybah', ll: [54.0, 22.5], rich: 1.1 },
  { name: 'Manifa', ll: [49.1, 27.6], rich: 1.1 },
  { name: 'Abqaiq', ll: [49.7, 25.95], rich: 1.0 },
  { name: 'Burgan', ll: [48.0, 29.0], rich: 1.7 },
  { name: 'Wafra', ll: [47.9, 28.6], rich: 0.7 },
  { name: 'Rumaila', ll: [47.4, 30.3], rich: 1.7 },
  { name: 'West Qurna', ll: [47.3, 31.0], rich: 1.4 },
  { name: 'Majnoon', ll: [47.6, 31.15], rich: 1.1 },
  { name: 'Halfaya', ll: [47.4, 31.8], rich: 0.9 },
  { name: 'Kirkuk', ll: [44.4, 35.5], rich: 1.3 },
  { name: 'East Baghdad', ll: [44.6, 33.4], rich: 0.8 },
  { name: 'Ahvaz', ll: [48.8, 31.3], rich: 1.5 },
  { name: 'Marun', ll: [49.6, 31.0], rich: 1.2 },
  { name: 'Gachsaran', ll: [50.8, 30.3], rich: 1.2 },
  { name: 'Agha Jari', ll: [49.8, 30.7], rich: 1.0 },
  { name: 'Azadegan', ll: [47.75, 31.55], rich: 1.0 },
  { name: 'Masjed Soleyman', ll: [49.3, 31.95], rich: 0.6 },
  { name: 'South Pars', ll: [52.0, 26.6], rich: 1.6, gas: true },
  { name: 'North Field', ll: [51.6, 26.1], rich: 1.5, gas: true },
  { name: 'Dukhan', ll: [50.75, 25.4], rich: 0.9 },
  { name: 'Awali', ll: [50.55, 26.05], rich: 0.5 },
  { name: 'Upper Zakum', ll: [53.6, 24.85], rich: 1.3 },
  { name: 'Murban', ll: [54.0, 23.6], rich: 1.3 },
  { name: 'Asab', ll: [54.2, 23.3], rich: 0.8 },
  { name: 'Yibal', ll: [56.2, 22.1], rich: 0.8 },
  { name: 'Marib', ll: [45.3, 15.5], rich: 0.6 },
  { name: 'Al-Omar', ll: [40.6, 35.1], rich: 0.7 },
  { name: 'Rumeilan', ll: [42.0, 36.9], rich: 0.6 },
  { name: 'Batman', ll: [41.1, 37.8], rich: 0.5 },
  { name: 'Gulf of Suez', ll: [33.2, 28.4], rich: 0.7 },
  { name: 'Zohr', ll: [32.0, 31.9], rich: 1.0, gas: true },
  { name: 'Leviathan', ll: [33.8, 32.6], rich: 1.0, gas: true },
  { name: 'Azeri-Chirag-Guneshli', ll: [51.0, 40.1], rich: 1.3 },
  { name: 'Galkynysh', ll: [62.6, 37.4], rich: 1.4, gas: true },
];

/** Countries with an in-theater capital that a human or full AI can command. */
export const PLAYABLE = [
  'IRN', 'SAU', 'TUR', 'ISR', 'EGY', 'IRQ', 'ARE', 'SYR', 'JOR', 'KWT', 'QAT', 'BHR', 'OMN', 'YEM',
  'AZE', 'ARM', 'GEO', 'TKM', 'SDN', 'LBN', 'CYP', 'PSX', 'ERI', 'DJI',
];

/** Map colours: muted, distinguishable on satellite imagery. */
export const COUNTRY_STYLE: Record<string, string> = {
  IRN: '#3fa66b', SAU: '#c9a227', TUR: '#d0453c', ISR: '#3d7bd9', EGY: '#b5763a', IRQ: '#7a5bc4',
  ARE: '#2bb3b1', SYR: '#9b3a46', JOR: '#c46a9e', KWT: '#6f9f36', QAT: '#9a2a5a', BHR: '#d9774f',
  OMN: '#b2533a', YEM: '#7d8f42', AZE: '#2f8fbf', ARM: '#d68a29', GEO: '#b8485f', TKM: '#4fa3a0',
  SDN: '#a07444', LBN: '#5aa1d6', CYP: '#c2b25a', PSX: '#4c9a51', ERI: '#8aa63f', DJI: '#5c7fb3',
  AFG: '#7a7f5c', PAK: '#3b7a48', RUS: '#6c7a8f', KAZ: '#3aa0c7', UZB: '#4a8fb0', GRC: '#5b86c7',
  LBY: '#7d6a4a', ETH: '#8f9a3a', SOM: '#6a8fb5', SSD: '#8d6a50', CYN: '#a69b6a', BGR: '#6f8f6a',
};

export const FA_FALLBACK: Record<string, string> = {
  IRN: 'ایران', SAU: 'عربستان سعودی', TUR: 'ترکیه', ISR: 'اسرائیل', EGY: 'مصر', IRQ: 'عراق',
  ARE: 'امارات متحده عربی', SYR: 'سوریه', JOR: 'اردن', KWT: 'کویت', QAT: 'قطر', BHR: 'بحرین',
  OMN: 'عمان', YEM: 'یمن', AZE: 'جمهوری آذربایجان', ARM: 'ارمنستان', GEO: 'گرجستان', TKM: 'ترکمنستان',
  SDN: 'سودان', LBN: 'لبنان', CYP: 'قبرس', PSX: 'فلسطین', ERI: 'اریتره', DJI: 'جیبوتی',
};
