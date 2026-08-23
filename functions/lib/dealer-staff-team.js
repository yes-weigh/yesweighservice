/** Dealer staff teams: sales, service (limited), admin (full dealer power). */

export function dealerStaffTeamsFromUserData(data) {
  const stored = Array.isArray(data?.dealerTeams)
    ? data.dealerTeams.filter(team => team === 'sales' || team === 'service' || team === 'admin')
    : [];
  if (stored.includes('admin') || data?.staffDepartment === 'admin') return ['admin'];
  if (stored.length) return [...new Set(stored.filter(team => team !== 'admin'))];
  if (data?.staffDepartment === 'service') return ['service'];
  if (data?.staffDepartment === 'sales') return ['sales'];
  return ['sales'];
}

export function isDealerAdminStaff(user) {
  return user?.role === 'dealer_staff'
    && dealerStaffTeamsFromUserData(user.data).includes('admin');
}
