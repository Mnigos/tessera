use axum::body::Body;
use axum::http::{Response, StatusCode, header};

use crate::smart_http::domain::SmartHttpError;

pub fn empty_response(status: StatusCode) -> Response<Body> {
    Response::builder()
        .status(status)
        .body(Body::empty())
        .expect("failed to build empty HTTP response")
}

pub fn basic_auth_challenge_response(error: SmartHttpError) -> Response<Body> {
    Response::builder()
        .status(smart_http_error_to_status(&error))
        .header(header::WWW_AUTHENTICATE, "Basic realm=\"Tessera Git\"")
        .body(Body::empty())
        .expect("failed to build basic auth challenge response")
}

pub fn smart_http_error_to_status(error: &SmartHttpError) -> StatusCode {
    match error {
        SmartHttpError::InvalidPath
        | SmartHttpError::UnsupportedMethod
        | SmartHttpError::UnsupportedService => StatusCode::BAD_REQUEST,
        SmartHttpError::MissingCredentials
        | SmartHttpError::InvalidCredentials
        | SmartHttpError::Unauthorized => StatusCode::UNAUTHORIZED,
        SmartHttpError::AuthorizationUnavailable => StatusCode::BAD_GATEWAY,
        SmartHttpError::InvalidRepositoryMetadata
        | SmartHttpError::RepositoryUnavailable
        | SmartHttpError::BackendFailed
        | SmartHttpError::InvalidBackendResponse => StatusCode::INTERNAL_SERVER_ERROR,
    }
}
