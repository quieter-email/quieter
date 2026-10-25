(() => {
  const root = document.documentElement;
  const originalClass = root.className;
  const originalTheme = root.dataset.colorTheme;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Canvas is unavailable.");
  }
  const probe = document.createElement("span");
  probe.style.setProperty("transition", "none", "important");
  document.body.append(probe);

  /** @param {string} token The semantic color token name. */
  const rgb = (token) => {
    if (getComputedStyle(probe).getPropertyValue(`--${token}`).trim() === "") {
      throw new Error(`Missing color token ${token}.`);
    }
    probe.style.color = `var(--${token})`;
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = getComputedStyle(probe).color;
    context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
  };
  /** @param {{ foreground: string, background: string, tint?: number }} colors The text color, backdrop, and optional pill tint. */
  const contrast = ({ foreground, background, tint = 0 }) => {
    const foregroundRgb = rgb(foreground);
    const backgroundRgb = rgb(background).map(
      (channel, index) => foregroundRgb[index] * tint + channel * (1 - tint)
    );
    const luminances = [foregroundRgb, backgroundRgb].map((channels) =>
      channels
        .map((value) => {
          const channel = value / 255;
          return channel <= 0.04045
            ? channel / 12.92
            : ((channel + 0.055) / 1.055) ** 2.4;
        })
        .reduce(
          (sum, channel, index) =>
            sum + channel * [0.2126, 0.7152, 0.0722][index],
          0
        )
    );
    return (Math.max(...luminances) + 0.05) / (Math.min(...luminances) + 0.05);
  };

  const themes = [
    ["light", "light"],
    ["dark", "dark"],
    ["04-porcelain", "light"],
    ["08-lilac", "light"],
    ["10-sand", "light"],
    ["12-eclipse", "dark"],
    ["graphite", "dark"],
    ["coffee", "dark"],
    ["moss", "dark"],
    ["sage", "light"],
  ];
  const colors = [
    "q-gray",
    "q-blue",
    "q-cyan",
    "q-green",
    "q-yellow",
    "q-orange",
    "q-red",
    "q-pink",
    "q-purple",
    "success",
    "destructive",
  ];
  const surfaces = ["bg", "bg-raised", "bg-surface", "control", "popover"];
  const measurements = [];
  const failures = [];

  try {
    for (const [theme, mode] of themes) {
      root.className = mode;
      if (theme === mode) {
        delete root.dataset.colorTheme;
      } else {
        root.dataset.colorTheme = theme;
      }
      let pillMinimum = Infinity;
      let textMinimum = Infinity;
      let focusMinimum = Infinity;
      let actionMinimum = Infinity;
      for (const surface of surfaces) {
        for (const color of colors) {
          const ratio = contrast({
            background: surface,
            foreground: color,
            tint: 0.15,
          });
          pillMinimum = Math.min(pillMinimum, ratio);
          if (ratio < 4.5) {
            failures.push({
              ratio,
              role: `${color} pill on ${surface}`,
              theme,
            });
          }
        }
        for (const token of ["fg", "muted-fg"]) {
          const ratio = contrast({ background: surface, foreground: token });
          textMinimum = Math.min(textMinimum, ratio);
          if (ratio < 4.5) {
            failures.push({ ratio, role: `${token} on ${surface}`, theme });
          }
        }
        const focusRatio = contrast({
          background: surface,
          foreground: "ring",
        });
        focusMinimum = Math.min(focusMinimum, focusRatio);
        if (focusRatio < 3) {
          failures.push({
            ratio: focusRatio,
            role: `focus on ${surface}`,
            theme,
          });
        }
      }
      for (const action of ["primary", "secondary", "destructive"]) {
        for (const suffix of ["", "-hover", "-active"]) {
          const ratio = contrast({
            background: `${action}${suffix}`,
            foreground: `${action}-fg`,
          });
          actionMinimum = Math.min(actionMinimum, ratio);
          if (ratio < 4.5) {
            failures.push({ ratio, role: `${action}${suffix}`, theme });
          }
        }
      }
      measurements.push({
        actionMinimum: Number(actionMinimum.toFixed(2)),
        focusMinimum: Number(focusMinimum.toFixed(2)),
        pillMinimum: Number(pillMinimum.toFixed(2)),
        textMinimum: Number(textMinimum.toFixed(2)),
        theme,
      });
    }
  } finally {
    root.className = originalClass;
    if (originalTheme === undefined) {
      delete root.dataset.colorTheme;
    } else {
      root.dataset.colorTheme = originalTheme;
    }
    probe.remove();
  }
  return { failures, measurements };
})();
