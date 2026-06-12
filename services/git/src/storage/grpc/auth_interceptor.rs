use subtle::ConstantTimeEq;
use tonic::{Request, Status};

const AUTHORIZATION_HEADER: &str = "authorization";
const BEARER_PREFIX: &str = "Bearer ";
const UNAUTHORIZED_MESSAGE: &str = "Unauthorized";

pub fn storage_grpc_auth_interceptor(
    token: String,
) -> impl FnMut(Request<()>) -> Result<Request<()>, Status> + Clone {
    let expected = format!("{BEARER_PREFIX}{token}");

    move |request| authorize_request(request, &expected)
}

fn authorize_request(request: Request<()>, expected: &str) -> Result<Request<()>, Status> {
    let Some(value) = request.metadata().get(AUTHORIZATION_HEADER) else {
        return Err(unauthorized());
    };

    let Ok(value) = value.to_str() else {
        return Err(unauthorized());
    };

    if value.as_bytes().ct_eq(expected.as_bytes()).into() {
        return Ok(request);
    }

    Err(unauthorized())
}

fn unauthorized() -> Status {
    Status::unauthenticated(UNAUTHORIZED_MESSAGE)
}

#[cfg(test)]
mod tests {
    use tonic::Code;

    use super::storage_grpc_auth_interceptor;

    #[test]
    fn accepts_matching_bearer_token() {
        let mut interceptor = storage_grpc_auth_interceptor("service-token".to_string());
        let mut request = tonic::Request::new(());
        request
            .metadata_mut()
            .insert("authorization", "Bearer service-token".parse().unwrap());

        assert!(interceptor(request).is_ok());
    }

    #[test]
    fn rejects_missing_metadata() {
        let mut interceptor = storage_grpc_auth_interceptor("service-token".to_string());
        let error = interceptor(tonic::Request::new(())).unwrap_err();

        assert_eq!(error.code(), Code::Unauthenticated);
        assert_eq!(error.message(), "Unauthorized");
    }

    #[test]
    fn rejects_malformed_metadata() {
        let mut interceptor = storage_grpc_auth_interceptor("service-token".to_string());
        let mut request = tonic::Request::new(());
        request
            .metadata_mut()
            .insert("authorization", "service-token".parse().unwrap());

        let error = interceptor(request).unwrap_err();

        assert_eq!(error.code(), Code::Unauthenticated);
        assert_eq!(error.message(), "Unauthorized");
    }

    #[test]
    fn rejects_mismatched_token() {
        let mut interceptor = storage_grpc_auth_interceptor("service-token".to_string());
        let mut request = tonic::Request::new(());
        request
            .metadata_mut()
            .insert("authorization", "Bearer other-token".parse().unwrap());

        let error = interceptor(request).unwrap_err();

        assert_eq!(error.code(), Code::Unauthenticated);
        assert_eq!(error.message(), "Unauthorized");
    }
}
