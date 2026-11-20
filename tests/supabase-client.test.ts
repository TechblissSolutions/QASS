jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn((_url: string, _key: string, options: { auth: { storage: Storage } }) => ({
    auth: { storage: options.auth.storage },
  })),
}));

import { createClient } from '@supabase/supabase-js';
import { getSupabaseClient, setAuthPersistence } from '@/lib/supabase';

test('switches browser storage without creating another auth client', () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example.com';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  window.localStorage.clear();
  window.sessionStorage.clear();

  const firstClient = getSupabaseClient();
  setAuthPersistence(false);
  const secondClient = getSupabaseClient();

  expect(secondClient).toBe(firstClient);
  expect(createClient).toHaveBeenCalledTimes(1);

  const storage = (createClient as jest.Mock).mock.calls[0][2].auth.storage as Storage;
  storage.setItem('test-key', 'session-value');
  expect(window.sessionStorage.getItem('test-key')).toBe('session-value');
  expect(window.localStorage.getItem('test-key')).toBeNull();
});
