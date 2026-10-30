import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const password='E2E-only-password-2026';
async function signIn(page,email){
  await page.goto('/');
  await page.getByLabel('Email',{exact:true}).fill(email);
  await page.getByLabel('Password',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('button',{name:'Sign out'})).toBeVisible();
}
async function asRole(page,email){
  await page.getByRole('button',{name:'Sign out'}).click();
  // The logout request must finish before signIn navigates to the app root.
  await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
  await signIn(page,email);
}
async function completeSteps(page,employeeId,kind,count){
  await page.goto('/#/'+kind+'/'+employeeId);
  await expect(page.getByRole('heading',{name:kind==='onboarding'?'Onboarding checklist':'Offboarding checklist'})).toBeVisible();
  const buttons=page.getByRole('button',{name:kind==='onboarding'?'Approve step':'Complete step'});
  for(let n=count;n>0;n--){
    await expect(buttons).toHaveCount(n);
    await buttons.first().click();
    await expect(buttons).toHaveCount(n-1);
  }
}
test('HR and IT take an employee through the full lifecycle',async({page})=>{
  const number='LIFE-'+randomUUID().slice(0,8).toUpperCase();
  const employeeName='Lifecycle '+number;
  await signIn(page,'hr@example.test');
  await page.getByRole('link',{name:'Add employee'}).click();
  for(const [field,value] of [['Employee number',number],['Full name',employeeName],
    ['Position / job title','Business Analyst'],['Department','Consulting'],
    ['Location','Melbourne'],['Start date','2026-10-19']])
    await page.getByLabel(field,{exact:true}).fill(value);
  await page.getByRole('button',{name:'Save employee'}).click();
  await expect(page.getByRole('heading',{name:employeeName,exact:true})).toBeVisible();
  const employeeId=page.url().match(/\/employees\/([0-9a-f-]+)/i)?.[1];
  expect(employeeId).toBeTruthy();

  await page.getByRole('link',{name:'View onboarding checklist'}).click();
  await page.getByRole('button',{name:'Start onboarding'}).click();
  await expect(page.getByText('Workflow status: InProgress')).toBeVisible();
  await completeSteps(page,employeeId,'onboarding',5);
  await expect(page.getByText('Employee status: Onboarding')).toBeVisible();
  await asRole(page,'it@example.test');
  await completeSteps(page,employeeId,'onboarding',6);
  await expect(page.getByText('Employee status: Active')).toBeVisible();

  await asRole(page,'hr@example.test');
  await page.goto('/#/offboarding/'+employeeId);
  await page.getByLabel('Last employment date').fill('2026-11-01');
  await page.getByRole('button',{name:'Start offboarding'}).click();
  await expect(page.getByText('Workflow: InProgress')).toBeVisible();
  await completeSteps(page,employeeId,'offboarding',1);
  await asRole(page,'it@example.test');
  await completeSteps(page,employeeId,'offboarding',2);
  await expect(page.getByText('Workflow: Completed')).toBeVisible();
  await expect(page.getByText(/Employee: Offboarded/)).toBeVisible();
  await page.reload();
  await expect(page.getByText(/Employee: Offboarded/)).toBeVisible();
  await page.screenshot({path:test.info().outputPath('full-lifecycle.png'),fullPage:true});
});
