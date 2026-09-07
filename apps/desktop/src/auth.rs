use keyring::Entry;

const CREDENTIAL_SERVICE: &str = "email.quieter.desktop";
pub struct TokenStore;

impl TokenStore {
    pub fn load(base_url: &str) -> Option<String> {
        Entry::new(CREDENTIAL_SERVICE, base_url)
            .ok()
            .and_then(|credential| credential.get_secret().ok())
            .and_then(|bytes| String::from_utf8(bytes).ok())
            .filter(|token| !token.is_empty())
    }

    pub fn save(base_url: &str, token: &str) -> anyhow::Result<()> {
        Entry::new(CREDENTIAL_SERVICE, base_url)?.set_secret(token.as_bytes())?;
        Ok(())
    }

    pub fn clear(base_url: &str) -> anyhow::Result<()> {
        let credential = Entry::new(CREDENTIAL_SERVICE, base_url)?;
        if let Err(error) = credential.delete_credential()
            && !matches!(error, keyring::Error::NoEntry)
        {
            return Err(error.into());
        }
        Ok(())
    }
}
