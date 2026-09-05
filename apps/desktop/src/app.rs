use gpui::{Context, IntoElement, Render, Window, div, prelude::*, px};

use crate::api::ApiClient;
use crate::auth::TokenStore;
use crate::theme::QuieterTheme;

pub struct QuieterDesktop {
    api: ApiClient,
    has_session: bool,
}

impl QuieterDesktop {
    pub fn new(_window: &mut Window, _cx: &mut Context<Self>) -> Self {
        let token = TokenStore::load();
        Self {
            api: ApiClient::new(token.clone()).expect("failed to initialize HTTP client"),
            has_session: token.is_some(),
        }
    }
}

impl Render for QuieterDesktop {
    fn render(&mut self, _window: &mut Window, _cx: &mut Context<Self>) -> impl IntoElement {
        let theme = QuieterTheme::light();
        div()
            .size_full()
            .bg(theme.background)
            .text_color(theme.foreground)
            .font_family("Geist")
            .child(
                div()
                    .size_full()
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(
                        div()
                            .w(px(420.0))
                            .p_8()
                            .rounded_xl()
                            .border_1()
                            .border_color(theme.border)
                            .bg(theme.surface)
                            .shadow_lg()
                            .child(
                                div()
                                    .text_2xl()
                                    .font_weight(gpui::FontWeight::SEMIBOLD)
                                    .child("Quieter"),
                            )
                            .child(
                                div()
                                    .mt_3()
                                    .text_sm()
                                    .text_color(theme.muted)
                                    .child(if self.has_session {
                                        "Restoring your desktop mailbox…"
                                    } else {
                                        "A faster, quieter way to work through mail."
                                    }),
                            )
                            .child(
                                div()
                                    .mt_6()
                                    .text_xs()
                                    .text_color(theme.muted)
                                    .child(format!("Server: {}", self.api.base_url())),
                            ),
                    ),
            )
    }
}

