import { vacancyImageHandler } from './handler.mjs';

Deno.serve(vacancyImageHandler({
  url: Deno.env.get('SUPABASE_URL') ?? '',
  publishableKey: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  cleanupKey: Deno.env.get('JOBS_VACANCY_IMAGE_CLEANUP_KEY') ?? '',
}));
