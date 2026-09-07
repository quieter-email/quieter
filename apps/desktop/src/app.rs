use std::collections::HashSet;
use std::time::{Duration, Instant};

use chrono::{DateTime, Local};
use gpui::{
    Animation, AnimationExt as _, AnyElement, ClickEvent, Context, Entity, FontWeight, Hsla,
    IntoElement, Render, SharedString, Subscription, Window, div, prelude::*, px, relative, svg,
    uniform_list,
};
use gpui_component::TitleBar;
use gpui_component::input::{Input, InputEvent, InputState};
use gpui_component::skeleton::Skeleton;
use gpui_component::spinner::Spinner;

use crate::api::{ApiClient, ApiError, DeviceCode};
use crate::auth::TokenStore;
use crate::dither::{particle_mark, workspace_dither};
use crate::model::{
    MailCategory, Mailbox, MailboxGroup, MessageDetail, MessageSummary, ThreadCommand,
    ThreadDetail, preview_mailboxes, preview_thread, preview_threads,
};
use crate::theme::{QuieterTheme, apply_component_theme};

#[derive(Clone)]
enum AppPhase {
    SignedOut,
    RequestingDevice,
    AwaitingDevice(DeviceCode),
    LoadingMailboxes,
    Ready,
}

#[derive(Clone)]
struct ToastMessage {
    is_error: bool,
    message: SharedString,
}

pub struct QuieterDesktop {
    api: ApiClient,
    phase: AppPhase,
    palette: QuieterTheme,
    mailbox_groups: Vec<MailboxGroup>,
    selected_mailbox_id: Option<String>,
    category: MailCategory,
    threads: Vec<MessageSummary>,
    thread_result_estimate: Option<u32>,
    has_more_threads: bool,
    selected_thread_id: Option<String>,
    thread_detail: Option<ThreadDetail>,
    loading_threads: bool,
    loading_detail: bool,
    compose_open: bool,
    sending: bool,
    mutating: bool,
    search_input: Entity<InputState>,
    compose_to_input: Entity<InputState>,
    compose_subject_input: Entity<InputState>,
    compose_body_input: Entity<InputState>,
    error_banner: Option<SharedString>,
    toast: Option<ToastMessage>,
    auth_generation: u64,
    thread_generation: u64,
    toast_generation: u64,
    is_preview: bool,
    _subscriptions: Vec<Subscription>,
}

impl QuieterDesktop {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let force_signed_out =
            std::env::var("QUIETER_DESKTOP_FORCE_SIGNED_OUT").is_ok_and(|value| value == "1");
        let token = if force_signed_out {
            None
        } else {
            TokenStore::load()
        };
        let has_session = token.is_some();
        let is_preview = std::env::var("QUIETER_DESKTOP_PREVIEW").is_ok_and(|value| value == "1");
        let search_input = cx.new(|cx| InputState::new(window, cx).placeholder("Search mail"));
        let compose_to_input = cx.new(|cx| InputState::new(window, cx).placeholder("Recipients"));
        let compose_subject_input = cx.new(|cx| InputState::new(window, cx).placeholder("Subject"));
        let compose_body_input = cx.new(|cx| {
            InputState::new(window, cx)
                .placeholder("Write a message…")
                .multi_line(true)
        });

        let mut subscriptions =
            vec![
                cx.subscribe_in(&search_input, window, |this, _, event, _, cx| {
                    if matches!(event, InputEvent::PressEnter { .. }) {
                        this.load_threads(cx);
                    }
                }),
            ];
        subscriptions.push(cx.observe_window_appearance(window, |this, window, cx| {
            this.palette = QuieterTheme::for_appearance(window.appearance());
            apply_component_theme(this.palette, cx);
            cx.notify();
        }));

        cx.defer_in(window, move |this, _, cx| {
            if is_preview {
                this.install_preview(cx);
            } else if has_session {
                this.load_mailboxes(cx);
            }
        });

        Self {
            api: ApiClient::new(token).expect("failed to initialize HTTP client"),
            phase: if is_preview {
                AppPhase::Ready
            } else if has_session {
                AppPhase::LoadingMailboxes
            } else {
                AppPhase::SignedOut
            },
            palette: QuieterTheme::for_appearance(window.appearance()),
            mailbox_groups: Vec::new(),
            selected_mailbox_id: None,
            category: MailCategory::Inbox,
            threads: Vec::new(),
            thread_result_estimate: None,
            has_more_threads: false,
            selected_thread_id: None,
            thread_detail: None,
            loading_threads: false,
            loading_detail: false,
            compose_open: false,
            sending: false,
            mutating: false,
            search_input,
            compose_to_input,
            compose_subject_input,
            compose_body_input,
            error_banner: None,
            toast: None,
            auth_generation: 0,
            thread_generation: 0,
            toast_generation: 0,
            is_preview,
            _subscriptions: subscriptions,
        }
    }

    fn install_preview(&mut self, cx: &mut Context<Self>) {
        let mailboxes = preview_mailboxes();
        self.selected_mailbox_id = mailboxes.default_mailbox_id;
        self.mailbox_groups = mailboxes.groups;
        self.threads = preview_threads();
        self.thread_result_estimate = Some(self.threads.len() as u32);
        self.has_more_threads = false;
        if let Some(first) = self.threads.first() {
            self.selected_thread_id = Some(first.thread_id.clone());
            self.thread_detail = Some(preview_thread(first));
        }
        self.phase = AppPhase::Ready;
        cx.notify();
    }

    fn begin_device_authorization(
        &mut self,
        _: &ClickEvent,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.auth_generation = self.auth_generation.wrapping_add(1);
        let generation = self.auth_generation;
        let api = self.api.with_token(None);
        self.phase = AppPhase::RequestingDevice;
        self.error_banner = None;
        cx.notify();

        cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move { api.request_device_code() })
                .await;
            let _ = this.update(cx, |this, cx| {
                if this.auth_generation != generation {
                    return;
                }
                match result {
                    Ok(code) => {
                        this.phase = AppPhase::AwaitingDevice(code.clone());
                        if let Err(error) = open::that(&code.verification_uri_complete) {
                            this.error_banner = Some(
                                format!("The browser could not be opened automatically: {error}")
                                    .into(),
                            );
                        }
                        this.poll_device_authorization(code, generation, cx);
                    }
                    Err(error) => {
                        this.phase = AppPhase::SignedOut;
                        this.error_banner = Some(error.to_string().into());
                    }
                }
                cx.notify();
            });
        })
        .detach();
    }

    fn poll_device_authorization(
        &mut self,
        code: DeviceCode,
        generation: u64,
        cx: &mut Context<Self>,
    ) {
        let api = self.api.with_token(None);
        cx.spawn(async move |this, cx| {
            let deadline = Instant::now() + Duration::from_secs(code.expires_in);
            let mut interval = Duration::from_secs(code.interval.max(1));

            loop {
                cx.background_executor().timer(interval).await;
                if Instant::now() >= deadline
                    || !this
                        .read_with(cx, |this, _| this.auth_generation == generation)
                        .unwrap_or(false)
                {
                    break;
                }

                let poll_api = api.clone();
                let device_code = code.device_code.clone();
                let result = cx
                    .background_executor()
                    .spawn(async move { poll_api.poll_device_token(&device_code) })
                    .await;
                match result {
                    Err(ApiError::AuthorizationPending) => continue,
                    Err(ApiError::SlowDown) => {
                        interval += Duration::from_secs(5);
                        continue;
                    }
                    Ok(token) => {
                        let access_token = token.access_token;
                        let token_to_store = access_token.clone();
                        let stored = cx
                            .background_executor()
                            .spawn(async move { TokenStore::save(&token_to_store) })
                            .await;
                        let _ = this.update(cx, |this, cx| {
                            if this.auth_generation != generation {
                                return;
                            }
                            this.api = this.api.with_token(Some(access_token));
                            if let Err(error) = stored {
                                this.error_banner = Some(
                                    format!(
                                        "Signed in, but the session could not be saved to the system credential vault: {error}"
                                    )
                                    .into(),
                                );
                            }
                            this.load_mailboxes(cx);
                        });
                        return;
                    }
                    Err(error) => {
                        let _ = this.update(cx, |this, cx| {
                            if this.auth_generation == generation {
                                this.phase = AppPhase::SignedOut;
                                this.error_banner = Some(error.to_string().into());
                                cx.notify();
                            }
                        });
                        return;
                    }
                }
            }

            let _ = this.update(cx, |this, cx| {
                if this.auth_generation == generation {
                    this.phase = AppPhase::SignedOut;
                    this.error_banner = Some("The authorization code expired. Try again.".into());
                    cx.notify();
                }
            });
        })
        .detach();
    }

    fn cancel_device_authorization(
        &mut self,
        _: &ClickEvent,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.auth_generation = self.auth_generation.wrapping_add(1);
        self.phase = AppPhase::SignedOut;
        self.error_banner = None;
        cx.notify();
    }

    fn reopen_authorization_page(
        &mut self,
        _: &ClickEvent,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if let AppPhase::AwaitingDevice(code) = &self.phase
            && let Err(error) = open::that(&code.verification_uri_complete)
        {
            self.set_toast(
                format!("The browser could not be opened: {error}"),
                true,
                cx,
            );
        }
    }

    fn load_mailboxes(&mut self, cx: &mut Context<Self>) {
        let api = self.api.clone();
        self.phase = AppPhase::LoadingMailboxes;
        cx.notify();

        cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move { api.list_mailboxes() })
                .await;
            let _ = this.update(cx, |this, cx| match result {
                Ok(mailboxes) => {
                    let first_mailbox_id = mailboxes
                        .groups
                        .iter()
                        .flat_map(|group| group.mailboxes.iter())
                        .next()
                        .map(|mailbox| mailbox.id.clone());
                    this.selected_mailbox_id = mailboxes
                        .default_mailbox_id
                        .filter(|default_id| {
                            mailboxes.groups.iter().any(|group| {
                                group
                                    .mailboxes
                                    .iter()
                                    .any(|mailbox| &mailbox.id == default_id)
                            })
                        })
                        .or(first_mailbox_id);
                    this.mailbox_groups = mailboxes.groups;
                    this.phase = AppPhase::Ready;
                    if this.selected_mailbox_id.is_some() {
                        this.load_threads(cx);
                    } else {
                        this.error_banner = Some(
                            "No mailbox is connected yet. Add one in the web app, then refresh."
                                .into(),
                        );
                        cx.notify();
                    }
                }
                Err(ApiError::Unauthorized) => {
                    this.expire_local_session(
                        "Your desktop session expired. Continue in the browser to reconnect.",
                        cx,
                    );
                }
                Err(error) => {
                    this.phase = AppPhase::Ready;
                    this.error_banner = Some(error.to_string().into());
                    cx.notify();
                }
            });
        })
        .detach();
    }

    fn load_threads(&mut self, cx: &mut Context<Self>) {
        let Some(mailbox_id) = self.selected_mailbox_id.clone() else {
            return;
        };
        let query = self.search_input.read(cx).value().trim().to_owned();

        if self.is_preview {
            let normalized_query = query.to_lowercase();
            self.threads = preview_threads()
                .into_iter()
                .filter(|message| {
                    (self.category == MailCategory::Inbox
                        || (self.category == MailCategory::Unread && message.is_unread))
                        && (normalized_query.is_empty()
                            || message.sender().to_lowercase().contains(&normalized_query)
                            || message.subject().to_lowercase().contains(&normalized_query)
                            || message.preview().to_lowercase().contains(&normalized_query))
                })
                .collect();
            self.thread_result_estimate = Some(self.threads.len() as u32);
            self.has_more_threads = false;
            self.selected_thread_id = self
                .threads
                .first()
                .map(|message| message.thread_id.clone());
            self.thread_detail = self.threads.first().map(preview_thread);
            cx.notify();
            return;
        }

        self.thread_generation = self.thread_generation.wrapping_add(1);
        let generation = self.thread_generation;
        let category = self.category;
        let api = self.api.clone();
        self.loading_threads = true;
        self.thread_detail = None;
        self.selected_thread_id = None;
        cx.notify();

        cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move {
                    api.list_threads(
                        &mailbox_id,
                        category,
                        (!query.is_empty()).then_some(query.as_str()),
                    )
                })
                .await;
            let _ = this.update(cx, |this, cx| {
                if this.thread_generation != generation {
                    return;
                }
                this.loading_threads = false;
                match result {
                    Ok(list) => {
                        this.thread_result_estimate = list.result_size_estimate;
                        this.has_more_threads = list.next_page_token.is_some();
                        let mut thread_ids = HashSet::new();
                        this.threads = list
                            .messages
                            .into_iter()
                            .filter(|message| thread_ids.insert(message.thread_id.clone()))
                            .collect();
                    }
                    Err(ApiError::Unauthorized) => this.expire_local_session(
                        "Your desktop session expired. Continue in the browser to reconnect.",
                        cx,
                    ),
                    Err(error) => this.set_toast(error.to_string(), true, cx),
                }
                cx.notify();
            });
        })
        .detach();
    }

    fn refresh_threads(&mut self, _: &ClickEvent, _: &mut Window, cx: &mut Context<Self>) {
        self.load_threads(cx);
    }

    fn select_category(&mut self, category: MailCategory, _: &mut Window, cx: &mut Context<Self>) {
        if self.category == category {
            return;
        }
        self.category = category;
        self.load_threads(cx);
    }

    fn select_thread(&mut self, thread_id: String, _: &mut Window, cx: &mut Context<Self>) {
        if self.selected_thread_id.as_deref() == Some(&thread_id) && self.thread_detail.is_some() {
            return;
        }
        self.selected_thread_id = Some(thread_id.clone());
        if let Some(message) = self
            .threads
            .iter_mut()
            .find(|message| message.thread_id == thread_id)
        {
            message.is_unread = false;
        }

        if self.is_preview {
            self.thread_detail = self
                .threads
                .iter()
                .find(|message| message.thread_id == thread_id)
                .map(preview_thread);
            cx.notify();
            return;
        }

        let Some(mailbox_id) = self.selected_mailbox_id.clone() else {
            return;
        };
        self.thread_generation = self.thread_generation.wrapping_add(1);
        let generation = self.thread_generation;
        let api = self.api.clone();
        self.thread_detail = None;
        self.loading_detail = true;
        cx.notify();

        cx.spawn(async move |this, cx| {
            let fetch_api = api.clone();
            let detail_mailbox_id = mailbox_id.clone();
            let detail_thread_id = thread_id.clone();
            let detail = cx
                .background_executor()
                .spawn(async move { fetch_api.get_thread(&detail_mailbox_id, &detail_thread_id) })
                .await;
            if detail.is_ok() {
                let _ = cx
                    .background_executor()
                    .spawn(async move {
                        api.thread_action(ThreadCommand::MarkRead, &mailbox_id, &thread_id)
                    })
                    .await;
            }
            let _ = this.update(cx, |this, cx| {
                if this.thread_generation != generation {
                    return;
                }
                this.loading_detail = false;
                match detail {
                    Ok(thread) => this.thread_detail = Some(thread),
                    Err(ApiError::Unauthorized) => this.expire_local_session(
                        "Your desktop session expired. Continue in the browser to reconnect.",
                        cx,
                    ),
                    Err(error) => this.set_toast(error.to_string(), true, cx),
                }
                cx.notify();
            });
        })
        .detach();
    }

    fn run_thread_action(&mut self, command: ThreadCommand, cx: &mut Context<Self>) {
        let Some(thread_id) = self.selected_thread_id.clone() else {
            return;
        };
        let remove_from_view = matches!(
            command,
            ThreadCommand::Archive
                | ThreadCommand::MoveToInbox
                | ThreadCommand::Spam
                | ThreadCommand::Trash
        );
        let previous_threads = self.threads.clone();
        let previous_detail = self.thread_detail.clone();

        if remove_from_view {
            self.threads
                .retain(|message| message.thread_id != thread_id);
            self.selected_thread_id = None;
            self.thread_detail = None;
        } else if let Some(message) = self
            .threads
            .iter_mut()
            .find(|message| message.thread_id == thread_id)
        {
            message.is_unread = matches!(command, ThreadCommand::MarkUnread);
        }

        if self.is_preview {
            self.set_toast(command.completion_message(), false, cx);
            return;
        }

        let Some(mailbox_id) = self.selected_mailbox_id.clone() else {
            return;
        };
        let api = self.api.clone();
        self.mutating = true;
        cx.notify();
        let request_thread_id = thread_id.clone();
        cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move { api.thread_action(command, &mailbox_id, &request_thread_id) })
                .await;
            let _ = this.update(cx, |this, cx| {
                this.mutating = false;
                match result {
                    Ok(_) => this.set_toast(command.completion_message(), false, cx),
                    Err(ApiError::Unauthorized) => this.expire_local_session(
                        "Your desktop session expired. Continue in the browser to reconnect.",
                        cx,
                    ),
                    Err(error) => {
                        this.threads = previous_threads;
                        this.thread_detail = previous_detail;
                        this.selected_thread_id = Some(thread_id);
                        this.set_toast(error.to_string(), true, cx);
                    }
                }
                cx.notify();
            });
        })
        .detach();
    }

    fn cycle_mailbox(&mut self, _: &ClickEvent, _: &mut Window, cx: &mut Context<Self>) {
        let mailbox_ids = self
            .mailbox_groups
            .iter()
            .flat_map(|group| group.mailboxes.iter())
            .map(|mailbox| mailbox.id.clone())
            .collect::<Vec<_>>();
        if mailbox_ids.len() < 2 {
            return;
        }
        let current_index = mailbox_ids
            .iter()
            .position(|id| Some(id) == self.selected_mailbox_id.as_ref())
            .unwrap_or_default();
        self.selected_mailbox_id =
            Some(mailbox_ids[(current_index + 1) % mailbox_ids.len()].clone());
        self.load_threads(cx);
    }

    fn open_compose(&mut self, _: &ClickEvent, _: &mut Window, cx: &mut Context<Self>) {
        self.compose_open = true;
        cx.notify();
    }

    fn close_compose(&mut self, _: &ClickEvent, _: &mut Window, cx: &mut Context<Self>) {
        if !self.sending {
            self.compose_open = false;
            cx.notify();
        }
    }

    fn open_reply(&mut self, _: &ClickEvent, window: &mut Window, cx: &mut Context<Self>) {
        let Some(detail) = self.thread_detail.as_ref() else {
            return;
        };
        let recipient = detail
            .messages
            .last()
            .and_then(|message| message.from.clone())
            .unwrap_or_default();
        let subject = detail.subject.as_deref().unwrap_or("(No subject)");
        let reply_subject = if subject.to_lowercase().starts_with("re:") {
            subject.to_owned()
        } else {
            format!("Re: {subject}")
        };
        self.compose_to_input
            .update(cx, |input, cx| input.set_value(recipient, window, cx));
        self.compose_subject_input
            .update(cx, |input, cx| input.set_value(reply_subject, window, cx));
        self.compose_body_input
            .update(cx, |input, cx| input.set_value("", window, cx));
        self.compose_open = true;
        cx.notify();
    }

    fn send_compose(&mut self, _: &ClickEvent, window: &mut Window, cx: &mut Context<Self>) {
        if self.sending {
            return;
        }
        let to = self.compose_to_input.read(cx).value().trim().to_owned();
        let subject = self
            .compose_subject_input
            .read(cx)
            .value()
            .trim()
            .to_owned();
        let body = self.compose_body_input.read(cx).value().to_string();
        if to.is_empty() {
            self.set_toast("Add at least one recipient in To.", true, cx);
            return;
        }
        if body.trim().is_empty() {
            self.set_toast("Write a message before sending.", true, cx);
            return;
        }

        if self.is_preview {
            self.finish_send(window, cx);
            return;
        }
        let Some(mailbox_id) = self.selected_mailbox_id.clone() else {
            return;
        };
        let api = self.api.clone();
        self.sending = true;
        cx.notify();
        cx.spawn_in(window, async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move { api.send_message(&mailbox_id, &to, &subject, &body) })
                .await;
            let _ = this.update_in(cx, |this, window, cx| {
                this.sending = false;
                match result {
                    Ok(_) => this.finish_send(window, cx),
                    Err(ApiError::Unauthorized) => this.expire_local_session(
                        "Your desktop session expired. Continue in the browser to reconnect.",
                        cx,
                    ),
                    Err(error) => this.set_toast(error.to_string(), true, cx),
                }
                cx.notify();
            });
        })
        .detach();
    }

    fn finish_send(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.compose_open = false;
        self.sending = false;
        self.compose_to_input
            .update(cx, |input, cx| input.set_value("", window, cx));
        self.compose_subject_input
            .update(cx, |input, cx| input.set_value("", window, cx));
        self.compose_body_input
            .update(cx, |input, cx| input.set_value("", window, cx));
        self.set_toast("Message sent", false, cx);
    }

    fn open_web_settings(&mut self, _: &ClickEvent, _: &mut Window, cx: &mut Context<Self>) {
        if let Err(error) = open::that(format!("{}/settings", self.api.base_url())) {
            self.set_toast(format!("Settings could not be opened: {error}"), true, cx);
        }
    }

    fn open_web_chat(&mut self, _: &ClickEvent, _: &mut Window, cx: &mut Context<Self>) {
        if let Err(error) = open::that(format!("{}/chat", self.api.base_url())) {
            self.set_toast(format!("Chat could not be opened: {error}"), true, cx);
        }
    }

    fn sign_out(&mut self, _: &ClickEvent, _: &mut Window, cx: &mut Context<Self>) {
        let api = self.api.clone();
        cx.spawn(async move |_, cx| {
            let _ = cx
                .background_executor()
                .spawn(async move { api.sign_out() })
                .await;
        })
        .detach();
        self.expire_local_session("Signed out on this device.", cx);
    }

    fn expire_local_session(&mut self, message: impl Into<SharedString>, cx: &mut Context<Self>) {
        self.auth_generation = self.auth_generation.wrapping_add(1);
        let _ = TokenStore::clear();
        self.api = self.api.with_token(None);
        self.phase = AppPhase::SignedOut;
        self.mailbox_groups.clear();
        self.selected_mailbox_id = None;
        self.threads.clear();
        self.thread_result_estimate = None;
        self.has_more_threads = false;
        self.selected_thread_id = None;
        self.thread_detail = None;
        self.compose_open = false;
        self.is_preview = false;
        self.error_banner = Some(message.into());
        cx.notify();
    }

    fn set_toast(
        &mut self,
        message: impl Into<SharedString>,
        is_error: bool,
        cx: &mut Context<Self>,
    ) {
        self.toast_generation = self.toast_generation.wrapping_add(1);
        let generation = self.toast_generation;
        self.toast = Some(ToastMessage {
            is_error,
            message: message.into(),
        });
        cx.notify();
        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(Duration::from_secs(4)).await;
            let _ = this.update(cx, |this, cx| {
                if this.toast_generation == generation {
                    this.toast = None;
                    cx.notify();
                }
            });
        })
        .detach();
    }

    fn selected_mailbox(&self) -> Option<&Mailbox> {
        self.mailbox_groups
            .iter()
            .flat_map(|group| group.mailboxes.iter())
            .find(|mailbox| Some(&mailbox.id) == self.selected_mailbox_id.as_ref())
    }

    fn render_title_bar(&self) -> AnyElement {
        TitleBar::new()
            .bg(self.palette.background)
            .border_color(self.palette.border)
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .h_full()
                    .text_sm()
                    .font_weight(FontWeight::MEDIUM)
                    .child(
                        svg()
                            .path("brand/quieter-mark.svg")
                            .size(px(17.0))
                            .text_color(self.palette.foreground),
                    )
                    .child("Quieter"),
            )
            .into_any_element()
    }

    fn render_auth(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let palette = self.palette;
        let content = match &self.phase {
            AppPhase::RequestingDevice => div()
                .mt_8()
                .h(px(42.0))
                .w_full()
                .rounded_lg()
                .bg(palette.primary)
                .text_color(palette.primary_foreground)
                .flex()
                .items_center()
                .justify_center()
                .gap_2()
                .child(Spinner::new().color(palette.primary_foreground))
                .child("Preparing secure sign-in…")
                .into_any_element(),
            AppPhase::AwaitingDevice(code) => div()
                .mt_8()
                .w_full()
                .child(
                    div()
                        .rounded_lg()
                        .border_1()
                        .border_color(palette.border)
                        .bg(palette.raised)
                        .px_5()
                        .py_4()
                        .child(
                            div()
                                .text_xs()
                                .text_color(palette.muted)
                                .child("One-time code"),
                        )
                        .child(
                            div()
                                .mt_2()
                                .font_family("Geist Mono")
                                .text_2xl()
                                .font_weight(FontWeight::SEMIBOLD)
                                .child(code.user_code.clone()),
                        )
                        .child(
                            div()
                                .mt_2()
                                .text_sm()
                                .text_color(palette.muted)
                                .child("Approve this desktop in the browser. This window will continue automatically."),
                        )
                        .child(
                            div()
                                .mt_2()
                                .truncate()
                                .text_xs()
                                .text_color(palette.muted)
                                .child(code.verification_uri.clone()),
                        ),
                )
                .child(
                    div()
                        .id("open-authorization-page")
                        .mt_3()
                        .h(px(42.0))
                        .w_full()
                        .rounded_lg()
                        .bg(palette.primary)
                        .text_color(palette.primary_foreground)
                        .cursor_pointer()
                        .flex()
                        .items_center()
                        .justify_center()
                        .on_click(cx.listener(Self::reopen_authorization_page))
                        .child("Open browser again"),
                )
                .child(
                    div()
                        .id("cancel-authorization")
                        .mt_2()
                        .h(px(38.0))
                        .w_full()
                        .rounded_lg()
                        .cursor_pointer()
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_sm()
                        .text_color(palette.muted)
                        .hover(|style| style.bg(palette.hover))
                        .on_click(cx.listener(Self::cancel_device_authorization))
                        .child("Cancel"),
                )
                .into_any_element(),
            _ => div()
                .id("continue-in-browser")
                .mt_8()
                .h(px(42.0))
                .w_full()
                .rounded_lg()
                .bg(palette.primary)
                .text_color(palette.primary_foreground)
                .cursor_pointer()
                .flex()
                .items_center()
                .justify_center()
                .gap_2()
                .hover(|style| style.opacity(0.88))
                .on_click(cx.listener(Self::begin_device_authorization))
                .child("Continue in browser")
                .child(
                    svg()
                        .path("icons/chevron-down.svg")
                        .size(px(15.0))
                        .text_color(palette.primary_foreground),
                )
                .into_any_element(),
        };

        div()
            .size_full()
            .flex()
            .bg(palette.background)
            .child(
                div()
                    .w(relative(0.5))
                    .h_full()
                    .flex()
                    .items_center()
                    .justify_center()
                    .px_8()
                    .child(
                        div()
                            .w_full()
                            .max_w(px(448.0))
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_2()
                                    .mb_10()
                                    .child(
                                        svg()
                                            .path("brand/quieter-mark.svg")
                                            .size(px(28.0))
                                            .text_color(palette.foreground),
                                    )
                                    .child(
                                        div()
                                            .text_xl()
                                            .font_weight(FontWeight::SEMIBOLD)
                                            .child("Quieter"),
                                    ),
                            )
                            .child(
                                div()
                                    .text_2xl()
                                    .font_weight(FontWeight::MEDIUM)
                                    .child("Continue to Quieter"),
                            )
                            .child(
                                div().mt_2().text_sm().text_color(palette.muted).child(
                                    "Sign in in your browser, then return to the native app.",
                                ),
                            )
                            .child(content)
                            .when_some(self.error_banner.clone(), |this, error| {
                                this.child(
                                    div()
                                        .mt_4()
                                        .rounded_lg()
                                        .border_1()
                                        .border_color(palette.danger)
                                        .bg(palette.surface)
                                        .p_3()
                                        .text_sm()
                                        .text_color(palette.danger)
                                        .child(error),
                                )
                            })
                            .child(div().mt_8().text_xs().text_color(palette.muted).child(
                                if self.api.base_url().contains("localhost") {
                                    "Using the local Quieter development server"
                                } else {
                                    "Connected securely to quieter.email"
                                },
                            )),
                    ),
            )
            .child(
                div()
                    .relative()
                    .w(relative(0.5))
                    .h_full()
                    .overflow_hidden()
                    .border_l_1()
                    .border_color(palette.border)
                    .bg(palette.surface)
                    .child(
                        div()
                            .absolute()
                            .top_0()
                            .left_0()
                            .right_0()
                            .bottom_0()
                            .child(workspace_dither(palette.foreground, palette.is_dark)),
                    )
                    .child(
                        div()
                            .absolute()
                            .top_0()
                            .left_0()
                            .right_0()
                            .bottom_0()
                            .with_animation(
                                "auth-particle-field",
                                Animation::new(Duration::from_secs(10)).repeat(),
                                move |this, delta| {
                                    this.child(particle_mark(
                                        palette.foreground,
                                        delta * std::f32::consts::TAU * 2.0,
                                    ))
                                },
                            ),
                    ),
            )
            .into_any_element()
    }

    fn render_sidebar(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let palette = self.palette;
        let mailbox = self.selected_mailbox().cloned();
        let mailbox_count = self
            .mailbox_groups
            .iter()
            .map(|group| group.mailboxes.len())
            .sum::<usize>();
        let group_name = self
            .mailbox_groups
            .iter()
            .find(|group| {
                group
                    .mailboxes
                    .iter()
                    .any(|item| self.selected_mailbox_id.as_deref() == Some(item.id.as_str()))
            })
            .map(|group| {
                let _group_identity = &group.id;
                group.name.clone()
            })
            .unwrap_or_else(|| "Mailbox".to_owned());

        let mut navigation = div().mt_4().flex().flex_col().gap_1();
        for (category_index, category) in MailCategory::ALL.into_iter().enumerate() {
            let is_active = self.category == category;
            let unread_count = (category == MailCategory::Inbox)
                .then(|| {
                    mailbox
                        .as_ref()
                        .map_or(0, |mailbox| mailbox.unread_non_spam_count)
                })
                .unwrap_or_default();
            navigation = navigation.child(
                div()
                    .id(("category", category_index))
                    .h(px(34.0))
                    .px_3()
                    .rounded_lg()
                    .flex()
                    .items_center()
                    .gap_3()
                    .cursor_pointer()
                    .text_sm()
                    .font_weight(if is_active {
                        FontWeight::MEDIUM
                    } else {
                        FontWeight::NORMAL
                    })
                    .bg(if is_active {
                        palette.active
                    } else {
                        Hsla::transparent_black()
                    })
                    .hover(|style| style.bg(palette.hover))
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.select_category(category, window, cx);
                    }))
                    .child(svg().path(category.icon_path()).size(px(17.0)).text_color(
                        if is_active {
                            palette.foreground
                        } else {
                            palette.muted
                        },
                    ))
                    .child(div().flex_1().child(category.label()))
                    .when(unread_count > 0, |this| {
                        this.child(
                            div()
                                .min_w(px(21.0))
                                .h(px(20.0))
                                .px_1()
                                .rounded_full()
                                .bg(palette.control)
                                .text_xs()
                                .flex()
                                .items_center()
                                .justify_center()
                                .child(unread_count.to_string()),
                        )
                    }),
            );
        }

        div()
            .w(px(272.0))
            .h_full()
            .flex_none()
            .flex()
            .flex_col()
            .px_3()
            .pb_3()
            .child(
                div()
                    .id("mailbox-switcher")
                    .mt_2()
                    .h(px(54.0))
                    .rounded_lg()
                    .border_1()
                    .border_color(palette.border)
                    .bg(palette.raised)
                    .px_3()
                    .flex()
                    .items_center()
                    .gap_3()
                    .cursor_pointer()
                    .hover(|style| style.bg(palette.hover))
                    .on_click(cx.listener(Self::cycle_mailbox))
                    .child(
                        div()
                            .size(px(32.0))
                            .rounded_full()
                            .bg(palette.primary)
                            .text_color(palette.primary_foreground)
                            .flex()
                            .items_center()
                            .justify_center()
                            .text_sm()
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(
                                mailbox
                                    .as_ref()
                                    .and_then(|mailbox| mailbox.label().chars().next())
                                    .unwrap_or('Q')
                                    .to_uppercase()
                                    .to_string(),
                            ),
                    )
                    .when_some(mailbox.as_ref(), |this, mailbox| {
                        this.child(
                            div()
                                .ml(px(-16.0))
                                .mt(px(21.0))
                                .size(px(8.0))
                                .rounded_full()
                                .border_2()
                                .border_color(palette.raised)
                                .bg(if mailbox.connection_status == "connected" {
                                    palette.primary
                                } else {
                                    palette.danger
                                }),
                        )
                    })
                    .child(
                        div()
                            .min_w_0()
                            .flex_1()
                            .child(
                                div()
                                    .truncate()
                                    .text_sm()
                                    .font_weight(FontWeight::MEDIUM)
                                    .child(
                                        mailbox
                                            .as_ref()
                                            .map_or("Loading mailbox…", Mailbox::label)
                                            .to_owned(),
                                    ),
                            )
                            .child(
                                div()
                                    .truncate()
                                    .text_xs()
                                    .text_color(palette.muted)
                                    .child(group_name),
                            ),
                    )
                    .when(mailbox_count > 1, |this| {
                        this.child(
                            svg()
                                .path("icons/chevron-down.svg")
                                .size(px(15.0))
                                .text_color(palette.muted),
                        )
                    }),
            )
            .child(
                div()
                    .mt_3()
                    .h(px(34.0))
                    .rounded_lg()
                    .bg(palette.control)
                    .p(px(3.0))
                    .flex()
                    .child(
                        div()
                            .h_full()
                            .flex_1()
                            .rounded(px(6.0))
                            .bg(palette.surface)
                            .shadow_sm()
                            .flex()
                            .items_center()
                            .justify_center()
                            .gap_2()
                            .text_sm()
                            .font_weight(FontWeight::MEDIUM)
                            .child(
                                svg()
                                    .path("icons/mail.svg")
                                    .size(px(15.0))
                                    .text_color(palette.foreground),
                            )
                            .child("Mail"),
                    )
                    .child(
                        div()
                            .id("open-web-chat")
                            .h_full()
                            .flex_1()
                            .rounded(px(6.0))
                            .cursor_pointer()
                            .flex()
                            .items_center()
                            .justify_center()
                            .text_sm()
                            .text_color(palette.muted)
                            .hover(|style| style.bg(palette.hover))
                            .on_click(cx.listener(Self::open_web_chat))
                            .child("Chat ↗"),
                    ),
            )
            .child(
                div()
                    .id("compose")
                    .mt_4()
                    .h(px(40.0))
                    .rounded_lg()
                    .bg(palette.primary)
                    .text_color(palette.primary_foreground)
                    .cursor_pointer()
                    .flex()
                    .items_center()
                    .justify_center()
                    .gap_2()
                    .font_weight(FontWeight::MEDIUM)
                    .hover(|style| style.opacity(0.88))
                    .on_click(cx.listener(Self::open_compose))
                    .child(
                        svg()
                            .path("icons/edit.svg")
                            .size(px(16.0))
                            .text_color(palette.primary_foreground),
                    )
                    .child("Compose"),
            )
            .child(navigation)
            .child(div().flex_1())
            .child(
                div()
                    .border_t_1()
                    .border_color(palette.border)
                    .pt_3()
                    .child(
                        div()
                            .id("settings")
                            .h(px(34.0))
                            .px_3()
                            .rounded_lg()
                            .flex()
                            .items_center()
                            .gap_3()
                            .cursor_pointer()
                            .text_sm()
                            .text_color(palette.muted)
                            .hover(|style| style.bg(palette.hover).text_color(palette.foreground))
                            .on_click(cx.listener(Self::open_web_settings))
                            .child(
                                svg()
                                    .path("icons/settings.svg")
                                    .size(px(17.0))
                                    .text_color(palette.muted),
                            )
                            .child("Settings")
                            .child(div().flex_1())
                            .child("↗"),
                    )
                    .child(
                        div()
                            .id("sign-out")
                            .h(px(34.0))
                            .px_3()
                            .rounded_lg()
                            .flex()
                            .items_center()
                            .gap_3()
                            .cursor_pointer()
                            .text_sm()
                            .text_color(palette.muted)
                            .hover(|style| style.bg(palette.hover).text_color(palette.foreground))
                            .on_click(cx.listener(Self::sign_out))
                            .child(
                                svg()
                                    .path("icons/logout.svg")
                                    .size(px(17.0))
                                    .text_color(palette.muted),
                            )
                            .child("Sign out"),
                    ),
            )
            .into_any_element()
    }

    fn render_thread_row(&mut self, index: usize, cx: &mut Context<Self>) -> AnyElement {
        let message = self.threads[index].clone();
        let palette = self.palette;
        let is_selected = self.selected_thread_id.as_deref() == Some(message.thread_id.as_str());
        let is_unread = message.is_unread
            || message.label_ids.iter().any(|label| label == "UNREAD")
            || message
                .thread_label_ids
                .iter()
                .any(|label| label == "UNREAD");
        let sender = sender_label(message.sender());
        let initial = sender
            .chars()
            .next()
            .unwrap_or('?')
            .to_uppercase()
            .to_string();
        let date = format_mail_date(message.date.as_deref().or(message.internal_date.as_deref()));
        let thread_id = message.thread_id.clone();

        div()
            .id(index)
            .h(px(76.0))
            .w_full()
            .px_3()
            .py_2()
            .border_b_1()
            .border_color(palette.border)
            .cursor_pointer()
            .bg(if is_selected {
                palette.active
            } else {
                Hsla::transparent_black()
            })
            .hover(|style| {
                style.bg(if is_selected {
                    palette.active
                } else {
                    palette.hover
                })
            })
            .on_click(cx.listener(move |this, _, window, cx| {
                this.select_thread(thread_id.clone(), window, cx);
            }))
            .child(
                div()
                    .size_full()
                    .flex()
                    .items_center()
                    .gap_3()
                    .child(
                        div()
                            .relative()
                            .size(px(38.0))
                            .flex_none()
                            .rounded_full()
                            .bg(palette.control)
                            .flex()
                            .items_center()
                            .justify_center()
                            .text_sm()
                            .font_weight(FontWeight::MEDIUM)
                            .child(initial)
                            .when(is_unread, |this| {
                                this.child(
                                    div()
                                        .absolute()
                                        .right(px(-1.0))
                                        .bottom(px(0.0))
                                        .size(px(8.0))
                                        .rounded_full()
                                        .border_2()
                                        .border_color(if is_selected {
                                            palette.active
                                        } else {
                                            palette.surface
                                        })
                                        .bg(palette.primary),
                                )
                            }),
                    )
                    .child(
                        div()
                            .min_w_0()
                            .flex_1()
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_2()
                                    .child(
                                        div()
                                            .min_w_0()
                                            .flex_1()
                                            .truncate()
                                            .text_sm()
                                            .font_weight(if is_unread {
                                                FontWeight::SEMIBOLD
                                            } else {
                                                FontWeight::MEDIUM
                                            })
                                            .child(sender),
                                    )
                                    .when(message.thread_message_count.unwrap_or(1) > 1, |this| {
                                        this.child(div().text_xs().text_color(palette.muted).child(
                                            format!(
                                                "{}",
                                                message.thread_message_count.unwrap_or(1)
                                            ),
                                        ))
                                    })
                                    .child(
                                        div()
                                            .flex_none()
                                            .text_xs()
                                            .text_color(palette.muted)
                                            .child(date),
                                    ),
                            )
                            .child(
                                div()
                                    .mt(px(1.0))
                                    .truncate()
                                    .text_sm()
                                    .font_weight(if is_unread {
                                        FontWeight::MEDIUM
                                    } else {
                                        FontWeight::NORMAL
                                    })
                                    .child(message.subject().to_owned()),
                            )
                            .child(
                                div()
                                    .mt(px(1.0))
                                    .truncate()
                                    .text_xs()
                                    .text_color(palette.muted)
                                    .child(message.preview().to_owned()),
                            ),
                    ),
            )
            .into_any_element()
    }

    fn render_message_list(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let palette = self.palette;
        let count = self
            .thread_result_estimate
            .unwrap_or(self.threads.len() as u32);
        let list_body = if self.loading_threads {
            div()
                .flex_1()
                .px_3()
                .py_3()
                .flex()
                .flex_col()
                .gap_3()
                .children((0..7).map(|index| {
                    div()
                        .id(("thread-skeleton", index as usize))
                        .h(px(58.0))
                        .flex()
                        .items_center()
                        .gap_3()
                        .child(Skeleton::new().size(px(38.0)).rounded_full())
                        .child(
                            div()
                                .flex_1()
                                .flex()
                                .flex_col()
                                .gap_2()
                                .child(Skeleton::new().h(px(10.0)))
                                .child(Skeleton::new().h(px(8.0)).w(relative(0.72))),
                        )
                }))
                .into_any_element()
        } else if self.threads.is_empty() {
            div()
                .flex_1()
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .px_8()
                .text_center()
                .child(
                    svg()
                        .path("icons/mail.svg")
                        .size(px(26.0))
                        .text_color(palette.muted),
                )
                .child(
                    div()
                        .mt_3()
                        .text_sm()
                        .font_weight(FontWeight::MEDIUM)
                        .child("Nothing here"),
                )
                .child(
                    div()
                        .mt_1()
                        .text_xs()
                        .text_color(palette.muted)
                        .child("This view is clear. Try another mailbox or search."),
                )
                .into_any_element()
        } else {
            uniform_list(
                "message-threads",
                self.threads.len(),
                cx.processor(|this, range: std::ops::Range<usize>, _, cx| {
                    range
                        .map(|index| this.render_thread_row(index, cx))
                        .collect::<Vec<_>>()
                }),
            )
            .h_full()
            .into_any_element()
        };

        div()
            .w(relative(0.34))
            .min_w(px(320.0))
            .max_w(px(480.0))
            .h_full()
            .flex_none()
            .flex()
            .flex_col()
            .overflow_hidden()
            .rounded_lg()
            .border_1()
            .border_color(palette.border)
            .bg(palette.surface)
            .shadow_sm()
            .child(
                div()
                    .h(px(52.0))
                    .flex_none()
                    .px_4()
                    .border_b_1()
                    .border_color(palette.border)
                    .flex()
                    .items_center()
                    .child(
                        div()
                            .text_base()
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(self.category.label()),
                    )
                    .child(div().ml_2().text_xs().text_color(palette.muted).child(
                        if self.has_more_threads {
                            format!("{count}+")
                        } else {
                            count.to_string()
                        },
                    ))
                    .child(div().flex_1())
                    .child(
                        div()
                            .id("refresh-threads")
                            .size(px(30.0))
                            .rounded_lg()
                            .cursor_pointer()
                            .flex()
                            .items_center()
                            .justify_center()
                            .hover(|style| style.bg(palette.hover))
                            .on_click(cx.listener(Self::refresh_threads))
                            .child(
                                svg()
                                    .path("icons/refresh.svg")
                                    .size(px(16.0))
                                    .text_color(palette.muted),
                            ),
                    ),
            )
            .child(
                div()
                    .h(px(48.0))
                    .flex_none()
                    .px_3()
                    .py_2()
                    .border_b_1()
                    .border_color(palette.border)
                    .child(
                        div()
                            .h_full()
                            .rounded_lg()
                            .bg(palette.control)
                            .flex()
                            .items_center()
                            .px_2()
                            .child(
                                svg()
                                    .path("icons/search.svg")
                                    .size(px(15.0))
                                    .text_color(palette.muted),
                            )
                            .child(
                                Input::new(&self.search_input)
                                    .appearance(false)
                                    .bordered(false)
                                    .focus_bordered(false)
                                    .h_full()
                                    .flex_1(),
                            ),
                    ),
            )
            .child(list_body)
            .into_any_element()
    }

    fn render_detail_header(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let palette = self.palette;
        let has_thread = self.selected_thread_id.is_some();
        let archive_or_inbox = if self.category == MailCategory::Trash {
            (
                "icons/inbox.svg",
                ThreadCommand::MoveToInbox,
                "Move to Inbox",
            )
        } else {
            ("icons/archive.svg", ThreadCommand::Archive, "Archive")
        };

        div()
            .h(px(52.0))
            .flex_none()
            .px_3()
            .border_b_1()
            .border_color(palette.border)
            .flex()
            .items_center()
            .gap_1()
            .when(has_thread, |this| {
                this.child(
                    div()
                        .id("thread-primary-action")
                        .size(px(32.0))
                        .rounded_lg()
                        .cursor_pointer()
                        .flex()
                        .items_center()
                        .justify_center()
                        .hover(|style| style.bg(palette.hover))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.run_thread_action(archive_or_inbox.1, cx);
                        }))
                        .child(
                            svg()
                                .path(archive_or_inbox.0)
                                .size(px(17.0))
                                .text_color(palette.muted),
                        ),
                )
                .child(
                    div()
                        .id("thread-unread")
                        .size(px(32.0))
                        .rounded_lg()
                        .cursor_pointer()
                        .flex()
                        .items_center()
                        .justify_center()
                        .hover(|style| style.bg(palette.hover))
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.run_thread_action(ThreadCommand::MarkUnread, cx);
                        }))
                        .child(
                            svg()
                                .path("icons/mail.svg")
                                .size(px(17.0))
                                .text_color(palette.muted),
                        ),
                )
                .child(
                    div()
                        .id("thread-spam")
                        .size(px(32.0))
                        .rounded_lg()
                        .cursor_pointer()
                        .flex()
                        .items_center()
                        .justify_center()
                        .hover(|style| style.bg(palette.hover))
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.run_thread_action(ThreadCommand::Spam, cx);
                        }))
                        .child(
                            svg()
                                .path("icons/spam.svg")
                                .size(px(17.0))
                                .text_color(palette.muted),
                        ),
                )
                .child(
                    div()
                        .id("thread-trash")
                        .size(px(32.0))
                        .rounded_lg()
                        .cursor_pointer()
                        .flex()
                        .items_center()
                        .justify_center()
                        .hover(|style| style.bg(palette.hover))
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.run_thread_action(ThreadCommand::Trash, cx);
                        }))
                        .child(
                            svg()
                                .path("icons/trash.svg")
                                .size(px(17.0))
                                .text_color(palette.muted),
                        ),
                )
                .child(div().flex_1())
                .child(
                    div()
                        .id("reply")
                        .h(px(32.0))
                        .px_3()
                        .rounded_lg()
                        .border_1()
                        .border_color(palette.border)
                        .cursor_pointer()
                        .flex()
                        .items_center()
                        .gap_2()
                        .text_sm()
                        .hover(|style| style.bg(palette.hover))
                        .on_click(cx.listener(Self::open_reply))
                        .child(
                            svg()
                                .path("icons/reply.svg")
                                .size(px(16.0))
                                .text_color(palette.foreground),
                        )
                        .child("Reply"),
                )
            })
            .when(!has_thread, |this| {
                this.child(
                    div()
                        .text_xs()
                        .text_color(palette.muted)
                        .child("Select a conversation to read it"),
                )
            })
            .when(self.mutating, |this| {
                this.child(Spinner::new().color(palette.muted))
            })
            .into_any_element()
    }

    fn render_message_card(&self, message: &MessageDetail, index: usize) -> AnyElement {
        let palette = self.palette;
        let sender = sender_label(message.from.as_deref().unwrap_or("Unknown sender"));
        let initial = sender
            .chars()
            .next()
            .unwrap_or('?')
            .to_uppercase()
            .to_string();
        div()
            .id(SharedString::from(format!(
                "message-card-{}-{index}",
                message.id
            )))
            .rounded_lg()
            .border_1()
            .border_color(palette.border)
            .bg(palette.surface)
            .shadow_sm()
            .overflow_hidden()
            .child(
                div()
                    .px_5()
                    .py_4()
                    .flex()
                    .items_center()
                    .gap_3()
                    .border_b_1()
                    .border_color(palette.border)
                    .child(
                        div()
                            .relative()
                            .size(px(36.0))
                            .rounded_full()
                            .bg(palette.control)
                            .flex()
                            .items_center()
                            .justify_center()
                            .text_sm()
                            .font_weight(FontWeight::MEDIUM)
                            .child(initial)
                            .when(message.is_unread, |this| {
                                this.child(
                                    div()
                                        .absolute()
                                        .right_0()
                                        .bottom_0()
                                        .size(px(7.0))
                                        .rounded_full()
                                        .bg(palette.primary),
                                )
                            }),
                    )
                    .child(
                        div()
                            .min_w_0()
                            .flex_1()
                            .child(
                                div()
                                    .truncate()
                                    .text_sm()
                                    .font_weight(FontWeight::SEMIBOLD)
                                    .child(sender),
                            )
                            .child(
                                div()
                                    .truncate()
                                    .text_xs()
                                    .text_color(palette.muted)
                                    .child(format!("to {}", message.to.as_deref().unwrap_or("me"))),
                            ),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(palette.muted)
                            .child(format_mail_date(message.date.as_deref())),
                    ),
            )
            .child(
                div()
                    .px_6()
                    .py_6()
                    .text_sm()
                    .line_height(relative(1.65))
                    .text_color(palette.foreground)
                    .whitespace_normal()
                    .when_some(
                        message
                            .subject
                            .clone()
                            .filter(|subject| !subject.trim().is_empty()),
                        |this, subject| {
                            this.child(div().mb_4().font_weight(FontWeight::MEDIUM).child(subject))
                        },
                    )
                    .child(message.body().to_owned()),
            )
            .into_any_element()
    }

    fn render_thread_detail(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let palette = self.palette;
        let body = if self.loading_detail {
            div()
                .flex_1()
                .p_6()
                .child(Skeleton::new().h(px(26.0)).w(relative(0.56)))
                .child(
                    div()
                        .mt_6()
                        .rounded_lg()
                        .border_1()
                        .border_color(palette.border)
                        .p_5()
                        .child(Skeleton::new().h(px(14.0)).w(relative(0.42)))
                        .child(Skeleton::new().mt_5().h(px(10.0)))
                        .child(Skeleton::new().mt_2().h(px(10.0)).w(relative(0.84)))
                        .child(Skeleton::new().mt_2().h(px(10.0)).w(relative(0.66))),
                )
                .into_any_element()
        } else if let Some(detail) = self.thread_detail.as_ref() {
            let subject = detail
                .subject
                .as_deref()
                .filter(|subject| !subject.trim().is_empty())
                .unwrap_or("(No subject)")
                .to_owned();
            let detail_id = SharedString::from(format!("thread-detail-{}", detail.thread_id));
            div()
                .id(detail_id)
                .flex_1()
                .overflow_y_scroll()
                .px_6()
                .pt_6()
                .pb_10()
                .child(
                    div()
                        .max_w(px(820.0))
                        .mx_auto()
                        .child(
                            div()
                                .mb_5()
                                .text_2xl()
                                .font_weight(FontWeight::SEMIBOLD)
                                .child(subject),
                        )
                        .when(
                            detail.messages.is_empty()
                                && detail
                                    .snippet
                                    .as_deref()
                                    .is_some_and(|value| !value.is_empty()),
                            |this| {
                                this.child(
                                    div()
                                        .text_sm()
                                        .text_color(palette.muted)
                                        .child(detail.snippet.clone().unwrap_or_default()),
                                )
                            },
                        )
                        .children(detail.messages.iter().enumerate().map(|(index, message)| {
                            div().mb_3().child(self.render_message_card(message, index))
                        })),
                )
                .into_any_element()
        } else {
            div()
                .flex_1()
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .text_center()
                .child(
                    div()
                        .size(px(48.0))
                        .rounded_full()
                        .bg(palette.control)
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(
                            svg()
                                .path("icons/mail.svg")
                                .size(px(21.0))
                                .text_color(palette.muted),
                        ),
                )
                .child(
                    div()
                        .mt_4()
                        .text_sm()
                        .font_weight(FontWeight::MEDIUM)
                        .child("Your quieter reading space"),
                )
                .child(
                    div()
                        .mt_1()
                        .max_w(px(320.0))
                        .text_xs()
                        .text_color(palette.muted)
                        .child("Choose a conversation. Mail stays in this focused pane while the list remains close."),
                )
                .into_any_element()
        };

        div()
            .min_w_0()
            .h_full()
            .flex_1()
            .flex()
            .flex_col()
            .overflow_hidden()
            .rounded_lg()
            .border_1()
            .border_color(palette.border)
            .bg(palette.raised)
            .shadow_sm()
            .child(self.render_detail_header(cx))
            .child(body)
            .into_any_element()
    }

    fn render_compose(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let palette = self.palette;
        div()
            .absolute()
            .right(px(18.0))
            .bottom(px(18.0))
            .w(px(560.0))
            .h(relative(0.78))
            .max_h(px(650.0))
            .min_h(px(460.0))
            .rounded_xl()
            .border_1()
            .border_color(palette.border_strong)
            .bg(palette.surface)
            .shadow_xl()
            .overflow_hidden()
            .flex()
            .flex_col()
            .child(
                div()
                    .h(px(48.0))
                    .flex_none()
                    .px_4()
                    .border_b_1()
                    .border_color(palette.border)
                    .bg(palette.raised)
                    .flex()
                    .items_center()
                    .child(
                        div()
                            .text_sm()
                            .font_weight(FontWeight::SEMIBOLD)
                            .child("New message"),
                    )
                    .child(div().flex_1())
                    .child(
                        div()
                            .id("close-compose")
                            .size(px(30.0))
                            .rounded_lg()
                            .cursor_pointer()
                            .flex()
                            .items_center()
                            .justify_center()
                            .hover(|style| style.bg(palette.hover))
                            .on_click(cx.listener(Self::close_compose))
                            .child(
                                svg()
                                    .path("icons/window-close.svg")
                                    .size(px(16.0))
                                    .text_color(palette.muted),
                            ),
                    ),
            )
            .child(
                div()
                    .h(px(44.0))
                    .flex_none()
                    .px_4()
                    .border_b_1()
                    .border_color(palette.border)
                    .flex()
                    .items_center()
                    .child(
                        div()
                            .w(px(34.0))
                            .text_sm()
                            .text_color(palette.muted)
                            .child("To"),
                    )
                    .child(
                        Input::new(&self.compose_to_input)
                            .appearance(false)
                            .bordered(false)
                            .focus_bordered(false)
                            .h_full()
                            .flex_1(),
                    ),
            )
            .child(
                div()
                    .h(px(44.0))
                    .flex_none()
                    .px_4()
                    .border_b_1()
                    .border_color(palette.border)
                    .child(
                        Input::new(&self.compose_subject_input)
                            .appearance(false)
                            .bordered(false)
                            .focus_bordered(false)
                            .h_full(),
                    ),
            )
            .child(
                div().min_h_0().flex_1().p_4().child(
                    Input::new(&self.compose_body_input)
                        .appearance(false)
                        .bordered(false)
                        .focus_bordered(false)
                        .h_full(),
                ),
            )
            .child(
                div()
                    .h(px(58.0))
                    .flex_none()
                    .px_4()
                    .border_t_1()
                    .border_color(palette.border)
                    .flex()
                    .items_center()
                    .child(
                        div()
                            .text_xs()
                            .text_color(palette.muted)
                            .child("Sent through the selected mailbox"),
                    )
                    .child(div().flex_1())
                    .child(
                        div()
                            .id("send-compose")
                            .h(px(36.0))
                            .min_w(px(86.0))
                            .px_4()
                            .rounded_lg()
                            .bg(palette.primary)
                            .text_color(palette.primary_foreground)
                            .cursor_pointer()
                            .flex()
                            .items_center()
                            .justify_center()
                            .gap_2()
                            .font_weight(FontWeight::MEDIUM)
                            .hover(|style| style.opacity(0.88))
                            .on_click(cx.listener(Self::send_compose))
                            .when(self.sending, |this| {
                                this.child(Spinner::new().color(palette.primary_foreground))
                            })
                            .child(if self.sending { "Sending…" } else { "Send" }),
                    ),
            )
            .into_any_element()
    }

    fn render_toast(&self) -> Option<AnyElement> {
        let palette = self.palette;
        self.toast.as_ref().map(|toast| {
            div()
                .absolute()
                .right(px(18.0))
                .bottom(if self.compose_open {
                    px(686.0)
                } else {
                    px(18.0)
                })
                .max_w(px(420.0))
                .min_h(px(42.0))
                .px_4()
                .py_3()
                .rounded_lg()
                .border_1()
                .border_color(if toast.is_error {
                    palette.danger
                } else {
                    palette.border_strong
                })
                .bg(palette.surface)
                .shadow_lg()
                .text_sm()
                .text_color(if toast.is_error {
                    palette.danger
                } else {
                    palette.foreground
                })
                .child(toast.message.clone())
                .into_any_element()
        })
    }

    fn render_workspace(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let palette = self.palette;
        let sidebar = self.render_sidebar(cx);
        let message_list = self.render_message_list(cx);
        let thread_detail = self.render_thread_detail(cx);

        div()
            .relative()
            .size_full()
            .overflow_hidden()
            .bg(palette.background)
            .child(
                div()
                    .absolute()
                    .top_0()
                    .left_0()
                    .right_0()
                    .bottom_0()
                    .child(workspace_dither(palette.foreground, palette.is_dark)),
            )
            .child(
                div().relative().size_full().flex().child(sidebar).child(
                    div()
                        .min_w_0()
                        .flex_1()
                        .h_full()
                        .p_2()
                        .pl_0()
                        .flex()
                        .gap_2()
                        .child(message_list)
                        .child(thread_detail),
                ),
            )
            .when_some(self.error_banner.clone(), |this, message| {
                this.child(
                    div()
                        .absolute()
                        .left(px(286.0))
                        .right(px(14.0))
                        .top(px(14.0))
                        .rounded_lg()
                        .border_1()
                        .border_color(palette.danger)
                        .bg(palette.surface)
                        .px_4()
                        .py_3()
                        .text_sm()
                        .text_color(palette.danger)
                        .child(message),
                )
            })
            .when(self.compose_open, |this| {
                this.child(self.render_compose(cx))
            })
            .when_some(self.render_toast(), |this, toast| this.child(toast))
            .into_any_element()
    }
}

impl Render for QuieterDesktop {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let auth_visible = matches!(
            self.phase,
            AppPhase::SignedOut | AppPhase::RequestingDevice | AppPhase::AwaitingDevice(_)
        );
        let content = if auth_visible {
            self.render_auth(cx)
        } else {
            self.render_workspace(cx)
        };

        div()
            .size_full()
            .flex()
            .flex_col()
            .font_family("Geist")
            .text_color(self.palette.foreground)
            .bg(self.palette.background)
            .child(self.render_title_bar())
            .child(div().min_h_0().flex_1().child(content))
    }
}

fn sender_label(raw: &str) -> String {
    let before_address = raw.split_once('<').map_or(raw, |(name, _)| name);
    let trimmed = before_address.trim().trim_matches('"');
    if trimmed.is_empty() {
        raw.trim().to_owned()
    } else {
        trimmed.to_owned()
    }
}

fn format_mail_date(value: Option<&str>) -> String {
    let Some(value) = value.filter(|value| !value.trim().is_empty()) else {
        return String::new();
    };
    let parsed = DateTime::parse_from_rfc2822(value)
        .or_else(|_| DateTime::parse_from_rfc3339(value))
        .map(|date| date.with_timezone(&Local));
    let Ok(date) = parsed else {
        return value.to_owned();
    };
    if date.date_naive() == Local::now().date_naive() {
        date.format("%H:%M").to_string()
    } else {
        date.format("%b %d").to_string().replace(" 0", " ")
    }
}
