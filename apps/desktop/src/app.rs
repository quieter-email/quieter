use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

use chrono::{DateTime, Datelike, Local};
use gpui::{
    Animation, AnimationExt as _, AnyElement, ClickEvent, Context, Entity, FocusHandle, FontWeight,
    IntoElement, KeyBinding, Render, ScrollStrategy, SharedString, Subscription,
    UniformListScrollHandle, Window, div, prelude::*, px, relative, svg, uniform_list,
};
use gpui_component::button::ButtonVariants as _;
use gpui_component::input::{Input, InputEvent, InputState};
use gpui_component::menu::DropdownMenu as _;
use gpui_component::skeleton::Skeleton;
use gpui_component::spinner::Spinner;
use gpui_component::{Disableable as _, TitleBar};

use crate::api::{ApiClient, ApiError, DeviceCode};
use crate::auth::{DeviceAuthorization, TokenStore};
use crate::dither::auth_visual;
use crate::model::{
    MailCategory, Mailbox, MailboxGroup, MailboxLabel, MailboxRequestScope, MessageDetail,
    MessageSummary, ReplyContext, ThreadActionRollback, ThreadCommand, ThreadDetail,
    ThreadReadCompletion, preview_labels, preview_mailboxes, preview_thread, preview_threads,
    reconcile_thread_refresh,
};
use crate::theme::{QuieterTheme, apply_component_theme};

gpui::actions!(
    quieter_desktop,
    [DesktopCompose, DesktopSearch, DesktopRefresh, DesktopEscape]
);
use crate::motion;

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
    focus_handle: FocusHandle,
    window_handle: gpui::AnyWindowHandle,
    api: ApiClient,
    phase: AppPhase,
    palette: QuieterTheme,
    reduced_motion: bool,
    hover_motion: HashMap<SharedString, motion::MotionValue>,
    mailbox_groups: Vec<MailboxGroup>,
    labels: Vec<MailboxLabel>,
    selected_mailbox_id: Option<String>,
    category: MailCategory,
    threads: Vec<MessageSummary>,
    thread_scroll: UniformListScrollHandle,
    thread_result_estimate: Option<u32>,
    has_more_threads: bool,
    next_page_token: Option<String>,
    list_query: String,
    list_scope: Option<(String, MailCategory, String)>,
    loading_more: bool,
    selected_thread_id: Option<String>,
    thread_detail: Option<ThreadDetail>,
    expanded_message_ids: HashSet<String>,
    reading_threads: HashSet<(String, String)>,
    mail_revision: u64,
    refresh_pending: bool,
    loading_threads: bool,
    loading_detail: bool,
    compose_open: bool,
    compose_mailbox_id: Option<String>,
    compose_reply_context: Option<ReplyContext>,
    sending: bool,
    mutating: bool,
    search_input: Entity<InputState>,
    compose_to_input: Entity<InputState>,
    compose_subject_input: Entity<InputState>,
    compose_body_input: Entity<InputState>,
    error_banner: Option<SharedString>,
    toast: Option<ToastMessage>,
    auth_generation: u64,
    auth_deadline: Option<Instant>,
    thread_generation: u64,
    detail_generation: u64,
    mutation_generation: u64,
    compose_generation: u64,
    toast_generation: u64,
    is_preview: bool,
    open_auth_browser: bool,
    _subscriptions: Vec<Subscription>,
}

impl QuieterDesktop {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let focus_handle = cx.focus_handle();
        focus_handle.focus(window);
        cx.bind_keys([
            KeyBinding::new("ctrl-n", DesktopCompose, Some("QuieterDesktop")),
            KeyBinding::new("ctrl-k", DesktopSearch, Some("QuieterDesktop")),
            KeyBinding::new("ctrl-r", DesktopRefresh, Some("QuieterDesktop")),
            KeyBinding::new("escape", DesktopEscape, Some("QuieterDesktop")),
            KeyBinding::new("cmd-n", DesktopCompose, Some("QuieterDesktop")),
            KeyBinding::new("cmd-k", DesktopSearch, Some("QuieterDesktop")),
            KeyBinding::new("cmd-r", DesktopRefresh, Some("QuieterDesktop")),
        ]);
        let force_signed_out =
            std::env::var("QUIETER_DESKTOP_FORCE_SIGNED_OUT").is_ok_and(|value| value == "1");
        let arguments: HashSet<String> = std::env::args().skip(1).collect();
        let is_preview = arguments.contains("--preview")
            || std::env::var("QUIETER_DESKTOP_PREVIEW").is_ok_and(|value| value == "1");
        let api = ApiClient::new(None).expect("failed to initialize HTTP client");
        let token = if force_signed_out || is_preview {
            None
        } else {
            TokenStore::load(api.base_url())
        };
        let has_session = token.is_some();
        let connect_on_launch = arguments.contains("--connect") && !has_session && !is_preview;
        let open_auth_browser = !arguments.contains("--no-open-browser");
        let search_input = cx.new(|cx| InputState::new(window, cx).placeholder("Search"));
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
            } else if connect_on_launch {
                this.begin_device_authorization(cx);
            }
        });

        Self {
            focus_handle,
            window_handle: window.window_handle(),
            api: api.with_token(token),
            phase: if is_preview {
                AppPhase::Ready
            } else if has_session {
                AppPhase::LoadingMailboxes
            } else {
                AppPhase::SignedOut
            },
            palette: QuieterTheme::for_appearance(window.appearance()),
            reduced_motion: false,
            hover_motion: HashMap::new(),
            mailbox_groups: Vec::new(),
            labels: Vec::new(),
            selected_mailbox_id: None,
            category: MailCategory::Inbox,
            threads: Vec::new(),
            thread_scroll: UniformListScrollHandle::new(),
            thread_result_estimate: None,
            has_more_threads: false,
            next_page_token: None,
            list_query: String::new(),
            list_scope: None,
            loading_more: false,
            selected_thread_id: None,
            thread_detail: None,
            expanded_message_ids: HashSet::new(),
            reading_threads: HashSet::new(),
            mail_revision: 0,
            refresh_pending: false,
            loading_threads: false,
            loading_detail: false,
            compose_open: false,
            compose_mailbox_id: None,
            compose_reply_context: None,
            sending: false,
            mutating: false,
            search_input,
            compose_to_input,
            compose_subject_input,
            compose_body_input,
            error_banner: None,
            toast: None,
            auth_generation: 0,
            auth_deadline: None,
            thread_generation: 0,
            detail_generation: 0,
            mutation_generation: 0,
            compose_generation: 0,
            toast_generation: 0,
            is_preview,
            open_auth_browser,
            _subscriptions: subscriptions,
        }
    }

    fn install_preview(&mut self, cx: &mut Context<Self>) {
        let mailboxes = preview_mailboxes();
        self.selected_mailbox_id = mailboxes.default_mailbox_id;
        self.mailbox_groups = mailboxes.groups;
        self.labels = preview_labels();
        self.threads = preview_threads();
        self.thread_result_estimate = Some(self.threads.len() as u32);
        self.has_more_threads = false;
        if let Some(first) = self.threads.first() {
            self.selected_thread_id = Some(first.thread_id.clone());
            self.thread_detail = Some(preview_thread(first));
            self.expanded_message_ids.extend(
                self.thread_detail
                    .as_ref()
                    .and_then(|thread| thread.messages.last())
                    .map(|message| message.id.clone()),
            );
        }
        self.phase = AppPhase::Ready;
        cx.notify();
    }

    fn begin_device_authorization(&mut self, cx: &mut Context<Self>) {
        if matches!(
            self.phase,
            AppPhase::RequestingDevice | AppPhase::AwaitingDevice(_)
        ) {
            return;
        }
        self.auth_generation = self.auth_generation.wrapping_add(1);
        let generation = self.auth_generation;
        let started_at = Instant::now();
        self.auth_deadline = Some(started_at + Duration::from_secs(300));
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
                        let authorization =
                            DeviceAuthorization::new(started_at, code.expires_in, code.interval);
                        if authorization.remaining().is_none() {
                            this.phase = AppPhase::SignedOut;
                            this.auth_deadline = None;
                            this.error_banner = Some("Sign-in took too long. Try again.".into());
                            cx.notify();
                            return;
                        }
                        this.auth_deadline = Some(authorization.deadline());
                        this.phase = AppPhase::AwaitingDevice(code.clone());
                        if this.open_auth_browser {
                            if let Err(error) = open::that(&code.verification_uri_complete) {
                                this.error_banner = Some(
                                    format!(
                                        "The browser could not be opened automatically: {error}"
                                    )
                                    .into(),
                                );
                            }
                        } else {
                            println!("{}", code.verification_uri_complete);
                        }
                        this.poll_device_authorization(code, authorization, generation, cx);
                    }
                    Err(error) => {
                        this.phase = AppPhase::SignedOut;
                        this.auth_deadline = None;
                        this.error_banner = Some(error.to_string().into());
                    }
                }
                cx.notify();
            });
        })
        .detach();

        cx.spawn(async move |this, cx| {
            loop {
                let Some(wait) = this
                    .read_with(cx, |this, _| {
                        this.auth_deadline.map(|deadline| {
                            deadline
                                .saturating_duration_since(Instant::now())
                                .min(Duration::from_secs(1))
                        })
                    })
                    .ok()
                    .flatten()
                else {
                    return;
                };
                cx.background_executor().timer(wait).await;
                let waiting = this
                    .update(cx, |this, cx| {
                        if this.auth_generation != generation
                            || !matches!(
                                this.phase,
                                AppPhase::RequestingDevice | AppPhase::AwaitingDevice(_)
                            )
                        {
                            return false;
                        }
                        if this
                            .auth_deadline
                            .is_some_and(|deadline| Instant::now() >= deadline)
                        {
                            this.auth_generation = this.auth_generation.wrapping_add(1);
                            this.auth_deadline = None;
                            this.phase = AppPhase::SignedOut;
                            this.error_banner = Some("Sign-in took too long. Try again.".into());
                            cx.notify();
                            return false;
                        }
                        cx.notify();
                        true
                    })
                    .unwrap_or(false);
                if !waiting {
                    return;
                }
            }
        })
        .detach();
    }

    fn poll_device_authorization(
        &mut self,
        code: DeviceCode,
        mut authorization: DeviceAuthorization,
        generation: u64,
        cx: &mut Context<Self>,
    ) {
        let api = self.api.with_token(None);
        cx.spawn(async move |this, cx| {
            loop {
                let Some(wait) = authorization.next_wait() else {
                    break;
                };
                cx.background_executor().timer(wait).await;
                if authorization.remaining().is_none()
                    || !this
                        .read_with(cx, |this, _| this.auth_generation == generation)
                        .unwrap_or(false)
                {
                    break;
                }

                let poll_api = api.clone();
                let device_code = code.device_code.clone();
                let Some(remaining) = authorization.remaining() else {
                    break;
                };
                let result = cx
                    .background_executor()
                    .spawn(async move { poll_api.poll_device_token(&device_code, remaining) })
                    .await;
                match result {
                    Err(ApiError::AuthorizationPending) => continue,
                    Err(ApiError::SlowDown) => {
                        authorization.slow_down();
                        continue;
                    }
                    Err(ApiError::Transport(_)) | Err(ApiError::Server { status: 429 | 500..=599, .. }) => {
                        authorization.transient_failure();
                        continue;
                    }
                    Ok(token) => {
                        let access_token = token.access_token;
                        if authorization.remaining().is_none()
                            || !this.read_with(cx, |this, _| this.auth_generation == generation).unwrap_or(false) {
                            let revoke_api = api.with_token(Some(access_token));
                            let _ = cx.background_executor().spawn(async move { revoke_api.sign_out() }).await;
                            break;
                        }
                        let revoke_token = access_token.clone();
                        let signed_in = this.update(cx, |this, cx| {
                            if this.auth_generation != generation || authorization.remaining().is_none() {
                                return false;
                            }
                            let stored = TokenStore::save(this.api.base_url(), &access_token);
                            if authorization.remaining().is_none() {
                                let cleared = TokenStore::clear(this.api.base_url());
                                this.auth_deadline = None;
                                this.phase = AppPhase::SignedOut;
                                this.error_banner = Some(if cleared.is_err() {
                                    "Sign-in took too long, and the saved session could not be removed. Check your system credential store.".into()
                                } else {
                                    "Sign-in took too long. Try again.".into()
                                });
                                cx.notify();
                                return false;
                            }
                            this.auth_deadline = None;
                            this.api = this.api.with_token(Some(access_token));
                            if let Err(error) = stored {
                                this.error_banner = Some(
                                    format!(
                                        "Signed in, but the session could not be saved to the system credential vault: {error}"
                                    )
                                    .into(),
                                );
                            }
                            if this.open_auth_browser {
                                cx.activate(true);
                            }
                            this.load_mailboxes(cx);
                            true
                        }).unwrap_or(false);
                        if !signed_in {
                            let revoke_api = api.with_token(Some(revoke_token));
                            let _ = cx.background_executor().spawn(async move { revoke_api.sign_out() }).await;
                        }
                        return;
                    }
                    Err(error) => {
                        let _ = this.update(cx, |this, cx| {
                            if this.auth_generation == generation {
                                this.phase = AppPhase::SignedOut;
                                this.auth_deadline = None;
                                this.error_banner = Some(if matches!(error, ApiError::DeviceCodeExpired) {
                                    "Sign-in took too long. Try again.".into()
                                } else {
                                    error.to_string().into()
                                });
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
                    this.auth_deadline = None;
                    this.error_banner = Some("Sign-in took too long. Try again.".into());
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
        self.auth_deadline = None;
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
        let generation = self.auth_generation;
        self.phase = AppPhase::LoadingMailboxes;
        cx.notify();

        cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move { api.list_mailboxes() })
                .await;
            let _ = this.update(cx, |this, cx| {
                if this.auth_generation != generation {
                    return;
                }
                match result {
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
                            this.load_labels(cx);
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
        let scope = (mailbox_id.clone(), self.category, query.clone());
        let same_scope = self.list_scope.as_ref() == Some(&scope);
        self.list_scope = Some(scope);
        self.list_query = query.clone();
        if !same_scope {
            self.thread_scroll
                .scroll_to_item_strict(0, ScrollStrategy::Top);
        }
        self.next_page_token = None;
        self.has_more_threads = false;
        self.loading_more = false;

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
            self.expanded_message_ids.clear();
            self.expanded_message_ids.extend(
                self.thread_detail
                    .as_ref()
                    .and_then(|thread| thread.messages.last())
                    .map(|message| message.id.clone()),
            );
            cx.notify();
            return;
        }

        self.thread_generation = self.thread_generation.wrapping_add(1);
        if !same_scope {
            self.detail_generation = self.detail_generation.wrapping_add(1);
            self.mutation_generation = self.mutation_generation.wrapping_add(1);
            self.loading_detail = false;
            self.mutating = false;
            self.threads.clear();
            self.thread_detail = None;
            self.expanded_message_ids.clear();
            self.selected_thread_id = None;
        }
        let generation = self.thread_generation;
        let auth_generation = self.auth_generation;
        let category = self.category;
        let mail_revision = self.mail_revision;
        let api = self.api.clone();
        self.loading_threads = true;
        cx.notify();

        cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move {
                    api.list_threads(
                        &mailbox_id,
                        category,
                        (!query.is_empty()).then_some(query.as_str()),
                        None,
                    )
                })
                .await;
            let _ = this.update(cx, |this, cx| {
                if this.thread_generation != generation || this.auth_generation != auth_generation {
                    return;
                }
                this.loading_threads = false;
                if this.mail_revision != mail_revision {
                    if this.mutating {
                        this.refresh_pending = true;
                        cx.notify();
                    } else {
                        this.load_threads(cx);
                    }
                    return;
                }
                match result {
                    Ok(list) => {
                        this.thread_result_estimate = list.result_size_estimate;
                        this.has_more_threads = list.next_page_token.is_some();
                        this.next_page_token = list.next_page_token;
                        this.threads = reconcile_thread_refresh(
                            list.messages,
                            &this.threads,
                            this.selected_thread_id.as_deref(),
                        );
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

    fn load_labels(&mut self, cx: &mut Context<Self>) {
        self.labels.clear();
        let Some(mailbox_id) = self.selected_mailbox_id.clone() else {
            return;
        };
        if self.is_preview {
            self.labels = preview_labels();
            return;
        }
        let api = self.api.clone();
        let auth_generation = self.auth_generation;
        cx.spawn(async move |this, cx| {
            let request_mailbox_id = mailbox_id.clone();
            let result = cx
                .background_executor()
                .spawn(async move { api.list_labels(&request_mailbox_id) })
                .await;
            let _ = this.update(cx, |this, cx| {
                if this.auth_generation != auth_generation
                    || this.selected_mailbox_id.as_ref() != Some(&mailbox_id)
                {
                    return;
                }
                match result {
                    Ok(mut labels) => {
                        labels.retain(|label| label.kind == "user" && label.visible != Some(false));
                        labels.sort_by_key(|label| label.position.unwrap_or(0));
                        this.labels = labels;
                    }
                    Err(ApiError::Unauthorized) => this
                        .expire_local_session("Your desktop session expired. Sign in again.", cx),
                    Err(error) => this.set_toast(error.to_string(), true, cx),
                }
                cx.notify();
            });
        })
        .detach();
    }

    fn load_more_threads(&mut self, cx: &mut Context<Self>) {
        if self.loading_threads || self.loading_more || self.is_preview {
            return;
        }
        let (Some(mailbox_id), Some(page_token)) = (
            self.selected_mailbox_id.clone(),
            self.next_page_token.clone(),
        ) else {
            return;
        };
        let api = self.api.clone();
        let query = self.list_query.clone();
        let category = self.category;
        let generation = self.thread_generation;
        let auth_generation = self.auth_generation;
        let mail_revision = self.mail_revision;
        self.loading_more = true;
        cx.notify();
        cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move {
                    api.list_threads(
                        &mailbox_id,
                        category,
                        (!query.is_empty()).then_some(query.as_str()),
                        Some(&page_token),
                    )
                })
                .await;
            let _ = this.update(cx, |this, cx| {
                if this.auth_generation != auth_generation || this.thread_generation != generation {
                    return;
                }
                this.loading_more = false;
                if this.mail_revision != mail_revision {
                    cx.notify();
                    return;
                }
                match result {
                    Ok(page) => {
                        this.next_page_token = page.next_page_token;
                        this.has_more_threads = this.next_page_token.is_some();
                        this.thread_result_estimate =
                            page.result_size_estimate.or(this.thread_result_estimate);
                        let mut thread_ids: HashSet<String> = this
                            .threads
                            .iter()
                            .map(|message| message.thread_id.clone())
                            .collect();
                        this.threads.extend(
                            page.messages
                                .into_iter()
                                .filter(|message| thread_ids.insert(message.thread_id.clone())),
                        );
                    }
                    Err(ApiError::Unauthorized) => this
                        .expire_local_session("Your desktop session expired. Sign in again.", cx),
                    Err(error) => this.set_toast(error.to_string(), true, cx),
                }
                cx.notify();
            });
        })
        .detach();
    }

    fn refresh_threads(&mut self, cx: &mut Context<Self>) {
        if self.loading_threads || self.mutating {
            return;
        }
        if self.selected_mailbox_id.is_some() {
            self.load_threads(cx);
        } else if !self.is_preview {
            self.load_mailboxes(cx);
        }
    }

    fn select_category(
        &mut self,
        category: MailCategory,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.close_compose(window, cx);
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
        if self.category == MailCategory::Unread {
            self.threads
                .retain(|message| message.is_unread || message.thread_id == thread_id);
        }
        self.selected_thread_id = Some(thread_id.clone());
        if self.is_preview {
            if let Some(message) = self
                .threads
                .iter_mut()
                .find(|message| message.thread_id == thread_id)
            {
                message.set_unread(false);
            }
            self.thread_detail = self
                .threads
                .iter()
                .find(|message| message.thread_id == thread_id)
                .map(preview_thread);
            self.expanded_message_ids.clear();
            self.expanded_message_ids.extend(
                self.thread_detail
                    .as_ref()
                    .and_then(|thread| thread.messages.last())
                    .map(|message| message.id.clone()),
            );
            cx.notify();
            return;
        }

        let Some(mailbox_id) = self.selected_mailbox_id.clone() else {
            return;
        };
        self.detail_generation = self.detail_generation.wrapping_add(1);
        let generation = self.detail_generation;
        let auth_generation = self.auth_generation;
        let api = self.api.clone();
        self.thread_detail = None;
        self.expanded_message_ids.clear();
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
            let _ = this.update(cx, |this, cx| {
                if this.detail_generation != generation || this.auth_generation != auth_generation {
                    return;
                }
                this.loading_detail = false;
                match detail {
                    Ok(thread) => {
                        let has_unread = thread.messages.iter().any(|message| message.is_unread)
                            || this
                                .threads
                                .iter()
                                .any(|message| message.thread_id == thread_id && message.is_unread);
                        this.expanded_message_ids.extend(
                            thread
                                .messages
                                .iter()
                                .rev()
                                .find(|message| {
                                    !message.label_ids.iter().any(|label| label == "DRAFT")
                                })
                                .map(|message| message.id.clone()),
                        );
                        this.thread_detail = Some(thread);
                        if !has_unread {
                            cx.notify();
                            return;
                        }
                        let read_key = (mailbox_id.clone(), thread_id.clone());
                        if !this.reading_threads.insert(read_key.clone()) {
                            cx.notify();
                            return;
                        }
                        cx.spawn(async move |this, cx| {
                            let result = cx
                                .background_executor()
                                .spawn(async move {
                                    api.thread_action(
                                        ThreadCommand::MarkRead,
                                        &mailbox_id,
                                        &thread_id,
                                    )
                                })
                                .await;
                            let _ = this.update(cx, |this, cx| {
                                if this.auth_generation != auth_generation {
                                    return;
                                }
                                this.reading_threads.remove(&read_key);
                                cx.notify();
                                match result {
                                    Ok(_) => {
                                        if (ThreadReadCompletion {
                                            session_generation: auth_generation,
                                            mailbox_id: read_key.0,
                                            thread_id: read_key.1,
                                        })
                                        .apply(
                                            &MailboxRequestScope {
                                                session_generation: this.auth_generation,
                                                view_generation: this.thread_generation,
                                                mailbox_id: this.selected_mailbox_id.clone(),
                                            },
                                            this.category,
                                            &mut this.threads,
                                            this.selected_thread_id.as_deref(),
                                            &mut this.thread_detail,
                                        ) {
                                            this.mail_revision = this.mail_revision.wrapping_add(1);
                                        }
                                    }
                                    Err(ApiError::Unauthorized) => this.expire_local_session(
                                        "Your desktop session expired. Sign in again.",
                                        cx,
                                    ),
                                    Err(error) => this.set_toast(error.to_string(), true, cx),
                                }
                                if this.refresh_pending && !this.mutating {
                                    this.refresh_pending = false;
                                    this.load_threads(cx);
                                }
                                cx.notify();
                            });
                        })
                        .detach();
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

    fn run_thread_action(&mut self, command: ThreadCommand, cx: &mut Context<Self>) {
        if self.mutating {
            return;
        }
        let Some(thread_id) = self.selected_thread_id.clone() else {
            return;
        };
        if self.reading_threads.iter().any(|(mailbox_id, id)| {
            Some(mailbox_id) == self.selected_mailbox_id.as_ref() && id == &thread_id
        }) {
            self.set_toast("Wait for this conversation to finish loading.", true, cx);
            return;
        }
        self.mail_revision = self.mail_revision.wrapping_add(1);
        let remove_from_view = matches!(
            command,
            ThreadCommand::Archive
                | ThreadCommand::MoveToInbox
                | ThreadCommand::Spam
                | ThreadCommand::Trash
        );
        let rollback = ThreadActionRollback {
            scope: MailboxRequestScope {
                session_generation: self.auth_generation,
                view_generation: self.thread_generation,
                mailbox_id: self.selected_mailbox_id.clone(),
            },
            message: self
                .threads
                .iter()
                .enumerate()
                .find(|(_, message)| message.thread_id == thread_id)
                .map(|(index, message)| (index, message.clone())),
            detail: self.thread_detail.clone(),
            thread_id: thread_id.clone(),
            detail_generation: self.detail_generation,
        };

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
            message.set_unread(matches!(command, ThreadCommand::MarkUnread));
        }
        if matches!(command, ThreadCommand::MarkRead | ThreadCommand::MarkUnread)
            && let Some(detail) = self.thread_detail.as_mut()
        {
            for message in &mut detail.messages {
                message.is_unread = matches!(command, ThreadCommand::MarkUnread);
                message.label_ids.retain(|label| label != "UNREAD");
                if message.is_unread {
                    message.label_ids.push("UNREAD".to_owned());
                }
            }
        }

        if self.is_preview {
            self.set_toast(command.completion_message(), false, cx);
            return;
        }

        let Some(mailbox_id) = self.selected_mailbox_id.clone() else {
            return;
        };
        let api = self.api.clone();
        let auth_generation = self.auth_generation;
        self.mutation_generation = self.mutation_generation.wrapping_add(1);
        let generation = self.mutation_generation;
        self.mutating = true;
        cx.notify();
        let request_thread_id = thread_id.clone();
        cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move { api.thread_action(command, &mailbox_id, &request_thread_id) })
                .await;
            let _ = this.update(cx, |this, cx| {
                if this.auth_generation != auth_generation {
                    return;
                }
                if this.mutation_generation != generation {
                    this.mail_revision = this.mail_revision.wrapping_add(1);
                    if matches!(result, Err(ApiError::Unauthorized)) {
                        this.expire_local_session(
                            "Your desktop session expired. Sign in again.",
                            cx,
                        );
                        return;
                    }
                    if let Err(error) = result {
                        this.set_toast(error.to_string(), true, cx);
                    }
                    if this.mutating {
                        this.refresh_pending = true;
                    } else {
                        this.load_threads(cx);
                    }
                    return;
                }
                this.mutating = false;
                this.mail_revision = this.mail_revision.wrapping_add(1);
                match result {
                    Ok(_) => this.set_toast(command.completion_message(), false, cx),
                    Err(ApiError::Unauthorized) => this.expire_local_session(
                        "Your desktop session expired. Continue in the browser to reconnect.",
                        cx,
                    ),
                    Err(error) => {
                        rollback.restore(
                            &MailboxRequestScope {
                                session_generation: this.auth_generation,
                                view_generation: this.thread_generation,
                                mailbox_id: this.selected_mailbox_id.clone(),
                            },
                            this.detail_generation,
                            &mut this.threads,
                            &mut this.selected_thread_id,
                            &mut this.thread_detail,
                        );
                        this.set_toast(error.to_string(), true, cx);
                    }
                }
                if this.refresh_pending {
                    this.refresh_pending = false;
                    this.load_threads(cx);
                }
                cx.notify();
            });
        })
        .detach();
    }

    fn open_compose(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.compose_mailbox_id.is_none() {
            self.compose_mailbox_id = self.selected_mailbox_id.clone();
            self.compose_reply_context = None;
            self.compose_to_input
                .update(cx, |input, cx| input.set_value("", window, cx));
            self.compose_subject_input
                .update(cx, |input, cx| input.set_value("", window, cx));
            self.compose_body_input
                .update(cx, |input, cx| input.set_value("", window, cx));
        }
        self.compose_open = true;
        self.compose_to_input
            .update(cx, |input, cx| input.focus(window, cx));
        cx.notify();
    }

    fn close_compose(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.sending {
            self.compose_open = false;
            self.focus_handle.focus(window);
            cx.notify();
        }
    }

    fn keyboard_compose(
        &mut self,
        _: &DesktopCompose,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if matches!(self.phase, AppPhase::Ready) && self.selected_mailbox_id.is_some() {
            self.open_compose(window, cx);
        }
    }

    fn keyboard_search(&mut self, _: &DesktopSearch, window: &mut Window, cx: &mut Context<Self>) {
        if matches!(self.phase, AppPhase::Ready) && !self.compose_open {
            self.search_input
                .update(cx, |input, cx| input.focus(window, cx));
        }
    }

    fn keyboard_refresh(&mut self, _: &DesktopRefresh, _: &mut Window, cx: &mut Context<Self>) {
        if matches!(self.phase, AppPhase::Ready) && !self.loading_threads {
            self.refresh_threads(cx);
        }
    }

    fn keyboard_escape(&mut self, _: &DesktopEscape, window: &mut Window, cx: &mut Context<Self>) {
        if self.compose_open {
            self.close_compose(window, cx);
        } else if self.selected_thread_id.is_some() {
            self.detail_generation = self.detail_generation.wrapping_add(1);
            self.selected_thread_id = None;
            self.thread_detail = None;
            self.loading_detail = false;
            if self.category == MailCategory::Unread {
                self.threads.retain(|message| message.is_unread);
            }
            self.focus_handle.focus(window);
            cx.notify();
        } else {
            self.focus_handle.focus(window);
        }
    }

    fn open_reply(&mut self, _: &ClickEvent, window: &mut Window, cx: &mut Context<Self>) {
        if self.sending
            || (self.compose_mailbox_id.is_some()
                && (!self.compose_to_input.read(cx).value().is_empty()
                    || !self.compose_subject_input.read(cx).value().is_empty()
                    || !self.compose_body_input.read(cx).value().is_empty()))
        {
            self.compose_open = true;
            self.set_toast("Finish your open draft before starting a reply.", true, cx);
            return;
        }
        let Some(detail) = self.thread_detail.as_ref() else {
            return;
        };
        let own_address = self
            .selected_mailbox()
            .map(|mailbox| mailbox.email_address.as_str())
            .unwrap_or("");
        let Some(draft) = detail.reply_draft(own_address) else {
            return;
        };
        self.compose_mailbox_id = self.selected_mailbox_id.clone();
        self.compose_reply_context = Some(draft.context);
        self.compose_to_input
            .update(cx, |input, cx| input.set_value(draft.recipient, window, cx));
        self.compose_subject_input
            .update(cx, |input, cx| input.set_value(draft.subject, window, cx));
        self.compose_body_input
            .update(cx, |input, cx| input.set_value("", window, cx));
        self.compose_open = true;
        self.compose_body_input
            .update(cx, |input, cx| input.focus(window, cx));
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
        let Some(mailbox_id) = self.compose_mailbox_id.clone() else {
            return;
        };
        let api = self.api.clone();
        let reply_context = self.compose_reply_context.clone();
        let auth_generation = self.auth_generation;
        self.compose_generation = self.compose_generation.wrapping_add(1);
        let generation = self.compose_generation;
        self.sending = true;
        cx.notify();
        cx.spawn_in(window, async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move {
                    api.send_message(&mailbox_id, &to, &subject, &body, reply_context.as_ref())
                })
                .await;
            let _ = this.update_in(cx, |this, window, cx| {
                if this.auth_generation != auth_generation || this.compose_generation != generation
                {
                    return;
                }
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
        self.focus_handle.focus(window);
        self.sending = false;
        self.compose_mailbox_id = None;
        self.compose_reply_context = None;
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
        let url = self
            .api
            .workspace_url("chat", self.selected_mailbox_id.as_deref());
        if let Err(error) = open::that(url.as_str()) {
            self.set_toast(format!("Chat could not be opened: {error}"), true, cx);
        }
    }

    fn sign_out(&mut self, _: &ClickEvent, _: &mut Window, cx: &mut Context<Self>) {
        if self.is_preview {
            self.expire_local_session("Preview closed.", cx);
            return;
        }
        let api = self.api.clone();
        self.expire_local_session("Signed out on this device.", cx);
        let generation = self.auth_generation;
        cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move { api.sign_out() })
                .await;
            if result.is_err() && !matches!(result, Err(ApiError::Unauthorized)) {
                let _ = this.update(cx, |this, cx| {
                    if this.auth_generation == generation {
                        this.set_toast("Signed out here, but the server session could not be revoked. Check your connection and try again.", true, cx);
                    }
                });
            }
        })
        .detach();
    }

    fn expire_local_session(&mut self, message: impl Into<SharedString>, cx: &mut Context<Self>) {
        self.auth_generation = self.auth_generation.wrapping_add(1);
        self.auth_deadline = None;
        self.thread_generation = self.thread_generation.wrapping_add(1);
        self.detail_generation = self.detail_generation.wrapping_add(1);
        self.mutation_generation = self.mutation_generation.wrapping_add(1);
        self.compose_generation = self.compose_generation.wrapping_add(1);
        self.toast_generation = self.toast_generation.wrapping_add(1);
        self.toast = None;
        self.hover_motion.clear();
        self.reading_threads.clear();
        self.expanded_message_ids.clear();
        self.refresh_pending = false;
        self.mail_revision = self.mail_revision.wrapping_add(1);
        let generation = self.auth_generation;
        let view = cx.entity().downgrade();
        let window_handle = self.window_handle;
        cx.defer(move |cx| {
            let _ = cx.update_window(window_handle, |_, window, cx| {
                let _ = view.update(cx, |this, cx| {
                    if this.auth_generation != generation {
                        return;
                    }
                    for input in [
                        &this.search_input,
                        &this.compose_to_input,
                        &this.compose_subject_input,
                        &this.compose_body_input,
                    ] {
                        input.update(cx, |input, cx| input.set_value("", window, cx));
                    }
                    this.focus_handle.focus(window);
                });
            });
        });
        let cleared = if self.is_preview {
            Ok(())
        } else {
            TokenStore::clear(self.api.base_url())
        };
        self.api = self.api.with_token(None);
        self.phase = AppPhase::SignedOut;
        self.mailbox_groups.clear();
        self.labels.clear();
        self.selected_mailbox_id = None;
        self.threads.clear();
        self.thread_result_estimate = None;
        self.has_more_threads = false;
        self.selected_thread_id = None;
        self.next_page_token = None;
        self.list_query.clear();
        self.list_scope = None;
        self.loading_more = false;
        self.thread_detail = None;
        self.compose_open = false;
        self.compose_mailbox_id = None;
        self.compose_reply_context = None;
        self.sending = false;
        self.mutating = false;
        self.loading_threads = false;
        self.loading_detail = false;
        self.is_preview = false;
        self.error_banner = Some(message.into());
        if cleared.is_err() {
            self.error_banner = Some("Signed out, but the saved session could not be removed from this device. Check your system credential store.".into());
        }
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
        let palette = if matches!(
            self.phase,
            AppPhase::SignedOut | AppPhase::RequestingDevice | AppPhase::AwaitingDevice(_)
        ) {
            QuieterTheme::dark()
        } else {
            self.palette
        };
        TitleBar::new()
            .bg(palette.background)
            .border_color(palette.border)
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .h_full()
                    .text_sm()
                    .text_color(palette.foreground)
                    .font_weight(FontWeight::MEDIUM)
                    .child(
                        svg()
                            .path("brand/quieter-mark.svg")
                            .size(px(17.0))
                            .text_color(palette.foreground),
                    )
                    .child("Quieter"),
            )
            .into_any_element()
    }

    fn render_auth(&mut self, window: &Window, cx: &mut Context<Self>) -> AnyElement {
        let palette = QuieterTheme::dark();
        let show_visual = f32::from(window.viewport_size().width) >= 760.0;
        let expires_in = self.auth_deadline.map(|deadline| {
            let minutes = (deadline.saturating_duration_since(Instant::now()).as_secs() + 59) / 60;
            format!("Code expires in {minutes} min")
        });
        let content = match &self.phase {
            AppPhase::RequestingDevice => div()
                .mt_8()
                .h(px(36.0))
                .w_full()
                .rounded(px(12.0))
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
                        .rounded(px(14.0))
                        .border_1()
                        .border_color(palette.border)
                        .bg(palette.control)
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
                                .mt_3()
                                .text_size(px(13.0))
                                .text_color(palette.muted)
                                .child(
                                    "Enter this code in your browser to connect the desktop app.",
                                ),
                        )
                        .child(
                            div()
                                .mt_3()
                                .truncate()
                                .text_xs()
                                .text_color(palette.muted)
                                .child(code.verification_uri.clone()),
                        )
                        .when_some(expires_in, |this, expiry| {
                            this.child(
                                div()
                                    .mt_3()
                                    .text_xs()
                                    .text_color(palette.muted)
                                    .child(expiry),
                            )
                        }),
                )
                .child(
                    div()
                        .id("open-authorization-page")
                        .mt_3()
                        .h(px(36.0))
                        .w_full()
                        .rounded(px(12.0))
                        .bg(palette.primary)
                        .text_color(palette.primary_foreground)
                        .cursor_pointer()
                        .flex()
                        .items_center()
                        .justify_center()
                        .on_click(cx.listener(Self::reopen_authorization_page))
                        .child("Open sign-in page"),
                )
                .child(
                    div()
                        .id("cancel-authorization")
                        .mt_2()
                        .h(px(32.0))
                        .w_full()
                        .rounded(px(12.0))
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
                .h(px(36.0))
                .w_full()
                .rounded(px(12.0))
                .bg(palette.primary)
                .text_color(palette.primary_foreground)
                .cursor_pointer()
                .flex()
                .items_center()
                .justify_center()
                .gap_2()
                .hover(|style| style.opacity(0.88))
                .on_click(cx.listener(|this, _, _, cx| this.begin_device_authorization(cx)))
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
            .bg(gpui::rgb(0x0a0a0a))
            .child(
                div()
                    .id("auth-form-scroll")
                    .relative()
                    .w(if show_visual { relative(7.0 / 12.0) } else { relative(1.0) })
                    .h_full()
                    .overflow_y_scroll()
                    .flex()
                    .items_center()
                    .justify_center()
                    .px_6()
                    .py_8()
                    .child(
                        div()
                            .absolute()
                            .top(px(24.0))
                            .left(px(24.0))
                            .child(
                                svg()
                                    .path("brand/quieter-combination.svg")
                                    .w(px(96.0))
                                    .h(px(24.0))
                                    .text_color(palette.foreground),
                            ),
                    )
                    .child(
                        div()
                            .w_full()
                            .max_w(px(352.0))
                            .child(
                                div()
                                    .text_center()
                                    .text_size(px(24.0))
                                    .font_weight(FontWeight::MEDIUM)
                                    .child("Continue to Quieter"),
                            )
                            .child(
                                div().mt_3().text_center().text_size(px(13.0)).text_color(palette.muted).child(
                                    "Sign in in your browser. Quieter will continue here automatically.",
                                ),
                            )
                            .child(content)
                            .when_some(self.error_banner.clone(), |this, error| {
                                this.child(
                                    div()
                                        .mt_4()
                                        .rounded(px(12.0))
                                        .border_1()
                                        .border_color(palette.danger)
                                        .bg(palette.control)
                                        .p_3()
                                        .text_size(px(13.0))
                                        .text_color(palette.danger)
                                        .child(error),
                                )
                            })
                            .child(
                                div()
                                    .mt_10()
                                    .flex()
                                    .justify_center()
                                    .gap_5()
                                    .text_xs()
                                    .text_color(palette.muted)
                                    .child(
                                        div()
                                            .id("auth-terms")
                                            .cursor_pointer()
                                            .hover(|style| style.text_color(palette.foreground))
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                if let Err(error) = open::that("https://quieter.email/terms") {
                                                    this.set_toast(format!("The browser could not be opened: {error}"), true, cx);
                                                }
                                            }))
                                            .child("Terms"),
                                    )
                                    .child(
                                        div()
                                            .id("auth-privacy")
                                            .cursor_pointer()
                                            .hover(|style| style.text_color(palette.foreground))
                                            .on_click(cx.listener(|this, _, _, cx| {
                                                if let Err(error) = open::that("https://quieter.email/privacy") {
                                                    this.set_toast(format!("The browser could not be opened: {error}"), true, cx);
                                                }
                                            }))
                                            .child("Privacy"),
                                    ),
                            ),
                    ),
            )
            .when(show_visual, |this| this.child(
                div()
                    .relative()
                    .w(relative(5.0 / 12.0))
                    .h_full()
                    .overflow_hidden()
                    .border_l_1()
                    .border_color(palette.border.opacity(0.3))
                    .bg(gpui::rgb(0x0a0a0a))
                    .child(auth_visual(
                        palette.primary,
                        true,
                        self.reduced_motion,
                    )),
            ))
            .into_any_element()
    }

    fn render_sidebar(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let palette = self.palette;
        let mailbox = self.selected_mailbox().cloned();
        let group_name = self
            .mailbox_groups
            .iter()
            .find(|group| {
                group
                    .mailboxes
                    .iter()
                    .any(|item| self.selected_mailbox_id.as_deref() == Some(item.id.as_str()))
            })
            .map_or_else(|| "Mailbox".to_owned(), |group| group.name.clone());
        let secondary = mailbox.as_ref().map_or(group_name.clone(), |mailbox| {
            if mailbox
                .display_name
                .as_ref()
                .is_some_and(|name| !name.trim().is_empty())
            {
                format!("{}, {group_name}", mailbox.email_address)
            } else {
                group_name.clone()
            }
        });
        let mut navigation = div().mt(px(8.0)).w_full().flex().flex_col().gap(px(2.0));
        for (index, category) in MailCategory::ALL.into_iter().enumerate() {
            let active = self.category == category;
            let hover_key: SharedString = format!("nav-{index}").into();
            let hover = self
                .hover_motion
                .get(&hover_key)
                .map_or(0.0, |value| value.sample().0);
            navigation = navigation.child(
                div()
                    .id(("category", index))
                    .w_full()
                    .h(px(32.0))
                    .px_3()
                    .rounded(px(12.0))
                    .flex()
                    .items_center()
                    .gap_3()
                    .cursor_pointer()
                    .text_size(px(13.0))
                    .text_color(if active {
                        palette.foreground
                    } else {
                        palette.muted
                    })
                    .bg(if active {
                        palette.active
                    } else {
                        palette.hover.opacity(hover)
                    })
                    .on_hover(cx.listener(move |this, hovered, _, cx| {
                        this.hover_motion
                            .entry(hover_key.clone())
                            .or_insert_with(|| motion::MotionValue::new(0.0))
                            .retarget(
                                if *hovered { 1.0 } else { 0.0 },
                                motion::FEEDBACK,
                                this.reduced_motion,
                            );
                        cx.notify();
                    }))
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.select_category(category, window, cx);
                    }))
                    .child(
                        svg()
                            .path(if category == MailCategory::Unread {
                                "icons/unread.svg"
                            } else {
                                category.icon_path()
                            })
                            .size(px(16.0))
                            .text_color(palette.foreground),
                    )
                    .child(category.label()),
            );
        }
        div()
            .w(px(272.0))
            .h_full()
            .flex_none()
            .flex()
            .flex_col()
            .p_6()
            .child(
                gpui_component::button::Button::new("mailbox-switcher")
                    .ghost()
                    .mx_1()
                    .w(px(216.0))
                    .h(px(56.0))
                    .flex_none()
                    .justify_start()
                    .px_3()
                    .py_2()
                    .rounded(px(12.0))
                    .child(
                        div()
                            .w(px(192.0))
                            .min_w_0()
                            .child(
                                div()
                                    .truncate()
                                    .text_size(px(13.0))
                                    .line_height(px(20.0))
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
                                    .mt_1()
                                    .truncate()
                                    .text_xs()
                                    .text_color(palette.muted)
                                    .child(secondary),
                            ),
                    )
                    .dropdown_menu({
                        let groups = self.mailbox_groups.clone();
                        let selected_id = self.selected_mailbox_id.clone();
                        let view = cx.entity().downgrade();
                        move |mut menu, _, _| {
                            for group in &groups {
                                menu = menu.label(group.name.clone());
                                for mailbox in &group.mailboxes {
                                    let id = mailbox.id.clone();
                                    let view = view.clone();
                                    menu = menu.item(
                                        gpui_component::menu::PopupMenuItem::new(
                                            mailbox.label().to_owned(),
                                        )
                                        .checked(Some(&id) == selected_id.as_ref())
                                        .on_click(
                                            move |_, window, cx| {
                                                let _ = view.update(cx, |this, cx| {
                                                    this.selected_mailbox_id = Some(id.clone());
                                                    this.compose_open = false;
                                                    cx.defer_in(window, |this, window, _| {
                                                        this.focus_handle.focus(window);
                                                    });
                                                    this.load_labels(cx);
                                                    this.load_threads(cx);
                                                });
                                            },
                                        ),
                                    );
                                }
                            }
                            menu
                        }
                    }),
            )
            .child(
                div()
                    .id("compose")
                    .mt(px(12.0))
                    .mx_1()
                    .h(px(32.0))
                    .flex_none()
                    .px_4()
                    .rounded(px(12.0))
                    .bg(palette.primary)
                    .text_color(palette.primary_foreground)
                    .cursor_pointer()
                    .flex()
                    .items_center()
                    .gap_2()
                    .text_sm()
                    .hover(|style| style.opacity(0.88))
                    .on_click(cx.listener(|this, _, window, cx| this.open_compose(window, cx)))
                    .child(
                        svg()
                            .path("icons/edit.svg")
                            .size(px(16.0))
                            .text_color(palette.primary_foreground),
                    )
                    .child("Compose"),
            )
            .child(
                div()
                    .id("sidebar-scroll")
                    .min_h_0()
                    .flex_1()
                    .overflow_y_scroll()
                    .child(div().mx_1().child(navigation))
                    .child(
                        div()
                            .mx_1()
                            .mt_6()
                            .child(
                                div()
                                    .px_2()
                                    .mb_2()
                                    .text_xs()
                                    .text_color(palette.muted)
                                    .child("Labels"),
                            )
                            .children(
                                self.labels
                                    .iter()
                                    .filter(|label| {
                                        label.kind == "user" && label.visible != Some(false)
                                    })
                                    .map(|label| {
                                        let color = palette
                                            .label_color(label.color.as_deref().unwrap_or("gray"));
                                        let query =
                                            format!("label:\"{}\"", label.name.replace('"', ""));
                                        div()
                                            .id(SharedString::from(format!("label-{}", label.id)))
                                            .h(px(28.0))
                                            .mb(px(2.0))
                                            .px_3()
                                            .rounded(px(10.0))
                                            .flex()
                                            .items_center()
                                            .gap_2()
                                            .cursor_pointer()
                                            .text_xs()
                                            .text_color(palette.muted)
                                            .hover(|style| style.bg(palette.hover))
                                            .on_click(cx.listener(move |this, _, window, cx| {
                                                this.compose_open = false;
                                                this.focus_handle.focus(window);
                                                this.search_input.update(cx, |input, cx| {
                                                    input.set_value(query.clone(), window, cx)
                                                });
                                                this.load_threads(cx);
                                            }))
                                            .child(
                                                div()
                                                    .size(px(12.0))
                                                    .flex_none()
                                                    .rounded_full()
                                                    .bg(color),
                                            )
                                            .child(
                                                div()
                                                    .min_w_0()
                                                    .flex_1()
                                                    .truncate()
                                                    .child(label.name.clone()),
                                            )
                                    }),
                            ),
                    ),
            )
            .child(
                div()
                    .p_2()
                    .flex_none()
                    .flex()
                    .gap_1()
                    .child(
                        div()
                            .id("settings")
                            .flex_1()
                            .h(px(36.0))
                            .px_4()
                            .rounded(px(12.0))
                            .flex()
                            .items_center()
                            .gap_2()
                            .cursor_pointer()
                            .text_sm()
                            .text_color(palette.muted)
                            .hover(|style| style.bg(palette.hover).text_color(palette.foreground))
                            .on_click(cx.listener(Self::open_web_settings))
                            .child(
                                svg()
                                    .path("icons/settings.svg")
                                    .size(px(16.0))
                                    .text_color(palette.muted),
                            )
                            .child("Settings"),
                    )
                    .child(
                        gpui_component::button::Button::new("help-and-appearance")
                            .ghost()
                            .size(px(36.0))
                            .rounded(px(12.0))
                            .tooltip("Help and appearance")
                            .child(
                                svg()
                                    .path("icons/help.svg")
                                    .size(px(16.0))
                                    .text_color(palette.muted),
                            )
                            .dropdown_menu({
                                let view = cx.entity().downgrade();
                                let sign_out_view = view.clone();
                                let reduced_motion = self.reduced_motion;
                                move |mut menu, _, _| {
                                    let chat_view = view.clone();
                                    menu = menu.item(
                                        gpui_component::menu::PopupMenuItem::new(
                                            "Open Chat in browser",
                                        )
                                        .on_click(
                                            move |event, window, cx| {
                                                let _ = chat_view.update(cx, |this, cx| {
                                                    this.open_web_chat(event, window, cx)
                                                });
                                            },
                                        ),
                                    );
                                    menu = menu.link("Help", "https://quieter.email").separator();
                                    let motion_view = view.clone();
                                    menu = menu.item(
                                        gpui_component::menu::PopupMenuItem::new("Reduce motion")
                                            .checked(reduced_motion)
                                            .on_click(move |_, _, cx| {
                                                let _ = motion_view.update(cx, |this, cx| {
                                                    this.reduced_motion = !this.reduced_motion;
                                                    cx.notify();
                                                });
                                            }),
                                    );
                                    for (name, dark) in
                                        [("Light appearance", false), ("Dark appearance", true)]
                                    {
                                        let view = view.clone();
                                        menu = menu.item(
                                            gpui_component::menu::PopupMenuItem::new(name)
                                                .on_click(move |_, _, cx| {
                                                    let _ = view.update(cx, |this, cx| {
                                                        this.palette = if dark {
                                                            QuieterTheme::dark()
                                                        } else {
                                                            QuieterTheme::light()
                                                        };
                                                        apply_component_theme(this.palette, cx);
                                                        cx.notify();
                                                    });
                                                }),
                                        );
                                    }
                                    let view = sign_out_view.clone();
                                    menu.separator().item(
                                        gpui_component::menu::PopupMenuItem::new("Sign out")
                                            .on_click(move |event, window, cx| {
                                                let _ = view.update(cx, |this, cx| {
                                                    this.sign_out(event, window, cx)
                                                });
                                            }),
                                    )
                                }
                            }),
                    ),
            )
            .with_animation(
                "sidebar-entrance",
                motion::animation(Duration::from_millis(500), self.reduced_motion),
                |this, delta| this.opacity(delta),
            )
            .into_any_element()
    }

    fn render_thread_row(&mut self, index: usize, cx: &mut Context<Self>) -> AnyElement {
        let message = self.threads[index].clone();
        let palette = self.palette;
        let selected = self.selected_thread_id.as_deref() == Some(message.thread_id.as_str());
        let unread = message.is_unread
            || message
                .label_ids
                .iter()
                .chain(&message.thread_label_ids)
                .any(|label| label == "UNREAD");
        let sender = sender_label(message.sender());
        let initial = sender
            .chars()
            .next()
            .unwrap_or('?')
            .to_uppercase()
            .to_string();
        let address = message
            .sender()
            .split_once('<')
            .map_or("", |(_, address)| address.trim_end_matches('>'))
            .to_owned();
        let date = format_mail_date(message.internal_date.as_deref().or(message.date.as_deref()));
        let thread_id = message.thread_id.clone();
        let hover_key: SharedString = format!("row-{thread_id}").into();
        let hover = self
            .hover_motion
            .get(&hover_key)
            .map_or(0.0, |value| value.sample().0);
        div()
            .id(index)
            .relative()
            .h(px(68.0))
            .w_full()
            .rounded(px(14.0))
            .cursor_pointer()
            .bg(if selected {
                palette.hover
            } else {
                palette.hover.opacity(0.65 * hover)
            })
            .on_hover(cx.listener(move |this, hovered, _, cx| {
                this.hover_motion
                    .entry(hover_key.clone())
                    .or_insert_with(|| motion::MotionValue::new(0.0))
                    .retarget(
                        if *hovered { 1.0 } else { 0.0 },
                        motion::FEEDBACK,
                        this.reduced_motion,
                    );
                cx.notify();
            }))
            .on_click(cx.listener(move |this, _, window, cx| {
                this.select_thread(thread_id.clone(), window, cx);
            }))
            .when(unread, |this| {
                this.child(
                    div()
                        .absolute()
                        .left_0()
                        .top(px(18.0))
                        .w(px(3.0))
                        .h(px(32.0))
                        .rounded_r(px(2.0))
                        .bg(palette.primary),
                )
            })
            .child(
                div()
                    .size_full()
                    .flex()
                    .items_center()
                    .gap_3()
                    .px_3()
                    .child(
                        div()
                            .size(px(38.0))
                            .flex_none()
                            .rounded(px(14.0))
                            .bg(palette.hover.opacity(0.80))
                            .flex()
                            .items_center()
                            .justify_center()
                            .text_sm()
                            .text_color(palette.muted)
                            .font_weight(FontWeight::MEDIUM)
                            .child(initial),
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
                                    .h(px(20.0))
                                    .child(
                                        div()
                                            .min_w_0()
                                            .flex()
                                            .items_center()
                                            .gap_2()
                                            .flex_1()
                                            .overflow_hidden()
                                            .child(
                                                div()
                                                    .flex_none()
                                                    .text_size(px(13.0))
                                                    .font_weight(if unread {
                                                        FontWeight::SEMIBOLD
                                                    } else {
                                                        FontWeight::MEDIUM
                                                    })
                                                    .child(sender),
                                            )
                                            .child(
                                                div()
                                                    .min_w_0()
                                                    .flex_1()
                                                    .truncate()
                                                    .text_size(px(11.0))
                                                    .text_color(palette.muted)
                                                    .child(address),
                                            ),
                                    )
                                    .children(
                                        [
                                            (
                                                "icons/attachment.svg",
                                                message.thread_attachment_count.unwrap_or(0),
                                            ),
                                            (
                                                "icons/thread.svg",
                                                message
                                                    .thread_message_count
                                                    .filter(|count| *count > 1)
                                                    .unwrap_or(0),
                                            ),
                                        ]
                                        .into_iter()
                                        .filter(|(_, count)| *count > 0)
                                        .map(
                                            |(icon, count)| {
                                                div()
                                                    .flex_none()
                                                    .flex()
                                                    .items_center()
                                                    .gap_1()
                                                    .h(px(18.0))
                                                    .px_1()
                                                    .rounded(px(10.0))
                                                    .border_1()
                                                    .border_color(palette.border)
                                                    .bg(palette.raised.opacity(0.75))
                                                    .text_size(px(11.0))
                                                    .text_color(palette.muted)
                                                    .child(
                                                        svg()
                                                            .path(icon)
                                                            .size(px(12.0))
                                                            .text_color(palette.muted),
                                                    )
                                                    .child(count.to_string())
                                            },
                                        ),
                                    )
                                    .child(
                                        div()
                                            .flex_none()
                                            .text_xs()
                                            .font_weight(if unread {
                                                FontWeight::SEMIBOLD
                                            } else {
                                                FontWeight::NORMAL
                                            })
                                            .text_color(if unread {
                                                palette.foreground
                                            } else {
                                                palette.muted
                                            })
                                            .child(date),
                                    ),
                            )
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap(px(6.0))
                                    .child(
                                        div()
                                            .min_w_0()
                                            .flex_1()
                                            .truncate()
                                            .text_size(px(13.0))
                                            .line_height(px(18.0))
                                            .font_weight(if unread {
                                                FontWeight::MEDIUM
                                            } else {
                                                FontWeight::NORMAL
                                            })
                                            .text_color(if unread {
                                                palette.foreground
                                            } else {
                                                palette.muted
                                            })
                                            .child(message.subject().to_owned()),
                                    )
                                    .children(
                                        self.labels
                                            .iter()
                                            .filter(|label| {
                                                label.kind == "user"
                                                    && message
                                                        .label_ids
                                                        .iter()
                                                        .chain(&message.thread_label_ids)
                                                        .any(|id| id == &label.id)
                                            })
                                            .take(2)
                                            .map(|label| {
                                                let color = palette.label_color(
                                                    label.color.as_deref().unwrap_or("gray"),
                                                );
                                                div()
                                                    .flex_none()
                                                    .max_w(px(90.0))
                                                    .truncate()
                                                    .px_2()
                                                    .h(px(19.0))
                                                    .rounded(px(10.0))
                                                    .bg(color.opacity(0.16))
                                                    .text_color(color)
                                                    .text_size(px(11.0))
                                                    .child(label.name.clone())
                                            }),
                                    ),
                            ),
                    ),
            )
            .into_any_element()
    }

    fn render_message_list(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let palette = self.palette;
        let list_body = if self.loading_threads && self.threads.is_empty() {
            div()
                .flex_1()
                .px_4()
                .children((0..9).map(|index| {
                    div()
                        .id(("thread-skeleton", index as usize))
                        .h(px(68.0))
                        .flex()
                        .items_center()
                        .gap_3()
                        .child(Skeleton::new().size(px(38.0)).rounded(px(10.8)))
                        .child(
                            div()
                                .flex_1()
                                .flex()
                                .flex_col()
                                .gap_2()
                                .child(Skeleton::new().h(px(10.0)).w(relative(0.48)))
                                .child(Skeleton::new().h(px(8.0)).w(relative(0.85))),
                        )
                }))
                .into_any_element()
        } else if self.threads.is_empty() {
            div()
                .flex_1()
                .flex()
                .items_center()
                .justify_center()
                .text_sm()
                .text_color(palette.muted)
                .child(if self.list_query.is_empty() {
                    "No messages."
                } else {
                    "No messages found."
                })
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
            .track_scroll(self.thread_scroll.clone())
            .h_full()
            .into_any_element()
        };
        div()
            .size_full()
            .flex()
            .flex_col()
            .overflow_hidden()
            .rounded(px(16.0))
            .border_1()
            .border_color(palette.border)
            .bg(palette.panel_background())
            .shadow_md()
            .child(
                div().flex_none().px_4().pt_4().pb_3().child(
                    div()
                        .h(px(32.0))
                        .flex()
                        .items_center()
                        .gap_2()
                        .child(
                            div()
                                .id("refresh-threads")
                                .size(px(32.0))
                                .flex_none()
                                .rounded(px(12.0))
                                .border_1()
                                .border_color(palette.border)
                                .bg(palette.control)
                                .cursor_pointer()
                                .flex()
                                .items_center()
                                .justify_center()
                                .hover(|style| style.bg(palette.hover))
                                .tooltip(|window, cx| {
                                    gpui_component::tooltip::Tooltip::new("Refresh list")
                                        .build(window, cx)
                                })
                                .on_click(cx.listener(|this, _, _, cx| this.refresh_threads(cx)))
                                .child(
                                    svg()
                                        .path("icons/refresh.svg")
                                        .size(px(16.0))
                                        .text_color(palette.muted),
                                ),
                        )
                        .child(
                            div()
                                .min_w_0()
                                .flex_1()
                                .h_full()
                                .rounded(px(12.0))
                                .border_1()
                                .border_color(palette.border)
                                .bg(palette.control)
                                .flex()
                                .items_center()
                                .px_3()
                                .child(
                                    Input::new(&self.search_input)
                                        .appearance(false)
                                        .bordered(false)
                                        .focus_bordered(false)
                                        .h_full()
                                        .min_w_0()
                                        .flex_1()
                                        .text_size(px(13.0)),
                                )
                                .child(
                                    svg()
                                        .path("icons/search.svg")
                                        .size(px(14.0))
                                        .text_color(palette.muted),
                                ),
                        )
                        .child(
                            gpui_component::button::Button::new("scroll-threads-top")
                                .ghost()
                                .size(px(32.0))
                                .flex_none()
                                .rounded(px(12.0))
                                .border_1()
                                .border_color(palette.border)
                                .bg(palette.control)
                                .tooltip("Scroll to top")
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.thread_scroll
                                        .scroll_to_item_strict(0, ScrollStrategy::Top);
                                    cx.notify();
                                }))
                                .child(
                                    svg()
                                        .path("icons/arrow-up.svg")
                                        .size(px(14.0))
                                        .text_color(palette.muted),
                                ),
                        ),
                ),
            )
            .child(div().min_h_0().flex_1().px_4().child(list_body))
            .when(self.has_more_threads, |this| {
                this.child(
                    div().px_4().py_2().flex_none().child(
                        gpui_component::button::Button::new("load-more-threads")
                            .ghost()
                            .w_full()
                            .h(px(32.0))
                            .text_xs()
                            .disabled(self.loading_more)
                            .label(if self.loading_more {
                                "Loading conversations…"
                            } else {
                                "Load more conversations"
                            })
                            .on_click(cx.listener(|this, _, _, cx| this.load_more_threads(cx))),
                    ),
                )
            })
            .into_any_element()
    }

    fn render_detail_header(&mut self, compact: bool, cx: &mut Context<Self>) -> AnyElement {
        let palette = self.palette;
        let subject = self
            .thread_detail
            .as_ref()
            .and_then(|detail| detail.subject.clone())
            .unwrap_or_else(|| "(No subject)".to_owned());
        let action_pending = self.mutating
            || self
                .selected_mailbox_id
                .as_ref()
                .zip(self.selected_thread_id.as_ref())
                .is_some_and(|(mailbox_id, thread_id)| {
                    self.reading_threads
                        .contains(&(mailbox_id.clone(), thread_id.clone()))
                });
        let view = cx.entity().downgrade();
        let archive = if self.category == MailCategory::Trash {
            ("Move to Inbox", ThreadCommand::MoveToInbox)
        } else {
            ("Archive", ThreadCommand::Archive)
        };
        div()
            .flex_none()
            .px_5()
            .py_4()
            .border_b_1()
            .border_color(palette.border)
            .flex()
            .items_center()
            .gap_3()
            .when(compact, |this| {
                this.child(
                    gpui_component::button::Button::new("back-to-list")
                        .ghost()
                        .size(px(32.0))
                        .rounded(px(12.0))
                        .tooltip("Back to list")
                        .on_click(cx.listener(|this, _, window, cx| {
                            this.keyboard_escape(&DesktopEscape, window, cx);
                        }))
                        .child(
                            svg()
                                .path("icons/back.svg")
                                .size(px(16.0))
                                .text_color(palette.foreground),
                        ),
                )
            })
            .child(
                div()
                    .min_w_0()
                    .flex_1()
                    .truncate()
                    .text_size(px(16.0))
                    .font_weight(FontWeight::NORMAL)
                    .child(subject),
            )
            .when_some(
                self.thread_detail
                    .as_ref()
                    .map(|detail| detail.messages.len())
                    .filter(|count| *count > 1),
                |this, count| {
                    this.child(
                        div()
                            .flex_none()
                            .text_xs()
                            .text_color(palette.muted)
                            .child(format!("{count} messages")),
                    )
                },
            )
            .when(action_pending, |this| {
                this.child(Spinner::new().color(palette.muted))
            })
            .child(
                gpui_component::button::Button::new("thread-actions")
                    .ghost()
                    .disabled(action_pending)
                    .size(px(32.0))
                    .rounded(px(12.0))
                    .border_1()
                    .border_color(palette.border)
                    .child(
                        svg()
                            .path("icons/more.svg")
                            .size(px(16.0))
                            .text_color(palette.muted),
                    )
                    .tooltip("Message actions")
                    .dropdown_menu(move |mut menu, _, _| {
                        for (label, command) in [
                            archive,
                            ("Mark unread", ThreadCommand::MarkUnread),
                            ("Move to spam", ThreadCommand::Spam),
                            ("Move to trash", ThreadCommand::Trash),
                        ] {
                            let view = view.clone();
                            menu = menu.item(
                                gpui_component::menu::PopupMenuItem::new(label).on_click(
                                    move |_, _, cx| {
                                        let _ = view.update(cx, |this, cx| {
                                            this.run_thread_action(command, cx)
                                        });
                                    },
                                ),
                            );
                        }
                        menu
                    }),
            )
            .into_any_element()
    }

    fn render_message_card(
        &self,
        message: &MessageDetail,
        index: usize,
        expandable: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let palette = self.palette;
        let expanded = !expandable || self.expanded_message_ids.contains(&message.id);
        let message_id = message.id.clone();
        let sender = sender_label(message.from.as_deref().unwrap_or("Unknown sender"));
        let initial = sender
            .chars()
            .next()
            .unwrap_or('?')
            .to_uppercase()
            .to_string();
        let address = message
            .from
            .as_deref()
            .and_then(|value| value.split_once('<'))
            .map_or("", |(_, value)| value.trim_end_matches('>'))
            .to_owned();
        div()
            .id(SharedString::from(format!(
                "message-card-{}-{index}",
                message.id
            )))
            .child(
                div()
                    .id(("message-header", index))
                    .px_5()
                    .py_4()
                    .flex()
                    .items_start()
                    .gap_4()
                    .when(expandable, |this| {
                        this.cursor_pointer()
                            .hover(|style| style.bg(palette.hover.opacity(0.25)))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                if !this.expanded_message_ids.remove(&message_id) {
                                    this.expanded_message_ids.insert(message_id.clone());
                                }
                                cx.notify();
                            }))
                    })
                    .child(
                        div()
                            .size(px(40.0))
                            .flex_none()
                            .rounded(px(14.0))
                            .bg(palette.hover.opacity(0.80))
                            .flex()
                            .items_center()
                            .justify_center()
                            .text_sm()
                            .text_color(palette.muted)
                            .child(initial),
                    )
                    .child(
                        div()
                            .min_w_0()
                            .flex_1()
                            .child(
                                div()
                                    .flex()
                                    .flex_wrap()
                                    .items_center()
                                    .gap_2()
                                    .when(message.is_unread, |this| {
                                        this.child(
                                            div()
                                                .size(px(8.0))
                                                .flex_none()
                                                .rounded_full()
                                                .bg(palette.foreground.opacity(0.75)),
                                        )
                                    })
                                    .child(
                                        div()
                                            .text_size(px(14.0))
                                            .font_weight(FontWeight::MEDIUM)
                                            .child(sender),
                                    )
                                    .child(div().text_sm().text_color(palette.muted).child(address))
                                    .child(
                                        div().text_sm().text_color(palette.muted).child(
                                            format_mail_date(
                                                message
                                                    .internal_date
                                                    .as_deref()
                                                    .or(message.date.as_deref()),
                                            ),
                                        ),
                                    ),
                            )
                            .when(expanded, |this| {
                                this.child(div().mt_1().text_sm().text_color(palette.muted).child(
                                    format!("To  {}", message.to.as_deref().unwrap_or("me")),
                                ))
                            })
                            .when(!expanded, |this| {
                                this.child(
                                    div()
                                        .mt_1()
                                        .truncate()
                                        .text_size(px(14.0))
                                        .text_color(palette.foreground)
                                        .child(
                                            message
                                                .snippet
                                                .as_deref()
                                                .filter(|snippet| !snippet.trim().is_empty())
                                                .unwrap_or(message.body())
                                                .to_owned(),
                                        ),
                                )
                            }),
                    )
                    .when(expandable, |this| {
                        this.child(
                            svg()
                                .path(if expanded {
                                    "icons/arrow-up.svg"
                                } else {
                                    "icons/chevron-down.svg"
                                })
                                .size(px(16.0))
                                .text_color(palette.muted),
                        )
                    }),
            )
            .when(expanded, |this| {
                this.child(
                    div()
                        .px_5()
                        .pb_5()
                        .text_size(px(14.0))
                        .line_height(relative(1.5))
                        .whitespace_normal()
                        .child(message.body().to_owned()),
                )
            })
            .into_any_element()
    }

    fn render_thread_detail(&mut self, window: &Window, cx: &mut Context<Self>) -> AnyElement {
        let palette = self.palette;
        let compact = f32::from(window.viewport_size().width) < 1100.0;
        let reduced_motion = self.reduced_motion || !window.is_window_active();
        let body = if self.loading_detail {
            div()
                .flex_1()
                .p_5()
                .child(Skeleton::new().h(px(20.0)).w(relative(0.56)))
                .child(Skeleton::new().mt_8().h(px(12.0)).w(relative(0.45)))
                .child(Skeleton::new().mt_6().h(px(10.0)))
                .child(Skeleton::new().mt_2().h(px(10.0)).w(relative(0.84)))
                .into_any_element()
        } else if let Some(detail) = self.thread_detail.as_ref() {
            let non_draft_count = detail
                .messages
                .iter()
                .filter(|message| !message.label_ids.iter().any(|label| label == "DRAFT"))
                .count();
            let messages = detail
                .messages
                .iter()
                .rev()
                .filter(|message| {
                    non_draft_count == 0 || !message.label_ids.iter().any(|label| label == "DRAFT")
                })
                .enumerate()
                .map(|(index, message)| {
                    self.render_message_card(message, index, non_draft_count > 1, cx)
                })
                .collect::<Vec<_>>();
            let sender = detail
                .messages
                .last()
                .and_then(|message| message.from.as_deref())
                .map_or_else(|| "conversation".to_owned(), sender_label);
            div()
                .id("message-scroll")
                .min_h_0()
                .flex_1()
                .overflow_y_scroll()
                .children(messages)
                .child(
                    div().border_t_1().border_color(palette.border).p_5().child(
                        div()
                            .id("reply")
                            .h(px(50.0))
                            .px_5()
                            .rounded(px(16.0))
                            .border_1()
                            .border_color(palette.border)
                            .bg(palette.control)
                            .cursor_pointer()
                            .flex()
                            .items_center()
                            .gap_2()
                            .text_sm()
                            .text_color(palette.muted)
                            .hover(|style| style.bg(palette.hover).text_color(palette.foreground))
                            .on_click(cx.listener(Self::open_reply))
                            .child(
                                svg()
                                    .path("icons/reply.svg")
                                    .size(px(16.0))
                                    .text_color(palette.muted),
                            )
                            .child(format!("Reply to {sender}")),
                    ),
                )
                .with_animation(
                    SharedString::from(format!("detail-entrance-{}", detail.thread_id)),
                    motion::animation(motion::LAYOUT, self.reduced_motion),
                    |this, delta| this.opacity(0.55 + 0.45 * delta),
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
                        .mb_6()
                        .flex()
                        .flex_col()
                        .gap(px(6.0))
                        .children((0..2).map(|row| {
                            div()
                                .flex()
                                .gap(px(6.0))
                                .children((0..10).map(move |column| {
                                    if reduced_motion {
                                        div()
                                            .size(px(6.0))
                                            .bg(palette.muted.opacity(0.3))
                                            .into_any_element()
                                    } else {
                                        div()
                                            .size(px(6.0))
                                            .bg(palette.muted)
                                            .with_animation(
                                                ("empty-wave", (row * 10 + column) as usize),
                                                Animation::new(Duration::from_secs(2)).repeat(),
                                                move |this, delta| {
                                                    let phase = delta * std::f32::consts::TAU
                                                        + column as f32 * 0.56;
                                                    this.opacity((0.5 + 0.5 * phase.cos()) * 0.5)
                                                },
                                            )
                                            .into_any_element()
                                    }
                                }))
                        })),
                )
                .child(
                    div()
                        .text_sm()
                        .font_weight(FontWeight::SEMIBOLD)
                        .child("No conversation open"),
                )
                .child(
                    div()
                        .mt(px(6.0))
                        .text_sm()
                        .text_color(palette.muted)
                        .child("Choose a conversation to begin."),
                )
                .into_any_element()
        };
        div()
            .min_w_0()
            .size_full()
            .flex()
            .flex_col()
            .overflow_hidden()
            .rounded(px(16.0))
            .border_1()
            .border_color(palette.border)
            .bg(palette.panel_background())
            .shadow_md()
            .when(
                self.thread_detail.is_some() || (compact && self.selected_thread_id.is_some()),
                |this| this.child(self.render_detail_header(compact, cx)),
            )
            .child(body)
            .into_any_element()
    }

    fn render_compose(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let palette = self.palette;
        let sender = self
            .mailbox_groups
            .iter()
            .flat_map(|group| &group.mailboxes)
            .find(|mailbox| Some(&mailbox.id) == self.compose_mailbox_id.as_ref())
            .map_or_else(String::new, |mailbox| mailbox.email_address.clone());
        div()
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .p_6()
            .rounded(px(16.0))
            .border_1()
            .border_color(palette.border)
            .bg(palette.panel_background())
            .shadow_md()
            .child(
                div()
                    .w_full()
                    .max_w(px(928.0))
                    .h(px(448.0))
                    .max_h_full()
                    .rounded(px(16.0))
                    .border_1()
                    .border_color(palette.border)
                    .bg(palette.control)
                    .overflow_hidden()
                    .flex()
                    .flex_col()
                    .child(
                        div()
                            .h(px(41.0))
                            .flex_none()
                            .px_5()
                            .border_b_1()
                            .border_color(palette.border)
                            .flex()
                            .items_center()
                            .child(
                                div()
                                    .w(px(56.0))
                                    .text_sm()
                                    .text_color(palette.muted)
                                    .child("To"),
                            )
                            .child(
                                Input::new(&self.compose_to_input)
                                    .disabled(self.sending)
                                    .appearance(false)
                                    .bordered(false)
                                    .focus_bordered(false)
                                    .h_full()
                                    .min_w_0()
                                    .flex_1(),
                            ),
                    )
                    .child(
                        div()
                            .h(px(41.0))
                            .flex_none()
                            .px_5()
                            .border_b_1()
                            .border_color(palette.border)
                            .flex()
                            .items_center()
                            .child(
                                div()
                                    .w(px(56.0))
                                    .flex_none()
                                    .text_sm()
                                    .text_color(palette.muted)
                                    .child("Subject"),
                            )
                            .child(
                                Input::new(&self.compose_subject_input)
                                    .disabled(self.sending)
                                    .appearance(false)
                                    .bordered(false)
                                    .focus_bordered(false)
                                    .h_full()
                                    .min_w_0()
                                    .flex_1(),
                            ),
                    )
                    .child(
                        div().min_h_0().flex_1().px_5().py_2().child(
                            Input::new(&self.compose_body_input)
                                .disabled(self.sending)
                                .appearance(false)
                                .bordered(false)
                                .focus_bordered(false)
                                .h_full(),
                        ),
                    )
                    .child(
                        div()
                            .h(px(49.0))
                            .flex_none()
                            .px_5()
                            .border_t_1()
                            .border_color(palette.border)
                            .flex()
                            .items_center()
                            .gap_3()
                            .child(
                                div()
                                    .id("send-compose")
                                    .h(px(32.0))
                                    .px_3()
                                    .rounded(px(12.0))
                                    .bg(palette.primary)
                                    .text_color(palette.primary_foreground)
                                    .cursor_pointer()
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .gap_2()
                                    .text_sm()
                                    .hover(|style| style.opacity(0.88))
                                    .on_click(cx.listener(Self::send_compose))
                                    .when(self.sending, |this| {
                                        this.child(Spinner::new().color(palette.primary_foreground))
                                    })
                                    .when(!self.sending, |this| {
                                        this.child(
                                            svg()
                                                .path("icons/send.svg")
                                                .size(px(14.0))
                                                .text_color(palette.primary_foreground),
                                        )
                                    })
                                    .child(if self.sending { "Sending…" } else { "Send" }),
                            )
                            .child(
                                div()
                                    .min_w_0()
                                    .flex_1()
                                    .truncate()
                                    .text_xs()
                                    .text_color(palette.muted)
                                    .child(format!("From {sender}")),
                            )
                            .child(
                                div()
                                    .id("close-compose")
                                    .size(px(32.0))
                                    .rounded(px(12.0))
                                    .cursor_pointer()
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .hover(|style| style.bg(palette.hover))
                                    .tooltip(|window, cx| {
                                        gpui_component::tooltip::Tooltip::new(
                                            "Close composer, keep draft",
                                        )
                                        .build(window, cx)
                                    })
                                    .on_click(cx.listener(|this, _, window, cx| {
                                        this.close_compose(window, cx)
                                    }))
                                    .child(
                                        svg()
                                            .path("icons/window-close.svg")
                                            .size(px(14.0))
                                            .text_color(palette.muted),
                                    ),
                            ),
                    ),
            )
            .with_animation(
                "compose-entrance",
                motion::animation(motion::LAYOUT, self.reduced_motion),
                |this, delta| this.opacity(delta),
            )
            .into_any_element()
    }

    fn render_toast(&self) -> Option<AnyElement> {
        let palette = self.palette;
        self.toast.as_ref().map(|toast| {
            div()
                .absolute()
                .right(px(18.0))
                .bottom(px(18.0))
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

    fn render_workspace(&mut self, window: &Window, cx: &mut Context<Self>) -> AnyElement {
        let palette = self.palette;
        let viewport_width = f32::from(window.viewport_size().width);
        let compact = viewport_width < 1100.0;
        let available_width = (viewport_width - 272.0).max(0.0);
        let list_width = (available_width * 0.34).max(405.0).min(available_width);
        let sidebar = self.render_sidebar(cx);
        let mail_content = if self.compose_open {
            div()
                .min_w_0()
                .flex_1()
                .h_full()
                .p(px(6.0))
                .child(self.render_compose(cx))
                .into_any_element()
        } else if compact {
            div()
                .min_w_0()
                .flex_1()
                .h_full()
                .p_2()
                .child(if self.selected_thread_id.is_some() {
                    self.render_thread_detail(window, cx)
                } else {
                    self.render_message_list(cx)
                })
                .into_any_element()
        } else {
            div()
                .min_w_0()
                .flex_1()
                .h_full()
                .flex()
                .child(
                    div()
                        .w(px(list_width))
                        .h_full()
                        .flex_none()
                        .pl_2()
                        .pr_2()
                        .py_2()
                        .child(self.render_message_list(cx)),
                )
                .child(
                    div()
                        .min_w_0()
                        .flex_1()
                        .h_full()
                        .pr_2()
                        .py_2()
                        .child(self.render_thread_detail(window, cx)),
                )
                .into_any_element()
        };

        div()
            .relative()
            .size_full()
            .overflow_hidden()
            .bg(palette.background)
            .child(
                div()
                    .relative()
                    .size_full()
                    .flex()
                    .child(sidebar)
                    .child(mail_content),
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
            .when_some(self.render_toast(), |this, toast| this.child(toast))
            .into_any_element()
    }
}

impl Render for QuieterDesktop {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if self.hover_motion.values().any(|value| value.sample().1) {
            window.request_animation_frame();
        }
        self.hover_motion.retain(|_, value| {
            let (opacity, active) = value.sample();
            active || opacity > 0.0
        });
        let auth_visible = matches!(
            self.phase,
            AppPhase::SignedOut | AppPhase::RequestingDevice | AppPhase::AwaitingDevice(_)
        );
        let content = if auth_visible {
            self.render_auth(window, cx)
        } else {
            self.render_workspace(window, cx)
        };

        div()
            .size_full()
            .flex()
            .flex_col()
            .font_family("Geist")
            .key_context("QuieterDesktop")
            .track_focus(&self.focus_handle)
            .on_action(cx.listener(Self::keyboard_compose))
            .on_action(cx.listener(Self::keyboard_search))
            .on_action(cx.listener(Self::keyboard_refresh))
            .on_action(cx.listener(Self::keyboard_escape))
            .text_size(px(14.0))
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
    let parsed = value
        .trim()
        .parse::<i64>()
        .ok()
        .and_then(DateTime::from_timestamp_millis)
        .map(|date| date.with_timezone(&Local))
        .or_else(|| {
            DateTime::parse_from_rfc2822(value)
                .or_else(|_| DateTime::parse_from_rfc3339(value))
                .ok()
                .map(|date| date.with_timezone(&Local))
        });
    let Some(date) = parsed else {
        return String::new();
    };
    let now = Local::now();
    if date.date_naive() == now.date_naive() {
        date.format("%H:%M").to_string()
    } else if date.year() != now.year() {
        date.format("%b %e, %Y").to_string().replace("  ", " ")
    } else {
        date.format("%b %e").to_string().replace("  ", " ")
    }
}
