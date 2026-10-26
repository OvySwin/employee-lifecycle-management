import { Router } from 'express';
import { inTransaction, WorkflowError, taskFields } from './workflow-start.js';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function operationsRoutes(database) {
  const router=Router();
  router.get('/overview',async(req,res,next)=>{
    try {
      const [filter,params]=req.user.role==='HR'?['',[]]:req.user.role==='Manager'?['AND e.manager_user_id=$1',[req.user.id]]:["AND t.assigned_role='IT' AND (t.assignee_user_id IS NULL OR t.assignee_user_id=$1)",[req.user.id]];
      const rows=(await database.query(`
        SELECT w.id AS workflow_id,w.employee_id,w.kind,w.status AS workflow_status,
        e.employee_number,e.full_name,e.lifecycle_status,
        t.id AS task_id,t.title,t.status AS task_status,t.required,t.assigned_role,
        t.assignee_user_id,to_char(t.due_date,'YYYY-MM-DD') AS due_date
        FROM workflows w JOIN employees e ON e.id=w.employee_id
        JOIN workflow_tasks t ON t.workflow_id=w.id
        WHERE true ${filter}
        ORDER BY t.due_date NULLS LAST,e.full_name,t.position LIMIT 500
      `,params)).rows;
      const workflows=new Map();
      for(const row of rows){
        if(!workflows.has(row.workflow_id))workflows.set(row.workflow_id,{
          id:row.workflow_id,employee_id:row.employee_id,employee_name:row.full_name,
          kind:row.kind,status:row.workflow_status,lifecycle_status:row.lifecycle_status,
          total:0,completed:0,required_remaining:0
        });
        const workflow=workflows.get(row.workflow_id);
        workflow.total++;
        if(row.task_status==='Completed')workflow.completed++;
        if(row.required&&row.task_status==='Pending')workflow.required_remaining++;
      }
      const tasks=rows.map(row=>({id:row.task_id,workflow_id:row.workflow_id,
        employee_id:row.employee_id,employee_name:row.full_name,employee_number:row.employee_number,
        kind:row.kind,title:row.title,status:row.task_status,required:row.required,
        assigned_role:row.assigned_role,assignee_user_id:row.assignee_user_id,due_date:row.due_date}));
      res.json({workflows:[...workflows.values()],tasks,limited:rows.length===500});
    }catch(error){next(error);}
  });
  router.get('/team/users',async(req,res,next)=>{
    if(req.user.role!=='HR')return res.status(403).json({error:'Only HR can assign tasks.'});
    try{res.json({users:(await database.query('SELECT id,display_name,role FROM app_users WHERE enabled=true ORDER BY role,display_name')).rows});}
    catch(error){next(error);}
  });
  router.patch('/workflow-tasks/:id/assignee',async(req,res,next)=>{
    if(req.user.role!=='HR')return res.status(403).json({error:'Only HR can assign tasks.'});
    if(!uuid.test(req.params.id))return res.status(400).json({error:'Invalid task ID.'});
    const body=req.body;
    if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||
       !Object.hasOwn(body,'assignee_user_id')||
       !(body.assignee_user_id===null||(typeof body.assignee_user_id==='string'&&uuid.test(body.assignee_user_id))))
      return res.status(400).json({error:'Provide assignee_user_id as a user ID or null.'});
    try{
      const task=await inTransaction(database,async client=>{
        const current=(await client.query(`
          SELECT t.id,t.assigned_role,t.status,w.status AS workflow_status,e.manager_user_id
          FROM workflows w JOIN workflow_tasks t ON t.workflow_id=w.id
          JOIN employees e ON e.id=w.employee_id WHERE t.id=$1 FOR UPDATE OF w,t
        `,[req.params.id])).rows[0];
        if(!current)throw new WorkflowError(404,'Task not found.');
        if(current.status!=='Pending'||current.workflow_status!=='InProgress')
          throw new WorkflowError(409,'Only pending tasks on active workflows can be assigned.');
        if(body.assignee_user_id){
          const user=(await client.query('SELECT id,role FROM app_users WHERE id=$1 AND enabled=true',[body.assignee_user_id])).rows[0];
          if(!user||user.role!==current.assigned_role)throw new WorkflowError(400,'Assignee must have the task role.');
          if(user.role==='Manager'&&current.manager_user_id!==user.id)
            throw new WorkflowError(403,'Manager must own this employee.');
        }
        return (await client.query(`UPDATE workflow_tasks SET assignee_user_id=$1 WHERE id=$2 RETURNING ${taskFields}`,
          [body.assignee_user_id,req.params.id])).rows[0];
      });
      res.json({task});
    }catch(error){if(error instanceof WorkflowError)return res.status(error.status).json({error:error.message});next(error);}
  });
  return router;
}
