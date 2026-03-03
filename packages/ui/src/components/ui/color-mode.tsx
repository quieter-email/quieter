import type { ComponentProps } from "solid-js";
import {
  COLOR_MODE_STORAGE_KEY,
  ColorModeProvider as ColorModeProviderPrimitive,
  ColorModeScript as ColorModeScriptPrimitive,
  type ColorModeProviderProps as PrimitiveColorModeProviderProps,
  type ColorModeScriptProps as PrimitiveColorModeScriptProps,
  type ConfigColorMode,
  useColorMode,
  useColorModeValue,
} from "@kobalte/core/color-mode";
import { createEffect, splitProps } from "solid-js";
import { cn } from "../../lib/cn";
import { ToggleButton } from "./toggle-button";

export type ColorModeProviderProps = PrimitiveColorModeProviderProps;

const setDocumentTheme = (value: "light" | "dark") => {
  if (typeof document === "undefined") return;

  const root = document.documentElement;
  root.classList.toggle("dark", value === "dark");
  root.classList.toggle("light", value === "light");
  root.setAttribute("data-theme", value);
  root.dataset.kbTheme = value;
  root.style.colorScheme = value;
};

const ColorModeDocumentSync = () => {
  const { colorMode } = useColorMode();

  createEffect(() => {
    setDocumentTheme(colorMode());
  });

  return null;
};

export const ColorModeProvider = (props: ColorModeProviderProps) => {
  const [local, others] = splitProps(props, ["children"]);

  return (
    <ColorModeProviderPrimitive {...others}>
      <ColorModeDocumentSync />
      {local.children}
    </ColorModeProviderPrimitive>
  );
};

export type ColorModeScriptProps = PrimitiveColorModeScriptProps;

const colorModeClassSyncScript =
  "!function(){try{var r=document.documentElement;var t=r.dataset.kbTheme;if(t!=='dark'&&t!=='light')return;r.classList.toggle('dark',t==='dark');r.classList.toggle('light',t==='light');r.setAttribute('data-theme',t);r.style.colorScheme=t;}catch(e){}}();";

export const ColorModeScript = (props: ColorModeScriptProps) => {
  const [local, others] = splitProps(props, ["nonce"]);

  return (
    <>
      <ColorModeScriptPrimitive nonce={local.nonce} {...others} />
      <script
        id="quietr-color-mode-class-sync-script"
        nonce={local.nonce}
        innerHTML={colorModeClassSyncScript}
      />
    </>
  );
};

export type ColorModeToggleProps = Omit<
  ComponentProps<typeof ToggleButton>,
  "onChange" | "pressed" | "children"
> & {
  lightLabel?: string;
  darkLabel?: string;
};

export const ColorModeToggle = (props: ColorModeToggleProps) => {
  const [local, others] = splitProps(props, ["class", "lightLabel", "darkLabel", "variant"]);
  const { colorMode, setColorMode } = useColorMode();

  return (
    <ToggleButton
      variant={local.variant ?? "default"}
      pressed={colorMode() === "dark"}
      onChange={(pressed) => {
        const next: ConfigColorMode = pressed ? "dark" : "light";
        setColorMode(next);
      }}
      class={cn("min-w-24", local.class)}
      {...others}
    >
      <span class="truncate">
        {colorMode() === "dark" ? (local.darkLabel ?? "Dark") : (local.lightLabel ?? "Light")}
      </span>
    </ToggleButton>
  );
};

export { COLOR_MODE_STORAGE_KEY, useColorMode, useColorModeValue };
