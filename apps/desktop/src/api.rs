use std::time::Duration;

use reqwest::blocking::{Client, RequestBuilder};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::model::{MailCategory, MailboxList, ThreadAction, ThreadDetail, ThreadList};

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
    #[error("The server returned {status}: {message}")]
    Server { status: u16, message: String },
}

#[derive(Debug, Deserialize)]
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
    scope: &'a str,
}

#[derive(Serialize)]
struct DeviceTokenRequest<'a> {
    client_id: &'a str,
    device_code: &'a str,
    grant_type: &'a str,
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
        let client = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .user_agent(concat!("QuieterDesktop/", env!("CARGO_PKG_VERSION")))
            .build()?;
        Ok(Self {
            base_url: base_url.trim_end_matches('/').to_owned(),
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

    pub fn request_device_code(&self) -> Result<DeviceCode, ApiError> {
        self.decode(self.client.post(format!("{}/api/auth/device/code", self.base_url)).json(
            &DeviceCodeRequest {
                client_id: DESKTOP_CLIENT_ID,
                scope: "mailbox.read mailbox.write",
            },
        ))
    }

    pub fn poll_device_token(&self, device_code: &str) -> Result<DeviceToken, ApiError> {
        self.decode(self.client.post(format!("{}/api/auth/device/token", self.base_url)).json(
            &DeviceTokenRequest {
                client_id: DESKTOP_CLIENT_ID,
                device_code,
                grant_type: "urn:ietf:params:oauth:grant-type:device_code",
            },
        ))
    }

    pub fn list_mailboxes(&self) -> Result<MailboxList, ApiError> {
        self.decode(self.authorize(self.client.get(format!(
            "{}/api/desktop/mail/listMailboxes",
            self.base_url
        ))))
    }

    pub fn list_threads(
        &self,
        mailbox_id: &str,
        category: MailCategory,
        query: Option<&str>,
    ) -> Result<ThreadList, ApiError> {
        let mut parameters = vec![
            ("mailboxId", mailbox_id),
            ("category", category.api_value()),
        ];
        if let Some(query) = query.filter(|query| !query.is_empty()) {
            parameters.push(("query", query));
        }
        self.decode(self.authorize(
            self.client
                .get(format!("{}/api/desktop/mail/listThreads", self.base_url))
                .query(&parameters),
        ))
    }

    pub fn get_thread(&self, mailbox_id: &str, thread_id: &str) -> Result<ThreadDetail, ApiError> {
        self.decode(self.authorize(
            self.client
                .get(format!("{}/api/desktop/mail/getThread", self.base_url))
                .query(&[("mailboxId", mailbox_id), ("threadId", thread_id)]),
        ))
    }

    pub fn thread_action(
        &self,
        action: &str,
        mailbox_id: &str,
        thread_id: &str,
    ) -> Result<serde_json::Value, ApiError> {
        self.decode(
            self.authorize(self.client.post(format!(
                "{}/api/desktop/mail/{action}",
                self.base_url
            )))
            .json(&ThreadAction {
                mailbox_id,
                thread_id,
            }),
        )
    }

    pub fn sign_out(&self) -> Result<serde_json::Value, ApiError> {
        self.decode(self.authorize(
            self.client
                .post(format!("{}/api/auth/sign-out", self.base_url)),
        ))
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
        if status.as_u16() == 401 {
            return Err(ApiError::Unauthorized);
        }
        if !status.is_success() {
            let message = response
                .json::<serde_json::Value>()
                .ok()
                .and_then(|value| {
                    value
                        .get("message")
                        .or_else(|| value.get("error"))
                        .and_then(serde_json::Value::as_str)
                        .map(str::to_owned)
                })
                .unwrap_or_else(|| "Request failed".to_owned());
            return Err(ApiError::Server {
                status: status.as_u16(),
                message,
            });
        }
        Ok(response.json()?)
    }
}
