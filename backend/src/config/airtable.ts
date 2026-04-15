import { env } from './environment';

export const AIRTABLE_CONFIG = {
  BASE_URL: 'https://api.airtable.com/v0',
  META_URL: 'https://api.airtable.com/v0/meta',
  AUTH_URL: 'https://airtable.com/oauth2/v1',
  WEB_URL: 'https://airtable.com',

  CLIENT_ID: env.AIRTABLE_CLIENT_ID,
  CLIENT_SECRET: env.AIRTABLE_CLIENT_SECRET,
  REDIRECT_URI: env.AIRTABLE_REDIRECT_URI,

  SCOPES: [
    'data.records:read',
    'data.records:write',
    'schema.bases:read',
    'schema.bases:write',
    'user.email:read',
  ],

  PAGINATION: {
    PAGE_SIZE: 100,
    MAX_RETRIES: 3,
    RETRY_DELAY_MS: 1000,
  },

  SCRAPING: {
    LOGIN_URL: 'https://airtable.com/login',
    REVISION_HISTORY_URL: 'https://airtable.com/v0.3/readRowActivitiesAndComments',
    BATCH_SIZE: 10,
    REQUEST_DELAY_MS: 500,
  },
} as const;
