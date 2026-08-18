import { defineConfig } from 'drizzle-kit';
import { loadDbEnv } from './src/env.js';

const { databaseUrl } = loadDbEnv();

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: databaseUrl },
  strict: true,
  verbose: true,
});
