/**
 * Hebrew for the domain's machine-readable reasons.
 *
 * The domain speaks English so its tests read plainly; the family reads
 * Hebrew. The mapping lives here, at the edge, rather than in the optimizer.
 */
export function reasonHe(reason: string): string {
  if (reason.startsWith('Cheapest complete basket')) return 'הסל השלם הזול ביותר מרשת אחת';
  if (reason.startsWith('Single retailer with verified')) return 'רשת אחת, תנאי משלוח מאומתים';
  if (reason.includes('cheaper at') && reason.includes('second delivery')) {
    const n = /^(\d+) lines/.exec(reason)?.[1] ?? '';
    const brand = /cheaper at (.+?),/.exec(reason)?.[1] ?? '';
    return `${n} פריטים זולים יותר ב${brand}, והחיסכון מכסה משלוח שני`;
  }
  if (reason.startsWith('Collect yourself — cheaper')) return 'איסוף עצמי — זול מכל משלוח';
  if (reason.startsWith('Collect yourself')) return 'איסוף עצמי — יקר יותר ממשלוח כאן';
  if (reason.startsWith('Cheaper in store')) return 'זול יותר בחנות, והחיסכון מכסה את הנסיעה';
  return reason;
}

export function rejectionHe(reason: string): string {
  const m = /prices only (\d+)\/(\d+) lines/.exec(reason);
  if (m) return `מספקת רק ${m[1]} מתוך ${m[2]} פריטים`;
  if (reason.includes('below the storefront minimum')) return 'הסל מתחת למינימום ההזמנה';
  return reason;
}
