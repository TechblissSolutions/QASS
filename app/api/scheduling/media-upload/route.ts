export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/supabase';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Map([
  ['image/jpeg', 'jpg'], ['image/png', 'png'], ['image/webp', 'webp'], ['image/gif', 'gif'],
]);

export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
    if (!token) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    const user = await getUserFromToken(token).catch(() => null);
    if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });

    const form = await req.formData();
    const projectId = String(form.get('projectId') || '').trim();
    const file = form.get('file');
    if (!projectId || !(file instanceof File)) return NextResponse.json({ error: 'Project and image are required.' }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Images must be 10 MB or smaller.' }, { status: 413 });
    const ext = ALLOWED.get(file.type);
    if (!ext) return NextResponse.json({ error: 'Use JPG, PNG, WEBP, or GIF images.' }, { status: 400 });

    const admin = getSupabaseAdmin();
    if (!admin) return NextResponse.json({ error: 'Sparrow storage is not configured. Add SUPABASE_SERVICE_ROLE_KEY to the server environment.' }, { status: 503 });
    const { data: project, error: projectError } = await admin.from('projects').select('id,user_id').eq('id', projectId).eq('user_id', user.id).maybeSingle();
    if (projectError || !project) return NextResponse.json({ error: 'Company not found.' }, { status: 404 });

    const bucketName = 'scheduled-media';
    const bucket = await admin.storage.getBucket(bucketName);
    if (bucket.error && !/not found|does not exist/i.test(bucket.error.message || '')) {
      return NextResponse.json({ error: `Storage check failed: ${bucket.error.message}` }, { status: 502 });
    }
    if (!bucket.data) {
      const created = await admin.storage.createBucket(bucketName, { public: true, fileSizeLimit: `${MAX_BYTES}`, allowedMimeTypes: [...ALLOWED.keys()] });
      if (created.error && !/already exists/i.test(created.error.message || '')) {
        return NextResponse.json({ error: `Storage is not ready: ${created.error.message}` }, { status: 502 });
      }
    }
    const path = `${user.id}/${projectId}/${crypto.randomUUID()}.${ext}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { error: uploadError } = await admin.storage.from(bucketName).upload(path, bytes, { contentType: file.type, upsert: false, cacheControl: '31536000' });
    if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 502 });
    const { data } = admin.storage.from(bucketName).getPublicUrl(path);
    return NextResponse.json({ success: true, media_url: data.publicUrl, media_type: 'image' });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Image upload failed.' }, { status: 500 });
  }
}
