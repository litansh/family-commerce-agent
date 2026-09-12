import { type NearbyBranch } from '@fca/branch-prices';
import { type Agorot } from '@fca/domain';
import { type Household } from './households.ts';
export interface IndexedBranch extends NearbyBranch {
    readonly indexedAt: string;
    readonly barcodes: number;
}
export interface BranchRow {
    readonly status: 'ready' | 'pending' | 'none';
    readonly at: string;
    readonly city: string;
    readonly requestedAt?: string;
    readonly branches: readonly IndexedBranch[];
}
/** What the compare screen shows per branch. Cash and driving are reported side by side, never summed for the family. */
export interface DriveView {
    readonly storefrontId: string;
    readonly chain: string;
    readonly brand: string;
    readonly branchName: string;
    readonly address: string;
    readonly distanceKm: number;
    readonly minutes: number;
    readonly itemsSubtotal: Agorot;
    readonly driveCost: Agorot;
    readonly coveredLines: number;
    readonly totalLines: number;
    readonly missingLineIds: readonly string[];
    readonly pricedAt: string;
}
export declare class BranchPrices {
    #private;
    constructor(table: string, bucket: string, refreshFn: string);
    get enabled(): boolean;
    /** The in-store view for a quote. Kicks the refresher when the household has none yet or it is a day old. */
    driveQuotes(hid: string, household: Household, lines: readonly {
        id: string;
        query: string;
        gtin?: string;
        qty: number;
    }[]): Promise<{
        status: BranchRow['status'];
        branches: DriveView[];
    }>;
    /** Find, geocode and index the branches near one household. */
    refreshHousehold(hid: string, household?: Household): Promise<BranchRow>;
    /** Every household that ever asked: the nightly pass. */
    refreshAll(): Promise<string[]>;
}
