use std::time::Duration;

use reqwest::blocking::{Client, RequestBuilder};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::json;
use thiserror::Error;
use url::{Host, Url};
use uuid::Uuid;

use crate::model::{
    MailCategory, MailboxLabel, MailboxList, ReplyContext, ThreadCommand, ThreadDetail, ThreadList,
};

const DESKTOP_CLIENT_ID: &str = "quieter-desktop";

#[derive(Clone)]
pub struct ApiClient {
    base_url: String,
    client: Client,
    token: Option<String>,
}

#[derive(Debug, Error)]
pub enum ApiError {
    #[error("The server could not be reached.")]
    Transport(#[from] reqwest::Error),
    #[error("Your desktop session has expired.")]
    Unauthorized,
    #[error("Authorization is still pending.")]
    AuthorizationPending,
    #[error("The server asked the desktop app to poll more slowly.")]
    SlowDown,
    #[error("This authorization code has expired.")]
    DeviceCodeExpired,
    #[error("Desktop authorization was declined.")]
    AccessDenied,
    #[error("{message}")]
    Server { status: u16, message: String },
    #[error("The server returned an invalid response. Please try again.")]
    InvalidResponse,
}

#[derive(Clone, Debug, Deserialize)]
pub struct DeviceCode {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub verification_uri_complete: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, Deserialize)]
pub struct DeviceToken {
    pub access_token: String,
}

#[derive(Serialize)]
struct DeviceCodeRequest<'a> {
    client_id: &'a str,
}

#[derive(Serialize)]
struct DeviceTokenRequest<'a> {
    client_id: &'a str,
    device_code: &'a str,
    grant_type: &'a str,
}

#[derive(Deserialize)]
struct ErrorResponse {
    error: Option<String>,
    error_description: Option<String>,
    message: Option<String>,
}

impl ApiClient {
    pub fn new(token: Option<String>) -> anyhow::Result<Self> {
        let base_url = std::env::var("QUIETER_SERVER_URL").unwrap_or_else(|_| {
            if cfg!(debug_assertions) {
                "http://localhost:3000".to_owned()
            } else {
                "https://quieter.email".to_owned()
            }
        });
        Self::from_base_url(&base_url, token)
    }

    pub fn from_base_url(base_url: &str, token: Option<String>) -> anyhow::Result<Self> {
        let parsed = Url::parse(base_url)?;
        let is_loopback = match parsed.host() {
            Some(Host::Domain(host)) => host == "localhost",
            Some(Host::Ipv4(address)) => address.is_loopback(),
            Some(Host::Ipv6(address)) => address.is_loopback(),
            None => false,
        };
        anyhow::ensure!(
            parsed.scheme() == "https" || (parsed.scheme() == "http" && is_loopback),
            "The server must use HTTPS, except for local development on loopback."
        );
        anyhow::ensure!(
            parsed.username().is_empty()
                && parsed.password().is_none()
                && parsed.path() == "/"
                && parsed.query().is_none()
                && parsed.fragment().is_none(),
            "The server URL must contain only a scheme, host, and optional port."
        );
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent(concat!("QuieterDesktop/", env!("CARGO_PKG_VERSION")))
            .build()?;
        Ok(Self {
            base_url: parsed.origin().ascii_serialization(),
            client,
            token,
        })
    }

    pub fn with_token(&self, token: Option<String>) -> Self {
        Self {
            base_url: self.base_url.clone(),
            client: self.client.clone(),
            token,
        }
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub fn workspace_url(&self, view: &str, mailbox_id: Option<&str>) -> Url {
        let mut url = Url::parse(&self.base_url).expect("validated server origin");
        url.query_pairs_mut().append_pair("view", view);
        if let Some(mailbox_id) = mailbox_id {
            url.query_pairs_mut().append_pair("mailboxId", mailbox_id);
        }
        url
    }

    pub fn request_device_code(&self) -> Result<DeviceCode, ApiError> {
        let code: DeviceCode = self.decode(
            self.client
                .post(format!("{}/api/auth/device/code", self.base_url))
                .json(&DeviceCodeRequest {
                    client_id: DESKTOP_CLIENT_ID,
                }),
        )?;
        for verification_uri in [&code.verification_uri, &code.verification_uri_complete] {
            let url = Url::parse(verification_uri).map_err(|_| ApiError::InvalidResponse)?;
            if url.origin().ascii_serialization() != self.base_url
                || !url.username().is_empty()
                || url.password().is_some()
                || url.path() != "/device"
                || url.fragment().is_some()
            {
                return Err(ApiError::InvalidResponse);
            }
        }
        let complete =
            Url::parse(&code.verification_uri_complete).map_err(|_| ApiError::InvalidResponse)?;
        if code.device_code.is_empty()
            || code.user_code.is_empty()
            || code.expires_in == 0
            || code.expires_in > 86_400
            || !complete
                .query_pairs()
                .any(|(key, value)| key == "user_code" && value == code.user_code)
        {
            return Err(ApiError::InvalidResponse);
        }
        Ok(code)
    }

    pub fn poll_device_token(&self, device_code: &str) -> Result<DeviceToken, ApiError> {
        let token: DeviceToken = self.decode(
            self.client
                .post(format!("{}/api/auth/device/token", self.base_url))
                .json(&DeviceTokenRequest {
                    client_id: DESKTOP_CLIENT_ID,
                    device_code,
                    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
                }),
        )?;
        if token.access_token.trim().is_empty() {
            return Err(ApiError::InvalidResponse);
        }
        Ok(token)
    }

    pub fn list_mailboxes(&self) -> Result<MailboxList, ApiError> {
        self.decode(
            self.authorize(
                self.client
                    .get(format!("{}/api/desktop/mail/listMailboxes", self.base_url)),
            ),
        )
    }

    pub fn list_threads(
        &self,
        mailbox_id: &str,
        category: MailCategory,
        query: Option<&str>,
        page_token: Option<&str>,
    ) -> Result<ThreadList, ApiError> {
        let mut parameters = vec![
            ("mailboxId", mailbox_id),
            ("category", category.api_value()),
        ];
        if let Some(query) = query.filter(|query| !query.is_empty()) {
            parameters.push(("query", query));
        }
        if let Some(page_token) = page_token {
            parameters.push(("pageToken", page_token));
        }
        self.decode(
            self.authorize(
                self.client
                    .get(format!("{}/api/desktop/mail/listThreads", self.base_url))
                    .query(&parameters),
            ),
        )
    }

    pub fn list_labels(&self, mailbox_id: &str) -> Result<Vec<MailboxLabel>, ApiError> {
        self.decode(
            self.authorize(
                self.client
                    .get(format!("{}/api/desktop/mail/listLabels", self.base_url)),
            )
            .query(&[("mailboxId", mailbox_id)]),
        )
    }

    pub fn get_thread(&self, mailbox_id: &str, thread_id: &str) -> Result<ThreadDetail, ApiError> {
        self.decode(
            self.authorize(
                self.client
                    .get(format!("{}/api/desktop/mail/getThread", self.base_url))
                    .query(&[("mailboxId", mailbox_id), ("threadId", thread_id)]),
            ),
        )
    }

    pub fn thread_action(
        &self,
        command: ThreadCommand,
        mailbox_id: &str,
        thread_id: &str,
    ) -> Result<serde_json::Value, ApiError> {
        let (procedure, body) = match command {
            ThreadCommand::Archive => (
                "updateThreadLabels",
                json!({
                    "mailboxId": mailbox_id,
                    "threadId": thread_id,
                    "removeLabelIds": ["INBOX"],
                }),
            ),
            ThreadCommand::MoveToInbox => (
                "updateThreadLabels",
                json!({
                    "mailboxId": mailbox_id,
                    "threadId": thread_id,
                    "addLabelIds": ["INBOX"],
                    "removeLabelIds": ["SPAM", "TRASH"],
                }),
            ),
            ThreadCommand::MarkRead => (
                "markThreadAsRead",
                json!({ "mailboxId": mailbox_id, "threadId": thread_id }),
            ),
            ThreadCommand::MarkUnread => (
                "markThreadAsUnread",
                json!({ "mailboxId": mailbox_id, "threadId": thread_id }),
            ),
            ThreadCommand::Spam => (
                "updateThreadLabels",
                json!({
                    "mailboxId": mailbox_id,
                    "threadId": thread_id,
                    "addLabelIds": ["SPAM"],
                    "removeLabelIds": ["INBOX"],
                }),
            ),
            ThreadCommand::Trash => (
                "moveThreadToTrash",
                json!({ "mailboxId": mailbox_id, "threadId": thread_id }),
            ),
        };

        self.decode(
            self.authorize(
                self.client
                    .post(format!("{}/api/desktop/mail/{procedure}", self.base_url)),
            )
            .json(&body),
        )
    }

    pub fn send_message(
        &self,
        mailbox_id: &str,
        to: &str,
        subject: &str,
        body_text: &str,
        reply_context: Option<&ReplyContext>,
    ) -> Result<serde_json::Value, ApiError> {
        let updated_at = chrono::Utc::now().timestamp_millis();
        self.decode(
            self.authorize(
                self.client
                    .post(format!("{}/api/desktop/mail/sendMessage", self.base_url)),
            )
            .json(&json!({
                "mailboxId": mailbox_id,
                "message": {
                    "attachments": [],
                    "bodyHtml": "",
                    "bodyText": body_text,
                    "inlineImages": [],
                    "localId": Uuid::new_v4().to_string(),
                    "recipients": { "bcc": "", "cc": "", "to": to },
                    "replyContext": reply_context,
                    "saveStatus": "idle",
                    "subject": subject,
                    "updatedAt": updated_at,
                },
            })),
        )
    }

    pub fn sign_out(&self) -> Result<serde_json::Value, ApiError> {
        self.decode(
            self.authorize(
                self.client
                    .post(format!("{}/api/auth/sign-out", self.base_url)),
            )
            .json(&json!({})),
        )
    }

    fn authorize(&self, request: RequestBuilder) -> RequestBuilder {
        if let Some(token) = &self.token {
            request.bearer_auth(token)
        } else {
            request
        }
    }

    fn decode<T: DeserializeOwned>(&self, request: RequestBuilder) -> Result<T, ApiError> {
        let response = request.send()?;
        let status = response.status();
        let body = response.text()?;

        if status.as_u16() == 401 {
            return Err(ApiError::Unauthorized);
        }
        if !status.is_success() {
            let error = serde_json::from_str::<ErrorResponse>(&body).ok();
            match error.as_ref().and_then(|value| value.error.as_deref()) {
                Some("authorization_pending") => return Err(ApiError::AuthorizationPending),
                Some("slow_down") => return Err(ApiError::SlowDown),
                Some("expired_token") => return Err(ApiError::DeviceCodeExpired),
                Some("access_denied") => return Err(ApiError::AccessDenied),
                _ => {}
            }
            let message = if status.is_client_error() {
                error.and_then(|value| value.error_description.or(value.message).or(value.error))
            } else {
                None
            }
            .unwrap_or_else(|| "Something went wrong. Please try again.".to_owned());
            return Err(ApiError::Server {
                status: status.as_u16(),
                message,
            });
        }

        serde_json::from_str(&body).map_err(|_| ApiError::InvalidResponse)
    }
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::mpsc;
    use std::thread;

    use super::*;

    struct MockServer {
        base_url: String,
        request: mpsc::Receiver<String>,
    }

    impl MockServer {
        fn start(status: u16, body: impl FnOnce(&str) -> String + Send + 'static) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let base_url = format!("http://{}", listener.local_addr().unwrap());
            let response_body = body(&base_url);
            let (sender, request) = mpsc::channel();
            thread::spawn(move || {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut bytes = Vec::new();
                let mut buffer = [0; 4096];
                loop {
                    let read = stream.read(&mut buffer).unwrap();
                    if read == 0 {
                        break;
                    }
                    bytes.extend_from_slice(&buffer[..read]);
                    if let Some(boundary) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&bytes[..boundary]);
                        let length = headers
                            .lines()
                            .filter_map(|line| line.split_once(':'))
                            .find(|(name, _)| name.eq_ignore_ascii_case("content-length"))
                            .map(|(_, value)| value.trim().parse::<usize>().unwrap())
                            .unwrap_or(0);
                        if bytes.len() >= boundary + 4 + length {
                            break;
                        }
                    }
                }
                sender.send(String::from_utf8(bytes).unwrap()).unwrap();
                write!(stream, "HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response_body}", response_body.len()).unwrap();
            });
            Self { base_url, request }
        }
    }

    #[test]
    fn browser_workspace_links_preserve_origin_and_encode_mailbox_scope() {
        for origin in ["http://localhost:3000", "https://quieter.email"] {
            let api = ApiClient::from_base_url(origin, Some("private-token".into())).unwrap();
            let url = api.workspace_url("chat", Some("mailbox/a & b"));
            assert_eq!(url.origin().ascii_serialization(), origin);
            assert_eq!(url.path(), "/");
            assert_eq!(
                url.query_pairs().collect::<Vec<_>>(),
                [
                    ("view".into(), "chat".into()),
                    ("mailboxId".into(), "mailbox/a & b".into())
                ]
            );
            assert!(!url.as_str().contains("private-token"));
            assert_eq!(api.workspace_url("inbox", None).query(), Some("view=inbox"));
        }
    }

    #[test]
    fn server_configuration_keeps_credentials_on_secure_origins() {
        for accepted in [
            "https://quieter.email",
            "https://QUIETER.EMAIL:443/",
            "http://localhost:3000",
            "http://127.0.0.1:4000",
            "http://[::1]:3000",
        ] {
            assert!(
                ApiClient::from_base_url(accepted, None).is_ok(),
                "{accepted}"
            );
        }
        for rejected in [
            "http://quieter.email",
            "http://192.168.1.5:3000",
            "https://user:password@quieter.email",
            "https://quieter.email/api",
            "https://quieter.email?token=secret",
            "https://quieter.email/#fragment",
            "file:///tmp/quieter",
            "http://localhost.attacker.test",
        ] {
            assert!(
                ApiClient::from_base_url(rejected, None).is_err(),
                "{rejected}"
            );
        }
        assert_eq!(
            ApiClient::from_base_url("https://QUIETER.EMAIL:443/", None)
                .unwrap()
                .base_url(),
            "https://quieter.email"
        );
        assert_ne!(
            ApiClient::from_base_url("http://localhost:3000", None)
                .unwrap()
                .base_url(),
            ApiClient::from_base_url("https://quieter.email", None)
                .unwrap()
                .base_url()
        );
    }

    #[test]
    fn device_code_only_opens_the_configured_server_and_matching_code() {
        for (verification, accepted) in [
            ("same", true),
            ("https://attacker.test/device", false),
            ("file:///C:/Windows/System32/calc.exe", false),
        ] {
            let server = MockServer::start(200, move |base| {
                let verification = if verification == "same" {
                    format!("{base}/device")
                } else {
                    verification.to_owned()
                };
                json!({ "device_code": "secret-device-code", "user_code": "TEST-CODE", "verification_uri": verification, "verification_uri_complete": format!("{verification}?user_code=TEST-CODE"), "expires_in": 300, "interval": 5 }).to_string()
            });
            let api = ApiClient::from_base_url(&server.base_url, None).unwrap();
            assert_eq!(api.request_device_code().is_ok(), accepted);
            let request = server.request.recv_timeout(Duration::from_secs(5)).unwrap();
            assert!(request.starts_with("POST /api/auth/device/code "));
            assert!(!request.to_lowercase().contains("authorization:"));
        }
    }

    #[test]
    fn device_polling_decodes_protocol_states() {
        for (code, expected) in [
            ("authorization_pending", "pending"),
            ("slow_down", "slow"),
            ("expired_token", "expired"),
            ("access_denied", "denied"),
        ] {
            let server = MockServer::start(400, move |_| {
                json!({ "error": code, "error_description": "Device authorization state" })
                    .to_string()
            });
            let api = ApiClient::from_base_url(&server.base_url, None).unwrap();
            let state = match api.poll_device_token("device-secret") {
                Err(ApiError::AuthorizationPending) => "pending",
                Err(ApiError::SlowDown) => "slow",
                Err(ApiError::DeviceCodeExpired) => "expired",
                Err(ApiError::AccessDenied) => "denied",
                _ => panic!("Unexpected device state"),
            };
            assert_eq!(state, expected);
        }
    }

    #[test]
    fn mailbox_requests_preserve_scoping_and_search_encoding() {
        let server = MockServer::start(200, |_| {
            json!({"messages": [], "nextPageToken": "page-2", "resultSizeEstimate": 72}).to_string()
        });
        let api =
            ApiClient::from_base_url(&server.base_url, Some("test-token".to_owned())).unwrap();
        let page = api
            .list_threads(
                "mailbox/a?b",
                MailCategory::Inbox,
                Some("from:maya@example.com subject:quarter & plan"),
                Some("cursor/next+=page"),
            )
            .unwrap();
        assert_eq!(page.next_page_token.as_deref(), Some("page-2"));
        let request = server.request.recv_timeout(Duration::from_secs(5)).unwrap();
        let path = request
            .lines()
            .next()
            .unwrap()
            .split_whitespace()
            .nth(1)
            .unwrap();
        let url = Url::parse(&format!("{}{path}", server.base_url)).unwrap();
        let parameters = url
            .query_pairs()
            .collect::<std::collections::HashMap<_, _>>();
        assert_eq!(parameters["mailboxId"], "mailbox/a?b");
        assert_eq!(parameters["pageToken"], "cursor/next+=page");
        assert_eq!(
            parameters["query"],
            "from:maya@example.com subject:quarter & plan"
        );
        assert!(
            request
                .to_lowercase()
                .contains("authorization: bearer test-token")
        );
    }

    #[test]
    fn moving_to_inbox_changes_labels_instead_of_only_untrashing() {
        let server = MockServer::start(200, |_| "{}".to_owned());
        let api =
            ApiClient::from_base_url(&server.base_url, Some("test-token".to_owned())).unwrap();
        api.thread_action(ThreadCommand::MoveToInbox, "mailbox-a", "thread-b")
            .unwrap();
        let request = server.request.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(request.starts_with("POST /api/desktop/mail/updateThreadLabels "));
        let body: serde_json::Value =
            serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1).unwrap();
        assert_eq!(body["mailboxId"], "mailbox-a");
        assert_eq!(body["addLabelIds"], json!(["INBOX"]));
        assert_eq!(body["removeLabelIds"], json!(["SPAM", "TRASH"]));
    }

    #[test]
    fn sign_out_sends_json_to_revoke_the_bearer_session() {
        let server = MockServer::start(200, |_| "{\"success\":true}".to_owned());
        let api =
            ApiClient::from_base_url(&server.base_url, Some("test-token".to_owned())).unwrap();
        api.sign_out().unwrap();
        let request = server.request.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(request.starts_with("POST /api/auth/sign-out "));
        assert!(
            request
                .to_lowercase()
                .contains("content-type: application/json")
        );
        assert!(
            request
                .to_lowercase()
                .contains("authorization: bearer test-token")
        );
        assert!(!request.to_lowercase().contains("origin:"));
        assert_eq!(request.split_once("\r\n\r\n").unwrap().1, "{}");
    }

    #[test]
    fn replies_retain_thread_and_message_headers() {
        let server = MockServer::start(200, |_| "{}".to_owned());
        let api =
            ApiClient::from_base_url(&server.base_url, Some("test-token".to_owned())).unwrap();
        let context = ReplyContext {
            thread_id: "thread-b".to_owned(),
            message_header_id: Some("<message@example.com>".to_owned()),
            references: vec!["<prior@example.com>".to_owned()],
        };
        api.send_message(
            "mailbox-a",
            "Maya <maya@example.com>",
            "Re: Review",
            "Looks good.",
            Some(&context),
        )
        .unwrap();
        let request = server.request.recv_timeout(Duration::from_secs(5)).unwrap();
        let body: serde_json::Value =
            serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1).unwrap();
        assert_eq!(body["message"]["replyContext"]["threadId"], "thread-b");
        assert_eq!(
            body["message"]["replyContext"]["messageHeaderId"],
            "<message@example.com>"
        );
        assert_eq!(
            body["message"]["replyContext"]["references"],
            json!(["<prior@example.com>"])
        );
        assert!(
            serde_json::to_value(ReplyContext {
                message_header_id: None,
                ..context
            })
            .unwrap()
            .get("messageHeaderId")
            .is_none()
        );
    }

    #[test]
    fn server_errors_hide_unexpected_details_but_preserve_validation_messages() {
        for (status, expected) in [
            (422, "Add at least one recipient in To."),
            (500, "Something went wrong. Please try again."),
        ] {
            let server = MockServer::start(status, |_| {
                json!({ "message": "Add at least one recipient in To." }).to_string()
            });
            let api = ApiClient::from_base_url(&server.base_url, None).unwrap();
            assert_eq!(api.list_mailboxes().unwrap_err().to_string(), expected);
        }
        let server = MockServer::start(401, |_| "{}".to_owned());
        let api = ApiClient::from_base_url(&server.base_url, None).unwrap();
        assert!(matches!(api.list_mailboxes(), Err(ApiError::Unauthorized)));
    }
}
