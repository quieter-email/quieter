mod api;
mod auth;
mod demo;

use api::{
    ApiClient, ApiError, MailCommand, Mailbox, MailboxGroup, MessageListItem, SessionUser,
    ThreadMessagesResult,
};
use auth::PendingAuth;
use demo::DemoStore;
use gpui::{
    AnyElement, App, Application, Bounds, ClickEvent, Context, FocusHandle, Focusable, Hsla,
    KeyDownEvent, Render, SharedString, Window, WindowBounds, WindowOptions, div, prelude::*, px,
    rgb, size,
};
use std::{
    collections::HashSet,
    time::{SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Theme {
    Light,
    Dark,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Category {
    Inbox,
    Unread,
    Archive,
    Sent,
    Drafts,
    Trash,
    Spam,
}

impl Category {
    const ALL: [Self; 7] = [
        Self::Inbox,
        Self::Unread,
        Self::Archive,
        Self::Sent,
        Self::Drafts,
        Self::Trash,
        Self::Spam,
    ];

    fn as_str(self) -> &'static str {
        match self {
            Self::Inbox => "inbox",
            Self::Unread => "unread",
            Self::Archive => "archive",
            Self::Sent => "sent",
            Self::Drafts => "drafts",
            Self::Trash => "trash",
            Self::Spam => "spam",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Inbox => "Inbox",
            Self::Unread => "Unread",
            Self::Archive => "Archive",
            Self::Sent => "Sent",
            Self::Drafts => "Drafts",
            Self::Trash => "Trash",
            Self::Spam => "Spam",
        }
    }

    fn icon(self) -> &'static str {
        match self {
            Self::Inbox => "▣",
            Self::Unread => "◉",
            Self::Archive => "□",
            Self::Sent => "↗",
            Self::Drafts => "◇",
            Self::Trash => "⌫",
            Self::Spam => "!",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum InputField {
    Search,
    To,
    Cc,
    Bcc,
    Subject,
    Body,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Status {
    SignedOut,
    Authenticating,
    Loading,
    Ready,
    Sending,
    Error,
}

#[derive(Clone, Copy)]
struct Palette {
    bg: Hsla,
    bg_raised: Hsla,
    surface: Hsla,
    control: Hsla,
    control_hover: Hsla,
    control_active: Hsla,
    fg: Hsla,
    muted: Hsla,
    faint: Hsla,
    border: Hsla,
    primary: Hsla,
    primary_fg: Hsla,
    blue: Hsla,
    purple: Hsla,
    green: Hsla,
    yellow: Hsla,
    red: Hsla,
}

fn palette(theme: Theme) -> Palette {
    match theme {
        Theme::Light => Palette {
            bg: rgb(0xe7e8ea).into(),
            bg_raised: rgb(0xf0f1f2).into(),
            surface: rgb(0xf9f9fa).into(),
            control: rgb(0xf0f1f2).into(),
            control_hover: rgb(0xe0e2e5).into(),
            control_active: rgb(0xd5d8dc).into(),
            fg: rgb(0x202124).into(),
            muted: rgb(0x6d7075).into(),
            faint: rgb(0x8e9298).into(),
            border: rgb(0xc9cdd2).into(),
            primary: rgb(0x25282c).into(),
            primary_fg: rgb(0xf9f9fa).into(),
            blue: rgb(0x487bb7).into(),
            purple: rgb(0x8c70c8).into(),
            green: rgb(0x4c8f71).into(),
            yellow: rgb(0xb18835).into(),
            red: rgb(0xb65d5d).into(),
        },
        Theme::Dark => Palette {
            bg: rgb(0x0d0d0d).into(),
            bg_raised: rgb(0x141414).into(),
            surface: rgb(0x202020).into(),
            control: rgb(0x1c1c1c).into(),
            control_hover: rgb(0x292929).into(),
            control_active: rgb(0x353535).into(),
            fg: rgb(0xf5f5f5).into(),
            muted: rgb(0xb7b7b7).into(),
            faint: rgb(0x818181).into(),
            border: rgb(0x303030).into(),
            primary: rgb(0xf2f2f2).into(),
            primary_fg: rgb(0x111111).into(),
            blue: rgb(0x3ec4e8).into(),
            purple: rgb(0xa276ed).into(),
            green: rgb(0x55c982).into(),
            yellow: rgb(0xe7bd4f).into(),
            red: rgb(0xe97b86).into(),
        },
    }
}

struct QuieterDesktop {
    api: ApiClient,
    auth_token: Option<String>,
    user: Option<SessionUser>,
    status: Status,
    error_message: Option<String>,
    notification: Option<String>,
    theme: Theme,
    focus_handle: FocusHandle,
    focused_field: Option<InputField>,
    category: Category,
    search_text: String,
    mailbox_groups: Vec<MailboxGroup>,
    selected_mailbox_id: Option<String>,
    demo: DemoStore,
    messages: Vec<MessageListItem>,
    selected_thread_id: Option<String>,
    thread: Option<ThreadMessagesResult>,
    compose_open: bool,
    compose_to: String,
    compose_cc: String,
    compose_bcc: String,
    compose_subject: String,
    compose_body: String,
}

impl QuieterDesktop {
    fn new(api: ApiClient, cx: &mut Context<Self>) -> Self {
        let auth_token = std::env::var("QUIETER_DESKTOP_TOKEN")
            .ok()
            .filter(|token| !token.trim().is_empty());
        let api = api.with_token(auth_token.clone());
        Self {
            api,
            auth_token,
            user: None,
            status: Status::SignedOut,
            error_message: None,
            notification: None,
            theme: Theme::Dark,
            focus_handle: cx.focus_handle(),
            focused_field: None,
            category: Category::Inbox,
            search_text: String::new(),
            mailbox_groups: Vec::new(),
            selected_mailbox_id: None,
            demo: DemoStore::new(),
            messages: Vec::new(),
            selected_thread_id: None,
            thread: None,
            compose_open: false,
            compose_to: String::new(),
            compose_cc: String::new(),
            compose_bcc: String::new(),
            compose_subject: String::new(),
            compose_body: String::new(),
        }
    }

    fn initialize(&mut self, cx: &mut Context<Self>) {
        if self.auth_token.is_some() {
            self.fetch_session(cx);
            return;
        }

        let keychain_url = self.api.keychain_url();
        let credentials = cx.read_credentials(&keychain_url);
        cx.spawn(async move |this, cx| {
            if let Ok(Some((_, bytes))) = credentials.await {
                if let Ok(token) = String::from_utf8(bytes) {
                    if !token.trim().is_empty() {
                        let _ = this.update(cx, |app, cx| {
                            app.auth_token = Some(token.clone());
                            app.api = app.api.with_token(Some(token));
                            app.fetch_session(cx);
                        });
                    }
                }
            }
        })
        .detach();
    }

    fn start_auth(&mut self, _: &ClickEvent, _: &mut Window, cx: &mut Context<Self>) {
        if self.status == Status::Authenticating {
            return;
        }
        let pending = match PendingAuth::new(&self.api.base_url()) {
            Ok(pending) => pending,
            Err(error) => {
                self.set_error(format!("Could not start browser sign-in: {error}"), cx);
                return;
            }
        };
        let auth_url = pending.auth_url().to_string();
        self.status = Status::Authenticating;
        self.error_message = None;
        cx.open_url(&auth_url);
        cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move { pending.wait_for_token() })
                .await;
            let _ = this.update(cx, |app, cx| match result {
                Ok(token) => app.finish_auth(token, cx),
                Err(error) => app.set_error(format!("Browser sign-in did not finish: {error}"), cx),
            });
        })
        .detach();
    }

    fn finish_auth(&mut self, token: String, cx: &mut Context<Self>) {
        let keychain_url = self.api.keychain_url();
        let write_task = cx.write_credentials(&keychain_url, "session", token.as_bytes());
        cx.spawn(async move |_this, _cx| {
            let _ = write_task.await;
        })
        .detach();
        self.auth_token = Some(token.clone());
        self.api = self.api.with_token(Some(token));
        self.fetch_session(cx);
    }

    fn fetch_session(&mut self, cx: &mut Context<Self>) {
        self.status = Status::Loading;
        let api = self.api.clone();
        cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move { api.get_session() })
                .await;
            let _ = this.update(cx, |app, cx| match result {
                Ok(Some(user)) => {
                    app.user = Some(user);
                    app.refresh_mailboxes(cx);
                }
                Ok(None) => app.clear_session(cx),
                Err(error) => app.handle_api_error(error, cx),
            });
        })
        .detach();
    }

    fn clear_session(&mut self, cx: &mut Context<Self>) {
        self.auth_token = None;
        self.user = None;
        self.api = self.api.with_token(None);
        self.mailbox_groups.clear();
        self.selected_mailbox_id = None;
        self.messages.clear();
        self.thread = None;
        self.selected_thread_id = None;
        self.status = Status::SignedOut;
        let keychain_url = self.api.keychain_url();
        let delete_task = cx.delete_credentials(&keychain_url);
        cx.spawn(async move |_this, _cx| {
            let _ = delete_task.await;
        })
        .detach();
    }

    fn logout(&mut self, _: &ClickEvent, _: &mut Window, cx: &mut Context<Self>) {
        self.clear_session(cx);
    }

    fn refresh_mailboxes(&mut self, cx: &mut Context<Self>) {
        self.status = Status::Loading;
        self.error_message = None;
        let api = self.api.clone();
        cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move { api.list_mailboxes() })
                .await;
            let _ = this.update(cx, |app, cx| match result {
                Ok(response) => app.receive_mailboxes(response, cx),
                Err(error) => app.handle_api_error(error, cx),
            });
        })
        .detach();
    }

    fn receive_mailboxes(&mut self, response: api::MailboxResponse, cx: &mut Context<Self>) {
        self.mailbox_groups = response.groups;
        let first_mailbox = self
            .mailbox_groups
            .iter()
            .flat_map(|group| group.mailboxes.iter())
            .find(|mailbox| !mailbox.id.is_empty())
            .map(|mailbox| mailbox.id.clone());
        self.selected_mailbox_id = response.default_mailbox_id.or(first_mailbox);
        if self.selected_mailbox_is_api() {
            self.category = Category::Sent;
        }
        if let Some(mailbox_id) = self.selected_mailbox_id.clone() {
            if self.selected_mailbox_needs_reconnect() {
                self.messages.clear();
                self.thread = None;
                self.status = Status::Ready;
                self.notification =
                    Some("Reconnect Google in the browser to load mail.".to_string());
                cx.notify();
            } else {
                self.refresh_messages_for(mailbox_id, cx);
            }
        } else {
            self.status = Status::Ready;
        }
    }

    fn refresh_messages(&mut self, cx: &mut Context<Self>) {
        if let Some(mailbox_id) = self.selected_mailbox_id.clone() {
            self.refresh_messages_for(mailbox_id, cx);
        }
    }

    fn refresh_messages_for(&mut self, mailbox_id: String, cx: &mut Context<Self>) {
        if mailbox_id == demo::DEMO_MAILBOX_ID {
            let messages = self.demo.list(self.category.as_str(), &self.search_text);
            self.messages = unique_threads(messages);
            self.thread = None;
            self.status = Status::Ready;
            self.error_message = None;
            self.notification = None;
            cx.notify();
            return;
        }
        if self.selected_mailbox_needs_reconnect() {
            self.messages.clear();
            self.thread = None;
            self.status = Status::Ready;
            self.error_message = None;
            self.notification = Some("Reconnect Google in the browser to load mail.".to_string());
            cx.notify();
            return;
        }
        self.status = Status::Loading;
        self.error_message = None;
        let category = self.category.as_str().to_string();
        let query = self.search_text.clone();
        let requested_mailbox_id = mailbox_id.clone();
        let requested_category = category.clone();
        let requested_query = query.clone();
        let api = self.api.clone();
        cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move { api.list_threads(&mailbox_id, &category, &query) })
                .await;
            let _ = this.update(cx, |app, cx| match result {
                Ok(page) => {
                    if app.selected_mailbox_id.as_deref() != Some(requested_mailbox_id.as_str())
                        || app.category.as_str() != requested_category
                        || app.search_text != requested_query
                    {
                        return;
                    }
                    app.messages = unique_threads(page.messages);
                    app.status = Status::Ready;
                    app.notification = None;
                    cx.notify();
                }
                Err(error) => app.handle_api_error(error, cx),
            });
        })
        .detach();
    }

    fn select_category(
        &mut self,
        category: Category,
        _: &ClickEvent,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.selected_mailbox_is_api() && category != Category::Sent {
            self.notification = Some("This mailbox exposes Sent mail only.".to_string());
            return;
        }
        self.category = category;
        self.selected_thread_id = None;
        self.thread = None;
        self.focused_field = None;
        self.refresh_messages(cx);
    }

    fn select_thread(
        &mut self,
        thread_id: String,
        _: &ClickEvent,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.selected_thread_id = Some(thread_id.clone());
        self.thread = None;
        self.focused_field = None;
        let Some(mailbox_id) = self.selected_mailbox_id.clone() else {
            return;
        };
        if mailbox_id == demo::DEMO_MAILBOX_ID {
            self.demo.mark_read(&thread_id, true);
            if let Some(thread) = self.demo.thread(&thread_id) {
                for message in &mut self.messages {
                    if message.thread_id == thread.thread_id {
                        message.is_unread = false;
                    }
                }
                self.thread = Some(thread);
                self.status = Status::Ready;
                cx.notify();
            }
            return;
        }
        let requested_mailbox_id = mailbox_id.clone();
        let requested_thread_id = thread_id.clone();
        let api = self.api.clone();
        cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move {
                    let thread = api.get_thread(&mailbox_id, &thread_id)?;
                    if thread.messages.iter().any(|message| message.is_unread) {
                        let message_ids = thread
                            .messages
                            .iter()
                            .map(|message| message.id.clone())
                            .collect::<Vec<_>>();
                        let _ = api.apply_command(
                            &mailbox_id,
                            &thread_id,
                            &message_ids,
                            MailCommand::MarkRead,
                        );
                    }
                    Ok::<_, ApiError>(thread)
                })
                .await;
            let _ = this.update(cx, |app, cx| match result {
                Ok(thread) => {
                    if app.selected_mailbox_id.as_deref() != Some(requested_mailbox_id.as_str())
                        || app.selected_thread_id.as_deref() != Some(requested_thread_id.as_str())
                    {
                        return;
                    }
                    for message in &mut app.messages {
                        if message.thread_id == thread.thread_id {
                            message.is_unread = false;
                        }
                    }
                    app.thread = Some(thread);
                    app.status = Status::Ready;
                    cx.notify();
                }
                Err(error) => app.handle_api_error(error, cx),
            });
        })
        .detach();
    }

    fn run_command(
        &mut self,
        command: MailCommand,
        _: &ClickEvent,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let (Some(mailbox_id), Some(thread)) =
            (self.selected_mailbox_id.clone(), self.thread.clone())
        else {
            return;
        };
        let thread_id = thread.thread_id.clone();
        let message_ids = thread
            .messages
            .iter()
            .map(|message| message.id.clone())
            .collect::<Vec<_>>();
        if mailbox_id == demo::DEMO_MAILBOX_ID {
            match command {
                MailCommand::Archive => self.demo.move_thread(&thread_id, "archive"),
                MailCommand::Trash => self.demo.move_thread(&thread_id, "trash"),
                MailCommand::MarkRead => self.demo.mark_read(&thread_id, true),
                MailCommand::MarkUnread => self.demo.mark_read(&thread_id, false),
            }
            self.notification = Some(match command {
                MailCommand::Archive => "Conversation archived".to_string(),
                MailCommand::Trash => "Conversation moved to Trash".to_string(),
                MailCommand::MarkRead => "Marked as read".to_string(),
                MailCommand::MarkUnread => "Marked as unread".to_string(),
            });
            self.selected_thread_id = None;
            self.thread = None;
            self.status = Status::Ready;
            self.refresh_messages(cx);
            return;
        }
        let api = self.api.clone();
        self.status = Status::Sending;
        cx.spawn(async move |this, cx| {
            let result =
                cx.background_executor()
                    .spawn(async move {
                        api.apply_command(&mailbox_id, &thread_id, &message_ids, command)
                    })
                    .await;
            let _ = this.update(cx, |app, cx| match result {
                Ok(()) => {
                    app.notification = Some(match command {
                        MailCommand::Archive => "Conversation archived".to_string(),
                        MailCommand::Trash => "Conversation moved to Trash".to_string(),
                        MailCommand::MarkRead => "Marked as read".to_string(),
                        MailCommand::MarkUnread => "Marked as unread".to_string(),
                    });
                    app.selected_thread_id = None;
                    app.thread = None;
                    app.refresh_messages(cx);
                }
                Err(error) => app.handle_api_error(error, cx),
            });
        })
        .detach();
    }

    fn open_compose(&mut self, _: &ClickEvent, window: &mut Window, cx: &mut Context<Self>) {
        if self.selected_mailbox_is_api() {
            self.notification = Some("Sending is not available for this mailbox yet.".to_string());
            return;
        }
        if self
            .selected_mailbox()
            .and_then(|mailbox| mailbox.capabilities.as_ref())
            .is_some_and(|capabilities| !capabilities.can_send)
        {
            self.notification =
                Some("You do not have permission to send from this mailbox.".to_string());
            return;
        }
        self.compose_open = true;
        self.focused_field = Some(InputField::To);
        window.focus(&self.focus_handle);
        cx.notify();
    }

    fn close_compose(&mut self, _: &ClickEvent, _: &mut Window, cx: &mut Context<Self>) {
        self.compose_open = false;
        self.focused_field = None;
        cx.notify();
    }

    fn send_message(&mut self, _: &ClickEvent, _: &mut Window, cx: &mut Context<Self>) {
        if self.compose_to.trim().is_empty() {
            self.notification = Some("Add at least one recipient before sending.".to_string());
            self.focused_field = Some(InputField::To);
            return;
        }
        let Some(mailbox_id) = self.selected_mailbox_id.clone() else {
            return;
        };
        if mailbox_id == demo::DEMO_MAILBOX_ID {
            let from = self
                .user
                .as_ref()
                .and_then(|user| user.email.as_deref())
                .unwrap_or("you@quieter.email")
                .to_string();
            self.demo.send(
                &from,
                &self.compose_to,
                &self.compose_subject,
                &self.compose_body,
            );
            self.compose_open = false;
            self.compose_to.clear();
            self.compose_cc.clear();
            self.compose_bcc.clear();
            self.compose_subject.clear();
            self.compose_body.clear();
            self.focused_field = None;
            self.notification = Some("Message sent in preview".to_string());
            self.status = Status::Ready;
            self.refresh_messages(cx);
            return;
        }
        let api = self.api.clone();
        let to = self.compose_to.clone();
        let cc = self.compose_cc.clone();
        let bcc = self.compose_bcc.clone();
        let subject = self.compose_subject.clone();
        let body = self.compose_body.clone();
        self.status = Status::Sending;
        cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(
                    async move { api.send_message(&mailbox_id, &to, &cc, &bcc, &subject, &body) },
                )
                .await;
            let _ = this.update(cx, |app, cx| match result {
                Ok(()) => {
                    app.compose_open = false;
                    app.compose_to.clear();
                    app.compose_cc.clear();
                    app.compose_bcc.clear();
                    app.compose_subject.clear();
                    app.compose_body.clear();
                    app.focused_field = None;
                    app.notification = Some("Message sent".to_string());
                    app.refresh_messages(cx);
                }
                Err(error) => app.handle_api_error(error, cx),
            });
        })
        .detach();
    }

    fn open_gmail_connect(&mut self, _: &ClickEvent, _: &mut Window, cx: &mut Context<Self>) {
        if self.selected_mailbox_is_demo() {
            self.notification = Some(
                "The preview mailbox is available offline. Connect a live mailbox in the browser."
                    .to_string(),
            );
            cx.notify();
            return;
        }
        let api = self.api.clone();
        let mailbox_id = self.selected_mailbox_id.clone();
        cx.spawn(async move |this, cx| {
            let result = cx
                .background_executor()
                .spawn(async move { api.start_gmail_connection("/", mailbox_id.as_deref()) })
                .await;
            let _ = this.update(cx, |app, cx| match result {
                Ok(url) => cx.open_url(&url),
                Err(error) => app.handle_api_error(error, cx),
            });
        })
        .detach();
    }

    fn toggle_theme(&mut self, _: &ClickEvent, _: &mut Window, cx: &mut Context<Self>) {
        self.theme = match self.theme {
            Theme::Light => Theme::Dark,
            Theme::Dark => Theme::Light,
        };
        cx.notify();
    }

    fn focus_field(&mut self, field: InputField, window: &mut Window, cx: &mut Context<Self>) {
        self.focused_field = Some(field);
        window.focus(&self.focus_handle);
        cx.notify();
    }

    fn submit_search(&mut self, cx: &mut Context<Self>) {
        self.selected_thread_id = None;
        self.thread = None;
        self.refresh_messages(cx);
    }

    fn on_key_down(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        if event.is_held {
            return;
        }
        let key = event.keystroke.key.to_ascii_lowercase();
        let modifiers = event.keystroke.modifiers;
        if modifiers.secondary() && key == "v" {
            if let Some(text) = cx.read_from_clipboard().and_then(|item| item.text()) {
                self.insert_text(&text);
                cx.notify();
            }
            return;
        }
        if key == "escape" {
            if self.compose_open {
                self.compose_open = false;
                self.focused_field = None;
            } else {
                self.selected_thread_id = None;
                self.thread = None;
            }
            cx.notify();
            return;
        }
        if self.focused_field.is_none() {
            match key.as_str() {
                "c" => {
                    if self.selected_mailbox_is_api() {
                        self.notification =
                            Some("Sending is not available for this mailbox yet.".to_string());
                    } else if self
                        .selected_mailbox()
                        .and_then(|mailbox| mailbox.capabilities.as_ref())
                        .is_some_and(|capabilities| !capabilities.can_send)
                    {
                        self.notification = Some(
                            "You do not have permission to send from this mailbox.".to_string(),
                        );
                    } else {
                        self.compose_open = true;
                        self.focused_field = Some(InputField::To);
                        window.focus(&self.focus_handle);
                    }
                }
                "r" => self.refresh_messages(cx),
                "/" => self.focus_field(InputField::Search, window, cx),
                _ => {}
            }
            cx.notify();
            return;
        }

        let field = self.focused_field.unwrap();
        if key == "backspace" {
            self.active_input_mut(field).pop();
            cx.notify();
            return;
        }
        if key == "enter" {
            match field {
                InputField::Search => self.submit_search(cx),
                InputField::To => self.focus_field(InputField::Cc, window, cx),
                InputField::Cc => self.focus_field(InputField::Bcc, window, cx),
                InputField::Bcc => self.focus_field(InputField::Subject, window, cx),
                InputField::Subject => self.focus_field(InputField::Body, window, cx),
                InputField::Body => self.insert_text("\n"),
            }
            cx.notify();
            return;
        }
        if !modifiers.modified() {
            if let Some(character) = event.keystroke.key_char.as_deref() {
                self.insert_text(character);
                cx.notify();
            }
        }
    }

    fn active_input_mut(&mut self, field: InputField) -> &mut String {
        match field {
            InputField::Search => &mut self.search_text,
            InputField::To => &mut self.compose_to,
            InputField::Cc => &mut self.compose_cc,
            InputField::Bcc => &mut self.compose_bcc,
            InputField::Subject => &mut self.compose_subject,
            InputField::Body => &mut self.compose_body,
        }
    }

    fn insert_text(&mut self, text: &str) {
        if let Some(field) = self.focused_field {
            self.active_input_mut(field).push_str(text);
        }
    }

    fn selected_mailbox_is_api(&self) -> bool {
        self.selected_mailbox()
            .and_then(|mailbox| mailbox.provider.as_deref())
            .is_some_and(|provider| provider.eq_ignore_ascii_case("api"))
    }

    fn selected_mailbox_is_demo(&self) -> bool {
        self.selected_mailbox_id.as_deref() == Some(demo::DEMO_MAILBOX_ID)
    }

    fn selected_mailbox_needs_reconnect(&self) -> bool {
        !self.selected_mailbox_is_demo()
            && self
                .selected_mailbox()
                .and_then(|mailbox| mailbox.connection_status.as_deref())
                .is_some_and(|status| status == "needs_reconnect")
    }

    fn selected_mailbox(&self) -> Option<&Mailbox> {
        let id = self.selected_mailbox_id.as_deref()?;
        self.mailbox_groups
            .iter()
            .flat_map(|group| group.mailboxes.iter())
            .find(|mailbox| mailbox.id == id)
    }

    fn select_mailbox(
        &mut self,
        mailbox_id: String,
        _: &ClickEvent,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.selected_mailbox_id.as_deref() == Some(mailbox_id.as_str()) {
            return;
        }
        self.selected_mailbox_id = Some(mailbox_id.clone());
        self.category = if self.selected_mailbox_is_api() {
            Category::Sent
        } else {
            Category::Inbox
        };
        self.selected_thread_id = None;
        self.thread = None;
        self.compose_open = false;
        self.focused_field = None;
        self.refresh_messages_for(mailbox_id, cx);
    }

    fn set_error(&mut self, message: String, cx: &mut Context<Self>) {
        self.status = Status::Error;
        self.error_message = Some(message);
        cx.notify();
    }

    fn handle_api_error(&mut self, error: ApiError, cx: &mut Context<Self>) {
        if error.status == 401 || error.code.as_deref() == Some("UNAUTHORIZED") {
            self.clear_session(cx);
        } else {
            self.set_error(error.message, cx);
        }
    }

    fn status_label(&self) -> String {
        match self.status {
            Status::SignedOut => "Not connected".to_string(),
            Status::Authenticating => "Waiting for browser sign-in".to_string(),
            Status::Loading => "Syncing quietly".to_string(),
            Status::Ready => self
                .notification
                .clone()
                .unwrap_or_else(|| "Up to date".to_string()),
            Status::Sending => "Sending".to_string(),
            Status::Error => self
                .error_message
                .clone()
                .unwrap_or_else(|| "Something went wrong".to_string()),
        }
    }

    fn render_login(&self, cx: &mut Context<Self>) -> AnyElement {
        let p = palette(self.theme);
        let button_label = if self.status == Status::Authenticating {
            "Waiting for browser"
        } else {
            "Sign in in browser"
        };
        div()
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .bg(p.bg)
            .child(
                div()
                    .w(px(470.0))
                    .p(px(42.0))
                    .rounded_lg()
                    .border_1()
                    .border_color(p.border)
                    .bg(p.surface)
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_3()
                            .child(
                                div()
                                    .size(px(42.0))
                                    .rounded_md()
                                    .bg(p.primary)
                                    .text_color(p.primary_fg)
                                    .text_size(px(25.0))
                                    .font_family("Lora")
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .child("q"),
                            )
                            .child(
                                div()
                                    .text_size(px(23.0))
                                    .font_family("Lora")
                                    .text_color(p.fg)
                                    .child("quieter"),
                            ),
                    )
                    .child(
                        div()
                            .mt_8()
                            .text_size(px(31.0))
                            .font_family("Lora")
                            .text_color(p.fg)
                            .child("A calmer desktop for email"),
                    )
                    .child(
                        div()
                            .mt_3()
                            .text_size(px(15.0))
                            .line_height(px(23.0))
                            .text_color(p.muted)
                            .child("Use your quieter account in the browser, then return here to keep your mailbox close and focused."),
                    )
                    .child(
                        div()
                            .mt_8()
                            .w_full()
                            .h(px(48.0))
                            .rounded_md()
                            .bg(p.primary)
                            .text_color(p.primary_fg)
                            .cursor_pointer()
                    .flex()
                    .items_center()
                    .justify_center()
                    .text_size(px(14.0))
                    .id("sign-in")
                    .on_click(cx.listener(Self::start_auth))
                    .child(button_label),
                    )
                    .child(
                        div()
                            .mt_4()
                            .text_size(px(12.0))
                            .text_color(if self.status == Status::Error { p.red } else { p.muted })
                            .child(self.status_label()),
                    )
                    .child(
                        div()
                            .mt_8()
                            .pt_5()
                            .border_t_1()
                            .border_color(p.border)
                            .text_size(px(12.0))
                            .text_color(p.faint)
                            .child("The desktop client uses the same session and mailbox permissions as quieter.email."),
                    ),
            )
            .into_any_element()
    }

    fn render_sidebar(&self, cx: &mut Context<Self>, p: Palette) -> AnyElement {
        let selected_label = self
            .selected_mailbox()
            .and_then(|mailbox| {
                mailbox
                    .display_name
                    .clone()
                    .or_else(|| mailbox.email_address.clone())
            })
            .unwrap_or_else(|| "No mailbox connected".to_string());
        let selected_email = if self.selected_mailbox_is_demo() {
            "inbox@quieter.com / Demo".to_string()
        } else {
            self.selected_mailbox()
                .and_then(|mailbox| mailbox.email_address.clone())
                .unwrap_or_else(|| "Connect a mailbox to begin".to_string())
        };
        let selected_unread = if self.selected_mailbox_is_demo() {
            self.demo.unread_count()
        } else {
            self.selected_mailbox()
                .and_then(|mailbox| mailbox.unread_non_spam_count)
                .unwrap_or_default()
        };
        let mailbox_rows = self
            .mailbox_groups
            .iter()
            .flat_map(|group| group.mailboxes.iter())
            .map(|mailbox| {
                let mailbox_id = mailbox.id.clone();
                let selected = self.selected_mailbox_id.as_deref() == Some(mailbox.id.as_str());
                let label = mailbox
                    .display_name
                    .clone()
                    .or_else(|| mailbox.email_address.clone())
                    .unwrap_or_else(|| "Unnamed mailbox".to_string());
                let email = mailbox.email_address.clone().unwrap_or_default();
                div()
                    .id(SharedString::from(format!("mailbox-{mailbox_id}")))
                    .w_full()
                    .min_h(px(42.0))
                    .px_3()
                    .py_2()
                    .rounded_md()
                    .flex()
                    .flex_col()
                    .justify_center()
                    .cursor_pointer()
                    .when(selected, |this| this.bg(p.control_active))
                    .hover(|style| style.bg(p.control_hover))
                    .on_click(cx.listener(move |app, event, window, cx| {
                        app.select_mailbox(mailbox_id.clone(), event, window, cx)
                    }))
                    .child(div().text_size(px(12.0)).text_color(p.fg).child(label))
                    .child(div().text_size(px(10.0)).text_color(p.faint).child(email))
                    .into_any_element()
            })
            .collect::<Vec<_>>();
        let mailbox_count = mailbox_rows.len();
        let is_api = self.selected_mailbox_is_api();
        let category_buttons = Category::ALL
            .into_iter()
            .filter(|category| !is_api || *category == Category::Sent)
            .map(|category| {
                let active = category == self.category;
                div()
                    .id(SharedString::from(format!(
                        "category-{}",
                        category.as_str()
                    )))
                    .w_full()
                    .h(px(38.0))
                    .px_3()
                    .rounded_md()
                    .flex()
                    .items_center()
                    .gap_3()
                    .cursor_pointer()
                    .when(active, |this| this.bg(p.control_active))
                    .hover(|style| style.bg(p.control_hover))
                    .text_color(if active { p.fg } else { p.muted })
                    .on_click(cx.listener(move |app, event, window, cx| {
                        app.select_category(category, event, window, cx)
                    }))
                    .child(div().w(px(18.0)).text_size(px(14.0)).child(category.icon()))
                    .child(div().text_size(px(13.0)).child(category.label()))
                    .into_any_element()
            })
            .collect::<Vec<_>>();

        div()
            .w(px(272.0))
            .flex_none()
            .h_full()
            .flex()
            .flex_col()
            .bg(p.bg_raised)
            .border_r_1()
            .border_color(p.border)
            .p_4()
            .child(
                div()
                    .px_1()
                    .child(
                        div()
                            .text_size(px(13.0))
                            .text_color(p.fg)
                            .child(selected_label),
                    )
                    .child(
                        div()
                            .mt_1()
                            .text_size(px(11.0))
                            .text_color(p.muted)
                            .child(selected_email),
                    ),
            )
            .child(
                div()
                    .mt_4()
                    .h(px(34.0))
                    .flex()
                    .gap_1()
                    .child(
                        div()
                            .flex_1()
                            .rounded_md()
                            .bg(p.surface)
                            .text_color(p.fg)
                            .text_size(px(12.0))
                            .flex()
                            .items_center()
                            .justify_center()
                            .child("▣  Mail"),
                    )
                    .child(
                        div()
                            .flex_1()
                            .rounded_md()
                            .text_color(p.muted)
                            .text_size(px(12.0))
                            .flex()
                            .items_center()
                            .justify_center()
                            .child("☷  Chat"),
                    ),
            )
            .when(mailbox_count > 1, |this| {
                this.child(
                    div()
                        .mt_4()
                        .px_2()
                        .text_size(px(10.0))
                        .text_color(p.faint)
                        .child("MAILBOXES"),
                )
                .child(div().mt_1().children(mailbox_rows))
            })
            .child(
                div()
                    .mt_4()
                    .w_full()
                    .h(px(42.0))
                    .rounded_md()
                    .bg(p.primary)
                    .text_color(p.primary_fg)
                    .cursor_pointer()
                    .flex()
                    .items_center()
                    .justify_center()
                    .text_size(px(13.0))
                    .id("compose")
                    .on_click(cx.listener(Self::open_compose))
                    .child("Compose"),
            )
            .child(div().mt_4().h(px(1.0)))
            .children(category_buttons)
            .child(
                div()
                    .mt_4()
                    .px_2()
                    .text_size(px(10.0))
                    .text_color(p.faint)
                    .child("LABELS"),
            )
            .child(
                div()
                    .mt_2()
                    .h(px(34.0))
                    .px_3()
                    .flex()
                    .items_center()
                    .gap_3()
                    .text_color(p.muted)
                    .text_size(px(13.0))
                    .child(div().w(px(18.0)).text_color(p.blue).child("●"))
                    .child("Clients"),
            )
            .child(
                div()
                    .h(px(34.0))
                    .px_3()
                    .flex()
                    .items_center()
                    .gap_3()
                    .text_color(p.muted)
                    .text_size(px(13.0))
                    .child(div().w(px(18.0)).text_color(p.green).child("●"))
                    .child("Finance"),
            )
            .child(
                div()
                    .h(px(34.0))
                    .px_3()
                    .flex()
                    .items_center()
                    .gap_3()
                    .text_color(p.muted)
                    .text_size(px(13.0))
                    .child(div().w(px(18.0)).text_color(p.blue).child("●"))
                    .child("Product"),
            )
            .child(div().flex_1())
            .child(
                div()
                    .p_3()
                    .rounded_md()
                    .border_1()
                    .border_color(p.border)
                    .text_size(px(11.0))
                    .text_color(p.muted)
                    .child(format!("{} unread", selected_unread)),
            )
            .child(
                div()
                    .mt_2()
                    .h(px(34.0))
                    .px_2()
                    .flex()
                    .items_center()
                    .justify_between()
                    .text_size(px(12.0))
                    .text_color(p.muted)
                    .child("Settings")
                    .child(
                        div()
                            .px_2()
                            .py_1()
                            .rounded_md()
                            .cursor_pointer()
                            .hover(|style| style.bg(p.control_hover))
                            .id("sign-out")
                            .on_click(cx.listener(Self::logout))
                            .child("Sign out"),
                    ),
            )
            .into_any_element()
    }

    #[allow(dead_code)]
    fn render_topbar(&self, cx: &mut Context<Self>, p: Palette) -> AnyElement {
        let user_label = self
            .user
            .as_ref()
            .and_then(|user| user.email.clone().or_else(|| user.name.clone()))
            .unwrap_or_else(|| "Account".to_string());
        let search_active = self.focused_field == Some(InputField::Search);
        let search_value = if self.search_text.is_empty() {
            "Search mail"
        } else {
            self.search_text.as_str()
        };
        let search_value = search_value.to_string();
        div()
            .h(px(68.0))
            .flex_none()
            .flex()
            .items_center()
            .gap_4()
            .px_5()
            .border_b_1()
            .border_color(p.border)
            .bg(p.bg)
            .child(
                div()
                    .text_size(px(17.0))
                    .font_family("Lora")
                    .text_color(p.fg)
                    .child(self.category.label()),
            )
            .child(div().text_size(px(12.0)).text_color(p.faint).child("/"))
            .child(
                div()
                    .flex_1()
                    .max_w(px(480.0))
                    .h(px(38.0))
                    .px_3()
                    .rounded_md()
                    .border_1()
                    .border_color(if search_active { p.blue } else { p.border })
                    .bg(p.surface)
                    .text_size(px(13.0))
                    .text_color(if self.search_text.is_empty() {
                        p.faint
                    } else {
                        p.fg
                    })
                    .cursor_pointer()
                    .id("search")
                    .on_click(cx.listener(move |app, _, window, cx| {
                        app.focus_field(InputField::Search, window, cx)
                    }))
                    .flex()
                    .items_center()
                    .child(div().mr_2().text_color(p.muted).child("⌕"))
                    .child(search_value),
            )
            .child(div().flex_1())
            .child(
                div()
                    .text_size(px(12.0))
                    .text_color(p.muted)
                    .child(self.status_label()),
            )
            .child(
                div()
                    .size(px(34.0))
                    .rounded_md()
                    .flex()
                    .items_center()
                    .justify_center()
                    .text_size(px(16.0))
                    .text_color(p.muted)
                    .cursor_pointer()
                    .hover(|style| style.bg(p.control_hover))
                    .id("refresh-topbar")
                    .on_click(cx.listener(|app, _, _, cx| app.refresh_messages(cx)))
                    .child("↻"),
            )
            .child(
                div()
                    .size(px(34.0))
                    .rounded_md()
                    .flex()
                    .items_center()
                    .justify_center()
                    .text_size(px(15.0))
                    .text_color(p.muted)
                    .cursor_pointer()
                    .hover(|style| style.bg(p.control_hover))
                    .id("toggle-theme")
                    .on_click(cx.listener(Self::toggle_theme))
                    .child(if self.theme == Theme::Light {
                        "◐"
                    } else {
                        "☼"
                    }),
            )
            .child(
                div()
                    .max_w(px(170.0))
                    .text_size(px(12.0))
                    .text_color(p.muted)
                    .child(user_label),
            )
            .into_any_element()
    }

    fn render_content(&self, cx: &mut Context<Self>, p: Palette) -> AnyElement {
        let search_active = self.focused_field == Some(InputField::Search);
        let search_value = if self.search_text.is_empty() {
            "Search"
        } else {
            self.search_text.as_str()
        };
        let list_header = div()
            .h(px(64.0))
            .flex_none()
            .flex()
            .items_center()
            .gap_2()
            .px_3()
            .pt_3()
            .pb_2()
            .child(
                div()
                    .size(px(36.0))
                    .rounded_md()
                    .border_1()
                    .border_color(p.border)
                    .text_color(p.muted)
                    .cursor_pointer()
                    .hover(|style| style.bg(p.control_hover))
                    .flex()
                    .items_center()
                    .justify_center()
                    .id("refresh-list")
                    .on_click(cx.listener(|app, _, _, cx| app.refresh_messages(cx)))
                    .child("↻"),
            )
            .child(
                div()
                    .flex_1()
                    .h(px(36.0))
                    .px_3()
                    .rounded_md()
                    .border_1()
                    .border_color(if search_active { p.fg } else { p.border })
                    .bg(p.control)
                    .text_size(px(13.0))
                    .text_color(if self.search_text.is_empty() {
                        p.muted
                    } else {
                        p.fg
                    })
                    .cursor_pointer()
                    .id("search")
                    .on_click(cx.listener(move |app, _, window, cx| {
                        app.focus_field(InputField::Search, window, cx)
                    }))
                    .flex()
                    .items_center()
                    .child(div().mr_2().text_color(p.muted).child("⌕"))
                    .child(search_value.to_string()),
            )
            .child(
                div()
                    .size(px(36.0))
                    .rounded_md()
                    .border_1()
                    .border_color(p.border)
                    .text_size(px(12.0))
                    .text_color(p.muted)
                    .cursor_pointer()
                    .hover(|style| style.bg(p.control_hover))
                    .flex()
                    .items_center()
                    .justify_center()
                    .id("toggle-theme-list")
                    .on_click(cx.listener(Self::toggle_theme))
                    .child(if self.theme == Theme::Light {
                        "◐"
                    } else {
                        "☼"
                    }),
            );

        if self.mailbox_groups.is_empty() {
            return div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .bg(p.bg)
                .child(list_header)
                .child(self.render_no_mailbox(cx, p))
                .into_any_element();
        }

        if self.selected_mailbox_needs_reconnect() {
            return div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .bg(p.bg)
                .child(list_header)
                .child(self.render_reconnect_mailbox(cx, p))
                .into_any_element();
        }

        let list = div()
            .w(px(452.0))
            .flex_none()
            .h_full()
            .min_w_0()
            .flex()
            .flex_col()
            .bg(p.bg)
            .child(list_header)
            .child(self.render_message_list(cx, p));
        let detail = if self.compose_open {
            self.render_compose(cx, p)
        } else if let Some(thread) = &self.thread {
            self.render_thread(thread, cx, p)
        } else {
            div()
                .flex_1()
                .min_w_0()
                .border_color(p.border)
                .bg(p.bg)
                .flex()
                .items_center()
                .justify_center()
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .items_center()
                        .gap_3()
                        .text_color(p.muted)
                        .child(div().text_size(px(24.0)).text_color(p.faint).child("⠿"))
                        .child(
                            div()
                                .text_size(px(15.0))
                                .text_color(p.fg)
                                .child("No conversation open"),
                        )
                        .child(
                            div()
                                .text_size(px(13.0))
                                .text_color(p.muted)
                                .child("Choose a conversation to begin."),
                        ),
                )
                .into_any_element()
        };
        div()
            .flex_1()
            .min_h_0()
            .min_w_0()
            .flex()
            .bg(p.bg)
            .child(list)
            .child(detail)
            .into_any_element()
    }

    fn render_reconnect_mailbox(&self, cx: &mut Context<Self>, p: Palette) -> AnyElement {
        div()
            .flex_1()
            .flex()
            .items_center()
            .justify_center()
            .child(
                div()
                    .w(px(410.0))
                    .p(px(34.0))
                    .rounded_lg()
                    .border_1()
                    .border_color(p.border)
                    .bg(p.surface)
                    .child(
                        div()
                            .text_size(px(22.0))
                            .font_family("Lora")
                            .text_color(p.fg)
                            .child("Reconnect Google"),
                    )
                    .child(
                        div()
                            .mt_3()
                            .text_size(px(14.0))
                            .line_height(px(21.0))
                            .text_color(p.muted)
                            .child("This account needs to reconnect through Google before quieter can load mail."),
                    )
                    .child(
                        div()
                            .mt_7()
                            .h(px(44.0))
                            .px_4()
                            .rounded_md()
                            .bg(p.primary)
                            .text_color(p.primary_fg)
                            .cursor_pointer()
                            .flex()
                            .items_center()
                            .justify_center()
                            .text_size(px(13.0))
                            .id("reconnect-gmail")
                            .on_click(cx.listener(Self::open_gmail_connect))
                            .child("Reconnect"),
                    ),
            )
            .into_any_element()
    }

    fn render_no_mailbox(&self, cx: &mut Context<Self>, p: Palette) -> AnyElement {
        div()
            .flex_1()
            .flex()
            .items_center()
            .justify_center()
            .child(
                div()
                    .w(px(410.0))
                    .p(px(34.0))
                    .rounded_lg()
                    .border_1()
                    .border_color(p.border)
                    .bg(p.surface)
                    .child(div().text_size(px(22.0)).font_family("Lora").text_color(p.fg).child("Connect a mailbox"))
                    .child(div().mt_3().text_size(px(14.0)).line_height(px(21.0)).text_color(p.muted).child("Your desktop workspace is ready. Connect Gmail in the browser to bring your conversations here."))
                    .child(
                        div()
                            .mt_7()
                            .h(px(44.0))
                            .px_4()
                            .rounded_md()
                            .bg(p.primary)
                            .text_color(p.primary_fg)
                            .cursor_pointer()
                            .flex()
                            .items_center()
                            .justify_center()
                            .text_size(px(13.0))
                            .id("connect-gmail")
                            .on_click(cx.listener(Self::open_gmail_connect))
                            .child("Connect Gmail"),
                    ),
            )
            .into_any_element()
    }

    fn render_message_list(&self, cx: &mut Context<Self>, p: Palette) -> AnyElement {
        if self.messages.is_empty() {
            return div()
                .flex_1()
                .flex()
                .items_center()
                .justify_center()
                .text_size(px(13.0))
                .text_color(p.faint)
                .child(if self.search_text.is_empty() {
                    "No conversations here"
                } else {
                    "No conversations match this search"
                })
                .into_any_element();
        }
        let rows = self
            .messages
            .iter()
            .enumerate()
            .map(|(index, message)| self.render_message_row(index, message, cx, p))
            .collect::<Vec<_>>();
        div()
            .flex_1()
            .min_h_0()
            .id("message-list")
            .overflow_y_scroll()
            .children(rows)
            .into_any_element()
    }

    fn render_message_row(
        &self,
        _index: usize,
        message: &MessageListItem,
        cx: &mut Context<Self>,
        p: Palette,
    ) -> AnyElement {
        let selected = self.selected_thread_id.as_deref() == Some(message.thread_id.as_str());
        let sender = sender_label(message.from.as_deref());
        let subject = message
            .subject
            .as_deref()
            .filter(|subject| !subject.trim().is_empty())
            .unwrap_or("(No subject)")
            .to_string();
        let date = format_date(message.date.as_deref().or(message.internal_date.as_deref()));
        let attachment_count = message.attachments.len();
        let thread_id = message.thread_id.clone();
        let badge = sender_badge(&sender);
        let badge_color = sender_badge_color(&sender, p);
        let sender_email = sender_email(message.from.as_deref());
        let message_tag = message_tag(&sender);
        div()
            .id(SharedString::from(format!("thread-row-{thread_id}")))
            .h(px(72.0))
            .w_full()
            .flex_none()
            .flex()
            .items_center()
            .gap_3()
            .px_3()
            .border_b_1()
            .border_color(p.border)
            .cursor_pointer()
            .when(selected, |this| this.bg(p.control_active))
            .hover(|style| style.bg(p.control_hover))
            .on_click(cx.listener(move |app, event, window, cx| {
                app.select_thread(thread_id.clone(), event, window, cx)
            }))
            .child(
                div()
                    .size(px(34.0))
                    .flex_none()
                    .rounded_lg()
                    .bg(badge_color)
                    .text_color(p.primary_fg)
                    .text_size(px(14.0))
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(badge),
            )
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .flex_col()
                    .gap_1()
                    .child(
                        div()
                            .flex()
                            .justify_between()
                            .gap_3()
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_2()
                                    .text_size(px(13.0))
                                    .text_color(if message.is_unread { p.fg } else { p.muted })
                                    .child(sender)
                                    .child(
                                        div()
                                            .text_size(px(10.0))
                                            .text_color(p.faint)
                                            .child(sender_email),
                                    ),
                            )
                            .child(div().text_size(px(11.0)).text_color(p.faint).child(date)),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .child(
                                div()
                                    .flex_1()
                                    .min_w_0()
                                    .text_size(px(13.0))
                                    .text_color(if message.is_unread { p.fg } else { p.muted })
                                    .child(subject),
                            )
                            .when(
                                message.thread_message_count.unwrap_or_default() > 1,
                                |this| {
                                    this.child(
                                        div()
                                            .px_1()
                                            .rounded_md()
                                            .bg(p.control)
                                            .text_size(px(10.0))
                                            .text_color(p.muted)
                                            .child(format!(
                                                "{}",
                                                message.thread_message_count.unwrap_or_default()
                                            )),
                                    )
                                },
                            )
                            .when(attachment_count > 0, |this| {
                                this.child(
                                    div()
                                        .px_1()
                                        .rounded_md()
                                        .bg(p.control)
                                        .text_size(px(10.0))
                                        .text_color(p.muted)
                                        .child(format!(
                                            "{attachment_count} file{}",
                                            if attachment_count == 1 { "" } else { "s" }
                                        )),
                                )
                            })
                            .when(!message_tag.is_empty(), |this| {
                                this.child(
                                    div()
                                        .px_2()
                                        .py_1()
                                        .rounded_md()
                                        .bg(if message_tag == "Finance" {
                                            p.green
                                        } else if message_tag == "Clients" {
                                            p.blue
                                        } else {
                                            p.purple
                                        })
                                        .text_size(px(10.0))
                                        .text_color(p.primary_fg)
                                        .child(message_tag),
                                )
                            }),
                    ),
            )
            .into_any_element()
    }

    fn render_thread(
        &self,
        thread: &ThreadMessagesResult,
        cx: &mut Context<Self>,
        p: Palette,
    ) -> AnyElement {
        let subject = thread
            .subject
            .as_deref()
            .filter(|subject| !subject.is_empty())
            .unwrap_or("(No subject)")
            .to_string();
        let messages = thread
            .messages
            .iter()
            .enumerate()
            .map(|(index, message)| {
                let sender = sender_label(message.from.as_deref());
                let body = message
                    .body_text
                    .as_deref()
                    .or(message.snippet.as_deref())
                    .unwrap_or("No message body available.");
                let attachment_names = message
                    .attachments
                    .iter()
                    .filter_map(|attachment| attachment.file_name.as_deref())
                    .map(str::to_string)
                    .collect::<Vec<_>>();
                div()
                    .mb_4()
                    .p_4()
                    .rounded_md()
                    .border_1()
                    .border_color(p.border)
                    .bg(if index == thread.messages.len() - 1 {
                        p.surface
                    } else {
                        p.bg
                    })
                    .child(
                        div()
                            .flex()
                            .justify_between()
                            .gap_3()
                            .child(div().text_size(px(13.0)).text_color(p.fg).child(sender))
                            .child(div().text_size(px(11.0)).text_color(p.faint).child(
                                format_date(
                                    message.date.as_deref().or(message.internal_date.as_deref()),
                                ),
                            )),
                    )
                    .child(
                        div()
                            .mt_3()
                            .text_size(px(13.0))
                            .line_height(px(21.0))
                            .text_color(p.muted)
                            .child(body.to_string()),
                    )
                    .when(!attachment_names.is_empty(), |this| {
                        this.child(
                            div()
                                .mt_3()
                                .text_size(px(11.0))
                                .text_color(p.faint)
                                .child(format!("Attachments: {}", attachment_names.join(", "))),
                        )
                    })
                    .into_any_element()
            })
            .collect::<Vec<_>>();
        div()
            .flex_1()
            .min_w_0()
            .h_full()
            .flex()
            .flex_col()
            .border_l_1()
            .border_color(p.border)
            .bg(p.bg)
            .child(
                div()
                    .h(px(62.0))
                    .flex_none()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap_3()
                    .px_5()
                    .border_b_1()
                    .border_color(p.border)
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .text_size(px(15.0))
                            .text_color(p.fg)
                            .child(subject),
                    )
                    .child(
                        div()
                            .px_2()
                            .py_1()
                            .rounded_md()
                            .text_size(px(11.0))
                            .text_color(p.muted)
                            .cursor_pointer()
                            .hover(|style| style.bg(p.control_hover))
                            .id("close-thread")
                            .on_click(cx.listener(|app, _, _, cx| {
                                app.selected_thread_id = None;
                                app.thread = None;
                                cx.notify();
                            }))
                            .child("Close"),
                    ),
            )
            .child(
                div()
                    .flex_1()
                    .min_h_0()
                    .id("thread-message-list")
                    .overflow_y_scroll()
                    .p_5()
                    .children(messages),
            )
            .child(
                div()
                    .h(px(58.0))
                    .flex_none()
                    .flex()
                    .items_center()
                    .gap_2()
                    .px_5()
                    .border_t_1()
                    .border_color(p.border)
                    .child(thread_action("Archive", MailCommand::Archive, cx, p))
                    .child(thread_action("Trash", MailCommand::Trash, cx, p))
                    .child(thread_action("Unread", MailCommand::MarkUnread, cx, p)),
            )
            .into_any_element()
    }

    fn render_field(
        &self,
        field: InputField,
        label: &str,
        value: &str,
        placeholder: &str,
        cx: &mut Context<Self>,
        p: Palette,
        multiline: bool,
    ) -> AnyElement {
        let active = self.focused_field == Some(field);
        let label = label.to_string();
        let field_id = label.clone();
        let value_or_placeholder = if value.is_empty() {
            placeholder.to_string()
        } else {
            value.to_string()
        };
        let height = if multiline { 170.0 } else { 42.0 };
        div()
            .w_full()
            .mb_3()
            .child(
                div()
                    .mb_1()
                    .text_size(px(11.0))
                    .text_color(p.muted)
                    .child(label),
            )
            .child(
                div()
                    .id(SharedString::from(format!("compose-field-{field_id}")))
                    .w_full()
                    .h(px(height))
                    .p_3()
                    .rounded_md()
                    .border_1()
                    .border_color(if active { p.blue } else { p.border })
                    .bg(p.surface)
                    .text_size(px(13.0))
                    .line_height(px(20.0))
                    .text_color(if value.is_empty() { p.faint } else { p.fg })
                    .cursor_pointer()
                    .on_click(
                        cx.listener(move |app, _, window, cx| app.focus_field(field, window, cx)),
                    )
                    .child(value_or_placeholder),
            )
            .into_any_element()
    }

    fn render_compose(&self, cx: &mut Context<Self>, p: Palette) -> AnyElement {
        div()
            .flex_1()
            .min_w_0()
            .h_full()
            .flex()
            .flex_col()
            .border_l_1()
            .border_color(p.border)
            .bg(p.bg)
            .child(
                div()
                    .h(px(62.0))
                    .flex_none()
                    .flex()
                    .items_center()
                    .justify_between()
                    .px_5()
                    .border_b_1()
                    .border_color(p.border)
                    .child(
                        div()
                            .font_family("Lora")
                            .text_size(px(16.0))
                            .text_color(p.fg)
                            .child("New message"),
                    )
                    .child(
                        div()
                            .px_2()
                            .py_1()
                            .rounded_md()
                            .text_size(px(11.0))
                            .text_color(p.muted)
                            .cursor_pointer()
                            .hover(|style| style.bg(p.control_hover))
                            .id("close-compose")
                            .on_click(cx.listener(Self::close_compose))
                            .child("Close"),
                    ),
            )
            .child(
                div()
                    .flex_1()
                    .min_h_0()
                    .id("compose-fields")
                    .overflow_y_scroll()
                    .p_5()
                    .child(self.render_field(
                        InputField::To,
                        "To",
                        &self.compose_to,
                        "name@example.com",
                        cx,
                        p,
                        false,
                    ))
                    .child(self.render_field(
                        InputField::Cc,
                        "Cc",
                        &self.compose_cc,
                        "Optional",
                        cx,
                        p,
                        false,
                    ))
                    .child(self.render_field(
                        InputField::Bcc,
                        "Bcc",
                        &self.compose_bcc,
                        "Optional",
                        cx,
                        p,
                        false,
                    ))
                    .child(self.render_field(
                        InputField::Subject,
                        "Subject",
                        &self.compose_subject,
                        "No subject",
                        cx,
                        p,
                        false,
                    ))
                    .child(self.render_field(
                        InputField::Body,
                        "Message",
                        &self.compose_body,
                        "Write something worth sending",
                        cx,
                        p,
                        true,
                    )),
            )
            .child(
                div()
                    .h(px(64.0))
                    .flex_none()
                    .flex()
                    .items_center()
                    .justify_between()
                    .px_5()
                    .border_t_1()
                    .border_color(p.border)
                    .child(
                        div()
                            .text_size(px(11.0))
                            .text_color(p.faint)
                            .child("Sent through your connected mailbox"),
                    )
                    .child(
                        div()
                            .px_4()
                            .py_2()
                            .rounded_md()
                            .bg(p.primary)
                            .text_color(p.primary_fg)
                            .text_size(px(12.0))
                            .cursor_pointer()
                            .id("send-message")
                            .on_click(cx.listener(Self::send_message))
                            .child("Send"),
                    ),
            )
            .into_any_element()
    }
}

impl Focusable for QuieterDesktop {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus_handle.clone()
    }
}

impl Render for QuieterDesktop {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let p = palette(self.theme);
        let root = div()
            .id("quieter-desktop")
            .size_full()
            .flex()
            .flex_col()
            .bg(p.bg)
            .text_color(p.fg)
            .font_family("Geist")
            .track_focus(&self.focus_handle)
            .on_key_down(cx.listener(Self::on_key_down));
        if self.auth_token.is_none() {
            root.child(self.render_login(cx))
        } else {
            root.child(
                div()
                    .flex_1()
                    .min_h_0()
                    .flex()
                    .child(self.render_sidebar(cx, p))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .h_full()
                            .flex()
                            .child(self.render_content(cx, p)),
                    ),
            )
        }
    }
}

fn thread_action(
    label: &'static str,
    command: MailCommand,
    cx: &mut Context<QuieterDesktop>,
    p: Palette,
) -> AnyElement {
    div()
        .px_2()
        .py_1()
        .rounded_md()
        .text_size(px(11.0))
        .text_color(p.muted)
        .cursor_pointer()
        .hover(|style| style.bg(p.control_hover))
        .id(SharedString::from(format!("thread-action-{label}")))
        .on_click(
            cx.listener(move |app, event, window, cx| app.run_command(command, event, window, cx)),
        )
        .child(label)
        .into_any_element()
}

fn unique_threads(messages: Vec<MessageListItem>) -> Vec<MessageListItem> {
    let mut seen = HashSet::new();
    messages
        .into_iter()
        .filter(|message| seen.insert(message.thread_id.clone()))
        .collect()
}

fn sender_email(raw: Option<&str>) -> String {
    raw.and_then(|value| value.split_once('<'))
        .and_then(|(_, value)| value.split_once('>'))
        .map(|(value, _)| value.trim().to_string())
        .unwrap_or_default()
}

fn sender_badge(sender: &str) -> String {
    let sender = sender.to_ascii_lowercase();
    if sender.contains("stripe") {
        "S".to_string()
    } else if sender.contains("github") {
        "◌".to_string()
    } else if sender.contains("linear") {
        "L".to_string()
    } else if sender.contains("figma") || sender.contains("theo") {
        "F".to_string()
    } else if sender.contains("vercel") {
        "▲".to_string()
    } else if sender.contains("slack") {
        "✣".to_string()
    } else if sender.contains("openai") {
        "◎".to_string()
    } else if sender.contains("shopify") {
        "S".to_string()
    } else if sender.contains("airtable") {
        "A".to_string()
    } else if sender.contains("dropbox") {
        "◆".to_string()
    } else if sender.contains("zoom") {
        "▰".to_string()
    } else if sender.contains("anthropic") {
        "A".to_string()
    } else {
        sender
            .chars()
            .next()
            .unwrap_or('?')
            .to_ascii_uppercase()
            .to_string()
    }
}

fn sender_badge_color(sender: &str, p: Palette) -> Hsla {
    let sender = sender.to_ascii_lowercase();
    if sender.contains("stripe") {
        p.purple
    } else if sender.contains("github") {
        p.control_active
    } else if sender.contains("linear") {
        p.faint
    } else if sender.contains("figma") || sender.contains("theo") {
        p.red
    } else if sender.contains("vercel") {
        p.fg
    } else if sender.contains("slack") {
        p.yellow
    } else if sender.contains("openai") {
        p.fg
    } else if sender.contains("shopify") {
        p.green
    } else if sender.contains("airtable") {
        p.blue
    } else if sender.contains("dropbox") || sender.contains("zoom") {
        p.blue
    } else {
        p.control_active
    }
}

fn message_tag(sender: &str) -> &'static str {
    let sender = sender.to_ascii_lowercase();
    if sender.contains("stripe") || sender.contains("openai") {
        "Finance"
    } else if sender.contains("airtable") || sender.contains("dropbox") || sender.contains("zoom") {
        "Clients"
    } else if sender.contains("github")
        || sender.contains("linear")
        || sender.contains("figma")
        || sender.contains("theo")
        || sender.contains("vercel")
        || sender.contains("slack")
    {
        "Product"
    } else {
        ""
    }
}

fn sender_label(raw: Option<&str>) -> String {
    let raw = raw.unwrap_or("Unknown sender").trim();
    let display = raw
        .split('<')
        .next()
        .unwrap_or(raw)
        .trim()
        .trim_matches('"');
    if display.is_empty() {
        raw.to_string()
    } else {
        display.to_string()
    }
}

fn format_date(raw: Option<&str>) -> String {
    let raw = raw.unwrap_or_default().trim();
    if raw.is_empty() {
        return "".to_string();
    }
    if let Ok(milliseconds) = raw.parse::<i64>() {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis() as i64)
            .unwrap_or(milliseconds);
        let age = now.saturating_sub(milliseconds);
        let days = age / 86_400_000;
        return match days {
            0 => {
                let seconds_since_midnight = milliseconds.div_euclid(1_000).rem_euclid(86_400);
                let hour = seconds_since_midnight / 3_600;
                let minute = (seconds_since_midnight % 3_600) / 60;
                let suffix = if hour < 12 { "AM" } else { "PM" };
                let display_hour = match hour % 12 {
                    0 => 12,
                    hour => hour,
                };
                format!("{display_hour}:{minute:02} {suffix}")
            }
            1 => "Yesterday".to_string(),
            days if days < 7 => format!("{days}d ago"),
            _ => "Earlier".to_string(),
        };
    }
    raw.split(',').next().unwrap_or(raw).trim().to_string()
}

fn server_url() -> String {
    if let Ok(url) = std::env::var("QUIETER_DESKTOP_URL") {
        return url;
    }
    if cfg!(debug_assertions) {
        "http://localhost:3000".to_string()
    } else {
        "https://quieter.email".to_string()
    }
}

fn main() {
    let api = match ApiClient::new(&server_url()) {
        Ok(api) => api,
        Err(error) => {
            eprintln!("Could not start quieter desktop: {error}");
            return;
        }
    };

    Application::new().run(move |cx: &mut App| {
        let bounds = Bounds::centered(None, size(px(1360.0), px(860.0)), cx);
        let window = cx
            .open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(bounds)),
                    titlebar: Some(gpui::TitlebarOptions {
                        title: Some("quieter".into()),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
                |_, cx| cx.new(|cx| QuieterDesktop::new(api.clone(), cx)),
            )
            .expect("could not open the quieter desktop window");
        window
            .update(cx, |view, window, cx| {
                view.initialize(cx);
                window.focus(&view.focus_handle);
            })
            .expect("could not initialize the quieter desktop window");
        cx.activate(true);
    });
}
