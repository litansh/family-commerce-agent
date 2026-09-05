/**
 * The API. One Lambda, one router, every route behind Cognito.
 *
 *   GET  /me                                   who am I, which households
 *   POST /households                           { name, address }
 *   POST /households/{hid}/invites             → { code }
 *   POST /invites/{code}/accept
 *   GET  /households/{hid}/memory
 *   POST /households/{hid}/memory/confirm      { phrase, gtin, productName, brand? }
 *   POST /households/{hid}/memory/shop         { bought: PurchasedLine[] }
 *   POST /households/{hid}/suggest             { lines }   → what did we forget
 *   POST /households/{hid}/resolve             { lines }   → brand/size choices per line
 *   POST /households/{hid}/quote               { lines, address?, pickup? } → ranked options
 *
 * Authorisation is one call, `requireMember`, and it happens before any
 * household data is touched. Everything after it is scoped by construction:
 * the memory repository is built for that household id and cannot address
 * another.
 */
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
type Event = APIGatewayProxyEventV2WithJWTAuthorizer;
export declare function handler(event: Event): Promise<APIGatewayProxyResultV2>;
export {};
