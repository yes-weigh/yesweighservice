import React, { useEffect, useMemo, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { BadgeCheck, Ban, CheckCircle2, Hash, PackagePlus, Send, Unlink } from 'lucide-react';
import { DocumentKamStrip } from '../../components/admin/DocumentKamStrip';
import { DocumentPartyBlock } from '../../components/admin/DocumentPartyBlock';
import { InvoiceDocumentBody } from '../../components/invoices/InvoiceDocumentBody';
import { InvoiceLocalFreightEditor } from '../../components/invoices/InvoiceLocalFreightEditor';
import { GatcSerialPickerDialog } from '../../components/invoices/GatcSerialPickerDialog';
import { RelatedSupportRequests } from '../../components/support/RelatedSupportRequests';
import { useConfirm } from '../../context/ConfirmContext';
import { logisticsPartnerLabel } from '../../constants/logisticsPartners';
import { useAuth } from '../../context/AuthContext';
import { isFreightInvoiceLineItem, serialNumbersFromLineItem } from '../../lib/invoices';
import {
  allotNonGatcSerialsToInvoice,
  invoiceNeedsNonGatcSerialAllotment,
  isNonGatcSerialEligibleLine,
  isVoidOrCancelledInvoiceStatus,
  nonGatcSerialShortage,
  pushRcInvoiceToYesGatc,
  unlinkNonGatcSerialsFromInvoice,
} from '../../lib/nonGatcSerialAllot';
import {
  allotGatcStampedSerialsToInvoice,
  gatcStampedSerialShortage,
  invoiceLineStampingCapacityKg,
  isGatcStampedSerialEligibleLine,
  unlinkGatcStampedSerialsFromInvoice,
} from '../../lib/gatcStampedSerialAllot';
import {
  findYesGatcRcForDealer,
  type YesGatcDealerRcLink,
} from '../../lib/yesgatcRecords';
import {
  effectiveInvoiceFreightSku,
  overlayLocalFreightOnLineItems,
  type LocalFreightSelectSku,
} from '../../lib/invoiceLocalFreight';
import { canVoidAdminInvoice, isInternalOpsUser } from '../../lib/staffAccess';
import { voidAdminInvoice } from '../../lib/voidAdminInvoice';
import type { AdminInvoiceDetailOutletContext } from './adminInvoiceDetailContext';

export const AdminInvoiceDocumentPage: React.FC = () => {
  const { user } = useAuth();
  const confirm = useConfirm();
  const {
    invoice,
    customerId,
    invoiceId,
    showManualLogistics,
    manualLogisticsPartnerId,
    manualLogisticsPartnerFromFreight,
    onOpenManualLogistics,
    showMarkDelivered,
    onOpenMarkDelivered,
    existingBooking,
    kamCardOpen,
    canEditLocalFreight = false,
    localFreightBusy = false,
    localFreightError = '',
    onChangeLocalFreight,
    reloadInvoice,
  } = useOutletContext<AdminInvoiceDetailOutletContext>();

  const isOps = isInternalOpsUser(user);
  const showKamCard = Boolean(invoice) && (!isOps || Boolean(kamCardOpen));
  const [freightOpen, setFreightOpen] = useState(true);
  const [allotBusy, setAllotBusy] = useState(false);
  const [allotError, setAllotError] = useState('');
  const [allotNotice, setAllotNotice] = useState('');
  const [rcLink, setRcLink] = useState<YesGatcDealerRcLink | null>(null);
  const [gatcPicker, setGatcPicker] = useState<{
    lineId: string;
    need: number;
    title: string;
    capacityKg: number | null;
  } | null>(null);
  const [gatcPickerError, setGatcPickerError] = useState('');
  const [voidBusy, setVoidBusy] = useState(false);

  useEffect(() => {
    if (!kamCardOpen) return;
    window.requestAnimationFrame(() => {
      document.getElementById('invoice-detail-kam')?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    });
  }, [kamCardOpen]);

  useEffect(() => {
    if (!customerId) {
      setRcLink(null);
      return;
    }
    let cancelled = false;
    void findYesGatcRcForDealer(customerId)
      .then(link => {
        if (!cancelled) setRcLink(link);
      })
      .catch(() => {
        if (!cancelled) setRcLink(null);
      });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  const displayInvoice = useMemo(() => {
    if (!invoice) return null;
    return {
      ...invoice,
      lineItems: overlayLocalFreightOnLineItems(invoice),
    };
  }, [invoice]);

  if (!displayInvoice || !invoice) return null;

  const trackingLabel = existingBooking?.consignmentNo?.trim()
    || existingBooking?.trackingNo?.trim()
    || '';
  const selectedFreightSku = (effectiveInvoiceFreightSku(invoice) || null) as LocalFreightSelectSku | null;
  const freightItem = displayInvoice.lineItems.find(item => isFreightInvoiceLineItem(item));
  const selectedLineItemId = canEditLocalFreight && freightOpen
    ? (freightItem?.id ?? null)
    : null;

  const invoiceVoid = isVoidOrCancelledInvoiceStatus(invoice.status);
  const canAllotSerials = Boolean(
    user
    && (isOps || user.role === 'warehouse')
    && !invoiceVoid,
  );
  const needsSerialAllot = invoiceNeedsNonGatcSerialAllotment(displayInvoice.lineItems);
  const hasAllottedSerials = displayInvoice.lineItems.some(
    line => isNonGatcSerialEligibleLine(line) && serialNumbersFromLineItem(line).length > 0,
  );
  const yesgatcPushed = Boolean(invoice.yesgatcRcPushedAt);
  const canPushYesGatc = Boolean(canAllotSerials && rcLink && hasAllottedSerials);

  const actorName = user?.displayName?.trim() || user?.email?.trim() || 'YESWEIGH';
  const showVoidInvoice = Boolean(user && canVoidAdminInvoice(user) && !invoiceVoid);

  const zohoNotice = (result: { zohoPushed?: boolean; zohoError?: string }) => {
    if (result.zohoPushed) return ' Zoho invoice updated.';
    if (result.zohoError) return ` Zoho update failed: ${result.zohoError}`;
    return '';
  };

  const handleAllotSerials = async () => {
    if (!canAllotSerials || allotBusy) return;
    setAllotBusy(true);
    setAllotError('');
    setAllotNotice('');
    try {
      const result = await allotNonGatcSerialsToInvoice({
        customerId,
        invoiceId,
        actorName,
      });
      await reloadInvoice?.();
      if (result.shortage > 0) {
        setAllotError(
          `Allotted ${result.allotted.toLocaleString('en-IN')}. ${result.shortage.toLocaleString('en-IN')} still short — non GATC pool is empty.${zohoNotice(result)}`,
        );
      } else if (result.allotted > 0) {
        setAllotNotice(
          `Allotted ${result.allotted.toLocaleString('en-IN')} non-GATC serial${result.allotted === 1 ? '' : 's'}.${zohoNotice(result)}${result.yesgatcPushed ? ' Pushed to YesGATC.' : ''}`,
        );
      } else {
        setAllotNotice('No serials needed on this invoice.');
      }
    } catch (err) {
      setAllotError(err instanceof Error ? err.message : 'Could not allot serial numbers.');
    } finally {
      setAllotBusy(false);
    }
  };

  const handleUnlinkSerials = async (lineId?: string) => {
    if (!canAllotSerials || allotBusy) return;
    const ok = await confirm({
      title: 'Unlink serial numbers',
      message: lineId
        ? 'Return these serial numbers to the non-GATC pool and remove them from the Zoho invoice?'
        : 'Return all allotted serial numbers to the non-GATC pool and remove them from the Zoho invoice?',
      confirmLabel: 'Unlink',
      destructive: true,
    });
    if (!ok) return;
    setAllotBusy(true);
    setAllotError('');
    setAllotNotice('');
    try {
      const result = await unlinkNonGatcSerialsFromInvoice({
        customerId,
        invoiceId,
        actorName,
        lineId,
      });
      await reloadInvoice?.();
      if (result.released > 0) {
        setAllotNotice(
          `Unlinked ${result.released.toLocaleString('en-IN')} serial${result.released === 1 ? '' : 's'}.${zohoNotice(result)}`,
        );
      } else {
        setAllotNotice('No serial numbers to unlink.');
      }
    } catch (err) {
      setAllotError(err instanceof Error ? err.message : 'Could not unlink serial numbers.');
    } finally {
      setAllotBusy(false);
    }
  };

  const openGatcPicker = (
    lineId: string,
    need: number,
    title: string,
    capacityKg: number | null,
  ) => {
    if (!canAllotSerials || allotBusy || need <= 0) return;
    setGatcPickerError('');
    setGatcPicker({ lineId, need, title, capacityKg });
  };

  const handleSaveGatcSerials = async (certificateIds: string[]) => {
    if (!gatcPicker || !canAllotSerials || allotBusy) return;
    setAllotBusy(true);
    setGatcPickerError('');
    setAllotError('');
    setAllotNotice('');
    try {
      const result = await allotGatcStampedSerialsToInvoice({
        customerId,
        invoiceId,
        lineId: gatcPicker.lineId,
        certificateIds,
        actorName,
      });
      await reloadInvoice?.();
      setGatcPicker(null);
      setAllotNotice(
        `Linked ${result.allotted.toLocaleString('en-IN')} GATC serial${result.allotted === 1 ? '' : 's'}.${zohoNotice(result)}`,
      );
    } catch (err) {
      setGatcPickerError(err instanceof Error ? err.message : 'Could not save GATC serial numbers.');
    } finally {
      setAllotBusy(false);
    }
  };

  const handleUnlinkGatcSerials = async (lineId?: string) => {
    if (!canAllotSerials || allotBusy) return;
    const ok = await confirm({
      title: 'Unlink GATC serial numbers',
      message: lineId
        ? 'Remove these GATC serials from the invoice, unlink the certificates, and update Zoho?'
        : 'Remove all GATC serials from this invoice, unlink the certificates, and update Zoho?',
      confirmLabel: 'Unlink',
      destructive: true,
    });
    if (!ok) return;
    setAllotBusy(true);
    setAllotError('');
    setAllotNotice('');
    try {
      const result = await unlinkGatcStampedSerialsFromInvoice({
        customerId,
        invoiceId,
        actorName,
        lineId,
      });
      await reloadInvoice?.();
      if (result.released > 0) {
        setAllotNotice(
          `Unlinked ${result.released.toLocaleString('en-IN')} GATC serial${result.released === 1 ? '' : 's'}.${zohoNotice(result)}`,
        );
      } else {
        setAllotNotice('No GATC serial numbers to unlink.');
      }
    } catch (err) {
      setAllotError(err instanceof Error ? err.message : 'Could not unlink GATC serial numbers.');
    } finally {
      setAllotBusy(false);
    }
  };

  const handleVoidInvoice = async () => {
    if (!showVoidInvoice || voidBusy || allotBusy) return;
    const ok = await confirm({
      title: 'Void invoice',
      message: `Void ${invoice.invoiceNumber || 'this invoice'} in Zoho? Serial numbers will return to the pool and GATC certificates will be unlinked from this invoice.`,
      confirmLabel: 'Void invoice',
      destructive: true,
    });
    if (!ok) return;
    setVoidBusy(true);
    setAllotError('');
    setAllotNotice('');
    try {
      const result = await voidAdminInvoice({ customerId, invoiceId });
      await reloadInvoice?.();
      const released = Number(result.released) || 0;
      setAllotNotice(
        released > 0
          ? `Invoice voided in Zoho. Released ${released.toLocaleString('en-IN')} serial${released === 1 ? '' : 's'} and unlinked GATC certificates.`
          : 'Invoice voided in Zoho.',
      );
    } catch (err) {
      setAllotError(err instanceof Error ? err.message : 'Could not void this invoice.');
    } finally {
      setVoidBusy(false);
    }
  };

  const handlePushYesGatc = async () => {
    if (!canPushYesGatc || allotBusy) return;
    setAllotBusy(true);
    setAllotError('');
    setAllotNotice('');
    try {
      const result = await pushRcInvoiceToYesGatc({
        customerId,
        invoiceId,
        actorName,
        force: yesgatcPushed,
      });
      await reloadInvoice?.();
      if (result.pushed) {
        setAllotNotice(
          `Pushed to YesGATC${result.rc?.rcName ? ` · ${result.rc.rcName}` : ''}${result.qty != null ? ` · qty ${result.qty}` : ''}.`,
        );
      } else if (result.skipped === 'not_rc') {
        setAllotError('This dealer is not linked as an RC.');
      } else if (result.skipped === 'no_serials') {
        setAllotError('Allot serial numbers before pushing to YesGATC.');
      } else if (result.skipped === 'already_pushed') {
        setAllotNotice('Already pushed to YesGATC.');
      } else {
        setAllotError(result.error || 'Could not push this invoice to YesGATC.');
      }
    } catch (err) {
      setAllotError(err instanceof Error ? err.message : 'Could not push this invoice to YesGATC.');
    } finally {
      setAllotBusy(false);
    }
  };

  return (
    <>
      <DocumentPartyBlock
        className="mb-4"
        customerName={invoice.customerName}
        address={invoice.shippingAddress}
        telHref={invoice.customerTelHref}
        whatsappHref={invoice.customerWhatsappHref}
        emptyAddressLabel="No address on file"
      />

      {showKamCard ? (
        <div id="invoice-detail-kam">
          <DocumentKamStrip
            className="mb-4"
            salespersonId={invoice.salespersonId}
            salespersonName={invoice.salespersonName}
          />
        </div>
      ) : null}
      <RelatedSupportRequests
        dealerId={customerId}
        invoiceId={invoiceId}
        invoiceNumber={invoice.invoiceNumber}
      />
      <InvoiceDocumentBody
        invoice={displayInvoice}
        itemClassName="admin-invoice-detail-item"
        totalsAfterItems
        selectFreightOnly={canEditLocalFreight}
        selectedLineItemId={selectedLineItemId}
        onSelectLineItem={canEditLocalFreight ? (item) => {
          if (!isFreightInvoiceLineItem(item)) return;
          setFreightOpen(open => !open);
        } : undefined}
        renderExpanded={canEditLocalFreight && onChangeLocalFreight
          ? (item) => (
            isFreightInvoiceLineItem(item) ? (
              <InvoiceLocalFreightEditor
                invoice={invoice}
                selectedSku={selectedFreightSku}
                busy={localFreightBusy}
                error={localFreightError}
                onSelect={onChangeLocalFreight}
              />
            ) : null
          )
          : undefined}
        itemMeta={item => {
          const nonGatc = isNonGatcSerialEligibleLine(item);
          const gatcStamped = isGatcStampedSerialEligibleLine(item);
          if (!nonGatc && !gatcStamped) return null;
          const serials = serialNumbersFromLineItem(item);
          const short = nonGatc ? nonGatcSerialShortage(item) : gatcStampedSerialShortage(item);
          return (
            <div className="invoice-nongatc-serials">
              {serials.length ? (
                <p className="invoice-nongatc-serials__list">
                  Serial Numbers {serials.join(', ')}
                </p>
              ) : (
                <p className="invoice-nongatc-serials__empty">No serial numbers</p>
              )}
              {canAllotSerials && nonGatc && short > 0 ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm invoice-nongatc-serials__btn"
                  disabled={allotBusy}
                  onClick={e => {
                    e.stopPropagation();
                    void handleAllotSerials();
                  }}
                >
                  <Hash size={14} aria-hidden />
                  {allotBusy ? 'Allotting…' : `Allot serial numbers (${short})`}
                </button>
              ) : null}
              {canAllotSerials && gatcStamped && short > 0 ? (
                <button
                  type="button"
                  className="btn btn-sm invoice-nongatc-serials__btn invoice-nongatc-serials__btn--gatc"
                  disabled={allotBusy}
                  onClick={e => {
                    e.stopPropagation();
                    openGatcPicker(item.id, short, item.name, invoiceLineStampingCapacityKg(item));
                  }}
                >
                  <BadgeCheck size={14} aria-hidden />
                  {allotBusy ? 'Opening…' : `Add GATC serial number (${short})`}
                </button>
              ) : null}
              {canAllotSerials && serials.length ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm invoice-nongatc-serials__btn"
                  disabled={allotBusy}
                  onClick={e => {
                    e.stopPropagation();
                    void (gatcStamped ? handleUnlinkGatcSerials(item.id) : handleUnlinkSerials(item.id));
                  }}
                >
                  <Unlink size={14} aria-hidden />
                  {allotBusy ? 'Unlinking…' : gatcStamped ? 'Unlink GATC serial numbers' : 'Unlink serial numbers'}
                </button>
              ) : null}
              {canPushYesGatc && yesgatcPushed ? (
                <p className="invoice-nongatc-serials__yesgatc">Pushed to YesGATC</p>
              ) : null}
              {canPushYesGatc && !yesgatcPushed ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm invoice-nongatc-serials__btn"
                  disabled={allotBusy}
                  onClick={e => {
                    e.stopPropagation();
                    void handlePushYesGatc();
                  }}
                >
                  <Send size={14} aria-hidden />
                  {allotBusy ? 'Pushing…' : 'Push to YesGATC'}
                </button>
              ) : null}
            </div>
          );
        }}
        afterItems={
          <>
            {canPushYesGatc && !needsSerialAllot ? (
              <div className="invoice-nongatc-serials invoice-nongatc-serials--bar panel glass">
                {yesgatcPushed ? (
                  <p className="invoice-nongatc-serials__yesgatc">
                    Pushed to YesGATC
                    {invoice.yesgatcRcName ? ` · ${invoice.yesgatcRcName}` : rcLink ? ` · ${rcLink.rcName}` : ''}
                    {invoice.yesgatcRcCode ? ` · ${invoice.yesgatcRcCode}` : ''}
                  </p>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary invoice-nongatc-serials__btn"
                    disabled={allotBusy}
                    onClick={() => void handlePushYesGatc()}
                  >
                    <Send size={16} aria-hidden />
                    {allotBusy ? 'Pushing…' : 'Push to YesGATC'}
                  </button>
                )}
                {invoice.yesgatcRcPushError && !yesgatcPushed ? (
                  <p className="invoice-nongatc-serials__error">{invoice.yesgatcRcPushError}</p>
                ) : null}
                {allotError ? <p className="invoice-nongatc-serials__error">{allotError}</p> : null}
                {allotNotice ? <p className="invoice-nongatc-serials__ok">{allotNotice}</p> : null}
              </div>
            ) : null}
            {canAllotSerials && needsSerialAllot ? (
              <div className="invoice-nongatc-serials invoice-nongatc-serials--bar panel glass">
                <button
                  type="button"
                  className="btn btn-primary invoice-nongatc-serials__btn"
                  disabled={allotBusy}
                  onClick={() => void handleAllotSerials()}
                >
                  <Hash size={16} aria-hidden />
                  {allotBusy ? 'Allotting…' : 'Allot serial numbers'}
                </button>
                {allotError ? <p className="invoice-nongatc-serials__error">{allotError}</p> : null}
                {allotNotice ? <p className="invoice-nongatc-serials__ok">{allotNotice}</p> : null}
              </div>
            ) : allotError || allotNotice ? (
              <div className="invoice-nongatc-serials invoice-nongatc-serials--bar panel glass">
                {allotError ? <p className="invoice-nongatc-serials__error">{allotError}</p> : null}
                {allotNotice ? <p className="invoice-nongatc-serials__ok">{allotNotice}</p> : null}
              </div>
            ) : null}
          {showManualLogistics || showMarkDelivered || showVoidInvoice || (existingBooking && trackingLabel) ? (
            <div className="invoice-manual-logistics panel glass">
              <div className="invoice-manual-logistics__actions">
                {showManualLogistics ? (
                  <button
                    type="button"
                    className="btn btn-secondary invoice-manual-logistics__btn"
                    onClick={onOpenManualLogistics}
                    title="Enter tracking number and box count only — no courier API booking"
                  >
                    <PackagePlus size={18} aria-hidden />
                    Manual Logistics
                  </button>
                ) : null}
                {showMarkDelivered ? (
                  <button
                    type="button"
                    className="btn btn-primary invoice-manual-logistics__btn"
                    onClick={onOpenMarkDelivered}
                    title="Mark delivered without a logistics booking"
                  >
                    <CheckCircle2 size={18} aria-hidden />
                    Mark as delivered
                  </button>
                ) : null}
                {showVoidInvoice ? (
                  <button
                    type="button"
                    className="btn invoice-manual-logistics__btn invoice-void-invoice-btn"
                    disabled={voidBusy || allotBusy}
                    onClick={() => void handleVoidInvoice()}
                    title="Void this invoice in Zoho, release serials, and unlink GATC certificates"
                  >
                    <Ban size={18} aria-hidden />
                    {voidBusy ? 'Voiding…' : 'Void Invoice'}
                  </button>
                ) : null}
              </div>
              {existingBooking && trackingLabel && !showManualLogistics && !showMarkDelivered ? (
                <p className="text-sm invoice-manual-logistics__saved">
                  Logistics:
                  {' '}
                  <strong>{trackingLabel}</strong>
                  {existingBooking.numberOfBoxes
                    ? ` · ${existingBooking.numberOfBoxes} box${existingBooking.numberOfBoxes === 1 ? '' : 'es'}`
                    : ''}
                </p>
              ) : null}
              {showManualLogistics ? (
                <p className="text-muted text-sm invoice-manual-logistics__hint">
                  {manualLogisticsPartnerFromFreight
                    ? (
                      <>
                        Record an existing
                        {' '}
                        {logisticsPartnerLabel(manualLogisticsPartnerId)}
                        {' '}
                        tracking number and box count — no booking automation.
                      </>
                    )
                    : (
                      <>
                        No freight line on this invoice — choose the delivery partner,
                        then enter tracking number and box count.
                      </>
                    )}
                </p>
              ) : showMarkDelivered ? (
                <p className="text-muted text-sm invoice-manual-logistics__hint">
                  Mark this invoice delivered even if no AWB or logistics booking exists.
                </p>
              ) : showVoidInvoice ? (
                <p className="text-muted text-sm invoice-manual-logistics__hint">
                  Void this invoice in Zoho. Serial numbers return to the pool and GATC
                  certificates are unlinked.
                </p>
              ) : null}
            </div>
          ) : null}
          </>
        }
      />
      {gatcPicker ? (
        <GatcSerialPickerDialog
          title={gatcPicker.title}
          need={gatcPicker.need}
          capacityKg={gatcPicker.capacityKg}
          saving={allotBusy}
          error={gatcPickerError}
          onClose={() => {
            if (!allotBusy) {
              setGatcPicker(null);
              setGatcPickerError('');
            }
          }}
          onSave={ids => void handleSaveGatcSerials(ids)}
        />
      ) : null}
    </>
  );
};
