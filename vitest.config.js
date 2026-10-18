import { defineConfig, configDefaults } from 'vitest/config';
export default defineConfig({test:{
  exclude:[...configDefaults.exclude,'e2e/**'],
  coverage:{provider:'v8',reporter:['text','html','json-summary','lcov'],
    include:['backend/src/**/*.js'],
    exclude:['backend/src/server.js','backend/src/db-cli.js'],
    thresholds:{lines:80,statements:80,functions:80,branches:80}}
}});
