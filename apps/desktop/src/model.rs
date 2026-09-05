use serde::{Deserialize, Serialize};

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
    pub display_name: String,
    pub email_address: String,
    pub unread_inbox_count: Option<u32>,
    pub connection_status: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadList {
    pub messages: Vec<MessageSummary>,
    pub next_page_token: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageSummary {
    pub id: String,
    pub thread_id: String,
    #[serde(default)]
    pub snippet: String,
    #[serde(default)]
    pub subject: String,
    #[serde(default)]
    pub from: String,
    #[serde(default)]
    pub date: String,
    #[serde(default)]
    pub is_unread: bool,
    #[serde(default)]
    pub thread_message_count: Option<u32>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadDetail {
    pub thread_id: String,
    #[serde(default)]
    pub subject: String,
    pub messages: Vec<MessageDetail>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageDetail {
    pub id: String,
    #[serde(default)]
    pub from: String,
    #[serde(default)]
    pub to: String,
    #[serde(default)]
    pub date: String,
    #[serde(default)]
    pub body_text: String,
    #[serde(default)]
    pub snippet: String,
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
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadAction<'a> {
    pub mailbox_id: &'a str,
    pub thread_id: &'a str,
}

