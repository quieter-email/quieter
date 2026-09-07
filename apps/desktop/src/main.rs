mod api;
mod app;
mod assets;
mod auth;
mod dither;
mod model;
mod theme;

use std::borrow::Cow;

use app::QuieterDesktop;
use assets::DesktopAssets;
use gpui::{
    App, AppContext as _, Application, Bounds, WindowBackgroundAppearance, WindowBounds,
    WindowOptions, px, size,
};
use gpui_component::{Root, TitleBar};

fn main() {
    Application::new()
        .with_assets(DesktopAssets)
        .run(|cx: &mut App| {
            cx.text_system()
                .add_fonts(vec![
                    Cow::Borrowed(include_bytes!("../assets/fonts/geist-variable.ttf")),
                    Cow::Borrowed(include_bytes!("../assets/fonts/geist-mono-variable.ttf")),
                    Cow::Borrowed(include_bytes!("../assets/fonts/lora-variable.ttf")),
                ])
                .expect("failed to load bundled Quieter fonts");
            gpui_component::init(cx);
            theme::configure_component_theme(cx);

            let bounds = Bounds::centered(None, size(px(1440.0), px(900.0)), cx);
            cx.open_window(
                WindowOptions {
                    app_id: Some("email.quieter.desktop".to_owned()),
                    titlebar: Some(TitleBar::title_bar_options()),
                    window_bounds: Some(WindowBounds::Windowed(bounds)),
                    window_background: WindowBackgroundAppearance::Blurred,
                    window_min_size: Some(size(px(980.0), px(640.0))),
                    ..WindowOptions::default()
                },
                |window, cx| {
                    let desktop = cx.new(|cx| QuieterDesktop::new(window, cx));
                    cx.new(|cx| Root::new(desktop, window, cx))
                },
            )
            .expect("failed to open the Quieter desktop window");
        });
}
