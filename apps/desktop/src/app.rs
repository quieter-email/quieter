use std::collections::{HashMap, HashSet};
use std::time::{Duration, Instant};

use chrono::{DateTime, Local};
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
use crate::auth::TokenStore;
use crate::dither::{auth_visual, workspace_dither};
use crate::model::{
    MailCategory, Mailbox, MailboxGroup, MailboxLabel, MailboxRequestScope, MessageDetail,
    MessageSummary, ReplyContext, ThreadActionRollback, ThreadCommand, ThreadDetail,
    preview_labels, preview_mailboxes, preview_thread, preview_threads,
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
    loading_more: bool,
    selected_thread_id: Option<String>,
    thread_detail: Option<ThreadDetail>,
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
            loading_more: false,
            selected_thread_id: None,
            thread_detail: None,
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
        }
        self.phase = AppPhase::Ready;
        cx.notify();
    }

    fn begin_device_authorization(&mut self, cx: &mut Context<Self>) {
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
                    Err(ApiError::Transport(_)) | Err(ApiError::Server { status: 429, .. }) => {
                        interval = (interval * 2).min(Duration::from_secs(30));
                        continue;
                    }
                    Ok(token) => {
                        let access_token = token.access_token;
                        if !this.read_with(cx, |this, _| this.auth_generation == generation).unwrap_or(false) {
                            let revoke_api = api.with_token(Some(access_token));
                            let _ = cx.background_executor().spawn(async move { revoke_api.sign_out() }).await;
                            return;
                        }
                        let _ = this.update(cx, |this, cx| {
                            if this.auth_generation != generation {
                                return;
                            }
                            let stored = TokenStore::save(this.api.base_url(), &access_token);
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
        self.list_query = query.clone();
        self.thread_scroll
            .scroll_to_item_strict(0, ScrollStrategy::Top);
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
            cx.notify();
            return;
        }

        self.thread_generation = self.thread_generation.wrapping_add(1);
        self.detail_generation = self.detail_generation.wrapping_add(1);
        self.mutation_generation = self.mutation_generation.wrapping_add(1);
        let generation = self.thread_generation;
        let auth_generation = self.auth_generation;
        let category = self.category;
        let api = self.api.clone();
        self.loading_threads = true;
        self.loading_detail = false;
        self.mutating = false;
        self.threads.clear();
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
                        None,
                    )
                })
                .await;
            let _ = this.update(cx, |this, cx| {
                if this.thread_generation != generation || this.auth_generation != auth_generation {
                    return;
                }
                this.loading_threads = false;
                match result {
                    Ok(list) => {
                        this.thread_result_estimate = list.result_size_estimate;
                        this.has_more_threads = list.next_page_token.is_some();
                        this.next_page_token = list.next_page_token;
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
                        this.thread_detail = Some(thread);
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
                                if this.auth_generation != auth_generation
                                    || this.detail_generation != generation
                                {
                                    return;
                                }
                                match result {
                                    Ok(_) => {
                                        if let Some(message) =
                                            this.threads.iter_mut().find(|message| {
                                                Some(&message.thread_id)
                                                    == this.selected_thread_id.as_ref()
                                            })
                                        {
                                            message.set_unread(false);
                                        }
                                    }
                                    Err(ApiError::Unauthorized) => this.expire_local_session(
                                        "Your desktop session expired. Sign in again.",
                                        cx,
                                    ),
                                    Err(error) => this.set_toast(error.to_string(), true, cx),
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
                    if let Err(error) = result {
                        this.set_toast(error.to_string(), true, cx);
                    }
                    return;
                }
                this.mutating = false;
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
        self.thread_generation = self.thread_generation.wrapping_add(1);
        self.detail_generation = self.detail_generation.wrapping_add(1);
        self.mutation_generation = self.mutation_generation.wrapping_add(1);
        self.compose_generation = self.compose_generation.wrapping_add(1);
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
            .bg(palette.background)
            .child(
                div()
                    .w(relative(0.6))
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
                                div().flex().items_center().gap_2().mb_8().child(
                                    svg()
                                        .path("brand/quieter-combination.svg")
                                        .w(px(128.0))
                                        .h(px(32.0))
                                        .text_color(palette.foreground),
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
                    .w(relative(0.4))
                    .h_full()
                    .overflow_hidden()
                    .border_l_1()
                    .border_color(palette.border)
                    .child(auth_visual(
                        QuieterTheme::dark().primary,
                        true,
                        self.reduced_motion,
                    )),
            )
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
            format!("{} / {group_name}", mailbox.email_address)
        });
        let mut navigation = div().mt(px(16.0)).w_full().flex().flex_col().gap(px(2.0));
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
                    .rounded(px(13.5))
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
                            .path(category.icon_path())
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
                    .rounded(px(13.5))
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
                    .mt(px(13.0))
                    .mx_1()
                    .h(px(32.0))
                    .flex_none()
                    .flex()
                    .gap(px(2.0))
                    .child(
                        div()
                            .id("mail-tab")
                            .flex_1()
                            .h_full()
                            .rounded(px(13.5))
                            .bg(palette.active)
                            .flex()
                            .items_center()
                            .justify_center()
                            .gap_2()
                            .text_size(px(13.0))
                            .cursor_pointer()
                            .on_click(cx.listener(|this, _, window, cx| {
                                this.close_compose(window, cx);
                            }))
                            .child(
                                svg()
                                    .path("icons/inbox.svg")
                                    .size(px(14.0))
                                    .text_color(palette.foreground),
                            )
                            .child("Mail"),
                    )
                    .child(
                        div()
                            .id("open-web-chat")
                            .flex_1()
                            .h_full()
                            .rounded(px(13.5))
                            .flex()
                            .items_center()
                            .justify_center()
                            .gap_2()
                            .text_size(px(13.0))
                            .cursor_pointer()
                            .text_color(palette.muted)
                            .hover(|style| style.bg(palette.hover))
                            .on_click(cx.listener(Self::open_web_chat))
                            .child(
                                svg()
                                    .path("icons/chat.svg")
                                    .size(px(14.0))
                                    .text_color(palette.muted),
                            )
                            .child("Chat"),
                    ),
            )
            .child(
                div()
                    .id("compose")
                    .mt(px(21.0))
                    .mx_1()
                    .h(px(36.0))
                    .flex_none()
                    .px_4()
                    .rounded(px(13.5))
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
                            .mt_4()
                            .px_2()
                            .child(div().text_xs().text_color(palette.muted).child("Views"))
                            .child(
                                div()
                                    .id("open-saved-views")
                                    .cursor_pointer()
                                    .mt_2()
                                    .text_xs()
                                    .text_color(palette.muted)
                                    .hover(|style| style.text_color(palette.foreground))
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        let url = this.api.workspace_url(
                                            "inbox",
                                            this.selected_mailbox_id.as_deref(),
                                        );
                                        if let Err(error) = open::that(url.as_str()) {
                                            this.set_toast(
                                                format!("The browser could not be opened: {error}"),
                                                true,
                                                cx,
                                            );
                                        }
                                    }))
                                    .child("Open saved views in browser"),
                            ),
                    )
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
                                            .rounded(px(13.5))
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
                                                    .rounded(px(4.0))
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
                            .rounded(px(13.5))
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
                            .rounded(px(13.5))
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
        let date = format_mail_date(message.date.as_deref().or(message.internal_date.as_deref()));
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
            .rounded(px(16.2))
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
                            .rounded(px(10.8))
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
                                                    .rounded(px(6.0))
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
                                                    .rounded(px(6.0))
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
        let list_body = if self.loading_threads {
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
                .child("You're all caught up.")
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
            .rounded(px(16.2))
            .border_1()
            .border_color(palette.border)
            .bg(palette.raised.opacity(0.60))
            .child(
                div().flex_none().px_4().pt_4().pb_3().child(
                    div()
                        .h(px(36.0))
                        .flex()
                        .items_center()
                        .gap_2()
                        .child(
                            div()
                                .id("refresh-threads")
                                .size(px(36.0))
                                .flex_none()
                                .rounded(px(21.6))
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
                                .rounded(px(21.6))
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
                                .size(px(36.0))
                                .flex_none()
                                .rounded(px(13.5))
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

    fn render_detail_header(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let palette = self.palette;
        let subject = self
            .thread_detail
            .as_ref()
            .and_then(|detail| detail.subject.clone())
            .unwrap_or_else(|| "(No subject)".to_owned());
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
            .gap_4()
            .child(
                div()
                    .min_w_0()
                    .flex_1()
                    .text_base()
                    .font_weight(FontWeight::MEDIUM)
                    .child(subject),
            )
            .when(self.mutating, |this| {
                this.child(Spinner::new().color(palette.muted))
            })
            .child(
                gpui_component::button::Button::new("thread-actions")
                    .ghost()
                    .size(px(32.0))
                    .rounded(px(13.5))
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

    fn render_message_card(&self, message: &MessageDetail, index: usize) -> AnyElement {
        let palette = self.palette;
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
                    .p_5()
                    .flex()
                    .items_start()
                    .gap_4()
                    .child(
                        div()
                            .size(px(40.0))
                            .flex_none()
                            .rounded(px(10.8))
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
                                    .child(
                                        div()
                                            .text_base()
                                            .font_weight(FontWeight::MEDIUM)
                                            .child(sender),
                                    )
                                    .child(div().text_sm().text_color(palette.muted).child(address))
                                    .child(
                                        div()
                                            .text_sm()
                                            .text_color(palette.muted)
                                            .child(format_mail_date(message.date.as_deref())),
                                    ),
                            )
                            .child(
                                div()
                                    .mt_1()
                                    .text_sm()
                                    .text_color(palette.muted)
                                    .child(format!(
                                        "To  {}",
                                        message.to.as_deref().unwrap_or("me")
                                    )),
                            ),
                    ),
            )
            .child(
                div()
                    .px_5()
                    .pb_5()
                    .text_base()
                    .line_height(relative(1.5))
                    .whitespace_normal()
                    .child(message.body().to_owned()),
            )
            .into_any_element()
    }

    fn render_thread_detail(&mut self, window: &Window, cx: &mut Context<Self>) -> AnyElement {
        let palette = self.palette;
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
            let messages = detail
                .messages
                .iter()
                .enumerate()
                .map(|(index, message)| self.render_message_card(message, index))
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
                            .rounded(px(21.6))
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
            .rounded(px(16.2))
            .border_1()
            .border_color(palette.border)
            .bg(palette.raised.opacity(0.60))
            .when(self.thread_detail.is_some(), |this| {
                this.child(self.render_detail_header(cx))
            })
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
            .rounded(px(16.2))
            .border_1()
            .border_color(palette.border)
            .bg(palette.raised.opacity(0.60))
            .child(
                div()
                    .w_full()
                    .max_w(px(848.0))
                    .h(px(400.0))
                    .max_h_full()
                    .rounded(px(21.6))
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
                            .px_3()
                            .border_b_1()
                            .border_color(palette.border)
                            .flex()
                            .items_center()
                            .child(
                                div()
                                    .w(px(30.0))
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
                            .px_3()
                            .border_b_1()
                            .border_color(palette.border)
                            .child(
                                Input::new(&self.compose_subject_input)
                                    .disabled(self.sending)
                                    .appearance(false)
                                    .bordered(false)
                                    .focus_bordered(false)
                                    .h_full(),
                            ),
                    )
                    .child(
                        div().min_h_0().flex_1().px_3().py_2().child(
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
                            .px_3()
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
                                    .rounded(px(13.5))
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
                                                .path("icons/reply.svg")
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
                                    .rounded(px(13.5))
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
        let sidebar = self.render_sidebar(cx);
        let mail_content = if self.compose_open {
            div()
                .min_w_0()
                .flex_1()
                .h_full()
                .p(px(6.0))
                .child(self.render_compose(cx))
                .into_any_element()
        } else {
            div()
                .min_w_0()
                .flex_1()
                .h_full()
                .flex()
                .child(
                    div()
                        .w(relative(0.34))
                        .min_w(px(320.0))
                        .h_full()
                        .flex_none()
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
                    .absolute()
                    .top_0()
                    .left_0()
                    .right_0()
                    .bottom_0()
                    .child(workspace_dither(palette.foreground, palette.is_dark)),
            )
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
            self.render_auth(cx)
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
