use gpui::{App, Hsla, hsla, px};
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
}

impl QuieterTheme {
    pub fn light() -> Self {
        Self {
            background: hsla(264.0 / 360.0, 0.02, 0.91, 1.0),
            raised: hsla(264.0 / 360.0, 0.02, 0.945, 1.0),
            surface: hsla(264.0 / 360.0, 0.02, 0.975, 1.0),
            foreground: hsla(264.0 / 360.0, 0.01, 0.15, 1.0),
            muted: hsla(264.0 / 360.0, 0.03, 0.45, 1.0),
            control: hsla(264.0 / 360.0, 0.02, 0.945, 1.0),
            hover: hsla(264.0 / 360.0, 0.02, 0.85, 1.0),
            active: hsla(264.0 / 360.0, 0.02, 0.80, 1.0),
            border: hsla(264.0 / 360.0, 0.02, 0.80, 0.70),
            border_strong: hsla(264.0 / 360.0, 0.02, 0.72, 0.90),
            primary: hsla(264.0 / 360.0, 0.01, 0.37, 1.0),
            primary_foreground: hsla(264.0 / 360.0, 0.01, 0.985, 1.0),
            danger: hsla(4.0 / 360.0, 0.67, 0.49, 1.0),
        }
    }
}

pub fn configure_component_theme(cx: &mut App) {
    let palette = QuieterTheme::light();
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
}
