use gpui::{App, Hsla, Rgba, WindowAppearance, px};
use gpui_component::theme::{Theme, ThemeMode};

#[derive(Clone, Copy)]
pub struct QuieterTheme {
    pub background: Hsla,
    pub raised: Hsla,
    pub surface: Hsla,
    pub foreground: Hsla,
    pub muted: Hsla,
    pub control: Hsla,
    pub hover: Hsla,
    pub active: Hsla,
    pub border: Hsla,
    pub border_strong: Hsla,
    pub primary: Hsla,
    pub primary_foreground: Hsla,
    pub danger: Hsla,
    pub is_dark: bool,
}

impl QuieterTheme {
    pub fn light() -> Self {
        Self {
            background: oklch(0.91, 0.002, 264.0, 1.0),
            raised: oklch(0.945, 0.002, 264.0, 1.0),
            surface: oklch(0.975, 0.002, 264.0, 1.0),
            foreground: oklch(0.15, 0.002, 264.0, 1.0),
            muted: oklch(0.45, 0.003, 264.0, 1.0),
            control: oklch(0.945, 0.002, 264.0, 1.0),
            hover: oklch(0.85, 0.002, 264.0, 1.0),
            active: oklch(0.80, 0.002, 264.0, 1.0),
            border: oklch(0.80, 0.002, 264.0, 0.70),
            border_strong: oklch(0.72, 0.002, 264.0, 0.90),
            primary: oklch(0.37, 0.002, 264.0, 1.0),
            primary_foreground: oklch(0.985, 0.002, 264.0, 1.0),
            danger: oklch(0.48, 0.19, 27.33, 1.0),
            is_dark: false,
        }
    }

    pub fn dark() -> Self {
        Self {
            background: oklch(0.125, 0.0, 264.0, 1.0),
            raised: oklch(0.198, 0.003, 264.0, 1.0),
            surface: oklch(0.235, 0.003, 264.0, 1.0),
            foreground: oklch(1.0, 0.002, 264.0, 1.0),
            muted: oklch(0.74, 0.004, 264.0, 1.0),
            control: oklch(0.19, 0.003, 264.0, 1.0),
            hover: oklch(0.24, 0.003, 264.0, 1.0),
            active: oklch(0.29, 0.003, 264.0, 1.0),
            border: oklch(0.28, 0.004, 264.0, 0.70),
            border_strong: oklch(0.40, 0.004, 264.0, 0.90),
            primary: oklch(0.95, 0.002, 264.0, 1.0),
            primary_foreground: oklch(0.141, 0.003, 264.0, 1.0),
            danger: oklch(0.58, 0.13, 27.33, 1.0),
            is_dark: true,
        }
    }

    pub fn for_appearance(appearance: WindowAppearance) -> Self {
        match appearance {
            WindowAppearance::Dark | WindowAppearance::VibrantDark => Self::dark(),
            WindowAppearance::Light | WindowAppearance::VibrantLight => Self::light(),
        }
    }

    pub fn label_color(self, name: &str) -> Hsla {
        let (lightness, chroma, hue) = match (self.is_dark, name) {
            (false, "blue") => (0.62, 0.145, 250.0),
            (true, "blue") => (0.72, 0.145, 250.0),
            (false, "cyan") => (0.63, 0.125, 210.0),
            (true, "cyan") => (0.73, 0.125, 210.0),
            (false, "green") => (0.58, 0.14, 150.0),
            (true, "green") => (0.70, 0.14, 150.0),
            (false, "yellow") => (0.70, 0.14, 90.0),
            (true, "yellow") => (0.78, 0.14, 90.0),
            (false, "orange") => (0.64, 0.15, 55.0),
            (true, "orange") => (0.74, 0.15, 55.0),
            (false, "red") => (0.60, 0.18, 25.0),
            (true, "red") => (0.72, 0.18, 25.0),
            (false, "pink") => (0.63, 0.16, 345.0),
            (true, "pink") => (0.75, 0.16, 345.0),
            (false, "purple") => (0.60, 0.16, 300.0),
            (true, "purple") => (0.72, 0.16, 300.0),
            (false, _) => (0.58, 0.014, 264.0),
            (true, _) => (0.65, 0.014, 264.0),
        };
        oklch(lightness, chroma, hue, 1.0)
    }
}

pub fn configure_component_theme(cx: &mut App) {
    apply_component_theme(QuieterTheme::for_appearance(cx.window_appearance()), cx);
}

pub fn apply_component_theme(palette: QuieterTheme, cx: &mut App) {
    Theme::change(
        if palette.is_dark {
            ThemeMode::Dark
        } else {
            ThemeMode::Light
        },
        None,
        cx,
    );
    let theme = Theme::global_mut(cx);
    theme.font_family = "Geist".into();
    theme.font_size = px(16.0);
    theme.mono_font_family = "Geist Mono".into();
    theme.radius = px(13.5);
    theme.radius_lg = px(16.2);
    theme.shadow = true;
    theme.background = palette.background;
    theme.foreground = palette.foreground;
    theme.border = palette.border;
    theme.primary = palette.primary;
    theme.primary_foreground = palette.primary_foreground;
    theme.muted = palette.raised;
    theme.muted_foreground = palette.muted;
    theme.caret = palette.foreground;
    theme.accent = palette.hover;
    theme.accent_foreground = palette.foreground;
    theme.input = palette.border;
    theme.popover = palette.control;
    theme.popover_foreground = palette.foreground;
    theme.skeleton = palette.hover;
    theme.selection = palette.active.opacity(0.65);
    theme.scrollbar = Hsla::transparent_black();
    theme.scrollbar_thumb = if palette.is_dark {
        oklch(0.36, 0.004, 264.0, 1.0)
    } else {
        oklch(0.84, 0.002, 264.0, 1.0)
    };
    theme.scrollbar_thumb_hover = palette.border_strong;
    theme.danger = palette.danger;
    theme.danger_foreground = palette.primary_foreground;
    theme.secondary = palette.control;
    theme.secondary_foreground = palette.foreground;
    theme.secondary_hover = palette.hover;
    theme.secondary_active = palette.active;
    theme.title_bar = palette.background;
    theme.title_bar_border = palette.border;
}

fn oklch(lightness: f32, chroma: f32, hue_degrees: f32, alpha: f32) -> Hsla {
    let hue = hue_degrees.to_radians();
    let a = chroma * hue.cos();
    let b = chroma * hue.sin();
    let l_component = lightness + 0.396_337_78 * a + 0.215_803_76 * b;
    let m_component = lightness - 0.105_561_346 * a - 0.063_854_17 * b;
    let s_component = lightness - 0.089_484_18 * a - 1.291_485_5 * b;
    let l = l_component.powi(3);
    let m = m_component.powi(3);
    let s = s_component.powi(3);
    let red = 4.076_741_7 * l - 3.307_711_6 * m + 0.230_969_94 * s;
    let green = -1.268_438 * l + 2.609_757_4 * m - 0.341_319_4 * s;
    let blue = -0.004_196_086_3 * l - 0.703_418_6 * m + 1.707_614_7 * s;
    let gamma = |channel: f32| {
        if channel <= 0.003_130_8 {
            channel * 12.92
        } else {
            1.055 * channel.powf(1.0 / 2.4) - 0.055
        }
        .clamp(0.0, 1.0)
    };
    Hsla::from(Rgba {
        r: gamma(red),
        g: gamma(green),
        b: gamma(blue),
        a: alpha,
    })
}
