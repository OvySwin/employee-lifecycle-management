import React, { useEffect, useRef, useState } from 'react';
import { api } from './api.js';

function routeFromHash() {
  const [path,query='']=(window.location.hash.slice(1) || '/employees').split('?');
  if (path==='/employees') return {kind:'list',page:new URLSearchParams(query).get('page') || '1'};
  if (path==='/employees/new') return {kind:'new'};
  const match=path.match(/^\/employees\/([0-9a-f-]+)(\/edit)?$/i);
  return match ? {kind:match[2]?'edit':'detail',id:match[1]} : {kind:'invalid'};
}

export function EmployeeWorkspace({user,csrf,onAuthExpired}) {
  const [route,setRoute]=useState(routeFromHash);
  const [notice,setNotice]=useState('');
  useEffect(()=>{ const update=()=>setRoute(routeFromHash()); window.addEventListener('hashchange',update); return ()=>window.removeEventListener('hashchange',update); },[]);
  function failed(error) { if (error.status===401) onAuthExpired(); }
  function saved(employee) { setNotice('Employee saved.'); window.location.hash=`/employees/${employee.id}`; }
  return <section aria-labelledby="employees-heading">
    <div className="section-header"><h2 id="employees-heading">{user.role==='HR'?'Employees':'Your employees'}</h2>{user.role==='HR' && route.kind!=='new' && <a className="button" href="#/employees/new" onClick={()=>setNotice('')}>Add employee</a>}</div>
    {notice && <p role="status" className="success">{notice}</p>}
    {route.kind==='list' ? <EmployeeList key={route.page} page={route.page} onError={failed}/> : route.kind==='new' ? user.role==='HR' ? <EmployeeForm csrf={csrf} onSaved={saved} onError={failed}/> : <p role="alert">Only HR can create employees.</p> : ['detail','edit'].includes(route.kind) ? <EmployeeDetail key={`${route.id}-${route.kind}`} id={route.id} edit={route.kind==='edit'} user={user} csrf={csrf} onSaved={saved} onError={failed}/> : <p role="alert">This page was not found.</p>}
    {route.kind!=='list' && <p><a href="#/employees">Back to employee list</a></p>}
  </section>;
}

function EmployeeList({page,onError}) {
  const [state,setState]=useState({loading:true});
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    setState({loading:true});
    api(`/api/employees?page=${encodeURIComponent(page)}&pageSize=10`,{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setState({data});}).catch(error=>{if(!controller.signal.aborted){onError(error);setState({error:error.message});}});
    return ()=>controller.abort();
    // onError only reports session expiry; page/retry define this request's lifetime.
  },[page,retry]);
  if(state.loading)return <p role="status">Loading employees…</p>;
  if(state.error)return <div><p role="alert">{state.error}</p><button onClick={()=>setRetry(retry+1)}>Retry employee list</button></div>;
  const {employees,pagination}=state.data;
  return <>
    {!employees.length ? <p>No employees found in your authorised scope.</p> : <div className="table-scroll"><table><caption>Employee records</caption><thead><tr><th scope="col">Number</th><th scope="col">Name</th><th scope="col">Position / job title</th><th scope="col">Status</th><th scope="col">Details</th></tr></thead><tbody>{employees.map(employee=><tr key={employee.id}><td>{employee.employee_number}</td><td>{employee.full_name}</td><td>{employee.job_title}</td><td>{employee.lifecycle_status}</td><td><a href={`#/employees/${employee.id}`} aria-label={`View ${employee.full_name}`}>View</a></td></tr>)}</tbody></table></div>}
    <nav className="pagination" aria-label="Employee pages"><button disabled={pagination.page<=1} onClick={()=>{window.location.hash=`/employees?page=${pagination.page-1}`;}}>Previous</button><span role="status">Page {pagination.page} of {pagination.totalPages} · {pagination.total} employees</span><button disabled={pagination.page>=pagination.totalPages} onClick={()=>{window.location.hash=`/employees?page=${pagination.page+1}`;}}>Next</button></nav>
  </>;
}

function EmployeeDetail({id,edit,user,csrf,onSaved,onError}) {
  const [state,setState]=useState({loading:true});
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();setState({loading:true});
    api(`/api/employees/${id}`,{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setState({employee:data.employee});}).catch(error=>{if(!controller.signal.aborted){onError(error);setState({error:error.message});}});
    return ()=>controller.abort();
  },[id,retry]);
  if(state.loading)return <p role="status">Loading employee…</p>;
  if(state.error)return <div><p role="alert">{state.error}</p><button onClick={()=>setRetry(retry+1)}>Retry employee details</button></div>;
  if(edit)return user.role==='HR' ? <EmployeeForm employee={state.employee} csrf={csrf} onSaved={onSaved} onError={onError}/> : <p role="alert">Only HR can edit employees.</p>;
  const employee=state.employee;
  return <article><h3>{employee.full_name}</h3><dl>{[['Employee number',employee.employee_number],['Job title',employee.job_title],['Department',employee.department],['Location',employee.location],['Start date',employee.start_date],['End date',employee.end_date || 'Not set'],['Lifecycle status',employee.lifecycle_status],['Manager',employee.manager_name || 'Unassigned']].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{user.role==='HR' && <a className="button" href={`#/employees/${employee.id}/edit`}>Edit employee</a>} <a className="button" href={`#/onboarding/${employee.id}`}>View onboarding checklist</a> <a className="button" href={`#/offboarding/${employee.id}`}>View offboarding</a><p>Lifecycle status changes through onboarding/offboarding workflows.</p></article>;
}

function TaskChecklist({tasks,userRole,csrf,onError,onApproval}) {
  const [items,setItems]=useState(tasks);
  const [approving,setApproving]=useState('');
  const [message,setMessage]=useState('');
  async function approve(task) {
    setApproving(task.id);setMessage('');
    try {
      const data=await api(`/api/onboarding-tasks/${task.id}/approve`,{method:'POST',csrf});
      setItems(previous=>previous.map(item=>item.id===task.id?data.task:item));
      onApproval(data);
    } catch(error) { onError(error);setMessage(error.message); }
    finally { setApproving(''); }
  }
  return <><ol>{items.map(task=><li key={task.id}>{task.title} — {task.assigned_role}{task.due_date ? ` · Due ${task.due_date}` : ''} · {task.status}{task.required ? ' · Required' : ' · Optional'}{task.status==='Pending' && task.assigned_role===userRole && <button disabled={Boolean(approving)} onClick={()=>approve(task)}>{approving===task.id?'Approving…':'Approve step'}</button>}</li>)}</ol>{message && <p role="alert">{message}</p>}</>;
}

export function OnboardingChecklistPage({employeeId,user,csrf,onAuthExpired}) {
  const [state,setState]=useState({loading:true});
  const [retry,setRetry]=useState(0);
  const [starting,setStarting]=useState(false);
  const [message,setMessage]=useState('');
  useEffect(()=>{
    const controller=new AbortController();setState({loading:true});
    api(`/api/employees/${employeeId}/onboarding`,{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setState({data});}).catch(error=>{if(!controller.signal.aborted){if(error.status===401)onAuthExpired();setState({error:error.message});}});
    return ()=>controller.abort();
  },[employeeId,retry]);
  async function start() {
    setStarting(true);setMessage('');
    try {
      const data=await api(`/api/employees/${employeeId}/onboarding`,{method:'POST',csrf});
      setState(previous=>({data:{...previous.data,...data,employee:{...previous.data.employee,...data.employee}}}));
    } catch(error) { if(error.status===401)onAuthExpired();setMessage(error.message); }
    finally { setStarting(false); }
  }
  if(state.loading)return <p role="status">Loading onboarding checklist…</p>;
  if(state.error)return <div><p role="alert">{state.error}</p><button onClick={()=>setRetry(retry+1)}>Retry onboarding checklist</button></div>;
  const {data}=state;
  return <section aria-labelledby="onboarding-checklist-heading">
    <p><a href={user.role==='IT'?'#/employees':`#/employees/${employeeId}`}>{user.role==='IT'?'Back to onboarding overview':'Back to employee details'}</a></p>
    <h2 id="onboarding-checklist-heading">Onboarding checklist</h2>
    <h3>{data.employee.full_name} ({data.employee.employee_number})</h3>
    <p>Start date: {data.employee.start_date} · Employee status: {data.employee.lifecycle_status}</p>
    {data.workflow ? <><p>Workflow status: {data.workflow.status}</p><TaskChecklist tasks={data.tasks} userRole={user.role} csrf={csrf} onError={error=>{if(error.status===401)onAuthExpired();}} onApproval={result=>setState(previous=>({data:{...previous.data,workflow:result.workflow,employee:result.employee ? {...previous.data.employee,...result.employee} : previous.data.employee}}))}/></> : <><p>No onboarding checklist has been started.</p>{user.role==='HR' && data.employee.lifecycle_status==='Onboarding' && <button disabled={starting} onClick={start}>{starting?'Starting…':'Start onboarding'}</button>}</>}
    {message && <p role="alert">{message}</p>}
  </section>;
}

export function OnboardingChecklistList({onAuthExpired}) {
  const [state,setState]=useState({loading:true});
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();setState({loading:true});
    api('/api/onboarding-checklists',{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setState({checklists:data.checklists});}).catch(error=>{if(!controller.signal.aborted){if(error.status===401)onAuthExpired();setState({error:error.message});}});
    return ()=>controller.abort();
  },[retry]);
  if(state.loading)return <p role="status">Loading onboarding checklists…</p>;
  if(state.error)return <div><p role="alert">{state.error}</p><button onClick={()=>setRetry(retry+1)}>Retry onboarding checklists</button></div>;
  return <section aria-labelledby="onboarding-checklists-heading"><h3 id="onboarding-checklists-heading">Onboarding checklists</h3>
    {!state.checklists.length ? <p>No onboarding checklists are available in your authorised scope.</p> : state.checklists.map(({employee,workflow,tasks})=><article key={workflow.id}><h4>{employee.full_name} ({employee.employee_number})</h4><p>Start date: {employee.start_date} · Workflow status: {workflow.status}</p><p>{tasks.filter(task=>task.status==='Completed').length} of {tasks.length} steps approved</p><a className="button" href={`#/onboarding/${employee.id}`}>View checklist and approve steps</a></article>)}
  </section>;
  //return <article><h3>{employee.full_name}</h3><dl>{[['Employee number',employee.employee_number],['Position / job title',employee.job_title],['Department',employee.department],['Location',employee.location],['Start date',employee.start_date],['End date',employee.end_date || 'Not set'],['Lifecycle status',employee.lifecycle_status],['Manager',employee.manager_name || 'Unassigned']].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{user.role==='HR' && <a className="button" href={`#/employees/${employee.id}/edit`}>Edit employee</a>}<p>Lifecycle status changes through onboarding/offboarding workflows.</p></article>;
}

function Field({name,label,error,...inputProps}) {
  return <div className="field"><label htmlFor={name}>{label}</label><input id={name} name={name} aria-invalid={Boolean(error)} aria-describedby={error?`${name}-error`:undefined} {...inputProps}/>{error && <p id={`${name}-error`} className="field-error">{error}</p>}</div>;
}

function EmployeeForm({employee,csrf,onSaved,onError}) {
  const [values,setValues]=useState(()=>({employee_number:employee?.employee_number || '',full_name:employee?.full_name || '',job_title:employee?.job_title || '',department:employee?.department || '',location:employee?.location || '',start_date:employee?.start_date || '',end_date:employee?.end_date || '',manager_user_id:employee?.manager_user_id || ''}));
  const [errors,setErrors]=useState({}),[message,setMessage]=useState(''),[saving,setSaving]=useState(false);
  const [managerState,setManagerState]=useState({loading:true}),[retry,setRetry]=useState(0);
  const summary=useRef(null);
  useEffect(()=>{
    const controller=new AbortController();setManagerState({loading:true});
    api('/api/employee-managers',{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setManagerState({managers:data.managers});}).catch(error=>{if(!controller.signal.aborted){onError(error);setManagerState({error:error.message});}});
    return ()=>controller.abort();
  },[retry]);
  useEffect(()=>{if(message)summary.current?.focus();},[message]);
  function change(event){const {name,value}=event.target;setValues(previous=>({...previous,[name]:value}));setErrors(previous=>({...previous,[name]:undefined}));}
  async function submit(event) {
    event.preventDefault();setSaving(true);setMessage('');setErrors({});
    const body={...values,end_date:values.end_date || null,manager_user_id:values.manager_user_id || null};
    if(employee)delete body.employee_number;
    try {
      const data=await api(employee?`/api/employees/${employee.id}`:'/api/employees',{method:employee?'PATCH':'POST',body,csrf});
      onSaved(data.employee);
    } catch(error){onError(error);setErrors(error.fields || {});setMessage(error.message || 'Unable to save. Please try again.');}
    finally{setSaving(false);}
  }
  return <form className="employee-form" onSubmit={submit}><h3>{employee?'Edit employee':'Add employee'}</h3>
    {message && <p ref={summary} tabIndex="-1" role="alert">{message} {errors.form || ''}</p>}
    <fieldset disabled={saving}><legend>Employee details</legend>
      <Field name="employee_number" label="Employee number" value={values.employee_number} onChange={change} error={errors.employee_number} required maxLength={40} readOnly={Boolean(employee)}/>
      {employee && <p className="hint">Employee number stays fixed after creation.</p>}
      {[['full_name','Full name',200],['job_title','Position / job title',120],['department','Department',120],['location','Location',120]].map(([name,label,max])=><Field key={name} name={name} label={label} value={values[name]} onChange={change} error={errors[name]} required maxLength={max}/>)}
      <Field name="start_date" label="Start date" type="date" value={values.start_date} onChange={change} error={errors.start_date} required/>
      <Field name="end_date" label="End date (optional)" type="date" value={values.end_date} min={values.start_date || undefined} onChange={change} error={errors.end_date}/>
      <div className="field"><label htmlFor="manager_user_id">Manager (optional)</label><select id="manager_user_id" name="manager_user_id" value={values.manager_user_id} onChange={change} disabled={managerState.loading || Boolean(managerState.error)} aria-invalid={Boolean(errors.manager_user_id)} aria-describedby={errors.manager_user_id?'manager-error':undefined}><option value="">Unassigned</option>{managerState.managers?.map(manager=><option value={manager.id} key={manager.id}>{manager.display_name}</option>)}{values.manager_user_id && !managerState.managers?.some(manager=>manager.id===values.manager_user_id) && <option value={values.manager_user_id}>Previously assigned manager (unavailable)</option>}</select>{errors.manager_user_id && <p id="manager-error" className="field-error">{errors.manager_user_id}</p>}</div>
      {managerState.loading && <p role="status">Loading managers…</p>}{managerState.error && <div><p role="alert">{managerState.error}</p><button type="button" onClick={()=>setRetry(retry+1)}>Retry managers</button></div>}
      <p>New employees start in Onboarding. Workflow completion changes their status later.</p>
      <button type="submit" disabled={saving || managerState.loading || Boolean(managerState.error)}>{saving?'Saving…':'Save employee'}</button>
    </fieldset><a href={employee?`#/employees/${employee.id}`:'#/employees'}>Cancel</a>
  </form>;
}

export function OffboardingChecklistPage({employeeId,user,csrf,onAuthExpired}) {
  const [state,setState]=useState({loading:true}),[refresh,setRefresh]=useState(0);
  const [date,setDate]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{
    const controller=new AbortController();
    Promise.all([
      api(`/api/employees/${employeeId}/offboarding`,{signal:controller.signal})
        .then(data=>({workflow:data})).catch(error=>error.status===404?{workflow:null}:Promise.reject(error)),
      user.role==='IT'?Promise.resolve(null):api(`/api/employees/${employeeId}`,{signal:controller.signal})
    ]).then(([a,b])=>{if(!controller.signal.aborted)setState({loading:false,data:a.workflow,employee:b?.employee});})
      .catch(error=>{if(!controller.signal.aborted){if(error.status===401)onAuthExpired();setState({loading:false,error:error.message});}});
    return ()=>controller.abort();
  },[employeeId,refresh]);
  async function start(event){
    event.preventDefault();setBusy(true);setMessage('');
    try{await api(`/api/employees/${employeeId}/offboarding`,{method:'POST',csrf,body:{end_date:date}});setRefresh(n=>n+1);}
    catch(error){if(error.status===401)onAuthExpired();setMessage(error.fields?.end_date||error.message);}
    finally{setBusy(false);}
  }
  async function approve(task){
    setBusy(true);setMessage('');
    try{await api(`/api/offboarding-tasks/${task.id}/approve`,{method:'POST',csrf});setRefresh(n=>n+1);}
    catch(error){if(error.status===401)onAuthExpired();setMessage(error.message);}
    finally{setBusy(false);}
  }
  if(state.loading)return <p role="status">Loading offboarding…</p>;
  if(state.error)return <p role="alert">{state.error} <button onClick={()=>setRefresh(n=>n+1)}>Retry</button></p>;
  return <section><h2>Offboarding checklist</h2>
    <p><a href="#/employees">Back to employees</a></p>
    {state.employee&&<h3>{state.employee.full_name} — {state.employee.lifecycle_status}</h3>}
    {!state.data?<>
      <p>No offboarding workflow has been started.</p>
      {user.role==='HR'&&state.employee?.lifecycle_status==='Active'&&
        <form onSubmit={start}><label htmlFor="offboard-date">Last employment date</label>
          <input id="offboard-date" type="date" min={state.employee.start_date} required value={date} onChange={e=>setDate(e.target.value)}/>
          <button disabled={busy}>Start offboarding</button></form>}
    </>:<>
      <p>Workflow: {state.data.workflow.status} · Employee: {state.data.employee.lifecycle_status}</p>
      <ol>{state.data.tasks.map(task=><li key={task.id}>
        {task.title} · {task.assigned_role} · {task.status}{task.due_date?` · Due ${task.due_date}`:''}
        {task.required?' · Required':' · Optional'}
        {state.data.workflow.status==='InProgress'&&task.status==='Pending'&&task.assigned_role===user.role&&
          (!task.assignee_user_id||task.assignee_user_id===user.id)&&
          <button disabled={busy} onClick={()=>approve(task)}>Complete step</button>}
      </li>)}</ol>
    </>}
    {message&&<p role="alert">{message}</p>}
  </section>;
}

export function ProgressDashboard({user,csrf,onAuthExpired}) {
  const [state,setState]=useState({loading:true}),[retry,setRetry]=useState(0);
  const [users,setUsers]=useState([]),[notice,setNotice]=useState('');
  useEffect(()=>{
    const controller=new AbortController();setState({loading:true});
    Promise.all([api('/api/overview',{signal:controller.signal}),
      user.role==='HR'?api('/api/team/users',{signal:controller.signal}):Promise.resolve({users:[]})])
      .then(([overview,people])=>{if(!controller.signal.aborted){setState({loading:false,...overview});setUsers(people.users);}})
      .catch(error=>{if(!controller.signal.aborted){if(error.status===401)onAuthExpired();setState({loading:false,error:error.message});}});
    return ()=>controller.abort();
  },[retry,user.role]);
  async function assign(task,id){
    setNotice('');
    try{await api(`/api/workflow-tasks/${task.id}/assignee`,{method:'PATCH',csrf,body:{assignee_user_id:id||null}});
      setNotice('Assignment saved.');setRetry(n=>n+1);}
    catch(error){if(error.status===401)onAuthExpired();setNotice(error.message);}
  }
  if(state.loading)return <p role="status">Loading progress and schedule…</p>;
  if(state.error)return <p role="alert">{state.error} <button onClick={()=>setRetry(n=>n+1)}>Retry</button></p>;
  return <section><h2>Workflow progress</h2>
    {state.limited&&<p role="alert">Only the first 500 visible tasks are included. Narrow the reporting scope before using this for a complete export.</p>}
    {!state.workflows.length?<p>No workflows available in your role.</p>:<div className="table-scroll"><table>
      <caption>Current lifecycle progress</caption><thead><tr><th>Employee</th><th>Kind</th><th>Status</th><th>Completed</th><th>Required remaining</th></tr></thead>
      <tbody>{state.workflows.map(w=><tr key={w.id}><td>{w.employee_name}</td><td>{w.kind}</td><td>{w.status}</td><td>{w.completed}/{w.total}</td><td>{w.required_remaining}</td></tr>)}</tbody></table></div>}
    <h3>Task schedule</h3>{notice&&<p role="status">{notice}</p>}
    <div className="table-scroll"><table><caption>Due dates and owners</caption><thead><tr><th>Due</th><th>Employee</th><th>Task</th><th>State</th><th>Owner</th></tr></thead>
    <tbody>{state.tasks.map(task=><tr key={task.id}><td>{task.due_date||'Unscheduled'}</td><td>{task.employee_name}</td><td>{task.title}</td><td>{task.status}</td><td>
    {user.role==='HR'&&task.status==='Pending'&&state.workflows.find(w=>w.id===task.workflow_id)?.status==='InProgress'?
      <select aria-label={`Assign ${task.title}`} value={task.assignee_user_id||''} onChange={e=>assign(task,e.target.value)}>
        <option value="">Role queue ({task.assigned_role})</option>
        {users.filter(person=>person.role===task.assigned_role).map(person=><option key={person.id} value={person.id}>{person.display_name}</option>)}
      </select> : task.assigned_role}</td></tr>)}</tbody></table></div>
  </section>;
}
