import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  type DocumentData,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { User } from '../types';
import { normalizeRole } from '../types';
import {
  allowedSupportTypesForUser,
  canManageSupportOps,
  isInternalOpsUser,
} from '../lib/staffAccess';
import type {
  CreateSupportRequestInput,
  DealerSupportRequest,
  SaveSupportRequestDraftInput,
  SendSupportMessageInput,
  SupportAssignee,
  SupportLifecycle,
  SupportMessage,
  SupportOpenStage,
  SupportRequestType,
} from '../types/dealer-support';
import { uploadSupportAttachments, type SupportSubmitProgress } from './supportAttachments';
import {
  canDealerCancelSupportRequest,
  isProductCourierType,
  isSupportDraft,
  isSupportOpen,
  isSupportClosed,
  legacyStatusToLifecycle,
  validateLifecycleTransition,
  validateOpenStageTransition,
} from './supportStatus';

const REQUEST_PREFIX: Record<SupportRequestType, string> = {
  service: 'SRV',
  return: 'RMA',
  complaint: 'CMP',
};

function resolveDealerId(user: User): string {
  if (user.role === 'dealer') return user.uid;
  if (user.dealerId) return user.dealerId;
  return user.uid;
}

function buildRequestNumber(type: SupportRequestType): string {
  const year = new Date().getFullYear();
  const suffix = String(Math.floor(Math.random() * 900000) + 100000);
  return `${REQUEST_PREFIX[type]}-${year}-${suffix}`;
}

function previewText(text: string, attachmentCount: number): string {
  const trimmed = text.trim();
  if (trimmed) return trimmed.slice(0, 140);
  if (attachmentCount > 0) return `${attachmentCount} attachment${attachmentCount > 1 ? 's' : ''}`;
  return 'New message';
}

function mapAttachment(raw: DocumentData): SupportMessage['attachments'][number] {
  return {
    id: String(raw.id ?? ''),
    kind: raw.kind === 'video' ? 'video' : 'image',
    url: String(raw.url ?? ''),
    storagePath: String(raw.storagePath ?? ''),
    fileName: String(raw.fileName ?? 'file'),
    mimeType: String(raw.mimeType ?? ''),
    size: Number(raw.size ?? 0),
  };
}

function mapMessage(id: string, data: DocumentData): SupportMessage {
  const attachmentsRaw = Array.isArray(data.attachments) ? data.attachments : [];
  return {
    id,
    text: String(data.text ?? ''),
    attachments: attachmentsRaw.map(item => mapAttachment(item as DocumentData)),
    authorUid: String(data.authorUid ?? ''),
    authorName: String(data.authorName ?? ''),
    authorRole: String(data.authorRole ?? ''),
    createdAt: String(data.createdAt ?? ''),
    isInitial: data.isInitial === true,
  };
}

function readLifecycleFields(data: DocumentData): {
  lifecycle: SupportLifecycle;
  openStage: SupportOpenStage | null;
} {
  if (data.lifecycle) {
    return {
      lifecycle: data.lifecycle as SupportLifecycle,
      openStage: data.openStage ? (data.openStage as SupportOpenStage) : null,
    };
  }
  return legacyStatusToLifecycle(
    String(data.status ?? 'pending'),
    data.assignedToUid ? String(data.assignedToUid) : null,
  );
}

export function mapSupportRequest(id: string, data: DocumentData): DealerSupportRequest {
  const product = data.product as DocumentData | undefined;
  const { lifecycle, openStage } = readLifecycleFields(data);

  return {
    id,
    type: (data.type ?? 'service') as SupportRequestType,
    requestNumber: String(data.requestNumber ?? ''),
    lifecycle,
    openStage: lifecycle === 'open' ? openStage : null,
    invoiceId: data.invoiceId ? String(data.invoiceId) : null,
    invoiceNumber: data.invoiceNumber ? String(data.invoiceNumber) : null,
    salesOrderNumber: data.salesOrderNumber ? String(data.salesOrderNumber) : null,
    product: product
      ? {
          lineItemId: product.lineItemId ? String(product.lineItemId) : null,
          itemId: product.itemId ? String(product.itemId) : null,
          name: String(product.name ?? 'Product'),
          sku: product.sku ? String(product.sku) : null,
          quantity: Number(product.quantity ?? 1),
          serialNumber: product.serialNumber ? String(product.serialNumber) : null,
        }
      : null,
    category: String(data.category ?? ''),
    subject: data.subject ? String(data.subject) : null,
    description: String(data.description ?? ''),
    notes: data.notes ? String(data.notes) : null,
    createdAt: String(data.createdAt ?? ''),
    updatedAt: String(data.updatedAt ?? data.createdAt ?? ''),
    lastMessageAt: data.lastMessageAt ? String(data.lastMessageAt) : null,
    lastMessagePreview: data.lastMessagePreview ? String(data.lastMessagePreview) : null,
    createdByUid: String(data.createdByUid ?? ''),
    createdByName: String(data.createdByName ?? ''),
    dealerId: String(data.dealerId ?? ''),
    dealerName: data.dealerName ? String(data.dealerName) : null,
    assignedToUid: data.assignedToUid ? String(data.assignedToUid) : null,
    assignedToName: data.assignedToName ? String(data.assignedToName) : null,
    assignedAt: data.assignedAt ? String(data.assignedAt) : null,
    courierTracking: data.courierTracking ? String(data.courierTracking) : null,
    shippedAt: data.shippedAt ? String(data.shippedAt) : null,
    receivedAt: data.receivedAt ? String(data.receivedAt) : null,
    resolvedAt: data.resolvedAt ? String(data.resolvedAt) : null,
    resolutionSummary: data.resolutionSummary ? String(data.resolutionSummary) : null,
  };
}

export function supportBasePath(role: User['role']): string {
  const base = role === 'super_admin'
    ? '/super-admin'
    : role === 'dealer_staff'
      ? '/dealer-staff'
      : role === 'staff'
        ? '/staff'
        : '/dealer';
  return `${base}/warranty-support`;
}

export function supportDetailPath(role: User['role'], requestId: string): string {
  return `${supportBasePath(role)}/${requestId}`;
}

export function canUserAccessSupportRequest(user: User, request: DealerSupportRequest): boolean {
  if (user.role === 'super_admin') return true;
  if (user.role === 'staff') {
    const allowed = allowedSupportTypesForUser(user);
    if (allowed === 'all') return true;
    if (allowed.length === 0) return false;
    return allowed.includes(request.type);
  }
  if (request.createdByUid === user.uid) return true;
  const dealerId = resolveDealerId(user);
  return request.dealerId === dealerId;
}

export async function getSupportRequest(requestId: string): Promise<DealerSupportRequest | null> {
  const current = await getDoc(doc(db, 'dealerSupportRequests', requestId));
  if (!current.exists()) return null;
  return mapSupportRequest(current.id, current.data());
}

function messageStageUpdates(
  user: User,
  request: DealerSupportRequest,
  isInitial: boolean,
): Record<string, string | null> {
  if (!isSupportOpen(request) || !request.openStage || isInitial) return {};

  if (isInternalOpsUser(user)) {
    if (
      request.openStage === 'submitted'
      || request.openStage === 'under_review'
      || request.openStage === 'in_workshop'
    ) {
      return { openStage: 'awaiting_dealer' };
    }
    return {};
  }

  if (request.openStage === 'awaiting_dealer') {
    return { openStage: 'under_review' };
  }

  return {};
}

export async function sendSupportMessage(
  user: User,
  requestId: string,
  input: SendSupportMessageInput,
  onProgress?: (progress: SupportSubmitProgress) => void,
): Promise<SupportMessage> {
  const request = await getSupportRequest(requestId);
  if (!request) throw new Error('Support request not found.');
  if (!canUserAccessSupportRequest(user, request)) {
    throw new Error('You do not have permission to message this request.');
  }
  if (!isInternalOpsUser(user) && isSupportClosed(request)) {
    throw new Error('This request is closed and cannot receive new messages.');
  }
  if (!isInternalOpsUser(user) && isSupportDraft(request) && !input.isInitial) {
    throw new Error('Submit the draft before sending messages.');
  }

  const text = input.text.trim();
  const files = input.files ?? [];
  if (!text && files.length === 0) {
    throw new Error('Enter a message or attach a file.');
  }

  const messageRef = doc(collection(db, 'dealerSupportRequests', requestId, 'messages'));
  const attachments = files.length
    ? await uploadSupportAttachments(requestId, messageRef.id, files, onProgress, {
        isInitial: input.isInitial === true,
      })
    : [];

  onProgress?.({
    phase: 'finalizing',
    label: 'Saving your request…',
    percent: 96,
  });

  const now = new Date().toISOString();
  const payload = {
    text,
    attachments,
    authorUid: user.uid,
    authorName: user.displayName,
    authorRole: user.role,
    createdAt: now,
    isInitial: input.isInitial === true,
  };

  const updates: Record<string, string | null> = {
    updatedAt: now,
    lastMessageAt: now,
    lastMessagePreview: previewText(text, attachments.length),
    ...messageStageUpdates(user, request, input.isInitial === true),
  };

  if (
    canManageSupportOps(user)
    && isSupportOpen(request)
    && request.openStage === 'submitted'
    && request.type === 'complaint'
  ) {
    updates.openStage = 'under_review';
  }

  await setDoc(messageRef, payload);

  try {
    await updateDoc(doc(db, 'dealerSupportRequests', requestId), updates);
  } catch (updateErr) {
    console.error('Support request metadata update failed:', updateErr);
  }

  return mapMessage(messageRef.id, payload);
}

function buildSupportProduct(
  input: Pick<
    CreateSupportRequestInput,
    | 'itemName'
    | 'invoiceNumber'
    | 'lineItemId'
    | 'itemId'
    | 'itemSku'
    | 'quantity'
    | 'serialNumber'
  >,
) {
  const hasProduct = Boolean(input.itemName?.trim() || input.invoiceNumber?.trim());
  if (!hasProduct) return null;
  return {
    lineItemId: input.lineItemId ?? null,
    itemId: input.itemId ?? null,
    name: input.itemName?.trim() || 'Product',
    sku: input.itemSku ?? null,
    quantity: input.quantity ?? 1,
    serialNumber: input.serialNumber?.trim() || null,
  };
}

function buildSupportRequestDocument(
  user: User,
  input: {
    type: SupportRequestType;
    lifecycle: SupportLifecycle;
    openStage?: SupportOpenStage | null;
    requestNumber: string;
    invoiceId?: string | null;
    invoiceNumber?: string | null;
    salesOrderNumber?: string | null;
    lineItemId?: string | null;
    itemId?: string | null;
    itemName?: string;
    itemSku?: string | null;
    serialNumber?: string | null;
    quantity?: number;
    category: string;
    subject?: string;
    description: string;
    notes?: string;
    createdAt: string;
    updatedAt: string;
    lastMessageAt?: string | null;
    lastMessagePreview?: string | null;
  },
) {
  return {
    type: input.type,
    requestNumber: input.requestNumber,
    lifecycle: input.lifecycle,
    openStage: input.lifecycle === 'open' ? (input.openStage ?? 'submitted') : null,
    invoiceId: input.invoiceId ?? null,
    invoiceNumber: input.invoiceNumber?.trim() || null,
    salesOrderNumber: input.salesOrderNumber ?? null,
    product: buildSupportProduct(input),
    category: input.category.trim(),
    subject: input.subject?.trim() || null,
    description: input.description.trim(),
    notes: input.notes?.trim() || null,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    lastMessageAt: input.lastMessageAt ?? null,
    lastMessagePreview: input.lastMessagePreview ?? null,
    createdByUid: user.uid,
    createdByName: user.displayName,
    dealerId: resolveDealerId(user),
    dealerName: user.displayName,
    assignedToUid: null,
    assignedToName: null,
    assignedAt: null,
    courierTracking: null,
    shippedAt: null,
    receivedAt: null,
    resolvedAt: null,
    resolutionSummary: null,
  };
}

async function finalizeSupportSubmit(requestId: string): Promise<void> {
  await updateDoc(doc(db, 'dealerSupportRequests', requestId), {
    lifecycle: 'open',
    openStage: 'submitted',
    updatedAt: new Date().toISOString(),
  });
}

export async function saveSupportRequestDraft(
  user: User,
  input: SaveSupportRequestDraftInput,
): Promise<DealerSupportRequest> {
  const now = new Date().toISOString();

  if (input.requestId) {
    const existing = await getSupportRequest(input.requestId);
    if (!existing) throw new Error('Draft not found.');
    if (!canUserAccessSupportRequest(user, existing)) {
      throw new Error('You do not have permission to edit this draft.');
    }
    if (!isSupportDraft(existing)) {
      throw new Error('Only drafts can be saved this way.');
    }

    const updates = {
      type: input.type,
      invoiceId: input.invoiceId ?? null,
      invoiceNumber: input.invoiceNumber?.trim() || null,
      salesOrderNumber: input.salesOrderNumber ?? null,
      product: buildSupportProduct(input),
      category: input.category?.trim() ?? '',
      subject: input.subject?.trim() || null,
      description: input.description?.trim() ?? '',
      notes: input.notes?.trim() || null,
      updatedAt: now,
    };

    await updateDoc(doc(db, 'dealerSupportRequests', input.requestId), updates);
    return (await getSupportRequest(input.requestId))!;
  }

  const data = buildSupportRequestDocument(user, {
    type: input.type,
    lifecycle: 'draft',
    requestNumber: buildRequestNumber(input.type),
    invoiceId: input.invoiceId,
    invoiceNumber: input.invoiceNumber,
    salesOrderNumber: input.salesOrderNumber,
    lineItemId: input.lineItemId,
    itemId: input.itemId,
    itemName: input.itemName,
    itemSku: input.itemSku,
    serialNumber: input.serialNumber,
    quantity: input.quantity,
    category: input.category?.trim() ?? '',
    subject: input.subject,
    description: input.description?.trim() ?? '',
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
  });

  const docRef = await addDoc(collection(db, 'dealerSupportRequests'), data);
  return mapSupportRequest(docRef.id, data);
}

export async function createSupportRequest(
  user: User,
  input: CreateSupportRequestInput,
  onProgress?: (progress: SupportSubmitProgress) => void,
): Promise<DealerSupportRequest> {
  const now = new Date().toISOString();
  const description = input.description.trim();

  onProgress?.({
    phase: 'preparing',
    label: 'Creating request…',
    percent: 4,
  });

  if (input.requestId) {
    const existing = await getSupportRequest(input.requestId);
    if (!existing) throw new Error('Draft not found.');
    if (!canUserAccessSupportRequest(user, existing)) {
      throw new Error('You do not have permission to submit this draft.');
    }
    if (!isSupportDraft(existing)) {
      throw new Error('This request has already been submitted.');
    }

    const data = buildSupportRequestDocument(user, {
      type: input.type,
      lifecycle: 'draft',
      requestNumber: existing.requestNumber,
      invoiceId: input.invoiceId,
      invoiceNumber: input.invoiceNumber,
      salesOrderNumber: input.salesOrderNumber,
      lineItemId: input.lineItemId,
      itemId: input.itemId,
      itemName: input.itemName,
      itemSku: input.itemSku,
      serialNumber: input.serialNumber,
      quantity: input.quantity,
      category: input.category.trim(),
      subject: input.subject,
      description,
      notes: input.notes,
      createdAt: existing.createdAt,
      updatedAt: now,
    });

    const draftRef = doc(db, 'dealerSupportRequests', input.requestId);
    await updateDoc(draftRef, data);
    await sendSupportMessage(user, input.requestId, {
      text: description,
      files: input.attachmentFiles,
      isInitial: true,
    }, onProgress);
    await finalizeSupportSubmit(input.requestId);
    onProgress?.({ phase: 'finalizing', label: 'Done', percent: 100 });
    return (await getSupportRequest(input.requestId))!;
  }

  const data = buildSupportRequestDocument(user, {
    type: input.type,
    lifecycle: 'draft',
    requestNumber: buildRequestNumber(input.type),
    invoiceId: input.invoiceId,
    invoiceNumber: input.invoiceNumber,
    salesOrderNumber: input.salesOrderNumber,
    lineItemId: input.lineItemId,
    itemId: input.itemId,
    itemName: input.itemName,
    itemSku: input.itemSku,
    serialNumber: input.serialNumber,
    quantity: input.quantity,
    category: input.category.trim(),
    subject: input.subject,
    description,
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
  });

  const docRef = await addDoc(collection(db, 'dealerSupportRequests'), data);

  try {
    await sendSupportMessage(user, docRef.id, {
      text: description,
      files: input.attachmentFiles,
      isInitial: true,
    }, onProgress);
    await finalizeSupportSubmit(docRef.id);
  } catch (err) {
    await deleteDoc(docRef);
    throw err;
  }

  onProgress?.({ phase: 'finalizing', label: 'Done', percent: 100 });
  return (await getSupportRequest(docRef.id))!;
}

export function subscribeSupportMessages(
  requestId: string,
  onData: (messages: SupportMessage[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(db, 'dealerSupportRequests', requestId, 'messages'),
    orderBy('createdAt', 'asc'),
  );
  return onSnapshot(
    q,
    snap => {
      onData(snap.docs.map(docSnap => mapMessage(docSnap.id, docSnap.data())));
    },
    err => onError?.(err instanceof Error ? err : new Error('Could not load messages.')),
  );
}

export function subscribeSupportRequest(
  requestId: string,
  onData: (request: DealerSupportRequest | null) => void,
): Unsubscribe {
  return onSnapshot(doc(db, 'dealerSupportRequests', requestId), snap => {
    if (!snap.exists()) {
      onData(null);
      return;
    }
    onData(mapSupportRequest(snap.id, snap.data()));
  });
}

export async function fetchDealerSupportRequests(user: User): Promise<DealerSupportRequest[]> {
  const dealerId = resolveDealerId(user);

  const snap = await getDocs(
    query(
      collection(db, 'dealerSupportRequests'),
      where('dealerId', '==', dealerId),
      orderBy('updatedAt', 'desc'),
      limit(100),
    ),
  );

  return snap.docs.map(docSnap => mapSupportRequest(docSnap.id, docSnap.data()));
}

function excludeDraftSupportRequests(requests: DealerSupportRequest[]): DealerSupportRequest[] {
  return requests.filter(request => !isSupportDraft(request));
}

export async function fetchOpsSupportRequests(): Promise<DealerSupportRequest[]> {
  const snap = await getDocs(
    query(
      collection(db, 'dealerSupportRequests'),
      orderBy('updatedAt', 'desc'),
      limit(200),
    ),
  );
  return excludeDraftSupportRequests(
    snap.docs.map(docSnap => mapSupportRequest(docSnap.id, docSnap.data())),
  );
}

export function subscribeOpsSupportRequests(
  onData: (rows: DealerSupportRequest[]) => void,
  onError?: (err: Error) => void,
): Unsubscribe {
  const q = query(
    collection(db, 'dealerSupportRequests'),
    orderBy('updatedAt', 'desc'),
    limit(200),
  );
  return onSnapshot(
    q,
    snap => {
      onData(excludeDraftSupportRequests(
        snap.docs.map(docSnap => mapSupportRequest(docSnap.id, docSnap.data())),
      ));
    },
    err => onError?.(err instanceof Error ? err : new Error('Could not load support queue.')),
  );
}

export async function fetchSupportRequestsForInvoice(
  dealerId: string,
  invoiceId: string,
): Promise<DealerSupportRequest[]> {
  const snap = await getDocs(
    query(
      collection(db, 'dealerSupportRequests'),
      where('dealerId', '==', dealerId),
      where('invoiceId', '==', invoiceId),
      orderBy('updatedAt', 'desc'),
      limit(20),
    ),
  );
  return excludeDraftSupportRequests(
    snap.docs.map(docSnap => mapSupportRequest(docSnap.id, docSnap.data())),
  );
}

export async function fetchSupportAssignees(): Promise<SupportAssignee[]> {
  const snap = await getDocs(
    query(
      collection(db, 'users'),
      where('active', '==', true),
      limit(200),
    ),
  );
  const rows: SupportAssignee[] = [];
  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const role = normalizeRole(String(data.role ?? ''));
    const profile = {
      uid: docSnap.id,
      role,
      staffPermissions: data.staffPermissions,
      staffAccessMode: data.staffAccessMode,
      staffDepartment: data.staffDepartment,
    } as User;
    if (role !== 'staff' && role !== 'super_admin') continue;
    if (!canManageSupportOps(profile)) continue;
    rows.push({
      uid: docSnap.id,
      displayName: String(data.displayName ?? 'Staff'),
      role,
    });
  }
  return rows.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

export async function assignSupportRequest(
  user: User,
  requestId: string,
  assignee: SupportAssignee | null,
): Promise<void> {
  if (!canManageSupportOps(user)) {
    throw new Error('Only staff can assign support requests.');
  }
  const request = await getSupportRequest(requestId);
  if (!request) throw new Error('Support request not found.');

  const now = new Date().toISOString();
  const updates: Record<string, string | null> = {
    assignedToUid: assignee?.uid ?? null,
    assignedToName: assignee?.displayName ?? null,
    assignedAt: assignee ? now : null,
    updatedAt: now,
  };

  if (
    assignee
    && isSupportOpen(request)
    && request.openStage === 'submitted'
  ) {
    updates.openStage = 'under_review';
  }

  await updateDoc(doc(db, 'dealerSupportRequests', requestId), updates);
}

export async function updateSupportOpenStage(
  user: User,
  requestId: string,
  openStage: SupportOpenStage,
): Promise<void> {
  if (!canManageSupportOps(user)) {
    throw new Error('Only staff can update request stage.');
  }
  const request = await getSupportRequest(requestId);
  if (!request) throw new Error('Support request not found.');

  const transitionError = validateOpenStageTransition(request, openStage);
  if (transitionError) throw new Error(transitionError);

  const now = new Date().toISOString();
  const updates: Record<string, string | null> = {
    openStage,
    updatedAt: now,
  };

  if (openStage === 'in_workshop' && !request.receivedAt) {
    updates.receivedAt = now;
  }

  await updateDoc(doc(db, 'dealerSupportRequests', requestId), updates);
}

export async function resolveSupportRequest(
  user: User,
  requestId: string,
  resolutionSummary?: string,
): Promise<void> {
  if (!canManageSupportOps(user)) {
    throw new Error('Only staff can resolve support requests.');
  }
  const request = await getSupportRequest(requestId);
  if (!request) throw new Error('Support request not found.');

  const transitionError = validateLifecycleTransition(request, 'resolved');
  if (transitionError) throw new Error(transitionError);

  const now = new Date().toISOString();
  await updateDoc(doc(db, 'dealerSupportRequests', requestId), {
    lifecycle: 'resolved',
    openStage: null,
    resolvedAt: now,
    resolutionSummary: resolutionSummary?.trim() || null,
    updatedAt: now,
  });
}

export async function cancelSupportRequest(
  user: User,
  requestId: string,
): Promise<void> {
  const request = await getSupportRequest(requestId);
  if (!request) throw new Error('Support request not found.');

  if (canManageSupportOps(user)) {
    const transitionError = validateLifecycleTransition(request, 'cancelled');
    if (transitionError) throw new Error(transitionError);
  } else if (!canUserAccessSupportRequest(user, request) || !isSupportOpen(request)) {
    throw new Error('You cannot cancel this request.');
  } else if (!canDealerCancelSupportRequest(request)) {
    throw new Error('This request can no longer be cancelled here. Contact YesOne support.');
  }

  const now = new Date().toISOString();
  await updateDoc(doc(db, 'dealerSupportRequests', requestId), {
    lifecycle: 'cancelled',
    openStage: null,
    updatedAt: now,
  });
}

export async function approveSupportRequestForCourier(
  user: User,
  requestId: string,
): Promise<void> {
  const request = await getSupportRequest(requestId);
  if (!request) throw new Error('Support request not found.');
  if (!isProductCourierType(request.type)) {
    throw new Error('Only repair and replacement requests can be approved for courier.');
  }
  await updateSupportOpenStage(user, requestId, 'awaiting_product');
}

export async function markSupportProductReceived(
  user: User,
  requestId: string,
): Promise<void> {
  await updateSupportOpenStage(user, requestId, 'in_workshop');
}

export async function markSupportProductShipped(
  user: User,
  requestId: string,
  courierTracking?: string,
): Promise<void> {
  const request = await getSupportRequest(requestId);
  if (!request) throw new Error('Support request not found.');
  if (!canUserAccessSupportRequest(user, request)) {
    throw new Error('You do not have permission to update this request.');
  }
  if (!isSupportOpen(request) || request.openStage !== 'awaiting_product') {
    throw new Error('Shipping is only available after courier approval.');
  }

  const now = new Date().toISOString();
  await updateDoc(doc(db, 'dealerSupportRequests', requestId), {
    openStage: 'in_transit',
    courierTracking: courierTracking?.trim() || null,
    shippedAt: now,
    updatedAt: now,
  });
}

async function deleteSupportRequestMessages(requestId: string): Promise<void> {
  const messagesSnap = await getDocs(
    collection(db, 'dealerSupportRequests', requestId, 'messages'),
  );
  await Promise.all(messagesSnap.docs.map(msgDoc => deleteDoc(msgDoc.ref)));
}

export async function deleteSupportRequestDraft(
  user: User,
  requestId: string,
): Promise<void> {
  const request = await getSupportRequest(requestId);
  if (!request) throw new Error('Draft not found.');
  if (!isSupportDraft(request)) throw new Error('Only drafts can be discarded.');
  if (!canUserAccessSupportRequest(user, request)) {
    throw new Error('You do not have permission to delete this draft.');
  }
  await deleteSupportRequestMessages(requestId);
  await deleteDoc(doc(db, 'dealerSupportRequests', requestId));
}

export async function deleteSupportRequest(
  user: User,
  requestId: string,
): Promise<void> {
  if (user.role !== 'super_admin') {
    throw new Error('Only super admin can permanently delete support tickets.');
  }
  await deleteSupportRequestMessages(requestId);
  await deleteDoc(doc(db, 'dealerSupportRequests', requestId));
}
