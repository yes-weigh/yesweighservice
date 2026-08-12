import type { AdminGoodsReceiptDetail } from '../../lib/admin-goods-receipts';

export interface AdminGoodsReceiptDetailOutletContext {
  goodsReceipt: AdminGoodsReceiptDetail | null;
  loading: boolean;
  error: string;
  goodsReceiptId: string;
  listPath: string;
}
