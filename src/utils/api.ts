import { supabase } from '../lib/supabase';

/**
 * Call a Vercel serverless API function with auth.
 * Replaces supabase.functions.invoke() for our Vercel migration.
 * Returns { data, error } to match the old Supabase pattern.
 */
export async function apiCall(
  path: string,
  body: Record<string, any>
): Promise<{ data: any; error: any }> {
  try {
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) return { data: null, error: new Error('Not authenticated') };

    const resp = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    const data = await resp.json();
    if (!resp.ok) {
      return { data: null, error: new Error(data?.error || `Request failed (${resp.status})`) };
    }
    if (data?.error) {
      return { data, error: new Error(data.error) };
    }
    return { data, error: null };
  } catch (err: any) {
    return { data: null, error: err };
  }
}
