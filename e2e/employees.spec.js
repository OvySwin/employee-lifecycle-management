import { test as base, expect } from '@playwright/test';
// Optional authoring-container fallback: its single-process Chromium must be restarted per test.
// Normal local/CI runs use Playwright's standard browser/context fixtures.
const test=base.extend(process.env.CHROMIUM_EXECUTABLE_PATH ? {
  page:async({playwright,browserName},use,testInfo)=>{
    const browser=await playwright[browserName].launch(testInfo.project.use.launchOptions);
    try { const page=await browser.newPage({baseURL:testInfo.project.use.baseURL});await use(page); }
    finally { await browser.close(); }
  }
}:{});
async function login(page,email='hr@example.test') {
  await page.goto('/');
  await page.getByLabel('Email',{exact:true}).fill(email);
  await page.getByLabel('Password',{exact:true}).fill('E2E-only-password-2026');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('button',{name:'Sign out'})).toBeVisible();
}
async function fillEmployee(page,number,name='Browser Employee') {
  await page.getByLabel('Employee number',{exact:true}).fill(number);
  await page.getByLabel('Full name',{exact:true}).fill(name);
  await page.getByLabel('Position / job title',{exact:true}).fill('Business Analyst');
  await page.getByLabel('Department',{exact:true}).fill('Consulting');
  await page.getByLabel('Location',{exact:true}).fill('Melbourne');
  await page.getByLabel('Start date',{exact:true}).fill('2026-10-19');
}
test('HR creates/edits an employee, navigates details and retains data after refresh',async({page})=>{
  await login(page);
  await page.getByRole('link',{name:'Add employee',exact:true}).click();
  await fillEmployee(page,'BROWSER-001');
  await page.getByLabel('Manager (optional)',{exact:true}).selectOption({label:'Demo Manager'});
  await page.getByRole('button',{name:'Save employee',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Browser Employee',exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading',{name:'Browser Employee',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Edit employee',exact:true}).click();
  await page.getByLabel('Position / job title',{exact:true}).fill('Senior Analyst');
  await expect(page.getByLabel('Employee number',{exact:true})).toHaveAttribute('readonly','');
  await page.getByRole('button',{name:'Save employee',exact:true}).click();
  await expect(page.locator('dd').filter({hasText:/^Senior Analyst$/})).toBeVisible();
  await page.reload();await expect(page.locator('dd').filter({hasText:/^Senior Analyst$/})).toBeVisible();
  await page.screenshot({path:test.info().outputPath('employee-details.png'),fullPage:true});
});
test('onboarding checklist has a dedicated page with the expanded default steps',async({page})=>{
  await login(page);
  await page.getByRole('link',{name:'View Sample Employee',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Sample Employee',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Onboarding checklist',exact:true})).toHaveCount(0);
  await page.getByRole('link',{name:'View onboarding checklist',exact:true}).click();
  await expect(page.getByRole('link',{name:'Back to employee details',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Start onboarding',exact:true}).click();
  await expect(page.getByRole('listitem')).toHaveCount(11);
  await expect(page.getByText('Send welcome email',{exact:false})).toBeVisible();
  const hrStep=page.getByRole('listitem').filter({hasText:'Send welcome email'});
  await hrStep.getByRole('button',{name:'Approve step',exact:true}).click();
  await expect(hrStep).toContainText('Completed');
});
test('duplicate validation preserves form values and attaches field feedback',async({page})=>{
  await login(page);await page.getByRole('link',{name:'Add employee',exact:true}).click();
  await fillEmployee(page,'DEMO-001','Retain This Name');
  await page.getByRole('button',{name:'Save employee',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Employee number already exists');
  await expect(page.getByLabel('Full name',{exact:true})).toHaveValue('Retain This Name');
  await expect(page.getByLabel('Employee number',{exact:true})).toHaveAttribute('aria-invalid','true');
  await expect(page.locator('#employee_number-error')).toContainText('unique');
});
test('list pagination and detail/back navigation work',async({page})=>{
  await login(page);
  await expect(page.getByRole('button',{name:'Previous',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Next',exact:true}).click();
  await expect(page.getByText(/Page 2 of/)).toBeVisible();
  await page.getByRole('link',{name:/^View /}).first().click();
  await expect(page.getByRole('link',{name:'Back to employee list'})).toBeVisible();
  await page.getByRole('link',{name:'Back to employee list'}).click();
  await expect(page.getByRole('table',{name:'Employee records'})).toBeVisible();
});
test('Manager has read-only scoped records and IT has no employee controls',async({page})=>{
  await login(page,'manager@example.test');
  await expect(page.getByRole('link',{name:'Add employee',exact:true})).toHaveCount(0);
  await expect(page.getByRole('link',{name:'View Sample Employee',exact:true})).toBeVisible();
  await expect(page.getByText('Paging Person 1',{exact:true})).toHaveCount(0);
  await page.getByRole('link',{name:'View Sample Employee',exact:true}).click();
  await expect(page.getByRole('link',{name:'Edit employee',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await login(page,'it@example.test');
  await expect(page.getByRole('heading',{name:'Your employees',exact:true})).toHaveCount(0);
  await expect(page.getByRole('link',{name:'Add employee',exact:true})).toHaveCount(0);
});
test('save failure preserves input and succeeds after retry',async({page})=>{
  await login(page);await page.getByRole('link',{name:'Add employee',exact:true}).click();
  await fillEmployee(page,'RETRY-001','Retry Person');
  const fail=route=>route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Temporary save failure'})});
  await page.route('**/api/employees',fail);
  await page.getByRole('button',{name:'Save employee',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Temporary save failure');
  await expect(page.getByLabel('Full name',{exact:true})).toHaveValue('Retry Person');
  await page.unroute('**/api/employees',fail);
  await page.getByRole('button',{name:'Save employee',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Retry Person',exact:true})).toBeVisible();
});
test('expired API session returns user to login and 403 remains a visible error',async({page})=>{
  await login(page);
  await page.route('**/api/employees/*',route=>route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:'Permission denied'})}));
  await page.getByRole('link',{name:'View Sample Employee',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Permission denied');
  await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeVisible();
  await page.unroute('**/api/employees/*');
  await page.route('**/api/employees/*',route=>route.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:'Authentication required'})}));
  await page.getByRole('button',{name:'Retry employee details',exact:true}).click();
  await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Session expired');
});
test('keyboard users can reach labelled form fields',async({page})=>{
  await login(page);await page.getByRole('link',{name:'Add employee',exact:true}).click();
  await page.getByLabel('Employee number',{exact:true}).focus();
  await page.keyboard.press('Tab');await expect(page.getByLabel('Full name',{exact:true})).toBeFocused();
  await page.keyboard.press('Tab');await expect(page.getByLabel('Position / job title',{exact:true})).toBeFocused();
});
