export async function hasPendingPrintJobs(orderId: string, token?: string | null): Promise<boolean> {
  try {
    const res = await fetch(`/api/print-jobs?orderId=${encodeURIComponent(orderId)}&status=pending`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    if (!res.ok) return false;
    const data = await res.json();
    const jobs = data?.data || [];
    return Array.isArray(jobs) && jobs.length > 0;
  } catch {
    return false;
  }
}
