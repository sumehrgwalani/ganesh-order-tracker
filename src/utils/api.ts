import { supabase } from '../lib/supabase';

/**
 * Call a Vercel serverless API function with auth.
 * Auto-retries once on auth failure (expired token) by refreshing the session.
 * Returns { data, error } to match the old Supabase pattern.
 */
export async function apiCall(
  path: string,
  body: Record<string, any>
): Promise<{ data: any; error: any }> {
  const doFetch = async (token: string) => {
    const resp = await fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    return resp;
  };

  try {
    const session = await supabase.auth.getSession();
    let token = session.data.session?.access_token;
    if (!token) return { data: null, error: new Error('Not authenticated') };

    let resp = await doFetch(token);
    let data = await resp.json();

    // Auto-retry once on auth failure — refresh session and try again
    if (resp.status === 401 || (data?.error && typeof data.error === 'string' && data.error.includes('Authentication'))) {
      const { data: refreshed } = await supabase.auth.refreshSession();
      const newToken = refreshed?.session?.access_token;
      if (newToken) {
        token = newToken;
        resp = await doFetch(token);
        data = await resp.json();
      }
    }

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
