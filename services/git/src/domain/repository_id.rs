use std::fmt;

use uuid::Uuid;

use super::RepositoryError;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RepositoryId(Uuid);

impl RepositoryId {
    pub fn parse(value: &str) -> Result<Self, RepositoryError> {
        Uuid::parse_str(value)
            .map(Self)
            .map_err(|_| RepositoryError::InvalidRepositoryId)
    }
}

impl fmt::Display for RepositoryId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}", self.0)
    }
}
