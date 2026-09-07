use gpui::{App, Hsla, Rgba, WindowAppearance, px};
use gpui_component::theme::Theme;

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
            background: oklch(0.91, 0.002, 264.0, 0.965),
            raised: oklch(0.945, 0.002, 264.0, 0.92),
            surface: oklch(0.975, 0.002, 264.0, 0.96),
            foreground: oklch(0.15, 0.001, 264.0, 1.0),
            muted: oklch(0.45, 0.003, 264.0, 1.0),
            control: oklch(0.945, 0.002, 264.0, 0.88),
            hover: oklch(0.85, 0.002, 264.0, 0.78),
            active: oklch(0.80, 0.002, 264.0, 0.9),
            border: oklch(0.80, 0.002, 264.0, 0.70),
            border_strong: oklch(0.72, 0.002, 264.0, 0.90),
            primary: oklch(0.37, 0.001, 264.0, 1.0),
            primary_foreground: oklch(0.985, 0.001, 264.0, 1.0),
            danger: oklch(0.58, 0.19, 24.0, 1.0),
            is_dark: false,
        }
    }

    pub fn dark() -> Self {
        Self {
            background: oklch(0.125, 0.002, 264.0, 0.965),
            raised: oklch(0.198, 0.003, 264.0, 0.92),
            surface: oklch(0.235, 0.003, 264.0, 0.96),
            foreground: oklch(1.0, 0.0, 0.0, 1.0),
            muted: oklch(0.74, 0.003, 264.0, 1.0),
            control: oklch(0.19, 0.003, 264.0, 0.9),
            hover: oklch(0.24, 0.003, 264.0, 0.9),
            active: oklch(0.29, 0.003, 264.0, 0.94),
            border: oklch(0.28, 0.003, 264.0, 0.70),
            border_strong: oklch(0.36, 0.003, 264.0, 0.90),
            primary: oklch(0.95, 0.001, 264.0, 1.0),
            primary_foreground: oklch(0.141, 0.002, 264.0, 1.0),
            danger: oklch(0.64, 0.20, 24.0, 1.0),
            is_dark: true,
        }
    }

    pub fn for_appearance(appearance: WindowAppearance) -> Self {
        match appearance {
            WindowAppearance::Dark | WindowAppearance::VibrantDark => Self::dark(),
            WindowAppearance::Light | WindowAppearance::VibrantLight => Self::light(),
        }
    }
}

pub fn configure_component_theme(cx: &mut App) {
    apply_component_theme(QuieterTheme::for_appearance(cx.window_appearance()), cx);
}

pub fn apply_component_theme(palette: QuieterTheme, cx: &mut App) {
    let theme = Theme::global_mut(cx);
    theme.font_family = "Geist".into();
    theme.font_size = px(14.0);
    theme.mono_font_family = "Geist Mono".into();
    theme.radius = px(8.0);
    theme.radius_lg = px(10.0);
    theme.shadow = true;
    theme.background = palette.background;
    theme.foreground = palette.foreground;
    theme.border = palette.border;
    theme.primary = palette.primary;
    theme.primary_foreground = palette.primary_foreground;
    theme.muted = palette.raised;
    theme.muted_foreground = palette.muted;
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
