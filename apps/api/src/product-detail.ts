/**
 * Canonical product by barcode with its per-chain listings, straight from
 * the catalogue's MCP. Chain names are what a family recognises; ids are
 * what the optimizer uses.
 */
import { McpClient, SUPERMCP_URL } from '@fca/retailer-connectors';

const mcp = new McpClient(SUPERMCP_URL, 30_000);

export interface ProductDetail {
  gtin: string;
  name: string;
  brand?: string;
  sizeQty?: number;
  sizeUnit?: string;
  listings: { chainId: string; chainName: string; name: string; orderable?: boolean }[];
}

export async function productDetail(gtin: string): Promise<ProductDetail | null> {
  const r = await mcp.callTool<{ product?: { gtin: string; name: string; brand?: string | null; sizeQty?: number | null; sizeUnit?: string | null; listings?: { chainId: string; chainName: string; name: string; orderable?: boolean }[] } }>('get_product', { gtin }).catch(() => null);
  const p = r?.product;
  if (!p) return null;
  const seen = new Set<string>();
  return {
    gtin: p.gtin, name: p.name, ...(p.brand ? { brand: p.brand } : {}), ...(p.sizeQty != null ? { sizeQty: p.sizeQty } : {}), ...(p.sizeUnit ? { sizeUnit: p.sizeUnit } : {}),
    listings: (p.listings ?? []).filter((l) => !seen.has(l.chainName) && seen.add(l.chainName)).map((l) => ({ chainId: l.chainId, chainName: l.chainName, name: l.name, ...(l.orderable !== undefined ? { orderable: l.orderable } : {}) })),
  };
}
