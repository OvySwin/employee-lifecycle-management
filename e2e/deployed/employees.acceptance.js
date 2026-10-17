import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
async function login(page,email='hr@example.test') {
  await page.goto('/');
  await page.getByLabel('Email',{exact:true}).fill(email);
  await page.getByLabel('Password',{exact:true}).fill(process.env.TEST_PASSWORD);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeVisible();
}
test('deployed health/readiness and unauthenticated access',async({request})=>{
  expect((await request.get('/health')).status()).toBe(200);
  const ready=await request.get('/ready');
  expect(ready.status()).toBe(200);expect((await ready.json()).database).toBe('connected');
  expect((await request.get('/api/employees')).status()).toBe(401);
});
test('HR creates, edits, refreshes and logs back into persisted data',async({page})=>{
  const number='DEPLOY-'+randomUUID().slice(0,8).toUpperCase(),name='Synthetic '+number;
  await login(page);
  await page.getByRole('link',{name:'Add employee',exact:true}).click();
  for(const [label,value] of [['Employee number',number],['Full name',name],['Job title','Test Analyst'],['Department','Testing'],['Location','Sydney'],['Start date','2026-10-17']])
    await page.getByLabel(label,{exact:true}).fill(value);
  await page.getByRole('button',{name:'Save employee',exact:true}).click();
  await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
  const detailURL=page.url();
  await page.reload();await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Edit employee',exact:true}).click();
  await page.getByLabel('Job title',{exact:true}).fill('Senior Test Analyst');
  await page.getByRole('button',{name:'Save employee',exact:true}).click();
  await page.reload();await expect(page.locator('dd').filter({hasText:/^Senior Test Analyst$/})).toBeVisible();
  await page.screenshot({path:test.info().outputPath('deployed-employee.png'),fullPage:true});
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
  expect((await page.request.get('/api/employees')).status()).toBe(401);
  await login(page);await page.goto(detailURL);
  await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
  await expect(page.locator('dd').filter({hasText:/^Senior Test Analyst$/})).toBeVisible();
});
test('Manager is read-only and IT is denied employee API access',async({page})=>{
  await login(page,'manager@example.test');
  await expect(page.getByRole('heading',{name:'Your employees',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'Add employee',exact:true})).toHaveCount(0);
  const result=await page.request.get('/api/employees');
  expect(result.status()).toBe(200);
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await login(page,'it@example.test');
  await expect(page.getByRole('link',{name:'Add employee',exact:true})).toHaveCount(0);
  expect((await page.request.get('/api/employees')).status()).toBe(403);
});
