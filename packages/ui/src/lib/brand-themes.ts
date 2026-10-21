import { brand } from "./brand-geometry.ts";

export type Color = readonly [number, number, number];
type ThemePalette = {
  raised: Color;
  surface: Color;
  primary: string;
  primaryInk: string;
  glow: boolean;
  radius?: number;
  gutter?: readonly [number, number];
  rowPadding?: number;
  panelGradient?: boolean;
};

export type BrandTheme = {
  name: string;
  colorMode: "light" | "dark";
  label: string;
  mode: "solid" | "glow" | "mist" | "metal" | "caustic" | "halo";
  base: Color;
  light: Color;
  accent: Color;
  ink: string;
  cssInk?: string;
  phase: number;
  palette?: ThemePalette;
};

export const BRAND_THEMES: BrandTheme[] = [
  {
    accent: [14, 15, 16],
    base: [14, 15, 16],
    colorMode: "dark",
    ink: brand.light,
    label: "Obsidian",
    light: [14, 15, 16],
    mode: "solid",
    name: "01-obsidian",
    phase: 0,
  },
  {
    accent: [238, 238, 240],
    base: [238, 238, 240],
    colorMode: "light",
    ink: brand.dark,
    label: "Paper",
    light: [238, 238, 240],
    mode: "solid",
    name: "02-paper",
    phase: 0,
  },
  {
    accent: [29, 55, 97],
    base: [9, 12, 17],
    colorMode: "dark",
    ink: brand.light,
    label: "Atmosphere",
    light: [128, 146, 164],
    mode: "glow",
    name: "03-atmosphere",
    phase: 0.8,
  },
  {
    accent: [154, 169, 186],
    base: [230, 231, 233],
    colorMode: "light",
    ink: brand.dark,
    label: "Porcelain",
    light: [254, 254, 252],
    mode: "mist",
    name: "04-porcelain",
    palette: {
      glow: false,
      primary: "#4e5877",
      primaryInk: "#ffffff",
      raised: [245, 246, 248],
      surface: [253, 253, 254],
    },
    phase: 1.2,
  },
  {
    accent: [18, 53, 132],
    base: [5, 13, 35],
    colorMode: "dark",
    ink: brand.light,
    label: "Blue hour",
    light: [85, 148, 218],
    mode: "glow",
    name: "05-blue-hour",
    phase: 2.8,
  },
  {
    accent: [26, 72, 107],
    base: [5, 19, 22],
    colorMode: "dark",
    ink: brand.light,
    label: "Aurora",
    light: [108, 192, 167],
    mode: "glow",
    name: "06-aurora",
    phase: 4.2,
  },
  {
    accent: [97, 35, 31],
    base: [22, 11, 12],
    colorMode: "dark",
    ink: brand.light,
    label: "Ember",
    light: [193, 130, 96],
    mode: "glow",
    name: "07-ember",
    phase: 1.9,
  },
  {
    accent: [160, 149, 187],
    base: [224, 222, 233],
    colorMode: "light",
    ink: brand.dark,
    label: "Lilac haze",
    light: [254, 246, 240],
    mode: "mist",
    name: "08-lilac",
    palette: {
      glow: true,
      primary: "#65517d",
      primaryInk: "#fffaff",
      raised: [239, 234, 247],
      surface: [249, 245, 253],
    },
    phase: 3.6,
  },
  {
    accent: [40, 49, 62],
    base: [12, 15, 19],
    colorMode: "dark",
    cssInk: brand.light,
    ink: "url(#metal)",
    label: "Silver",
    light: [131, 141, 151],
    mode: "metal",
    name: "09-silver",
    phase: 1.7,
  },
  {
    accent: [177, 153, 130],
    base: [229, 222, 210],
    colorMode: "light",
    ink: "#28231f",
    label: "Sand",
    light: [253, 248, 236],
    mode: "mist",
    name: "10-sand",
    palette: {
      glow: false,
      gutter: [4, 6],
      primary: "#71543b",
      primaryInk: "#fffbf4",
      radius: 4,
      raised: [243, 237, 226],
      rowPadding: 10,
      surface: [252, 248, 240],
    },
    phase: 5.1,
  },
  {
    accent: [21, 54, 74],
    base: [6, 18, 30],
    colorMode: "dark",
    ink: brand.light,
    label: "Caustic",
    light: [108, 182, 207],
    mode: "caustic",
    name: "11-caustic",
    phase: 2.3,
  },
  {
    accent: [40, 45, 68],
    base: [10, 11, 14],
    colorMode: "dark",
    ink: brand.light,
    label: "Eclipse",
    light: [155, 164, 190],
    mode: "halo",
    name: "12-eclipse",
    palette: {
      glow: true,
      primary: "#e3dff1",
      primaryInk: "#1b1824",
      raised: [23, 24, 32],
      surface: [29, 30, 40],
    },
    phase: 0,
  },
];

type AppTheme = Pick<
  BrandTheme,
  "name" | "label" | "colorMode" | "base" | "accent" | "ink"
> & { palette: ThemePalette };

export const APP_THEMES: AppTheme[] = [
  ...BRAND_THEMES.flatMap(({ palette, ...theme }) =>
    palette ? [{ ...theme, palette }] : []
  ),
  {
    accent: [116, 120, 126],
    base: [31, 33, 36],
    colorMode: "dark",
    ink: "#eeefed",
    label: "Graphite",
    name: "graphite",
    palette: {
      glow: false,
      gutter: [4, 6],
      primary: "#e1e3df",
      primaryInk: "#202225",
      radius: 4,
      raised: [39, 41, 44],
      rowPadding: 10,
      surface: [47, 49, 53],
    },
  },
  {
    accent: [144, 120, 92],
    base: [35, 30, 26],
    colorMode: "dark",
    ink: "#eee5d8",
    label: "Coffee",
    name: "coffee",
    palette: {
      glow: false,
      gutter: [6, 10],
      panelGradient: true,
      primary: "#d9c5a5",
      primaryInk: "#30251b",
      radius: 8,
      raised: [47, 40, 34],
      rowPadding: 14,
      surface: [56, 47, 39],
    },
  },
  {
    accent: [116, 138, 112],
    base: [28, 36, 32],
    colorMode: "dark",
    ink: "#e4e9df",
    label: "Moss",
    name: "moss",
    palette: {
      glow: false,
      gutter: [8, 12],
      primary: "#c4d1b8",
      primaryInk: "#253025",
      radius: 14,
      raised: [37, 47, 41],
      rowPadding: 14,
      surface: [44, 56, 48],
    },
  },
  {
    accent: [140, 157, 132],
    base: [222, 228, 218],
    colorMode: "light",
    ink: "#25312b",
    label: "Sage",
    name: "sage",
    palette: {
      glow: false,
      gutter: [8, 12],
      primary: "#4d6252",
      primaryInk: "#f7faf4",
      radius: 14,
      raised: [237, 241, 233],
      rowPadding: 14,
      surface: [246, 249, 243],
    },
  },
];
