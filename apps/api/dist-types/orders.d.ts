import type { ListLine } from '@fca/domain';
export interface Order {
    readonly id: string;
    readonly householdId: string;
    readonly retailer: string;
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
    create(householdId: string, userId: string, retailer: string, lines: readonly ListLine[]): Promise<Order>;
    get(householdId: string, id: string): Promise<Order>;
    list(householdId: string): Promise<Order[]>;
    /** The family says yes to the real total. Only valid while the worker is waiting. */
    approve(householdId: string, id: string, userId: string): Promise<Order>;
    cancel(householdId: string, id: string): Promise<Order>;
}
