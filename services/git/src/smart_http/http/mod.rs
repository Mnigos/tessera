mod request_handler;
mod response;
mod router;

pub use router::router;

use crate::smart_http::application::SmartHttpApplication;
use crate::smart_http::infrastructure::ApiSmartHttpAuthorizer;

pub type SmartHttpService = SmartHttpApplication<ApiSmartHttpAuthorizer>;
