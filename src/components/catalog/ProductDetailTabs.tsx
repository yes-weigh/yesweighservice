import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import type { CatalogCategory, CatalogProduct } from '../../types/catalog';
import type { CatalogNavState } from '../../lib/catalogNav';
import type { CatalogNcDoc } from '../../types/catalog-nc';
import { RelatedCatalogItems } from './RelatedCatalogItems';
import { ProductAuditHistory } from './ProductAuditHistory';
import { ProductNcPanel, type ProductNcExistingLocation } from './ProductNcPanel';
import { ProductMediaPanel } from './ProductMediaPanel';
import { ProductStockMovementsPanel } from './ProductStockMovementsPanel';
import { ProductSalesPanel } from './ProductSalesPanel';
import { ProductPurchasePanel } from './ProductPurchasePanel';

export type ProductDetailTabId =
  | 'spare'
  | 'audit'
  | 'sales'
  | 'nc'
  | 'media'
  | 'purchase'
  | 'support'
  | 'stock'
  | 'documents';

export type ProductApprovalDocument = {
  approvalNumber: string;
  pdfUrl: string;
  pdfFileName?: string | null;
};

const TAB_DEFS: { id: ProductDetailTabId; label: string }[] = [
  { id: 'spare', label: 'Spare' },
  { id: 'audit', label: 'Audit' },
  { id: 'sales', label: 'Sales' },
  { id: 'nc', label: 'NC' },
  { id: 'media', label: 'Media' },
  { id: 'purchase', label: 'Purchase' },
  { id: 'support', label: 'Support' },
  { id: 'stock', label: 'Stock' },
  { id: 'documents', label: 'Documents' },
];

export const DEALER_PRODUCT_DETAIL_TABS: ProductDetailTabId[] = ['spare', 'media', 'support', 'documents'];
export const MEDIA_PRODUCT_DETAIL_TABS: ProductDetailTabId[] = ['media'];

function TabPlaceholder({ label }: { label: string }) {
  return (
    <div className="product-detail-tab-panel__placeholder">
      <p className="product-detail-tab-panel__placeholder-title">{label}</p>
      <p className="text-muted text-sm">Coming soon.</p>
    </div>
  );
}

function TabPanelBody({ children }: { children: React.ReactNode }) {
  return <div className="product-detail-tab-panel__body">{children}</div>;
}

function ProductDocumentsPanel({
  approvalDocument,
}: {
  approvalDocument?: ProductApprovalDocument | null;
}) {
  if (!approvalDocument) {
    return (
      <div className="product-detail-documents">
        <p className="product-detail-documents__empty text-muted text-sm">
          No documents for this item yet.
        </p>
      </div>
    );
  }

  return (
    <div className="product-detail-documents">
      <article className="product-detail-documents__card">
        <p className="product-detail-documents__eyebrow">Approval certificate</p>
        <p className="product-detail-documents__number">{approvalDocument.approvalNumber}</p>
        <a
          href={approvalDocument.pdfUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="product-detail-documents__link"
        >
          <FileText size={16} aria-hidden />
          <span>{approvalDocument.pdfFileName || 'View approval PDF'}</span>
        </a>
      </article>
    </div>
  );
}

export const ProductDetailTabs: React.FC<{
  product: CatalogProduct;
  activeTab?: ProductDetailTabId;
  onActiveTabChange?: (tab: ProductDetailTabId) => void;
  showSpareTab: boolean;
  showAuditTab: boolean;
  showNcTab?: boolean;
  ncCategories?: CatalogCategory[];
  canEditNc?: boolean;
  /** Super admin only — show wipe-all NC control. */
  canWipeNc?: boolean;
  ncActorUid?: string;
  ncActorName?: string | null;
  ncExistingLocations?: ProductNcExistingLocation[];
  onNcChange?: (doc: CatalogNcDoc | null) => void;
  /** Expand this open NC line when the NC tab is shown. */
  ncFocusLineId?: string | null;
  relatedItems: CatalogProduct[];
  relatedKind: 'spares' | 'products';
  relatedLoading: boolean;
  linkError: string | null;
  manageSpareLinks: boolean;
  showStockQuantity: boolean;
  showCartActions: boolean;
  productsBasePath: string;
  sparesBasePath: string;
  onOpenLinkEditor: () => void;
  relatedLinkState: (item: CatalogProduct) => CatalogNavState;
  livePhysicalQty: number | null;
  canEditProductDetails: boolean;
  canWriteMedia?: boolean;
  mediaActorUid?: string;
  mediaActorName?: string | null;
  onAuditSnapshotChange: (snapshot: NonNullable<CatalogProduct['auditSnapshot']>) => void;
  visibleTabs?: readonly ProductDetailTabId[];
  /** Categorized products only — approval PDF for Documents tab. */
  approvalDocument?: ProductApprovalDocument | null;
}> = ({
  product,
  activeTab: controlledTab,
  onActiveTabChange,
  showSpareTab,
  showAuditTab,
  showNcTab = false,
  ncCategories = [],
  canEditNc = false,
  canWipeNc = false,
  ncActorUid = '',
  ncActorName = null,
  ncExistingLocations = [],
  onNcChange,
  ncFocusLineId = null,
  relatedItems,
  relatedKind,
  relatedLoading,
  linkError,
  manageSpareLinks,
  showStockQuantity,
  showCartActions,
  productsBasePath,
  sparesBasePath,
  onOpenLinkEditor,
  relatedLinkState,
  livePhysicalQty,
  canEditProductDetails,
  canWriteMedia = false,
  mediaActorUid = '',
  mediaActorName = null,
  onAuditSnapshotChange,
  visibleTabs,
  approvalDocument = null,
}) => {
  const [internalTab, setInternalTab] = useState<ProductDetailTabId>('spare');
  const activeTab = controlledTab ?? internalTab;
  const tabsRootRef = useRef<HTMLDivElement>(null);

  const visibleTabDefs = useMemo(() => {
    const allowed = visibleTabs ?? TAB_DEFS.map(tab => tab.id);
    return TAB_DEFS.filter(tab => {
      if (!allowed.includes(tab.id)) return false;
      if (tab.id === 'nc' && !showNcTab) return false;
      return true;
    });
  }, [visibleTabs, showNcTab]);

  const setActiveTab = (tab: ProductDetailTabId) => {
    onActiveTabChange?.(tab);
    if (controlledTab === undefined) setInternalTab(tab);
  };

  useEffect(() => {
    if (!visibleTabDefs.some(tab => tab.id === activeTab)) {
      const fallback = visibleTabDefs[0]?.id ?? 'spare';
      setActiveTab(fallback);
    }
  }, [activeTab, visibleTabDefs]);

  useEffect(() => {
    if (activeTab !== 'stock' && activeTab !== 'sales') return;
    const el = tabsRootRef.current;
    if (!el) return;
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    });
  }, [activeTab]);

  const spareTitle = relatedKind === 'spares' ? 'Mapped spares' : 'Mapped products';
  const spareEmpty = relatedKind === 'spares'
    ? 'No spares mapped to this product yet.'
    : 'No products mapped to this spare yet.';

  const panelId = useMemo(
    () => (tab: ProductDetailTabId) => `product-detail-tab-panel-${tab}`,
    [],
  );

  return (
    <div ref={tabsRootRef} className="product-detail-tabs">
      <div className="product-detail-tabs__nav">
        <div
          className="product-detail-tabs__track"
          role="tablist"
          aria-label="Product information"
        >
          {visibleTabDefs.map(tab => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`product-detail-tab-${tab.id}`}
              aria-selected={activeTab === tab.id}
              aria-controls={panelId(tab.id)}
              className={`product-detail-tabs__btn${activeTab === tab.id ? ' is-active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="product-detail-tabs__panels">
        {visibleTabDefs.some(tab => tab.id === 'spare') && (
        <div
          id={panelId('spare')}
          role="tabpanel"
          aria-labelledby="product-detail-tab-spare"
          hidden={activeTab !== 'spare'}
          className="product-detail-tab-panel"
        >
          <TabPanelBody>
            {showSpareTab ? (
              <>
                <RelatedCatalogItems
                items={relatedItems}
                title={spareTitle}
                emptyMessage={spareEmpty}
                detailBasePath={relatedKind === 'spares' ? sparesBasePath : productsBasePath}
                loading={relatedLoading}
                showStockQuantity={showStockQuantity}
                enableCart={showCartActions && relatedKind === 'spares'}
                getLinkState={relatedLinkState}
                embedded
                headerAction={
                  manageSpareLinks ? (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={onOpenLinkEditor}
                    >
                      {relatedKind === 'spares' ? 'Map spares' : 'Map products'}
                    </button>
                  ) : undefined
                }
              />
              {linkError && (
                <p className="related-catalog-section__error text-sm">{linkError}</p>
              )}
            </>
            ) : (
              <TabPlaceholder label="Spare mapping" />
            )}
          </TabPanelBody>
        </div>
        )}

        {visibleTabDefs.some(tab => tab.id === 'audit') && (
        <div
          id={panelId('audit')}
          role="tabpanel"
          aria-labelledby="product-detail-tab-audit"
          hidden={activeTab !== 'audit'}
          className="product-detail-tab-panel"
        >
          <TabPanelBody>
            {showAuditTab ? (
              <ProductAuditHistory
              product={product}
              livePhysicalQty={livePhysicalQty}
              canRecord={canEditProductDetails}
              embedded
              onSnapshotChange={onAuditSnapshotChange}
            />
            ) : (
              <TabPlaceholder label="Audit history" />
            )}
          </TabPanelBody>
        </div>
        )}

        {visibleTabDefs.some(tab => tab.id === 'nc') && (
        <div
          id={panelId('nc')}
          role="tabpanel"
          aria-labelledby="product-detail-tab-nc"
          hidden={activeTab !== 'nc'}
          className="product-detail-tab-panel"
        >
          <TabPanelBody>
            {showNcTab ? (
              <ProductNcPanel
                product={product}
                categories={ncCategories}
                open={activeTab === 'nc'}
                canEdit={canEditNc}
                canWipeNc={canWipeNc}
                actorUid={ncActorUid}
                actorName={ncActorName}
                existingLocations={ncExistingLocations}
                onNcChange={onNcChange}
                focusLineId={ncFocusLineId}
                embedded
              />
            ) : (
              <TabPlaceholder label="NC" />
            )}
          </TabPanelBody>
        </div>
        )}

        {visibleTabDefs.some(tab => tab.id === 'media') && (
        <div
          id={panelId('media')}
          role="tabpanel"
          aria-labelledby="product-detail-tab-media"
          hidden={activeTab !== 'media'}
          className="product-detail-tab-panel"
        >
          <TabPanelBody>
            <ProductMediaPanel
              catalogProductId={product.id}
              open={activeTab === 'media'}
              canWrite={canWriteMedia}
              actorUid={mediaActorUid}
              actorName={mediaActorName}
              embedded
            />
          </TabPanelBody>
        </div>
        )}

        {visibleTabDefs.some(tab => tab.id === 'documents') && (
        <div
          id={panelId('documents')}
          role="tabpanel"
          aria-labelledby="product-detail-tab-documents"
          hidden={activeTab !== 'documents'}
          className="product-detail-tab-panel"
        >
          <TabPanelBody>
            <ProductDocumentsPanel approvalDocument={approvalDocument} />
          </TabPanelBody>
        </div>
        )}

        {visibleTabDefs.some(tab => tab.id === 'purchase') && (
        <div
          id={panelId('purchase')}
          role="tabpanel"
          aria-labelledby="product-detail-tab-purchase"
          hidden={activeTab !== 'purchase'}
          className="product-detail-tab-panel"
        >
          <TabPanelBody>
            <ProductPurchasePanel product={product} active={activeTab === 'purchase'} />
          </TabPanelBody>
        </div>
        )}

        {visibleTabDefs.some(tab => tab.id === 'support') && (
          <div
            id={panelId('support')}
            role="tabpanel"
            aria-labelledby="product-detail-tab-support"
            hidden={activeTab !== 'support'}
            className="product-detail-tab-panel"
          >
            <TabPanelBody>
              <TabPlaceholder label="Support" />
            </TabPanelBody>
          </div>
        )}

        {visibleTabDefs.some(tab => tab.id === 'sales') && (
        <div
          id={panelId('sales')}
          role="tabpanel"
          aria-labelledby="product-detail-tab-sales"
          hidden={activeTab !== 'sales'}
          className="product-detail-tab-panel"
        >
          <TabPanelBody>
            <ProductSalesPanel product={product} active={activeTab === 'sales'} />
          </TabPanelBody>
        </div>
        )}

        {visibleTabDefs.some(tab => tab.id === 'stock') && (
        <div
          id={panelId('stock')}
          role="tabpanel"
          aria-labelledby="product-detail-tab-stock"
          hidden={activeTab !== 'stock'}
          className="product-detail-tab-panel"
        >
          <TabPanelBody>
            <ProductStockMovementsPanel product={product} active={activeTab === 'stock'} />
          </TabPanelBody>
        </div>
        )}
      </div>
    </div>
  );
};
