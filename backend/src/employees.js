import { Router } from 'express';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const textLimits = { employee_number: 40, full_name: 200, job_title: 120, department: 120, location: 120 };
const mutable = ['full_name','job_title','department','location','start_date','end_date','manager_user_id'];
const fields = `id,employee_number,full_name,job_title,department,location,
  to_char(start_date,'YYYY-MM-DD') AS start_date,
  to_char(end_date,'YYYY-MM-DD') AS end_date,lifecycle_status,manager_user_id,
  (SELECT display_name FROM app_users WHERE app_users.id=employees.manager_user_id) AS manager_name`;

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0,10) === value;
}

function validate(body, existing) {
  const errors = Object.create(null), values = Object.create(null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { errors:{form:'Send an employee object.'},values };
  const allowed = existing ? mutable : ['employee_number',...mutable];
  for (const key of Object.keys(body)) if (!allowed.includes(key)) errors[key] = key === 'lifecycle_status' ? 'Status changes only through a lifecycle workflow.' : key === 'employee_number' ? 'Employee number cannot be changed after creation.' : 'This field cannot be set.';
  for (const [key,limit] of Object.entries(textLimits)) {
    if (existing && !Object.hasOwn(body,key)) continue;
    if (existing && key === 'employee_number') continue;
    if (typeof body[key] !== 'string' || !body[key].trim() || body[key].trim().length > limit) errors[key] = `Enter between 1 and ${limit} characters.`;
    else values[key] = key === 'employee_number' ? body[key].trim().toUpperCase() : body[key].trim();
  }
  if (values.employee_number && !/^[A-Z0-9][A-Z0-9_-]{0,39}$/.test(values.employee_number)) errors.employee_number = 'Use letters, numbers, hyphens or underscores, starting with a letter or number.';
  if (!existing || Object.hasOwn(body,'start_date')) {
    if (!validDate(body.start_date)) errors.start_date = 'Enter a valid start date (YYYY-MM-DD).';
    else values.start_date = body.start_date;
  }
  if (Object.hasOwn(body,'end_date')) {
    if (body.end_date !== null && !validDate(body.end_date)) errors.end_date = 'Enter a valid end date or leave it empty.';
    else values.end_date = body.end_date;
  } else if (!existing) values.end_date = null;
  if (Object.hasOwn(body,'manager_user_id')) {
    if (body.manager_user_id !== null && (typeof body.manager_user_id !== 'string' || !uuid.test(body.manager_user_id))) errors.manager_user_id = 'Choose a valid manager or leave unassigned.';
    else values.manager_user_id = body.manager_user_id;
  } else if (!existing) values.manager_user_id = null;
  const start = values.start_date ?? existing?.start_date;
  const end = Object.hasOwn(values,'end_date') ? values.end_date : existing?.end_date;
  if (start && end && end < start) errors.end_date = 'End date must be on or after start date.';
  if (existing && Object.keys(body).length === 0) errors.form = 'Provide at least one field to update.';
  return {errors,values};
}

function validationResponse(res, errors) { return res.status(400).json({error:'Check the employee details.',fields:errors}); }
function hrOnly(req,res,next) { if (req.user.role !== 'HR') return res.status(403).json({error:'Only HR can create or edit employees.'}); next(); }
function reader(req,res,next) { if (!['HR','Manager'].includes(req.user.role)) return res.status(403).json({error:'Permission denied'}); next(); }
function databaseError(error,res,next) {
  if (error.code === '23505') return res.status(409).json({error:'Employee number already exists.',fields:{employee_number:'Choose a unique employee number.'}});
  if (error.code === '23503') return validationResponse(res,{manager_user_id:'The selected manager is no longer available.'});
  if (error.code === '23514') return validationResponse(res,{end_date:'Check the employment date range.'});
  next(error);
}

export function employeeRoutes(database) {
  const router = Router();
  async function checkManager(values) {
    if (!values.manager_user_id) return true;
    return (await database.query("SELECT id FROM app_users WHERE id=$1 AND role='Manager' AND enabled=true",[values.manager_user_id])).rows.length > 0;
  }
  router.get('/employee-managers',hrOnly,async (_req,res) => {
    const result=await database.query("SELECT id,display_name FROM app_users WHERE role='Manager' AND enabled=true ORDER BY display_name,id");
    res.json({managers:result.rows});
  });
  router.get('/employees',reader,async (req,res) => {
    const {page='1',pageSize='10'}=req.query;
    if (typeof page !== 'string' || typeof pageSize !== 'string' || !/^[1-9]\d*$/.test(page) || !/^[1-9]\d*$/.test(pageSize) || Number(page)>100000 || Number(pageSize)>100) return validationResponse(res,{pagination:'Page must be 1–100000 and pageSize 1–100.'});
    const scope=req.user.role==='Manager' ? 'WHERE manager_user_id=$1' : '';
    const args=req.user.role==='Manager' ? [req.user.id] : [];
    const total=Number((await database.query(`SELECT count(*) AS total FROM employees ${scope}`,args)).rows[0].total);
    const result=await database.query(`SELECT ${fields} FROM employees ${scope} ORDER BY employee_number,id LIMIT $${args.length+1} OFFSET $${args.length+2}`,[...args,Number(pageSize),(Number(page)-1)*Number(pageSize)]);
    res.json({employees:result.rows,pagination:{page:Number(page),pageSize:Number(pageSize),total,totalPages:Math.max(1,Math.ceil(total/Number(pageSize)))}});
  });
  router.get('/employees/:id',reader,async (req,res) => {
    if (!uuid.test(req.params.id)) return validationResponse(res,{id:'Invalid employee ID.'});
    const args=[req.params.id];
    const scope=req.user.role==='Manager' ? 'AND manager_user_id=$2' : '';
    if (scope) args.push(req.user.id);
    const result=await database.query(`SELECT ${fields} FROM employees WHERE id=$1 ${scope}`,args);
    if (!result.rows.length) return res.status(404).json({error:'Employee not found.'});
    res.json({employee:result.rows[0]});
  });
  router.post('/employees',hrOnly,async (req,res,next) => {
    const {errors,values}=validate(req.body);
    if (Object.keys(errors).length) return validationResponse(res,errors);
    if (!await checkManager(values)) return validationResponse(res,{manager_user_id:'Choose an enabled user with the Manager role.'});
    try {
      const keys=Object.keys(values);
      const result=await database.query(`INSERT INTO employees(${keys.join(',')}) VALUES(${keys.map((_,i)=>`$${i+1}`).join(',')}) RETURNING ${fields}`,Object.values(values));
      res.location(`/api/employees/${result.rows[0].id}`).status(201).json({employee:result.rows[0]});
    } catch(error) { databaseError(error,res,next); }
  });
  router.patch('/employees/:id',hrOnly,async (req,res,next) => {
    if (!uuid.test(req.params.id)) return validationResponse(res,{id:'Invalid employee ID.'});
    const existing=(await database.query(`SELECT ${fields} FROM employees WHERE id=$1`,[req.params.id])).rows[0];
    if (!existing) return res.status(404).json({error:'Employee not found.'});
    const {errors,values}=validate(req.body,existing);
    if (Object.keys(errors).length) return validationResponse(res,errors);
    if (!await checkManager(values)) return validationResponse(res,{manager_user_id:'Choose an enabled user with the Manager role.'});
    try {
      const keys=Object.keys(values);
      const result=await database.query(`UPDATE employees SET ${keys.map((key,i)=>`${key}=$${i+1}`).join(',')} WHERE id=$${keys.length+1} RETURNING ${fields}`,[...Object.values(values),req.params.id]);
      if (!result.rows.length) return res.status(404).json({error:'Employee not found.'});
      res.json({employee:result.rows[0]});
    } catch(error) { databaseError(error,res,next); }
  });
  return router;
}
