mod api;
mod app;
mod auth;
mod model;
mod theme;

use app::QuieterDesktop;
use gpui::{App, AppContext as _, Application, Bounds, WindowBounds, WindowOptions, px, size};
use gpui_component::Root;

fn main() {
    Application::new().run(|cx: &mut App| {
        gpui_component::init(cx);
        theme::configure_component_theme(cx);

        let bounds = Bounds::centered(None, size(px(1440.0), px(900.0)), cx);
        cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
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
