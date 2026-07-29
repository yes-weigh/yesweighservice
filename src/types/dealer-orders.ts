/** Cart line payload for Zoho sales-order submit. */

export interface SubmitDealerOrderLineInput {
  productId: string;
  quantity: number;
  /** Selected GATC stamping fee id; omit/null = without stamping. */
  gatcStampingPriceId?: string | null;
  /** Staff only: base product rate (server adds GATC fee). */
  rate?: number;
}
