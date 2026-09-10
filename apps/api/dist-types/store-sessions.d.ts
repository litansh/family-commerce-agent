import { type OtpChallenge, type StoreSession } from '@fca/cloud-connectors';
export type ConnectMethod = 'device' | 'otp' | 'password';
export interface ConnectionInfo {
    connected: boolean;
    method?: ConnectMethod;
    since?: string;
    lastVerifiedAt?: string;
}
export declare class StoreSessionStore {
    #private;
    private readonly table;
    constructor(table: string, key?: string);
    put(hid: string, store: string, session: StoreSession, method: ConnectMethod): Promise<void>;
    get(hid: string, store: string): Promise<StoreSession | undefined>;
    touch(hid: string, store: string): Promise<void>;
    remove(hid: string, store: string): Promise<void>;
    /** Every store this household is connected to, without opening any session. */
    list(hid: string): Promise<Record<string, ConnectionInfo>>;
    putChallenge(hid: string, store: string, challenge: OtpChallenge): Promise<string>;
    takeChallenge(hid: string, store: string, id: string): Promise<OtpChallenge>;
    dropChallenge(hid: string, id: string): Promise<void>;
}
