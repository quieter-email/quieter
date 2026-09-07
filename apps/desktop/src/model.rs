use serde::Deserialize;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailboxList {
    pub default_mailbox_id: Option<String>,
    pub groups: Vec<MailboxGroup>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailboxGroup {
    pub id: String,
    pub name: String,
    pub mailboxes: Vec<Mailbox>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mailbox {
    pub id: String,
    pub display_name: Option<String>,
    pub email_address: String,
    #[serde(default)]
    pub unread_non_spam_count: u32,
    pub connection_status: String,
}

impl Mailbox {
    pub fn label(&self) -> &str {
        self.display_name
            .as_deref()
            .filter(|name| !name.trim().is_empty())
            .unwrap_or(&self.email_address)
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadList {
    pub messages: Vec<MessageSummary>,
    pub next_page_token: Option<String>,
    pub result_size_estimate: Option<u32>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageSummary {
    pub id: String,
    pub thread_id: String,
    #[serde(default)]
    pub snippet: Option<String>,
    #[serde(default)]
    pub subject: Option<String>,
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub to: Option<String>,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub internal_date: Option<String>,
    #[serde(default)]
    pub is_unread: bool,
    #[serde(default)]
    pub thread_message_count: Option<u32>,
    #[serde(default)]
    pub label_ids: Vec<String>,
    #[serde(default)]
    pub thread_label_ids: Vec<String>,
}

impl MessageSummary {
    pub fn sender(&self) -> &str {
        self.from
            .as_deref()
            .filter(|sender| !sender.trim().is_empty())
            .unwrap_or("Unknown sender")
    }

    pub fn subject(&self) -> &str {
        self.subject
            .as_deref()
            .filter(|subject| !subject.trim().is_empty())
            .unwrap_or("(No subject)")
    }

    pub fn preview(&self) -> &str {
        self.snippet.as_deref().unwrap_or("")
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadDetail {
    pub thread_id: String,
    #[serde(default)]
    pub snippet: Option<String>,
    #[serde(default)]
    pub subject: Option<String>,
    pub messages: Vec<MessageDetail>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageDetail {
    pub id: String,
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub to: Option<String>,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub subject: Option<String>,
    #[serde(default)]
    pub body_text: Option<String>,
    #[serde(default)]
    pub snippet: Option<String>,
    #[serde(default)]
    pub is_unread: bool,
}

impl MessageDetail {
    pub fn body(&self) -> &str {
        self.body_text
            .as_deref()
            .filter(|body| !body.trim().is_empty())
            .or(self.snippet.as_deref())
            .unwrap_or("This message has no plain-text body.")
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MailCategory {
    Inbox,
    Unread,
    Archive,
    Sent,
    Drafts,
    Trash,
    Spam,
}

impl MailCategory {
    pub const ALL: [Self; 7] = [
        Self::Inbox,
        Self::Unread,
        Self::Archive,
        Self::Sent,
        Self::Drafts,
        Self::Trash,
        Self::Spam,
    ];

    pub const fn api_value(self) -> &'static str {
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

    pub const fn label(self) -> &'static str {
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

    pub const fn icon_path(self) -> &'static str {
        match self {
            Self::Inbox | Self::Unread => "icons/inbox.svg",
            Self::Archive => "icons/archive.svg",
            Self::Sent => "icons/send.svg",
            Self::Drafts => "icons/edit.svg",
            Self::Trash => "icons/trash.svg",
            Self::Spam => "icons/spam.svg",
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub enum ThreadCommand {
    Archive,
    MoveToInbox,
    MarkRead,
    MarkUnread,
    Spam,
    Trash,
}

impl ThreadCommand {
    pub const fn completion_message(self) -> &'static str {
        match self {
            Self::Archive => "Conversation archived",
            Self::MoveToInbox => "Conversation moved to Inbox",
            Self::MarkRead => "Conversation marked read",
            Self::MarkUnread => "Conversation marked unread",
            Self::Spam => "Conversation marked as spam",
            Self::Trash => "Conversation moved to Trash",
        }
    }
}

pub fn preview_mailboxes() -> MailboxList {
    MailboxList {
        default_mailbox_id: Some("preview-primary".to_owned()),
        groups: vec![MailboxGroup {
            id: "preview-personal".to_owned(),
            name: "Personal".to_owned(),
            mailboxes: vec![Mailbox {
                id: "preview-primary".to_owned(),
                display_name: Some("Leander".to_owned()),
                email_address: "hello@quieter.email".to_owned(),
                unread_non_spam_count: 4,
                connection_status: "connected".to_owned(),
            }],
        }],
    }
}

pub fn preview_threads() -> Vec<MessageSummary> {
    [
        (
            "Linear",
            "A calmer way to review your team's week",
            "Your weekly digest is ready. Twelve issues moved forward and three decisions need your attention.",
            "10:42",
            true,
            3,
        ),
        (
            "Maya Chen",
            "Re: Product direction for September",
            "The quieter default feels right. I left two notes on the interaction details and one thought about search.",
            "09:18",
            true,
            5,
        ),
        (
            "Notion",
            "Leander mentioned you in Launch notes",
            "We should keep the transition almost imperceptible and let the content carry the hierarchy.",
            "Yesterday",
            false,
            1,
        ),
        (
            "Raycast",
            "Your August product update",
            "New extensions, faster navigation, and a closer look at what the team has been building.",
            "Yesterday",
            false,
            1,
        ),
        (
            "Ari D.",
            "Coffee next week?",
            "Tuesday afternoon works for me. There is a small place around the corner from the studio.",
            "Fri",
            false,
            2,
        ),
        (
            "Vercel",
            "Deployment completed",
            "quieter-web-production was deployed successfully and is now serving traffic.",
            "Thu",
            false,
            1,
        ),
        (
            "Stripe",
            "Your July 2026 summary",
            "A summary of your balance, payouts, and recent account activity is now available.",
            "Wed",
            false,
            1,
        ),
    ]
    .into_iter()
    .enumerate()
    .map(
        |(index, (from, subject, snippet, date, is_unread, thread_message_count))| {
            MessageSummary {
                id: format!("preview-message-{index}"),
                thread_id: format!("preview-thread-{index}"),
                snippet: Some(snippet.to_owned()),
                subject: Some(subject.to_owned()),
                from: Some(from.to_owned()),
                to: Some("hello@quieter.email".to_owned()),
                date: Some(date.to_owned()),
                internal_date: None,
                is_unread,
                thread_message_count: Some(thread_message_count),
                label_ids: vec!["INBOX".to_owned()],
                thread_label_ids: vec!["INBOX".to_owned()],
            }
        },
    )
    .collect()
}

pub fn preview_thread(summary: &MessageSummary) -> ThreadDetail {
    ThreadDetail {
        thread_id: summary.thread_id.clone(),
        snippet: summary.snippet.clone(),
        subject: summary.subject.clone(),
        messages: vec![MessageDetail {
            id: summary.id.clone(),
            from: summary.from.clone(),
            to: summary.to.clone(),
            date: summary.date.clone(),
            subject: summary.subject.clone(),
            body_text: Some(format!(
                "Hi Leander,\n\n{}\n\nI pulled the important details into one place so you can review them without breaking focus. Let me know what you think when you have a moment.\n\nBest,\n{}",
                summary.preview(),
                summary.sender()
            )),
            snippet: summary.snippet.clone(),
            is_unread: false,
        }],
    }
}
