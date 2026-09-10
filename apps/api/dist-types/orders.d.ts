import type { ListLine } from '@fca/domain';
export interface OrderLeg {
    readonly retailer: string;
    readonly lines: readonly ListLine[];
    readonly status: string;
    readonly total?: number;
    readonly slot?: {
        id: string;
        label: string;
    };
    readonly paymentMethod?: string;
    readonly retailerOrderId?: string;
    readonly error?: string;
}
/**
 * One Kaniti order, fanned out to as many retailers as the basket needs.
 * The family approves once; every leg's worker sees the same token.
 */
export interface Order {
    readonly id: string;
    readonly householdId: string;
    /** Kept for single-retailer callers; equals legs[0].retailer. */
    readonly retailer: string;
    readonly legs: readonly OrderLeg[];
    readonly status: string;
    readonly lines: readonly ListLine[];
    readonly createdBy: string;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly total?: number;
    readonly slot?: {
        id: string;
        label: string;
    };
    readonly paymentMethod?: string;
    readonly retailerOrderId?: string;
    readonly error?: string;
}
export declare class OrderStore {
    #private;
    constructor(table: string, queueUrl: string);
    create(householdId: string, userId: string, legsIn: readonly {
        retailer: string;
        lines: readonly ListLine[];
    }[]): Promise<Order>;
    get(householdId: string, id: string): Promise<Order>;
    list(householdId: string): Promise<Order[]>;
    /** The family says yes to the real total. Only valid while the worker is waiting. */
    approve(householdId: string, id: string, userId: string): Promise<Order>;
    cancel(householdId: string, id: string): Promise<Order>;
}
/** History imports ride the same queue; the worker tells them apart by `type`. */
export declare class ImportStore {
    #private;
    private readonly table;
    private readonly queueUrl;
    constructor(table: string, queueUrl: string);
    request(householdId: string, retailer: string): Promise<{
        retailer: string;
        status: string;
    }>;
    status(householdId: string, retailer: string): Promise<Record<string, unknown>>;
}
/** Read one household-scoped row by sort key. Small helper for status rows. */
export declare function readRow(table: string, householdId: string, sk: string): Promise<Record<string, unknown> | undefined>;
export declare function writeRow(table: string, householdId: string, sk: string, item: Record<string, unknown>): Promise<void>;
