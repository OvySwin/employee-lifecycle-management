import { Router } from 'express';
import { enqueueNotification } from './notifications.js';
import { completeWorkflowTask } from './workflow-tasks.js';
import { inTransaction, WorkflowError, selectTemplate, validDate, taskFields } from './workflow-start.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function startOffboarding(database, employeeId, endDate) {
  return inTransaction(database, async client => {
    const employee = (await client.query(`SELECT id,job_title,department,location,lifecycle_status,
      to_char(start_date,'YYYY-MM-DD') AS start_date FROM employees WHERE id=$1 FOR UPDATE`,[employeeId])).rows[0];
    if (!employee) throw new WorkflowError(404,'Employee not found.');
    if (employee.lifecycle_status !== 'Active') throw new WorkflowError(409,'Only Active employees can start offboarding.');
    if (endDate < employee.start_date) throw new WorkflowError(400,'Check the offboarding details.',{end_date:'End date must be on or after start date.'});
    if ((await client.query("SELECT id FROM workflows WHERE employee_id=$1 AND status='InProgress'",[employeeId])).rows.length) throw new WorkflowError(409,'An active workflow already exists for this employee.');

    const templates = (await client.query("SELECT * FROM checklist_templates WHERE kind='Offboarding' FOR SHARE")).rows;
    const template = selectTemplate(templates,employee);
    if (!template) throw new WorkflowError(409,'No applicable offboarding template is configured.');
    const definitions = (await client.query('SELECT * FROM template_tasks WHERE template_id=$1 ORDER BY position FOR SHARE',[template.id])).rows;
    if (!definitions.some(task => task.required)) throw new WorkflowError(409,'The offboarding template must contain at least one required task.');

    const workflow = (await client.query("INSERT INTO workflows(employee_id,template_id,kind) VALUES($1,$2,'Offboarding') RETURNING id,employee_id,template_id,kind,status",[employeeId,template.id])).rows[0];
    const tasks = [];
    for (const task of definitions) {
      const result = await client.query(`INSERT INTO workflow_tasks(workflow_id,source_template_task_id,title,required,assigned_role,due_date,position)
        VALUES($1,$2,$3,$4,$5,$6::date+$7::integer,$8) RETURNING ${taskFields}`,
      [workflow.id,task.id,task.title,task.required,task.assigned_role,endDate,task.due_offset_days,task.position]);
      tasks.push(result.rows[0]);
    }
    await client.query("UPDATE employees SET end_date=$1,lifecycle_status='Offboarding' WHERE id=$2",[endDate,employeeId]);
    const users=(await client.query("SELECT id,role FROM app_users WHERE enabled=true AND role IN ('HR','IT')")).rows;
    for(const user of users) if(tasks.some(task=>task.assigned_role===user.role))
      await enqueueNotification(client,`offboarding-start:${workflow.id}:${user.id}`,user.id,
        'Offboarding checklist created',`An offboarding checklist is ready for employee ${employeeId}; final employment date ${endDate}. Open the application to review your role's tasks.`);
    return {employee:{id:employeeId,end_date:endDate,lifecycle_status:'Offboarding'},workflow,tasks};
  });
}

export function offboardingRoutes(database) {
  const router = Router();
  router.post('/employees/:id/offboarding',async (req,res,next) => {
    if (req.user.role !== 'HR') return res.status(403).json({error:'Only HR can start offboarding.'});
    if (!uuid.test(req.params.id)) return res.status(400).json({error:'Invalid employee ID.'});
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'end_date') || !validDate(body.end_date)) return res.status(400).json({error:'Check the offboarding details.',fields:{end_date:'Send only a valid end_date (YYYY-MM-DD).'}});
    try {
      const result = await startOffboarding(database,req.params.id,body.end_date);
      res.location(`/api/employees/${req.params.id}/offboarding`).status(201).json(result);
    } catch (error) {
      if (error instanceof WorkflowError) return res.status(error.status).json({error:error.message,...(error.fields ? {fields:error.fields} : {})});
      if (error.code === '23505') return res.status(409).json({error:'An active workflow already exists for this employee.'});
      next(error);
    }
  });
  router.get('/employees/:id/offboarding',async (req,res,next) => {
    if (!['HR','Manager','IT'].includes(req.user.role)) return res.status(403).json({error:'Permission denied'});
    if (!uuid.test(req.params.id)) return res.status(400).json({error:'Invalid employee ID.'});
    try {
      const result = await inTransaction(database,async client => {
        const employee = (await client.query(`SELECT id,lifecycle_status,to_char(end_date,'YYYY-MM-DD') AS end_date
          FROM employees WHERE id=$1 ${req.user.role === 'Manager' ? 'AND manager_user_id=$2' : ''} FOR SHARE`,req.user.role === 'Manager' ? [req.params.id,req.user.id] : [req.params.id])).rows[0];
        if (!employee) throw new WorkflowError(404,'Employee not found.');
        const workflow = (await client.query("SELECT id,employee_id,template_id,kind,status FROM workflows WHERE employee_id=$1 AND kind='Offboarding' ORDER BY created_at DESC,id DESC LIMIT 1",[employee.id])).rows[0];
        if (!workflow) throw new WorkflowError(404,'Offboarding workflow not found.');
        const tasks=(await client.query(`SELECT ${taskFields} FROM workflow_tasks WHERE workflow_id=$1 ORDER BY position`,[workflow.id])).rows;
        if(req.user.role==='IT' && !tasks.some(task=>task.assigned_role==='IT' && (!task.assignee_user_id || task.assignee_user_id===req.user.id))) throw new WorkflowError(404,'Offboarding workflow not found.');
        return {employee,workflow,tasks};
      });
      res.json(result);
    } catch(error) {
      if (error instanceof WorkflowError) return res.status(error.status).json({error:error.message});
      next(error);
    }
  });
  router.post('/offboarding-tasks/:id/approve',async(req,res,next)=>{
    if(!['HR','IT','Manager'].includes(req.user.role)) return res.status(403).json({error:'Permission denied.'});
    if(!uuid.test(req.params.id))return res.status(400).json({error:'Invalid task ID.'});
    try { res.json(await completeWorkflowTask(database,req.params.id,'Offboarding',req.user)); }
    catch(error){if(error instanceof WorkflowError)return res.status(error.status).json({error:error.message});next(error);}
  });
  return router;
}
