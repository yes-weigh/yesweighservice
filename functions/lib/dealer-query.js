function parseListParam(value) {
  if (!value || value === 'all') return [];
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value).split(',').map(s => s.trim()).filter(Boolean);
}

function getDealerStatusKey(dealer) {
  const stage = dealer.dealerStage;
  const signed = Boolean(dealer.portalUserId);
  if (stage === 'Active') return signed ? 'active-yes' : 'active-no';
  if (stage === 'Non Active') return signed ? 'non-active-yes' : 'non-active-no';
  if (stage === 'Black listed' || stage === 'Blacklisted') {
    return signed ? 'blacklisted-yes' : 'blacklisted-no';
  }
  return signed ? 'unset-yes' : 'unset-no';
}

function normalizeCategories(categories) {
  if (!categories) return [];
  if (Array.isArray(categories)) return categories.map(String);
  try {
    const parsed = JSON.parse(categories);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [String(categories)];
  }
}

export function filterDealers(dealers, query = {}) {
  let list = [...dealers];

  const explicitStageFilter = query.dealerStage && query.dealerStage !== 'all'
    && parseListParam(query.dealerStage).length > 0;
  const explicitStatusFilter = query.dealerStatus
    && parseListParam(query.dealerStatus).length > 0;

  if (!explicitStageFilter && !explicitStatusFilter) {
    const isFiltered = query.isFiltered === true || query.isFiltered === 'true';
    list = list.filter(d => Boolean(d.isFiltered) === isFiltered);
    if (isFiltered) {
      list = list.filter(d => d.filterReason === 'Manual');
    }
  }

  if (query.q?.trim()) {
    const q = query.q.trim().toLowerCase();
    list = list.filter(d =>
      String(d.contactName ?? '').toLowerCase().includes(q)
      || String(d.companyName ?? '').toLowerCase().includes(q),
    );
  }

  if (query.status && query.status !== 'all') {
    list = list.filter(d => d.status === query.status);
  }

  const kamIds = parseListParam(query.kamId);
  if (kamIds.length > 0) {
    if (kamIds.includes('unassigned')) {
      const assigned = kamIds.filter(a => a !== 'unassigned');
      list = list.filter(d =>
        !d.kamId || assigned.includes(d.kamId),
      );
    } else {
      list = list.filter(d => d.kamId && kamIds.includes(d.kamId));
    }
  }

  const stages = parseListParam(query.dealerStage);
  if (stages.length > 0) {
    list = list.filter(d => d.dealerStage && stages.includes(d.dealerStage));
  }

  const statusKeys = parseListParam(query.dealerStatus);
  if (statusKeys.length > 0) {
    list = list.filter(d => statusKeys.includes(getDealerStatusKey(d)));
  }

  const states = parseListParam(query.billingState);
  if (states.length > 0) {
    list = list.filter(d => d.billingState && states.includes(d.billingState));
  }

  const districts = parseListParam(query.district);
  if (districts.length > 0) {
    list = list.filter(d => d.district && districts.includes(d.district));
  }

  const cats = parseListParam(query.categories);
  if (cats.length > 0) {
    list = list.filter(d => {
      const rowCats = normalizeCategories(d.categories);
      return cats.some(c => rowCats.includes(c));
    });
  }

  if (query.signedIn === 'true') {
    list = list.filter(d => Boolean(d.portalUserId));
  } else if (query.signedIn === 'false') {
    list = list.filter(d => !d.portalUserId);
  }

  return list;
}

export function sortDealers(dealers, sortField = 'contactName', sortDir = 'asc') {
  const dir = sortDir === 'desc' ? -1 : 1;
  const field = sortField || 'contactName';

  return [...dealers].sort((a, b) => {
    if (field === 'phone') {
      const av = String(a.phone || a.mobile || '');
      const bv = String(b.phone || b.mobile || '');
      return av.localeCompare(bv) * dir;
    }
    const av = a[field] ?? '';
    const bv = b[field] ?? '';
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    return String(av).localeCompare(String(bv)) * dir;
  });
}

export function paginateDealers(dealers, page = 1, limit = 50) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 50));
  const skip = (safePage - 1) * safeLimit;
  return {
    data: dealers.slice(skip, skip + safeLimit),
    pagination: {
      total: dealers.length,
      page: safePage,
      limit: safeLimit,
      totalPages: Math.ceil(dealers.length / safeLimit) || 1,
    },
  };
}

export function dealerStats(dealers) {
  const activeRoster = dealers.filter(d => !d.isFiltered);
  return {
    total: activeRoster.length,
    active: activeRoster.filter(d => d.dealerStage === 'Active').length,
    blacklisted: dealers.filter(d => d.dealerStage === 'Blacklisted' || d.dealerStage === 'Black listed').length,
    inactive: activeRoster.filter(d => d.status === 'inactive').length,
    unassignedKam: activeRoster.filter(d => !d.kamId).length,
  };
}

export function dealerLocations(dealers) {
  const active = dealers.filter(d => !d.isFiltered);
  const states = Array.from(new Set(active.map(d => d.billingState).filter(Boolean))).sort();
  const districtsByState = {};
  for (const state of states) {
    districtsByState[state] = Array.from(new Set(
      active.filter(d => d.billingState === state && d.district).map(d => d.district),
    )).sort();
  }
  return { states, districtsByState };
}

export function dealersToCsv(dealers, kamsById = new Map()) {
  const headers = ['Dealer Name', 'Contact', 'Phone', 'KAM', 'State', 'District', 'Categories', 'Stage', 'Signed In'];
  const escapeCsv = str => {
    if (str == null || str === '') return '';
    return `"${String(str).replace(/"/g, '""')}"`;
  };

  const rows = [headers.join(',')];
  for (const d of dealers) {
    const cats = normalizeCategories(d.categories);
    const name = d.companyName || d.contactName;
    const phone = d.phone || d.mobile || '';
    const kam = d.kamId ? (kamsById.get(d.kamId)?.name ?? '') : '';
    rows.push([
      escapeCsv(name),
      escapeCsv(d.firstName || ''),
      escapeCsv(phone),
      escapeCsv(kam),
      escapeCsv(d.billingState || ''),
      escapeCsv(d.district || ''),
      escapeCsv(cats.join(' | ')),
      escapeCsv(d.dealerStage || ''),
      escapeCsv(d.portalUserId ? 'Yes' : 'No'),
    ].join(','));
  }
  return rows.join('\n');
}

export function mapDealerForClient(dealer, kamsById, usersById) {
  const kam = dealer.kamId ? kamsById.get(dealer.kamId) : null;
  const portalUser = dealer.portalUserId ? usersById.get(dealer.portalUserId) : null;
  return {
    id: dealer.id,
    contactName: dealer.contactName ?? '',
    firstName: dealer.firstName ?? null,
    companyName: dealer.companyName ?? null,
    email: dealer.email ?? null,
    phone: dealer.phone ?? null,
    mobile: dealer.mobile ?? null,
    status: dealer.status ?? 'active',
    outstandingReceivable: Number(dealer.outstandingReceivable ?? 0),
    unusedCredits: Number(dealer.unusedCredits ?? 0),
    syncedAt: dealer.syncedAt ?? null,
    isFiltered: Boolean(dealer.isFiltered),
    filterReason: dealer.filterReason ?? null,
    kamId: dealer.kamId ?? null,
    kamName: kam?.name ?? null,
    dealerStage: dealer.dealerStage ?? null,
    billingState: dealer.billingState ?? null,
    district: dealer.district ?? null,
    zipCode: dealer.zipCode ?? null,
    categories: normalizeCategories(dealer.categories),
    portalUserId: dealer.portalUserId ?? null,
    portalUserName: portalUser?.displayName ?? null,
    signedIn: Boolean(dealer.portalUserId),
  };
}
