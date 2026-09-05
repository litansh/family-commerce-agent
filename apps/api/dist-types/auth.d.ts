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
export declare function callerOf(event: APIGatewayProxyEventV2WithJWTAuthorizer): Caller;
export declare class HttpError extends Error {
    readonly status: number;
    constructor(status: number, message: string);
}
