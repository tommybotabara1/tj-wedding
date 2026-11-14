import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            PHOTO_PASSWORD: 'ToMyJeyan',
            ADMIN_PASSWORD: 'test admin',
            MEDIA_KEY: 'test-media-key',
            GOOGLE_CLIENT_ID: 'x',
            GOOGLE_CLIENT_SECRET: 'x',
            GOOGLE_REFRESH_TOKEN: 'x',
            DRIVE_FOLDER_ID: 'guest-folder',
            COPIES_FOLDER_ID: 'copies-folder',
            GEMINI_API_KEY: 'test-gemini',
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/apply-migrations.js'],
    },
  };
});
