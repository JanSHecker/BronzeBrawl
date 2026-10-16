import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({ ...base, testMatch: ['rewards.spec.js', 'status-layout.spec.js'],
  use: { ...base.use, trace: 'retain-on-failure', screenshot: 'only-on-failure' } });
