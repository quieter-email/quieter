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
    pub display_name: Option<String>,
    pub email_address: String,
    #[serde(default)]
    pub unread_non_spam_count: u32,
    pub connection_status: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailboxLabel {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    #[serde(rename = "type")]
    pub kind: String,
    pub position: Option<u32>,
    pub visible: Option<bool>,
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
    pub thread_attachment_count: Option<u32>,
    #[serde(default)]
    pub label_ids: Vec<String>,
    #[serde(default)]
    pub thread_label_ids: Vec<String>,
}

impl MessageSummary {
    pub fn set_unread(&mut self, unread: bool) {
        self.is_unread = unread;
        for labels in [&mut self.label_ids, &mut self.thread_label_ids] {
            labels.retain(|label| label != "UNREAD");
            if unread {
                labels.push("UNREAD".to_owned());
            }
        }
    }
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

pub struct ReplyDraft {
    pub recipient: String,
    pub subject: String,
    pub context: ReplyContext,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MailboxRequestScope {
    pub session_generation: u64,
    pub view_generation: u64,
    pub mailbox_id: Option<String>,
}

pub struct ThreadActionRollback {
    pub scope: MailboxRequestScope,
    pub message: Option<(usize, MessageSummary)>,
    pub detail: Option<ThreadDetail>,
    pub thread_id: String,
    pub detail_generation: u64,
}

impl ThreadActionRollback {
    pub fn restore(
        self,
        current_scope: &MailboxRequestScope,
        current_detail_generation: u64,
        threads: &mut Vec<MessageSummary>,
        selected_thread_id: &mut Option<String>,
        thread_detail: &mut Option<ThreadDetail>,
    ) -> bool {
        if self.scope != *current_scope {
            return false;
        }
        if let Some((index, message)) = self.message {
            threads.retain(|entry| entry.thread_id != message.thread_id);
            threads.insert(index.min(threads.len()), message);
        }
        if self.detail_generation == current_detail_generation {
            *thread_detail = self.detail;
            *selected_thread_id = Some(self.thread_id);
        }
        true
    }
}

impl ThreadDetail {
    pub fn reply_draft(&self, own_address: &str) -> Option<ReplyDraft> {
        let source = self.messages.last()?;
        let mut recipients = reply_addresses(source.reply_to.as_deref(), own_address);
        if recipients.is_empty() {
            let sender_is_owned = reply_addresses(source.from.as_deref(), "")
                .iter()
                .any(|address| address.eq_ignore_ascii_case(own_address));
            recipients = reply_addresses(
                if sender_is_owned {
                    source.to.as_deref()
                } else {
                    source.from.as_deref()
                },
                own_address,
            );
        }
        if recipients.is_empty() {
            recipients = reply_addresses(source.to.as_deref(), own_address);
        }
        let subject = source
            .subject
            .as_deref()
            .or(self.subject.as_deref())
            .unwrap_or("")
            .trim();
        let subject = if subject.to_lowercase().starts_with("re:") {
            subject.to_owned()
        } else if subject.is_empty() {
            "Re:".to_owned()
        } else {
            format!("Re: {subject}")
        };
        let message_header_id = source
            .message_header_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned);
        let mut references: Vec<String> = source
            .references
            .as_deref()
            .unwrap_or("")
            .split('<')
            .skip(1)
            .filter_map(|part| part.split_once('>').map(|(id, _)| format!("<{id}>")))
            .collect();
        if let Some(header_id) = &message_header_id {
            references.push(header_id.clone());
        }
        let mut seen = std::collections::HashSet::new();
        references.retain(|value| seen.insert(value.clone()));
        Some(ReplyDraft {
            recipient: recipients.join(", "),
            subject,
            context: ReplyContext {
                thread_id: self.thread_id.clone(),
                message_header_id,
                references,
            },
        })
    }
}

fn reply_addresses(header: Option<&str>, own_address: &str) -> Vec<String> {
    let Ok(addresses) = mailparse::addrparse(header.unwrap_or("")) else {
        return Vec::new();
    };
    let mut recipients = Vec::new();
    for address in addresses.iter() {
        let entries: &[mailparse::SingleInfo] = match address {
            mailparse::MailAddr::Single(entry) => std::slice::from_ref(entry),
            mailparse::MailAddr::Group(group) => &group.addrs,
        };
        for entry in entries {
            let address = entry.addr.trim_matches([' ', '\t', ',']);
            if !address.eq_ignore_ascii_case(own_address)
                && !recipients
                    .iter()
                    .any(|existing: &String| existing.eq_ignore_ascii_case(address))
            {
                recipients.push(address.to_owned());
            }
        }
    }
    recipients
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
    #[serde(default)]
    pub reply_to: Option<String>,
    #[serde(default)]
    pub message_header_id: Option<String>,
    #[serde(default)]
    pub references: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplyContext {
    pub thread_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_header_id: Option<String>,
    pub references: Vec<String>,
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
        default_mailbox_id: Some("demo:mailbox".to_owned()),
        groups: vec![MailboxGroup {
            id: "demo-team".to_owned(),
            name: "Demo".to_owned(),
            mailboxes: vec![Mailbox {
                id: "demo:mailbox".to_owned(),
                display_name: Some("Demo Mailbox".to_owned()),
                email_address: "inbox@quieter.com".to_owned(),
                unread_non_spam_count: 4,
                connection_status: "connected".to_owned(),
            }],
        }],
    }
}

pub fn preview_threads() -> Vec<MessageSummary> {
    [
        (
            "stripe", "Stripe <notifications@stripe.com>",
            "April payout reconciliation",
            "Your April payout reconciliation is ready. There are two failed transfers that need review before the end of the week.",
            0.08,
            true,
            1,
            "Label_Finance",
        ),
        (
            "github", "GitHub <notifications@github.com>",
            "[quieter] web / typecheck failed",
            "The workflow web / typecheck failed on pull request #184. The failing package is @quieter/web.",
            0.2,
            true,
            1,
            "Label_Product",
        ),
        (
            "linear", "Linear <notifications@linear.app>",
            "Mentioned in QTR-312 Demo mode fixture coverage",
            "Alex mentioned you in QTR-312 Demo mode fixture coverage. Can we include at least one threaded conversation?",
            0.34,
            true,
            1,
            "Label_Product",
        ),
        (
            "onboarding", "Theo Byte <theo@figma.com>",
            "Onboarding checklist draft",
            "I checked the screenshots and replaced the two stale workspace shots. The archive has desktop and mobile exports.",
            0.58,
            true,
            3,
            "Label_Product",
        ),
        (
            "deploy", "Vercel <notifications@vercel.com>",
            "Preview deployment ready",
            "Your preview deployment is ready. quieter-web-git-demo-mode built successfully and is available for review.",
            1.16,
            false,
            1,
            "Label_Product",
        ),
        (
            "slack", "Slack <notifications@slack.com>",
            "New mentions in #product",
            "You have 4 unread mentions in #product. The most recent thread is about the new mailbox switcher behavior.",
            1.8,
            false,
            1,
            "",
        ),
        (
            "openai", "OpenAI <support@openai.com>",
            "Weekly usage summary",
            "Your weekly usage summary is attached. Token volume increased 18% week over week.",
            2.25,
            false,
            1,
            "Label_Finance",
        ),
        (
            "shopify", "Shopify <orders@shopify.com>",
            "Your test order shipped",
            "The Quieter swag test order shipped today. Tracking usually appears within 24 hours.",
            2.9, false, 1, "",
        ),
        (
            "airtable", "Nova Reed <nova@airtable.com>",
            "Pilot account research export",
            "Here is the latest research export from Airtable. I filtered it down to active pilot conversations.",
            3.3, false, 1, "Label_Clients",
        ),
        (
            "dropbox", "Dropbox <no-reply@dropbox.com>",
            "Q2 launch folder shared with you",
            "Milo shared the Q2 launch folder with you. It contains the press screenshots, brand exports, and approvals.",
            4.1, false, 1, "",
        ),
        (
            "zoom", "Zoom <no-reply@zoom.us>",
            "Call recording: Rabbit Hole Labs sync",
            "Your cloud recording is ready. The transcript includes action items from the customer call.",
            4.7, false, 1, "Label_Clients",
        ),
        (
            "anthropic", "Anthropic <notifications@anthropic.com>",
            "Workspace security report",
            "Your workspace security report is ready. No high severity issues were detected in the last 7 days.",
            5.2, false, 1, "",
        ),
    ]
    .into_iter()
    .map(
        |(id, from, subject, snippet, days_ago, is_unread, thread_message_count, label)| {
            let timestamp = chrono::Utc::now() - chrono::Duration::milliseconds((days_ago * 86_400_000.0) as i64);
            let mut label_ids = vec!["INBOX".to_owned()];
            if is_unread { label_ids.push("UNREAD".to_owned()); }
            if !label.is_empty() { label_ids.push(label.to_owned()); }
            MessageSummary {
                id: format!("demo-{id}-1"),
                thread_id: if id == "onboarding" { "demo-thread-onboarding".to_owned() } else { format!("demo-{id}-1") },
                snippet: Some(snippet.to_owned()),
                subject: Some(subject.to_owned()),
                from: Some(from.to_owned()),
                to: Some("inbox@quieter.com".to_owned()),
                date: Some(timestamp.to_rfc3339()),
                internal_date: Some(timestamp.timestamp_millis().to_string()),
                is_unread,
                thread_message_count: Some(thread_message_count),
                thread_attachment_count: match id {
                    "stripe" | "github" | "onboarding" | "openai" | "airtable" | "zoom" => Some(1),
                    _ => None,
                },
                label_ids: label_ids.clone(),
                thread_label_ids: label_ids,
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
            body_text: Some(match summary.id.as_str() {
                "demo-stripe-1" => "Your April payout reconciliation is ready.\n\nThere are two failed transfers that need review before the end of the week. The CSV includes the payout IDs, transfer amounts, and current retry status.",
                "demo-github-1" => "The workflow web / typecheck failed on pull request #184.\n\nThe failing package is @quieter/web. The attached log includes the full compiler output.",
                "demo-linear-1" => "Alex mentioned you in QTR-312 Demo mode fixture coverage.\n\nCan we include at least one threaded conversation, a couple of attachments, and a sent reply so the walkthrough feels realistic?",
                _ => summary.preview(),
            }.to_owned()),
            snippet: summary.snippet.clone(),
            is_unread: false,
            reply_to: None,
            message_header_id: None,
            references: None,
        }],
    }
}

pub fn preview_labels() -> Vec<MailboxLabel> {
    [
        ("Clients", "cyan"),
        ("Finance", "green"),
        ("Product", "purple"),
    ]
    .into_iter()
    .enumerate()
    .map(|(position, (name, color))| MailboxLabel {
        id: format!("Label_{name}"),
        name: name.to_owned(),
        color: Some(color.to_owned()),
        kind: "user".to_owned(),
        position: Some(position as u32),
        visible: Some(true),
    })
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thread_summaries_preserve_server_attachment_counts() {
        let summary: MessageSummary = serde_json::from_value(serde_json::json!({
            "id": "message-1",
            "threadId": "thread-1",
            "threadMessageCount": 5,
            "threadAttachmentCount": 3
        }))
        .unwrap();
        assert_eq!(summary.thread_message_count, Some(5));
        assert_eq!(summary.thread_attachment_count, Some(3));

        let omitted: MessageSummary = serde_json::from_value(serde_json::json!({
            "id": "message-2",
            "threadId": "thread-2"
        }))
        .unwrap();
        assert_eq!(omitted.thread_attachment_count, None);

        let zero: MessageSummary = serde_json::from_value(serde_json::json!({
            "id": "message-3",
            "threadId": "thread-3",
            "threadAttachmentCount": 0
        }))
        .unwrap();
        assert_eq!(zero.thread_attachment_count, Some(0));
    }

    #[test]
    fn replies_follow_reply_to_and_never_match_display_names_as_owned_addresses() {
        let summary = preview_threads().remove(0);
        let mut detail = preview_thread(&summary);
        let message = &mut detail.messages[0];
        message.from = Some("\"me@example.com\" <other@example.com>".to_owned());
        message.reply_to = Some("\"Doe, Jane\" <jane@example.com>, ME@example.com".to_owned());
        message.message_header_id = Some("<current@example.com>".to_owned());
        message.references = Some("<prior@example.com> <prior@example.com>".to_owned());
        let draft = detail.reply_draft("me@example.com").unwrap();
        assert_eq!(draft.recipient, "jane@example.com");
        assert_eq!(
            draft.context.references,
            ["<prior@example.com>", "<current@example.com>"]
        );
        detail.messages[0].reply_to = None;
        assert_eq!(
            detail.reply_draft("me@example.com").unwrap().recipient,
            "other@example.com"
        );
    }

    #[test]
    fn replying_to_own_sent_message_uses_original_recipients() {
        let summary = preview_threads().remove(0);
        let mut detail = preview_thread(&summary);
        detail.messages[0].from = Some("Quieter <ME@example.com>".to_owned());
        detail.messages[0].to = Some(
            "Team: Jane <jane@example.com>, Lee <lee@example.com>;, me@example.com".to_owned(),
        );
        detail.messages[0].subject = Some("Re: Review".to_owned());
        let draft = detail.reply_draft("me@example.com").unwrap();
        assert_eq!(draft.recipient, "jane@example.com, lee@example.com");
        assert_eq!(draft.subject, "Re: Review");
        assert_eq!(draft.context.thread_id, detail.thread_id);
    }

    #[test]
    fn failed_actions_cannot_restore_mail_after_switching_or_signing_out() {
        let message = preview_threads().remove(0);
        let scope = MailboxRequestScope {
            session_generation: 1,
            view_generation: 2,
            mailbox_id: Some("mailbox-a".to_owned()),
        };
        for current_scope in [
            MailboxRequestScope {
                session_generation: 2,
                ..scope.clone()
            },
            MailboxRequestScope {
                mailbox_id: Some("mailbox-b".to_owned()),
                ..scope.clone()
            },
            MailboxRequestScope {
                view_generation: 3,
                ..scope.clone()
            },
        ] {
            let rollback = ThreadActionRollback {
                scope: scope.clone(),
                message: Some((0, message.clone())),
                detail: Some(preview_thread(&message)),
                thread_id: message.thread_id.clone(),
                detail_generation: 1,
            };
            let mut threads = Vec::new();
            let mut selected = None;
            let mut detail = None;
            assert!(!rollback.restore(&current_scope, 1, &mut threads, &mut selected, &mut detail));
            assert!(threads.is_empty());
            assert!(selected.is_none());
            assert!(detail.is_none());
        }
    }

    #[test]
    fn failed_action_rolls_back_only_its_row_and_keeps_new_selection() {
        let mut threads = preview_threads();
        let archived = threads.remove(0);
        threads[0].is_unread = false;
        let newer_thread = threads[0].thread_id.clone();
        let mut selected = Some(newer_thread.clone());
        let mut detail = Some(preview_thread(&threads[0]));
        let scope = MailboxRequestScope {
            session_generation: 1,
            view_generation: 2,
            mailbox_id: Some("mailbox-a".to_owned()),
        };
        let rollback = ThreadActionRollback {
            scope: scope.clone(),
            message: Some((0, archived.clone())),
            detail: Some(preview_thread(&archived)),
            thread_id: archived.thread_id.clone(),
            detail_generation: 1,
        };
        assert!(rollback.restore(&scope, 2, &mut threads, &mut selected, &mut detail));
        assert_eq!(threads[0].thread_id, archived.thread_id);
        assert!(!threads[1].is_unread);
        assert_eq!(selected, Some(newer_thread.clone()));
        assert_eq!(detail.unwrap().thread_id, newer_thread);
    }

    #[test]
    fn read_state_updates_every_unread_representation_and_can_be_rolled_back() {
        let message = preview_threads().remove(0);
        let scope = MailboxRequestScope {
            session_generation: 1,
            view_generation: 1,
            mailbox_id: Some("mailbox-a".to_owned()),
        };
        let rollback = ThreadActionRollback {
            scope: scope.clone(),
            message: Some((0, message.clone())),
            detail: None,
            thread_id: message.thread_id.clone(),
            detail_generation: 1,
        };
        let mut threads = vec![message];
        threads[0].set_unread(false);
        assert!(!threads[0].is_unread);
        assert!(!threads[0].label_ids.iter().any(|label| label == "UNREAD"));
        assert!(
            !threads[0]
                .thread_label_ids
                .iter()
                .any(|label| label == "UNREAD")
        );
        assert!(
            threads[0]
                .label_ids
                .iter()
                .any(|label| label == "Label_Finance")
        );
        rollback.restore(&scope, 1, &mut threads, &mut None, &mut None);
        assert!(threads[0].is_unread);
        for labels in [&threads[0].label_ids, &threads[0].thread_label_ids] {
            assert_eq!(
                labels
                    .iter()
                    .filter(|label| label.as_str() == "UNREAD")
                    .count(),
                1
            );
        }
        threads[0].set_unread(true);
        assert_eq!(
            threads[0]
                .thread_label_ids
                .iter()
                .filter(|label| label.as_str() == "UNREAD")
                .count(),
            1
        );
    }
}
