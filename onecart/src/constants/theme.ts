export const Colors = {
  light: {
    text: '#14161A',
    textSecondary: '#5D636E',
    background: '#F6F5F2',
    card: '#FFFFFF',
    border: '#E4E2DC',
    primary: '#1F6FEB',
    primaryText: '#FFFFFF',
    success: '#1E7F4F',
    warning: '#B26B00',
    danger: '#C62828',
    muted: '#ECEAE5',
  },
  dark: {
    text: '#F2F3F5',
    textSecondary: '#A3A8B2',
    background: '#0F1114',
    card: '#191C21',
    border: '#2A2E35',
    primary: '#4C8DFF',
    primaryText: '#FFFFFF',
    success: '#3FB97A',
    warning: '#E0A43A',
    danger: '#EF5350',
    muted: '#22262C',
  },
} as const;

export type Palette = { [K in keyof typeof Colors.light]: string };

export const Spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const Radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
export const MaxContentWidth = 960;
