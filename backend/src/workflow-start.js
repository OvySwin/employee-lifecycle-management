// Shared transaction and template selection primitives for lifecycle creation.
export async function inTransaction(database, action) {
  // PGlite exposes a callback transaction; production pg.Pool needs one leased client.
  if (typeof database.transaction === 'function') return database.transaction(action);
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export class WorkflowError extends Error {
  constructor(status, message, fields) { super(message); this.status = status; this.fields = fields; }
}

export function selectTemplate(templates, employee) {
  const filters = [['role_filter','job_title'],['department_filter','department'],['location_filter','location']];
  const matches = templates.filter(template => filters.every(([filter,field]) => template[filter] === null || template[filter] === employee[field]));
  const specificity = template => filters.filter(([filter]) => template[filter] !== null).length;
  // Exact, case-sensitive AND rules. Highest specificity, then version, name, ID.
  return matches.sort((a,b) => specificity(b)-specificity(a) || b.version-a.version || compare(a.name,b.name) || compare(a.id,b.id))[0];
}
function compare(a,b) { return a < b ? -1 : a > b ? 1 : 0; }

export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0,10) === value;
}

export const taskFields = `id,workflow_id,title,required,assigned_role,assignee_user_id,
  to_char(due_date,'YYYY-MM-DD') AS due_date,position,status`;
