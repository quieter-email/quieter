import { brand } from "./brand-geometry.ts";

export type Color = readonly [number, number, number];
export type BrandTheme = {
  name: string;
  colorMode: "light" | "dark";
  label: string;
  mode: "solid" | "glow" | "mist" | "metal" | "caustic" | "halo";
  base: Color;
  light: Color;
  accent: Color;
  ink: string;
  phase: number;
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
    phase: 3.6,
  },
  {
    accent: [40, 49, 62],
    base: [12, 15, 19],
    colorMode: "dark",
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
    phase: 0,
  },
];
