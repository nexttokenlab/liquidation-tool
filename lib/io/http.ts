import { NextResponse } from 'next/server';
export const ok = (data: unknown) => NextResponse.json(data);
export const bad = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

// Accepts multipart uploads (file fields) or JSON with CSV text fields: both upload and paste work.
export async function readCsvFields(req: Request, fields: string[]): Promise<Record<string, string | undefined> & { useSample?: boolean }> {
  const type = req.headers.get('content-type') ?? '';
  const out: Record<string, string | undefined> & { useSample?: boolean } = {};
  if (type.includes('multipart/form-data')) {
    const form = await req.formData();
    for (const f of fields) {
      const v = form.get(f);
      if (v && typeof v !== 'string') out[f] = await v.text();
      else if (typeof v === 'string' && v.trim()) out[f] = v;
    }
    out.useSample = form.get('useSample') === 'true';
  } else {
    const body = await req.json().catch(() => ({}));
    for (const f of fields) if (typeof body[f] === 'string' && body[f].trim()) out[f] = body[f];
    out.useSample = body.useSample === true;
  }
  return out;
}
