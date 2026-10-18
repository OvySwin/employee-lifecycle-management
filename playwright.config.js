import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./e2e',testMatch:'**/*.spec.js',fullyParallel:false,workers:1,
  reporter:[['list'],['html',{open:'never'}]],
  use:{baseURL:'http://127.0.0.1:5175',trace:'retain-on-failure',screenshot:'only-on-failure',launchOptions:process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--single-process','--no-zygote','--use-gl=angle','--use-angle=swiftshader','--in-process-gpu']}:{}},
  webServer:[
    {command:'node e2e/server.js',url:'http://127.0.0.1:3101/ready',reuseExistingServer:false,timeout:60000},
    {command:'npm run dev --workspace frontend -- --host 127.0.0.1 --port 5175 --strictPort',url:'http://127.0.0.1:5175',env:{API_PROXY_TARGET:'http://127.0.0.1:3101'},reuseExistingServer:false,timeout:60000}
  ]
});
