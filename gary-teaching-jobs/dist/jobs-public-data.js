import {jobsConfig} from './jobs-config.js';

export function createJobsPublicClient(createClient, fetcher = globalThis.fetch) {
  return createClient(jobsConfig.supabaseUrl, jobsConfig.publishableKey, {
    // Public browsing uses the same published projection in every session.
    accessToken: async () => null,
    global: {fetch: (input, options) => fetcher(input, {...options, cache: 'no-store'})},
  });
}
