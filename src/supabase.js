import { createClient } from '@supabase/supabase-js'
export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
export const rpc = async (fn, args) => {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data
}
