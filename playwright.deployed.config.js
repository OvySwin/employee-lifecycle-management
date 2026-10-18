import { defineConfig } from '@playwright/test';
const target=process.env.DEPLOYED_BASE_URL;
if (!target || !process.env.TEST_PASSWORD) throw new Error('Set DEPLOYED_BASE_URL and TEST_PASSWORD privately.');
if (process.env.ALLOW_SYNTHETIC_WRITES !== 'test-only') throw new Error('Explicitly allow synthetic writes on the Test environment only.');
export default defineConfig({
  testDir:'./e2e/deployed',testMatch:'**/*.acceptance.js',workers:1,
  retries:0,timeout:30000,
  outputDir:'test-results/deployed',
  reporter:[['list'],['html',{outputFolder:'playwright-report/deployed',open:'never'}]],
  use:{baseURL:target,trace:'off',video:'off',screenshot:'only-on-failure'}
});
