import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
/**
 * Households and membership.
 *
 *   HOUSEHOLD#<hid>  MEMBER#<uid>     — a member; GSI1 reverses it (USER#<uid> → HOUSEHOLD#<hid>)
 *   HOUSEHOLD#<hid>  META             — name, address, constants
 *   INVITE#<code>    INVITE           — a short-lived invite to a household
 *
 * Every read of household data goes through `requireMember`, which is the
 * single place authorisation happens. A household id in a URL means nothing
 * until the caller's membership row exists.
 */
export interface Household {
    readonly id: string;
    readonly name: string;
    readonly address: string;
    /** ISO 3166-1 alpha-2. Everything region-specific follows from it. */
    readonly country: string;
    /** Chains the family usually orders from, e.g. ["shufersal", "rami-levy"]. */
    readonly retailers?: readonly string[];
    /** How they prefer to get it. Drives the default quote. */
    readonly fulfillment?: 'delivery' | 'pickup' | 'either';
    /** Apartment, floor, entrance, notes — what the courier needs beyond the street. */
    readonly addressDetails?: Record<string, unknown>;
    /** UI language the family chose; the country stays IL for now. */
    readonly language?: string;
    readonly createdBy: string;
    readonly createdAt: string;
}
export interface Membership {
    readonly householdId: string;
    readonly userId: string;
    readonly role: 'owner' | 'member';
    readonly email?: string;
    readonly joinedAt: string;
}
export declare class HouseholdStore {
    #private;
    constructor(table: string, client?: DynamoDBClient);
    create(userId: string, email: string | undefined, name: string, address: string, country: string): Promise<Household>;
    listForUser(userId: string): Promise<Household[]>;
    get(id: string): Promise<Household | undefined>;
    update(id: string, patch: Partial<Pick<Household, 'name' | 'address' | 'retailers' | 'fulfillment' | 'addressDetails' | 'language'>>): Promise<Household>;
    /** The one authorisation check. Throws 404, not 403: an outsider learns nothing. */
    requireMember(householdId: string, userId: string): Promise<Membership>;
    createInvite(householdId: string): Promise<{
        code: string;
        expiresAt: string;
    }>;
    acceptInvite(code: string, userId: string, email: string | undefined): Promise<Household>;
}
