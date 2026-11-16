// Intentionally public Supabase configuration. No service-role/secret key here.
// Auth identity is shared; Jobs staff membership and policies are independent.
export const jobsConfig = Object.freeze({
  supabaseUrl: 'https://duyiihsmaqfgwezmsnjs.supabase.co',
  publishableKey: 'sb_publishable_gvmM9ng8dqbW0MESrN7zlA_8VrahsP8',
  cvBucket: 'jobs-cv', mediaBucket: 'jobs-media', maxCvBytes: 10 * 1024 * 1024,
});
