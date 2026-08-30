use keyring::Entry;

const CREDENTIAL_SERVICE: &str = "email.quieter.desktop";
const CREDENTIAL_ACCOUNT: &str = "session";

pub struct TokenStore;

impl TokenStore {
    pub fn load() -> Option<String> {
        Entry::new(CREDENTIAL_SERVICE, CREDENTIAL_ACCOUNT)
            .ok()
            .and_then(|credential| credential.get_secret().ok())
            .and_then(|bytes| String::from_utf8(bytes).ok())
            .filter(|token| !token.is_empty())
    }

    pub fn save(token: &str) -> anyhow::Result<()> {
        Entry::new(CREDENTIAL_SERVICE, CREDENTIAL_ACCOUNT)?.set_secret(token.as_bytes())?;
        Ok(())
    }

    pub fn clear() -> anyhow::Result<()> {
        let credential = Entry::new(CREDENTIAL_SERVICE, CREDENTIAL_ACCOUNT)?;
        if let Err(error) = credential.delete_credential()
            && !matches!(error, keyring::Error::NoEntry)
        {
            return Err(error.into());
        }
        Ok(())
    }
}
