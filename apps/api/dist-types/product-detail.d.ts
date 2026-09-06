export interface ProductDetail {
    gtin: string;
    name: string;
    brand?: string;
    sizeQty?: number;
    sizeUnit?: string;
    listings: {
        chainId: string;
        chainName: string;
        name: string;
        orderable?: boolean;
    }[];
}
export declare function productDetail(gtin: string): Promise<ProductDetail | null>;
