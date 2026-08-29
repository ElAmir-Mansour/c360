export const MARKETING_SOURCE = {
  file: 'clario360-website (2).html',
  sha256: 'd039b932cae44bf1360ab1680f993b395b952971841e527c591a2d138c2e2fa5',
} as const;

export const MARKETING_BRAND_TOKENS = {
  brand: {
    navy: '#005E5E',
    gold: '#ABB705',
    teal: '#0DA7A8',
    clarioSecRed: '#B23A48',
    clarioInsightViolet: '#5B3FA8',
  },
  suiteFamilies: {
    ds: {
      600: 'var(--teal-600)',
      700: 'var(--teal-700)',
      gradient: 'linear-gradient(150deg,var(--teal-700),var(--teal-600))',
    },
    bp: {
      600: 'var(--navy-600)',
      700: 'var(--navy-800)',
      gradient: 'linear-gradient(150deg,var(--navy-800),var(--navy-600))',
    },
    sec: {
      600: '#B23A48',
      700: '#7E2531',
      gradient: 'linear-gradient(150deg,#7E2531,#B23A48)',
    },
    insight: {
      600: '#5B3FA8',
      700: '#3C2A73',
      gradient: 'linear-gradient(150deg,#3C2A73,#5B3FA8)',
    },
  },
} as const;
