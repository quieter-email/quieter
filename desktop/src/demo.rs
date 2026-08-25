use crate::api::{MessageAttachment, MessageListItem, ThreadMessagesResult};

pub const DEMO_MAILBOX_ID: &str = "demo:mailbox";

#[derive(Clone)]
struct DemoEntry {
    category: String,
    message: MessageListItem,
}

pub struct DemoStore {
    entries: Vec<DemoEntry>,
    next_sent_id: u32,
}

impl DemoStore {
    pub fn new() -> Self {
        let entries = vec![
            message(
                "inbox",
                "demo-stripe-1",
                "demo-stripe",
                "Stripe <notifications@stripe.com>",
                "April payout reconciliation",
                "Your April payout is ready to reconcile. The attached CSV includes the line items for the month.",
                60 * 60 * 1_000,
                true,
                Some("april-payouts.csv"),
            ),
            message(
                "inbox",
                "demo-github-1",
                "demo-github",
                "GitHub <notifications@github.com>",
                "[quieter] web / typecheck failed",
                "The web check failed on the latest preview. The attached log points to the typecheck step that needs attention.",
                2 * 60 * 60 * 1_000,
                true,
                Some("ci-failure-log.txt"),
            ),
            message(
                "inbox",
                "demo-linear-1",
                "demo-linear",
                "Linear <notifications@linear.app>",
                "Mentioned in QTR-312 Demo mode fixture coverage",
                "You were mentioned in the demo mode fixture coverage issue. The remaining checks are ready for review.",
                4 * 60 * 60 * 1_000,
                true,
                None,
            ),
            message(
                "inbox",
                "demo-figma-3",
                "demo-figma",
                "Theo Byte <theo@figma.com>",
                "Re: Onboarding checklist draft",
                "The latest comments are in the onboarding checklist draft. I left the screenshots attached so the final pass has the same reference point.",
                24 * 60 * 60 * 1_000,
                false,
                Some("onboarding-screenshots.zip"),
            ),
            message(
                "inbox",
                "demo-figma-2",
                "demo-figma",
                "You <you@quieter.email>",
                "Onboarding checklist draft",
                "I added the first pass of the checklist here so the final comments stay together in one conversation.",
                2 * 24 * 60 * 60 * 1_000,
                false,
                None,
            ),
            message(
                "inbox",
                "demo-figma-1",
                "demo-figma",
                "Mara Chen <mara@example.com>",
                "Onboarding checklist draft",
                "Could you take a look at the onboarding checklist before tomorrow’s review?",
                3 * 24 * 60 * 60 * 1_000,
                false,
                None,
            ),
            message(
                "inbox",
                "demo-vercel-1",
                "demo-vercel",
                "Vercel <notifications@vercel.com>",
                "Preview deployment ready",
                "The latest quieter preview deployment is ready. Open it when you have a moment to review the new mailbox surface.",
                28 * 60 * 60 * 1_000,
                false,
                None,
            ),
            message(
                "inbox",
                "demo-slack-1",
                "demo-slack",
                "Slack <notifications@slack.com>",
                "New mentions in #product",
                "There are new mentions waiting in the product channel. This preview keeps them in the same focused inbox as the rest of your work.",
                3 * 24 * 60 * 60 * 1_000,
                false,
                None,
            ),
            message(
                "inbox",
                "demo-openai-1",
                "demo-openai",
                "OpenAI <support@openai.com>",
                "Weekly usage summary",
                "Here is the weekly usage summary for your workspace. The attached PDF contains the detail behind the totals.",
                6 * 24 * 60 * 60 * 1_000,
                false,
                Some("usage-summary.pdf"),
            ),
            message(
                "inbox",
                "demo-shopify-1",
                "demo-shopify",
                "Shopify <orders@shopify.com>",
                "Your test order shipped",
                "Your test order is on its way. Tracking details are available from the order page.",
                7 * 24 * 60 * 60 * 1_000,
                false,
                None,
            ),
            message(
                "inbox",
                "demo-airtable-1",
                "demo-airtable",
                "Nova Reed <nova@airtable.com>",
                "Pilot account research export",
                "The pilot account research export is ready. I included the workbook so you can filter the responses locally.",
                8 * 24 * 60 * 60 * 1_000,
                false,
                Some("research-export.xlsx"),
            ),
            message(
                "inbox",
                "demo-dropbox-1",
                "demo-dropbox",
                "Dropbox <no-reply@dropbox.com>",
                "Q2 launch folder shared with you",
                "A folder was shared with you for the Q2 launch materials.",
                9 * 24 * 60 * 60 * 1_000,
                false,
                None,
            ),
            message(
                "inbox",
                "demo-zoom-1",
                "demo-zoom",
                "Zoom <no-reply@zoom.us>",
                "Call recording: Rabbit Hole Labs sync",
                "The recording and transcript from the customer sync are ready to review.",
                10 * 24 * 60 * 60 * 1_000,
                false,
                Some("customer-call-transcript.vtt"),
            ),
            message(
                "inbox",
                "demo-anthropic-1",
                "demo-anthropic",
                "Anthropic <notifications@anthropic.com>",
                "Workspace security report",
                "Your workspace security report is ready. No action is required for this preview account.",
                11 * 24 * 60 * 60 * 1_000,
                false,
                None,
            ),
            message(
                "archive",
                "demo-archive-1",
                "demo-archive",
                "Taylor Morgan <taylor@example.com>",
                "Notes from the spring planning session",
                "Keeping this here for reference. The decisions still hold, but the immediate work has moved into the launch thread.",
                18 * 24 * 60 * 60 * 1_000,
                false,
                None,
            ),
            message(
                "sent",
                "demo-sent-1",
                "demo-sent",
                "You <you@quieter.email>",
                "Follow-up on the desktop experiment",
                "Thanks for taking a look. I will fold the workflow notes into the next pass and keep the browser handoff available.",
                2 * 24 * 60 * 60 * 1_000,
                false,
                None,
            ),
            message(
                "drafts",
                "demo-draft-1",
                "demo-draft",
                "You <you@quieter.email>",
                "A note I still want to send",
                "I am keeping this draft around as a small example of the compose flow.",
                3 * 24 * 60 * 60 * 1_000,
                false,
                None,
            ),
            message(
                "trash",
                "demo-trash-1",
                "demo-trash",
                "A noisy newsletter <news@example.com>",
                "A very long product announcement",
                "This message was moved out of the way so the inbox can stay focused.",
                7 * 24 * 60 * 60 * 1_000,
                false,
                None,
            ),
            message(
                "spam",
                "demo-spam-1",
                "demo-spam",
                "Unknown Sender <offers@example.invalid>",
                "You have been selected",
                "This is a harmless preview of the spam category.",
                8 * 24 * 60 * 60 * 1_000,
                true,
                None,
            ),
        ];

        Self {
            entries,
            next_sent_id: 2,
        }
    }

    pub fn list(&self, category: &str, query: &str) -> Vec<MessageListItem> {
        let query = query.trim().to_ascii_lowercase();
        let mut seen_threads = Vec::new();
        let mut messages = Vec::new();

        for entry in &self.entries {
            let category_matches = if category == "unread" {
                entry.message.is_unread && entry.category != "spam" && entry.category != "trash"
            } else {
                entry.category == category
            };
            if !category_matches || !matches_query(&entry.message, &query) {
                continue;
            }
            if seen_threads.contains(&entry.message.thread_id) {
                continue;
            }
            seen_threads.push(entry.message.thread_id.clone());
            let mut message = entry.message.clone();
            message.thread_message_count = Some(
                self.entries
                    .iter()
                    .filter(|candidate| {
                        candidate.category == entry.category
                            && candidate.message.thread_id == entry.message.thread_id
                    })
                    .count() as i64,
            );
            messages.push(message);
        }

        messages
    }

    pub fn thread(&self, thread_id: &str) -> Option<ThreadMessagesResult> {
        let mut messages = self
            .entries
            .iter()
            .filter(|entry| entry.message.thread_id == thread_id)
            .map(|entry| entry.message.clone())
            .collect::<Vec<_>>();
        if messages.is_empty() {
            return None;
        }
        messages.sort_by_key(|message| {
            message
                .internal_date
                .as_deref()
                .and_then(|date| date.parse::<i64>().ok())
                .unwrap_or_default()
        });
        let subject = messages.first().and_then(|message| message.subject.clone());
        Some(ThreadMessagesResult {
            thread_id: thread_id.to_string(),
            subject,
            messages,
        })
    }

    pub fn mark_read(&mut self, thread_id: &str, read: bool) {
        for entry in &mut self.entries {
            if entry.message.thread_id == thread_id {
                entry.message.is_unread = !read;
            }
        }
    }

    pub fn move_thread(&mut self, thread_id: &str, destination: &str) {
        for entry in &mut self.entries {
            if entry.message.thread_id == thread_id {
                entry.category = destination.to_string();
            }
        }
    }

    pub fn send(&mut self, from: &str, to: &str, subject: &str, body: &str) {
        let id = format!("demo-sent-{}", self.next_sent_id);
        self.next_sent_id += 1;
        let sender = if from.trim().is_empty() {
            "You <you@quieter.email>".to_string()
        } else {
            format!("You <{}>", from.trim())
        };
        let body = if to.trim().is_empty() {
            body.to_string()
        } else {
            format!("To: {}\n\n{}", to.trim(), body)
        };
        self.entries.push(message(
            "sent",
            &id,
            &id,
            &sender,
            if subject.trim().is_empty() {
                "(No subject)"
            } else {
                subject.trim()
            },
            &body,
            0,
            false,
            None,
        ));
    }

    pub fn unread_count(&self) -> i64 {
        self.entries
            .iter()
            .filter(|entry| {
                entry.message.is_unread && entry.category != "spam" && entry.category != "trash"
            })
            .count() as i64
    }
}

fn message(
    category: &str,
    id: &str,
    thread_id: &str,
    from: &str,
    subject: &str,
    body: &str,
    age_millis: i64,
    is_unread: bool,
    attachment: Option<&str>,
) -> DemoEntry {
    let date = now_millis().saturating_sub(age_millis).to_string();
    let snippet = body.lines().next().unwrap_or(body);
    DemoEntry {
        category: category.to_string(),
        message: MessageListItem {
            id: id.to_string(),
            thread_id: thread_id.to_string(),
            snippet: Some(snippet.chars().take(140).collect()),
            subject: Some(subject.to_string()),
            from: Some(from.to_string()),
            date: Some(date.clone()),
            internal_date: Some(date),
            body_text: Some(body.to_string()),
            attachments: attachment
                .map(|file_name| {
                    vec![MessageAttachment {
                        file_name: Some(file_name.to_string()),
                    }]
                })
                .unwrap_or_default(),
            thread_message_count: Some(1),
            is_unread,
        },
    }
}

fn matches_query(message: &MessageListItem, query: &str) -> bool {
    if query.is_empty() {
        return true;
    }
    [
        message.from.as_deref().unwrap_or_default(),
        message.subject.as_deref().unwrap_or_default(),
        message.snippet.as_deref().unwrap_or_default(),
        message.body_text.as_deref().unwrap_or_default(),
    ]
    .iter()
    .any(|value| value.to_ascii_lowercase().contains(query))
}

fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_categories_and_searches_without_sharing_web_fixtures() {
        let store = DemoStore::new();
        assert_eq!(store.list("inbox", "").len(), 12);
        assert_eq!(store.list("unread", "").len(), 3);
        assert_eq!(store.list("inbox", "payout").len(), 1);
        assert_eq!(store.list("sent", "").len(), 1);
    }

    #[test]
    fn thread_actions_update_local_preview_state() {
        let mut store = DemoStore::new();
        let thread = store.thread("demo-figma").expect("thread exists");
        assert_eq!(thread.messages.len(), 3);
        store.mark_read("demo-stripe", true);
        assert_eq!(store.list("unread", "").len(), 2);
        store.move_thread("demo-github", "archive");
        assert!(
            store
                .list("archive", "")
                .iter()
                .any(|message| message.thread_id == "demo-github")
        );
        store.send("you@quieter.email", "friend@example.com", "Hello", "A test");
        assert_eq!(store.list("sent", "").len(), 2);
    }
}
