use anyhow::{Context, Result, anyhow};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
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
        let (mut stream, _) = self
            .listener
            .accept()
            .context("The browser auth callback timed out")?;
        let (method, target, body) = read_request(&mut stream)?;
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
        let state = parameters
            .iter()
            .find(|(key, _)| key == "state")
            .map(|(_, value)| value.as_str())
            .unwrap_or_default();
        let token = parameters
            .iter()
            .find(|(key, _)| key == "token")
            .map(|(_, value)| value.clone())
            .filter(|token| !token.trim().is_empty())
            .ok_or_else(|| anyhow!("The browser did not return a session"))?;

        if state != self.state {
            write_response(
                &mut stream,
                "Authentication state did not match. You can close this tab.",
            )?;
            return Err(anyhow!("Authentication state did not match"));
        }

        write_response(
            &mut stream,
            "You are signed in. You can close this tab and return to quieter.",
        )?;
        Ok(token)
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
    fn accepts_a_valid_loopback_form_and_rejects_a_wrong_state() {
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
        });

        assert!(pending.wait_for_token().is_err());
        sender.join().expect("join callback sender");

        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind callback");
        let address = listener.local_addr().expect("read callback address");
        let pending = PendingAuth {
            listener,
            state,
            auth_url: "http://localhost:3000/desktop-auth".to_string(),
        };
        let sender = thread::spawn(move || {
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
