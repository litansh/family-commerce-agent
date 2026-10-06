import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';

/** Who is calling, as established by API Gateway's Cognito JWT authorizer. */
export interface Caller {
  readonly userId: string;
  readonly email?: string;
}

/**
 * The JWT was already verified by API Gateway before this code ran; a request
 * without a valid token never reaches the Lambda. We only read the claims.
 * The user id is the Cognito `sub`, which is stable across sign-in methods.
 */
export function callerOf(event: APIGatewayProxyEventV2WithJWTAuthorizer): Caller {
  const claims = event.requestContext.authorizer.jwt.claims;
  const sub = claims['sub'];
  if (typeof sub !== 'string' || sub === '') throw new HttpError(401, 'no subject in token');
  const email = claims['email'];
  return { userId: sub, ...(typeof email === 'string' ? { email } : {}) };
}

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
