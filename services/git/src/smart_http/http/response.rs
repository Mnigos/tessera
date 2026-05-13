use axum::body::Body;
use axum::http::{Response, StatusCode};

use crate::smart_http::domain::SmartHttpError;

pub fn empty_response(status: StatusCode) -> Response<Body> {
    Response::builder()
        .status(status)
        .body(Body::empty())
        .unwrap()
}

pub fn smart_http_error_to_status(error: &SmartHttpError) -> StatusCode {
    match error {
        SmartHttpError::InvalidPath
        | SmartHttpError::UnsupportedMethod
        | SmartHttpError::UnsupportedService => StatusCode::BAD_REQUEST,
        SmartHttpError::PushRejected => StatusCode::FORBIDDEN,
        SmartHttpError::Unauthorized => StatusCode::UNAUTHORIZED,
        SmartHttpError::AuthorizationUnavailable => StatusCode::BAD_GATEWAY,
        SmartHttpError::InvalidRepositoryMetadata
        | SmartHttpError::RepositoryUnavailable
        | SmartHttpError::BackendFailed
        | SmartHttpError::InvalidBackendResponse => StatusCode::INTERNAL_SERVER_ERROR,
    }
}
