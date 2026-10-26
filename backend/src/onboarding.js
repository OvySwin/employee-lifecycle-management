import { Router } from 'express';
import { completeWorkflowTask } from './workflow-tasks.js';
import { inTransaction, WorkflowError, selectTemplate, taskFields } from './workflow-start.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function startOnboarding(database, employeeId) {
  return inTransaction(database, async client => {
    const employee = (await client.query(`SELECT id,job_title,department,location,lifecycle_status,
      to_char(start_date,'YYYY-MM-DD') AS start_date FROM employees WHERE id=$1 FOR UPDATE`,[employeeId])).rows[0];
    if (!employee) throw new WorkflowError(404,'Employee not found.');
    if (employee.lifecycle_status !== 'Onboarding') throw new WorkflowError(409,'Only employees in Onboarding can start onboarding.');
    if ((await client.query("SELECT id FROM workflows WHERE employee_id=$1 AND status='InProgress'",[employeeId])).rows.length) throw new WorkflowError(409,'An active workflow already exists for this employee.');

    const templates = (await client.query("SELECT * FROM checklist_templates WHERE kind='Onboarding' FOR SHARE")).rows;
    const template = selectTemplate(templates,employee);
    if (!template) throw new WorkflowError(409,'No applicable onboarding template is configured.');
    const definitions = (await client.query('SELECT * FROM template_tasks WHERE template_id=$1 ORDER BY position FOR SHARE',[template.id])).rows;
    if (!definitions.some(task => task.required)) throw new WorkflowError(409,'The onboarding template must contain at least one required task.');

    const workflow = (await client.query("INSERT INTO workflows(employee_id,template_id,kind) VALUES($1,$2,'Onboarding') RETURNING id,employee_id,template_id,kind,status",[employeeId,template.id])).rows[0];
    const tasks = [];
    for (const task of definitions) {
      const result = await client.query(`INSERT INTO workflow_tasks(workflow_id,source_template_task_id,title,required,assigned_role,due_date,position)
        VALUES($1,$2,$3,$4,$5,$6::date+$7::integer,$8) RETURNING ${taskFields}`,
      [workflow.id,task.id,task.title,task.required,task.assigned_role,employee.start_date,task.due_offset_days,task.position]);
      tasks.push(result.rows[0]);
    }
    return {employee:{id:employeeId,lifecycle_status:employee.lifecycle_status},workflow,tasks};
  });
}

export function onboardingRoutes(database) {
  const router = Router();
  router.post('/employees/:id/onboarding',async (req,res,next) => {
    if (req.user.role !== 'HR') return res.status(403).json({error:'Only HR can start onboarding.'});
    if (!uuid.test(req.params.id)) return res.status(400).json({error:'Invalid employee ID.'});
    if (req.body !== undefined && (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length)) return res.status(400).json({error:'Onboarding does not accept a request body.'});
    try {
      const result = await startOnboarding(database,req.params.id);
      res.location(`/api/employees/${req.params.id}/onboarding`).status(201).json(result);
    } catch (error) {
      if (error instanceof WorkflowError) return res.status(error.status).json({error:error.message,...(error.fields ? {fields:error.fields} : {})});
      if (error.code === '23505') return res.status(409).json({error:'An active workflow already exists for this employee.'});
      next(error);
    }
  });
  router.get('/employees/:id/onboarding',async (req,res,next) => {
    if (!['HR','Manager','IT'].includes(req.user.role)) return res.status(403).json({error:'Permission denied'});
    if (!uuid.test(req.params.id)) return res.status(400).json({error:'Invalid employee ID.'});
    try {
      const result = await inTransaction(database,async client => {
        const employee = (await client.query(`SELECT id,employee_number,full_name,lifecycle_status,
          to_char(start_date,'YYYY-MM-DD') AS start_date FROM employees
          WHERE id=$1
          ${req.user.role === 'Manager' ? 'AND manager_user_id=$2' : ''}
          FOR SHARE`,req.user.role === 'Manager' ? [req.params.id,req.user.id] : [req.params.id])).rows[0];
        if (!employee) throw new WorkflowError(404,'Employee not found.');
        const workflow = (await client.query("SELECT id,employee_id,template_id,kind,status FROM workflows WHERE employee_id=$1 AND kind='Onboarding' ORDER BY created_at DESC,id DESC LIMIT 1",[employee.id])).rows[0] || null;
        const tasks=workflow ? (await client.query(`SELECT ${taskFields} FROM workflow_tasks WHERE workflow_id=$1 ORDER BY position`,[workflow.id])).rows : [];
        if (req.user.role === 'IT' && !tasks.some(task=>task.assigned_role==='IT')) throw new WorkflowError(404,'Employee not found.');
        return {employee,workflow,tasks};
      });
      res.json(result);
    } catch(error) {
      if (error instanceof WorkflowError) return res.status(error.status).json({error:error.message});
      next(error);
    }
  });
  router.get('/onboarding-checklists',async (req,res,next) => {
    if (!['HR','Manager','IT'].includes(req.user.role)) return res.status(403).json({error:'Permission denied'});
    try {
      const checklists = await inTransaction(database,async client => {
        const workflows = (await client.query(`SELECT
          w.id,w.employee_id,w.template_id,w.kind,w.status,e.employee_number,e.full_name,
          to_char(e.start_date,'YYYY-MM-DD') AS start_date
          FROM workflows w JOIN employees e ON e.id=w.employee_id
          WHERE w.kind='Onboarding'
          AND w.id=(SELECT latest.id FROM workflows latest WHERE latest.employee_id=w.employee_id AND latest.kind='Onboarding' ORDER BY latest.created_at DESC,latest.id DESC LIMIT 1)
          ${req.user.role === 'Manager' ? 'AND e.manager_user_id=$1' : ''}
          ${req.user.role === 'IT' ? "AND EXISTS (SELECT 1 FROM workflow_tasks t WHERE t.workflow_id=w.id AND t.assigned_role='IT')" : ''}
          ORDER BY e.full_name,w.id`,req.user.role === 'Manager' ? [req.user.id] : [])).rows;
        if (!workflows.length) return [];
        const tasks = (await client.query(`SELECT ${taskFields} FROM workflow_tasks WHERE workflow_id=ANY($1::uuid[]) ORDER BY workflow_id,position`,[workflows.map(workflow=>workflow.id)])).rows;
        const tasksByWorkflow = new Map(workflows.map(workflow=>[workflow.id,[]]));
        for (const task of tasks) tasksByWorkflow.get(task.workflow_id).push(task);
        return workflows.map(workflow=>({
          employee:{id:workflow.employee_id,employee_number:workflow.employee_number,full_name:workflow.full_name,start_date:workflow.start_date},
          workflow:{id:workflow.id,employee_id:workflow.employee_id,template_id:workflow.template_id,kind:workflow.kind,status:workflow.status},
          tasks:tasksByWorkflow.get(workflow.id)
        }));
      });
      res.json({checklists});
    } catch(error) { next(error); }
  });
  router.post('/onboarding-tasks/:id/approve',async (req,res,next) => {
    if (!['HR','IT'].includes(req.user.role)) return res.status(403).json({error:'Only HR or IT can approve onboarding tasks.'});
    if (!uuid.test(req.params.id)) return res.status(400).json({error:'Invalid task ID.'});
    try {
      const result=await completeWorkflowTask(database,req.params.id,'Onboarding',req.user);
      res.json(result);
    } catch(error) {
      if (error instanceof WorkflowError) return res.status(error.status).json({error:error.message});
      next(error);
    }
  });
  return router;
}
