use anyhow::{Context, Result, anyhow};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;
use std::time::{Duration, Instant};
use url::{Url, form_urlencoded};
use uuid::Uuid;

pub struct PendingAuth {
    listener: TcpListener,
    state: String,
    auth_url: String,
}

impl PendingAuth {
    pub fn new(base_url: &str) -> Result<Self> {
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .context("Could not reserve a local browser-auth callback")?;
        let port = listener.local_addr()?.port();
        let state = Uuid::new_v4().to_string();
        let callback = format!("http://127.0.0.1:{port}/callback");
        let mut auth_url = Url::parse(base_url)?.join("desktop-auth")?;
        auth_url
            .query_pairs_mut()
            .append_pair("callback", &callback)
            .append_pair("state", &state);

        Ok(Self {
            listener,
            state,
            auth_url: auth_url.to_string(),
        })
    }

    pub fn auth_url(&self) -> &str {
        &self.auth_url
    }

    pub fn wait_for_token(self) -> Result<String> {
        self.listener
            .set_nonblocking(true)
            .context("Could not configure the browser callback")?;
        let deadline = Instant::now() + Duration::from_secs(90);
        let mut last_error = "The browser did not return a session".to_string();

        loop {
            if Instant::now() >= deadline {
                return Err(anyhow!("The browser auth callback timed out: {last_error}"));
            }
            let (mut stream, _) = match self.listener.accept() {
                Ok(connection) => connection,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(25));
                    continue;
                }
                Err(error) => return Err(error).context("Could not accept the browser callback"),
            };

            let callback = read_request(&mut stream).and_then(|(method, target, body)| {
                let parameters = if method.eq_ignore_ascii_case("POST") {
                    form_urlencoded::parse(body.as_bytes())
                        .into_owned()
                        .collect::<Vec<_>>()
                } else {
                    Url::parse(&format!("http://localhost{target}"))?
                        .query_pairs()
                        .into_owned()
                        .collect::<Vec<_>>()
                };
                Ok(parameters)
            });

            let parameters = match callback {
                Ok(parameters) => parameters,
                Err(error) => {
                    last_error = error.to_string();
                    let _ = write_response(
                        &mut stream,
                        "The sign-in callback was incomplete. You can close this tab.",
                    );
                    continue;
                }
            };
            let state = parameters
                .iter()
                .find(|(key, _)| key == "state")
                .map(|(_, value)| value.as_str())
                .unwrap_or_default();
            if state != self.state {
                last_error = "Authentication state did not match".to_string();
                let _ = write_response(
                    &mut stream,
                    "Authentication state did not match. You can close this tab.",
                );
                continue;
            }

            let token = parameters
                .iter()
                .find(|(key, _)| key == "token")
                .map(|(_, value)| value.clone())
                .filter(|token| !token.trim().is_empty());
            let Some(token) = token else {
                last_error = "The browser did not return a session".to_string();
                let _ = write_response(
                    &mut stream,
                    "The browser did not return a session. You can close this tab.",
                );
                continue;
            };

            write_response(
                &mut stream,
                "You are signed in. You can close this tab and return to quieter.",
            )?;
            return Ok(token);
        }
    }
}

fn read_request(stream: &mut TcpStream) -> Result<(String, String, String)> {
    stream
        .set_read_timeout(Some(std::time::Duration::from_secs(90)))
        .context("Could not configure the browser callback")?;
    let mut bytes = Vec::with_capacity(4096);
    let mut buffer = [0_u8; 2048];
    let header_end;
    loop {
        let count = stream.read(&mut buffer)?;
        if count == 0 {
            return Err(anyhow!("The browser closed the auth callback early"));
        }
        bytes.extend_from_slice(&buffer[..count]);
        if let Some(position) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
            header_end = position + 4;
            break;
        }
        if bytes.len() > 16 * 1024 {
            return Err(anyhow!("The browser auth callback headers were too large"));
        }
    }

    let header_text = std::str::from_utf8(&bytes[..header_end - 4])?;
    let mut lines = header_text.lines();
    let request_line = lines
        .next()
        .ok_or_else(|| anyhow!("The browser callback was empty"))?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or_default().to_string();
    let target = request_parts.next().unwrap_or_default().to_string();
    if target != "/callback" && !target.starts_with("/callback?") {
        return Err(anyhow!("The browser callback path was not recognized"));
    }

    let content_length = lines
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().ok())
                .flatten()
        })
        .unwrap_or_default();
    while bytes.len() < header_end + content_length {
        let count = stream.read(&mut buffer)?;
        if count == 0 {
            return Err(anyhow!("The browser closed the auth callback early"));
        }
        bytes.extend_from_slice(&buffer[..count]);
        if bytes.len() > header_end + content_length + 16 * 1024 {
            return Err(anyhow!("The browser auth callback body was too large"));
        }
    }

    let body = String::from_utf8(bytes[header_end..header_end + content_length].to_vec())?;
    Ok((method, target, body))
}

fn write_response(stream: &mut TcpStream, message: &str) -> Result<()> {
    let body = format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>quieter</title></head><body style=\"font-family:system-ui;padding:3rem;background:#e7e8ea;color:#202124\"><h1>quieter</h1><p>{message}</p></body></html>"
    );
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    stream.write_all(response.as_bytes())?;
    stream.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::thread;

    #[test]
    fn ignores_a_wrong_state_and_accepts_the_next_valid_callback() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind callback");
        let address = listener.local_addr().expect("read callback address");
        let state = "expected-state".to_string();
        let pending = PendingAuth {
            listener,
            state: state.clone(),
            auth_url: "http://localhost:3000/desktop-auth".to_string(),
        };
        let sender = thread::spawn(move || {
            let mut stream = TcpStream::connect(address).expect("connect callback");
            let body = "state=wrong-state&token=session-token";
            write!(
                stream,
                "POST /callback HTTP/1.1\r\nHost: localhost\r\nContent-Length: {}\r\nContent-Type: application/x-www-form-urlencoded\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .expect("write callback");
            drop(stream);
            thread::sleep(Duration::from_millis(40));
            let mut stream = TcpStream::connect(address).expect("connect callback");
            let body = "state=expected-state&token=session-token";
            write!(
                stream,
                "POST /callback HTTP/1.1\r\nHost: localhost\r\nContent-Length: {}\r\nContent-Type: application/x-www-form-urlencoded\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .expect("write callback");
        });

        assert_eq!(
            pending.wait_for_token().expect("valid callback"),
            "session-token"
        );
        sender.join().expect("join callback sender");
    }
}
