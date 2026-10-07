import { ok } from '@/lib/io/http';
import { clearState } from '@/lib/io/store';
export const dynamic = 'force-dynamic';
export async function POST() { await clearState(); return ok({ ok: true }); }
