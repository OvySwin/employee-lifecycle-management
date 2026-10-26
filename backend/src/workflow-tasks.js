import { inTransaction, WorkflowError, taskFields } from './workflow-start.js';
import { enqueueNotification } from './notifications.js';

export async function completeWorkflowTask(database, taskId, kind, user) {
  return inTransaction(database, async client => {
    const row = (await client.query(`
      SELECT t.id,t.workflow_id,t.assigned_role,t.assignee_user_id,t.status,
             w.employee_id,w.status AS workflow_status,e.manager_user_id
      FROM workflows w JOIN workflow_tasks t ON t.workflow_id=w.id
      JOIN employees e ON e.id=w.employee_id
      WHERE t.id=$1 AND w.kind=$2 FOR UPDATE OF w,t
    `,[taskId,kind])).rows[0];
    if (!row) throw new WorkflowError(404,kind+' task not found.');
    if (row.assigned_role !== user.role ||
        (row.assignee_user_id && row.assignee_user_id !== user.id) ||
        (user.role === 'Manager' && row.manager_user_id !== user.id))
      throw new WorkflowError(403,'This task is not assigned to you or your role.');
    if (row.workflow_status !== 'InProgress') throw new WorkflowError(409,'Workflow already completed.');
    if (row.status !== 'Pending') throw new WorkflowError(409,'Task already completed.');
    const task = (await client.query(`
      UPDATE workflow_tasks SET status='Completed',completed_at=now(),completed_by=$1
      WHERE id=$2 AND status='Pending' RETURNING ${taskFields}
    `,[user.id,taskId])).rows[0];
    const incomplete = (await client.query(`
      SELECT count(*)::int AS count FROM workflow_tasks
      WHERE workflow_id=$1 AND required=true AND status='Pending'
    `,[row.workflow_id])).rows[0].count;
    let workflow = (await client.query(
      'SELECT id,employee_id,template_id,kind,status FROM workflows WHERE id=$1',
      [row.workflow_id]
    )).rows[0];
    let employee = null;
    if (incomplete === 0) {
      workflow = (await client.query(`
        UPDATE workflows SET status='Completed',completed_at=now()
        WHERE id=$1 RETURNING id,employee_id,template_id,kind,status
      `,[row.workflow_id])).rows[0];
      employee = (await client.query(`
        UPDATE employees SET lifecycle_status=$1 WHERE id=$2 RETURNING id,lifecycle_status
      `,[kind === 'Onboarding' ? 'Active' : 'Offboarded',row.employee_id])).rows[0];
    }
    if(employee){
      const hrUsers=(await client.query("SELECT id FROM app_users WHERE enabled=true AND role='HR'")).rows;
      for(const hr of hrUsers) await enqueueNotification(client,`workflow-complete:${workflow.id}:${hr.id}`,hr.id,
        `${kind} workflow completed`,`All required ${kind.toLowerCase()} tasks have been completed for employee ${row.employee_id}.`);
    }
    return {task,workflow,employee};
  });
}
