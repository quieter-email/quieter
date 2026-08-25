use reqwest::blocking::{Client, RequestBuilder};
use serde::{Deserialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::{fmt, time::Duration};
use url::Url;
use uuid::Uuid;

#[derive(Clone)]
pub struct ApiClient {
    base_url: Url,
    token: Option<String>,
    http: Client,
}

#[derive(Debug, Clone)]
pub struct ApiError {
    pub status: u16,
    pub code: Option<String>,
    pub message: String,
}

impl fmt::Display for ApiError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}", self.message)
    }
}

impl std::error::Error for ApiError {}

#[derive(Debug, Clone, Deserialize)]
pub struct SessionUser {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MailboxResponse {
    #[serde(default)]
    pub default_mailbox_id: Option<String>,
    #[serde(default)]
    pub groups: Vec<MailboxGroup>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MailboxGroup {
    #[serde(default)]
    pub mailboxes: Vec<Mailbox>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Mailbox {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub email_address: Option<String>,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub connection_status: Option<String>,
    #[serde(default)]
    pub unread_non_spam_count: Option<i64>,
    #[serde(default)]
    pub capabilities: Option<MailboxCapabilities>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MailboxCapabilities {
    #[serde(default)]
    pub can_send: bool,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MessageListItem {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub thread_id: String,
    #[serde(default)]
    pub snippet: Option<String>,
    #[serde(default)]
    pub subject: Option<String>,
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default)]
    pub internal_date: Option<String>,
    #[serde(default)]
    pub body_text: Option<String>,
    #[serde(default)]
    pub attachments: Vec<MessageAttachment>,
    #[serde(default)]
    pub thread_message_count: Option<i64>,
    #[serde(default)]
    pub is_unread: bool,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MessageAttachment {
    #[serde(default)]
    pub file_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ThreadMessagesResult {
    #[serde(default)]
    pub thread_id: String,
    #[serde(default)]
    pub subject: Option<String>,
    #[serde(default)]
    pub messages: Vec<MessageListItem>,
}

#[derive(Debug, Clone, Copy)]
pub enum MailCommand {
    Archive,
    Trash,
    MarkRead,
    MarkUnread,
}

impl ApiClient {
    pub fn new(base_url: &str) -> Result<Self, ApiError> {
        let normalized = format!("{}/", base_url.trim_end_matches('/'));
        let base_url = Url::parse(&normalized).map_err(|error| ApiError {
            status: 0,
            code: None,
            message: format!("Invalid server URL: {error}"),
        })?;
        let http = Client::builder()
            .timeout(Duration::from_secs(30))
            .user_agent("quieter-desktop/0.1")
            .build()
            .map_err(|error| ApiError {
                status: 0,
                code: None,
                message: format!("Could not create the network client: {error}"),
            })?;

        Ok(Self {
            base_url,
            token: None,
            http,
        })
    }

    pub fn with_token(&self, token: Option<String>) -> Self {
        Self {
            base_url: self.base_url.clone(),
            token,
            http: self.http.clone(),
        }
    }

    pub fn base_url(&self) -> String {
        self.base_url.as_str().trim_end_matches('/').to_string()
    }

    pub fn keychain_url(&self) -> String {
        format!("{}/desktop", self.base_url())
    }

    pub fn get_session(&self) -> Result<Option<SessionUser>, ApiError> {
        let url = self
            .base_url
            .join("api/auth/get-session")
            .map_err(|error| ApiError {
                status: 0,
                code: None,
                message: format!("Could not build the session URL: {error}"),
            })?;
        let response = self
            .authorized(self.http.get(url))
            .send()
            .map_err(|error| ApiError {
                status: 0,
                code: None,
                message: format!("Could not reach quieter: {error}"),
            })?;
        let status = response.status().as_u16();
        let body: Value = response.json().map_err(|error| ApiError {
            status,
            code: None,
            message: format!("The session response was invalid: {error}"),
        })?;

        if !((200..300).contains(&status)) {
            return Err(Self::error_from_value(status, &body));
        }
        if body.is_null() {
            return Ok(None);
        }

        let session: SessionEnvelope = serde_json::from_value(body).map_err(|error| ApiError {
            status,
            code: None,
            message: format!("The session response was invalid: {error}"),
        })?;
        Ok(Some(session.user))
    }

    pub fn list_mailboxes(&self) -> Result<MailboxResponse, ApiError> {
        self.orpc_get("mail/listMailboxes", Value::Null)
    }

    pub fn list_threads(
        &self,
        mailbox_id: &str,
        category: &str,
        query: &str,
    ) -> Result<MessagePage, ApiError> {
        let mut input = json!({
            "category": category,
            "mailboxId": mailbox_id,
            "maxResults": 40,
        });
        if !query.trim().is_empty() {
            input["query"] = Value::String(query.trim().to_string());
        }
        self.orpc_get("mail/listThreads", input)
    }

    pub fn get_thread(
        &self,
        mailbox_id: &str,
        thread_id: &str,
    ) -> Result<ThreadMessagesResult, ApiError> {
        self.orpc_get(
            "mail/getThread",
            json!({ "mailboxId": mailbox_id, "threadId": thread_id }),
        )
    }

    pub fn apply_command(
        &self,
        mailbox_id: &str,
        thread_id: &str,
        message_ids: &[String],
        command: MailCommand,
    ) -> Result<(), ApiError> {
        let command = match command {
            MailCommand::Archive => json!({ "kind": "move", "destination": "archive" }),
            MailCommand::Trash => json!({ "kind": "move", "destination": "trash" }),
            MailCommand::MarkRead => json!({ "kind": "set-read", "read": true }),
            MailCommand::MarkUnread => json!({ "kind": "set-read", "read": false }),
        };
        let _: Value = self.orpc(
            "mail/applyChanges",
            json!({
                "command": command,
                "mailboxId": mailbox_id,
                "targets": [{ "messageIds": message_ids, "threadId": thread_id }],
            }),
        )?;
        Ok(())
    }

    pub fn send_message(
        &self,
        mailbox_id: &str,
        to: &str,
        cc: &str,
        bcc: &str,
        subject: &str,
        body: &str,
    ) -> Result<(), ApiError> {
        let now = chrono_like_now();
        let body_html = format!("<p>{}</p>", html_escape(body).replace('\n', "<br>"));

        let _: Value = self.orpc(
            "mail/sendMessage",
            json!({
                "mailboxId": mailbox_id,
                "message": {
                    "attachments": [],
                    "bodyHtml": body_html,
                    "bodyText": body,
                    "inlineImages": [],
                    "localId": Uuid::new_v4().to_string(),
                    "messageId": null,
                    "recipients": {
                        "bcc": bcc,
                        "cc": cc,
                        "to": to,
                    },
                    "saveStatus": "saved",
                    "subject": subject,
                    "updatedAt": now,
                },
            }),
        )?;
        Ok(())
    }

    pub fn start_gmail_connection(
        &self,
        return_to: &str,
        mailbox_id: Option<&str>,
    ) -> Result<String, ApiError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct ConnectionResponse {
            authorization_url: String,
        }

        let mut input = json!({ "returnTo": return_to });
        if let Some(mailbox_id) = mailbox_id {
            input["mailboxId"] = Value::String(mailbox_id.to_string());
        }
        let response: ConnectionResponse = self.orpc("mail/startGmailConnection", input)?;
        Ok(response.authorization_url)
    }

    fn orpc<T: DeserializeOwned>(&self, route: &str, input: Value) -> Result<T, ApiError> {
        self.orpc_with_method(route, input, false)
    }

    fn orpc_get<T: DeserializeOwned>(&self, route: &str, input: Value) -> Result<T, ApiError> {
        self.orpc_with_method(route, input, true)
    }

    fn orpc_with_method<T: DeserializeOwned>(
        &self,
        route: &str,
        input: Value,
        get: bool,
    ) -> Result<T, ApiError> {
        let mut url = self
            .base_url
            .join(&format!("api/orpc/{route}"))
            .map_err(|error| ApiError {
                status: 0,
                code: None,
                message: format!("Could not build the API URL: {error}"),
            })?;
        let request = if get {
            let data =
                serde_json::to_string(&json!({ "json": input })).map_err(|error| ApiError {
                    status: 0,
                    code: None,
                    message: format!("Could not encode the API request: {error}"),
                })?;
            url.query_pairs_mut().append_pair("data", &data);
            self.http.get(url)
        } else {
            self.http.post(url).json(&json!({ "json": input }))
        };
        let response = self.authorized(request).send().map_err(|error| ApiError {
            status: 0,
            code: None,
            message: format!("Could not reach quieter: {error}"),
        })?;
        let status = response.status().as_u16();
        let body_text = response.text().map_err(|error| ApiError {
            status,
            code: None,
            message: format!("Could not read the server response: {error}"),
        })?;
        let body: Value = serde_json::from_str(&body_text).map_err(|error| ApiError {
            status,
            code: None,
            message: format!("The server returned invalid JSON: {error}"),
        })?;
        if !((200..300).contains(&status)) {
            return Err(Self::error_from_value(status, &body));
        }

        let payload = body.get("json").cloned().unwrap_or(Value::Null);
        serde_json::from_value(payload).map_err(|error| ApiError {
            status,
            code: None,
            message: format!("The server response did not match the desktop client: {error}"),
        })
    }

    fn authorized(&self, request: RequestBuilder) -> RequestBuilder {
        match &self.token {
            Some(token) => request.bearer_auth(token),
            None => request,
        }
    }

    fn error_from_value(status: u16, body: &Value) -> ApiError {
        let message = body
            .get("message")
            .and_then(Value::as_str)
            .or_else(|| body.get("error").and_then(Value::as_str))
            .unwrap_or("The server rejected the request")
            .to_string();
        ApiError {
            status,
            code: body.get("code").and_then(Value::as_str).map(str::to_string),
            message,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MessagePage {
    #[serde(default)]
    pub messages: Vec<MessageListItem>,
}

#[derive(Debug, Deserialize)]
struct SessionEnvelope {
    user: SessionUser,
}

fn chrono_like_now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::thread;

    #[test]
    fn sends_orpc_envelope_with_string_recipients() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind mock server");
        let address = listener.local_addr().expect("read mock server address");
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept client");
            let body = read_request_body(&mut stream);
            let response = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 13\r\nConnection: close\r\n\r\n{\"json\":null}";
            stream.write_all(response).expect("write mock response");
            serde_json::from_slice::<Value>(&body).expect("parse ORPC request")
        });

        let client = ApiClient::new(&format!("http://{address}")).expect("create client");
        client
            .send_message(
                "mailbox-1",
                "alice@example.com, bob@example.com",
                "cc@example.com",
                "bcc@example.com",
                "Hello",
                "A test message",
            )
            .expect("send message");
        let request = server.join().expect("join mock server");

        assert_eq!(request["json"]["mailboxId"], "mailbox-1");
        assert_eq!(
            request["json"]["message"]["recipients"]["to"],
            "alice@example.com, bob@example.com"
        );
        assert_eq!(
            request["json"]["message"]["recipients"]["cc"],
            "cc@example.com"
        );
        assert_eq!(request["json"]["message"]["attachments"], json!([]));
    }

    #[test]
    fn sends_get_orpc_input_in_the_data_query_parameter() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind mock server");
        let address = listener.local_addr().expect("read mock server address");
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept client");
            let target = read_request_target(&mut stream);
            let response_body = r#"{"json":{"groups":[]}}"#;
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            )
            .expect("write mock response");
            target
        });

        let client = ApiClient::new(&format!("http://{address}")).expect("create client");
        client.list_mailboxes().expect("list mailboxes");
        let target = server.join().expect("join mock server");
        let request_url =
            Url::parse(&format!("http://localhost{target}")).expect("parse captured request URL");
        let data = request_url
            .query_pairs()
            .find(|(key, _)| key == "data")
            .map(|(_, value)| value.into_owned())
            .expect("GET request data");

        assert_eq!(
            serde_json::from_str::<Value>(&data).expect("parse GET request data"),
            json!({ "json": null })
        );
    }

    fn read_request_body(stream: &mut TcpStream) -> Vec<u8> {
        let mut bytes = Vec::new();
        let mut buffer = [0_u8; 2048];
        let header_end;
        loop {
            let count = stream.read(&mut buffer).expect("read request");
            bytes.extend_from_slice(&buffer[..count]);
            if let Some(position) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
                header_end = position + 4;
                break;
            }
        }
        let headers = String::from_utf8_lossy(&bytes[..header_end]);
        let content_length = headers
            .lines()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.eq_ignore_ascii_case("content-length")
                    .then(|| value.trim().parse::<usize>().ok())
                    .flatten()
            })
            .expect("content length");
        while bytes.len() < header_end + content_length {
            let count = stream.read(&mut buffer).expect("read request body");
            bytes.extend_from_slice(&buffer[..count]);
        }
        bytes[header_end..header_end + content_length].to_vec()
    }

    fn read_request_target(stream: &mut TcpStream) -> String {
        let mut bytes = Vec::new();
        let mut buffer = [0_u8; 2048];
        let header_end;
        loop {
            let count = stream.read(&mut buffer).expect("read request");
            bytes.extend_from_slice(&buffer[..count]);
            if let Some(position) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
                header_end = position + 4;
                break;
            }
        }
        let request_line = String::from_utf8_lossy(&bytes[..header_end])
            .lines()
            .next()
            .expect("request line")
            .to_string();
        request_line
            .split_whitespace()
            .nth(1)
            .expect("request target")
            .to_string()
    }
}
