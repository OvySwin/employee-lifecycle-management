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

  const [offboarding,setOffboarding]=useState(null);
  const [offboardingEndDate,setOffboardingEndDate]=useState('');
  const [offboardingError,setOffboardingError]=useState('');
  const [offboardingLoading,setOffboardingLoading]=useState(false);

  useEffect(()=>{
    const controller=new AbortController();setState({loading:true});
    api(`/api/employees/${id}`,{signal:controller.signal}).then(data=>{if(!controller.signal.aborted)setState({employee:data.employee});}).catch(error=>{if(!controller.signal.aborted){onError(error);setState({error:error.message});}});
    return ()=>controller.abort();
  },[id,retry]);

  async function startEmployeeOffboarding(event) {
  event.preventDefault();
  setOffboardingLoading(true);
  setOffboardingError('');

  try {
    const data = await api(`/api/employees/${id}/offboarding`, {
      method: 'POST',
      body: { end_date: offboardingEndDate },
      csrf
    });

    setOffboarding(data);
  } catch (error) {
    setOffboardingError(error.fields?.end_date || error.message);
  } finally {
    setOffboardingLoading(false);
  }
}

  if(state.loading)return <p role="status">Loading employee…</p>;
  if(state.error)return <div><p role="alert">{state.error}</p><button onClick={()=>setRetry(retry+1)}>Retry employee details</button></div>;
  if(edit)return user.role==='HR' ? <EmployeeForm employee={state.employee} csrf={csrf} onSaved={onSaved} onError={onError}/> : <p role="alert">Only HR can edit employees.</p>;
  const employee=state.employee;
  return <article><h3>{employee.full_name}</h3><dl>{[['Employee number',employee.employee_number],['Position / job title',employee.job_title],['Department',employee.department],['Location',employee.location],['Start date',employee.start_date],['End date',employee.end_date || 'Not set'],['Lifecycle status',employee.lifecycle_status],['Manager',employee.manager_name || 'Unassigned']].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>{user.role==='HR' && <a className="button" href={`#/employees/${employee.id}/edit`}>Edit employee</a>}
  
{user.role === 'HR' && employee.lifecycle_status === 'Active' && (
  <form onSubmit={startEmployeeOffboarding}>
    <h4>Start offboarding</h4>

    <label htmlFor="offboarding-end-date">End date</label>
    <input
      id="offboarding-end-date"
      type="date"
      value={offboardingEndDate}
      min={employee.start_date}
      onChange={(event) => setOffboardingEndDate(event.target.value)}
      required
    />

    {offboardingError && <p role="alert">{offboardingError}</p>}

    <button type="submit" disabled={offboardingLoading}>
      {offboardingLoading ? 'Starting...' : 'Start offboarding'}
    </button>
  </form>
)}

{offboarding && (
  <div>
    <h4>Offboarding checklist</h4>
    <p>Status: {offboarding.employee.lifecycle_status}</p>
    <ul>
      {offboarding.tasks.map((task) => (
        <li key={task.id}>
          {task.title} — {task.status}
        </li>
      ))}
    </ul>
  </div>
)}
  
  <p>Lifecycle status changes through onboarding/offboarding workflows.</p></article>;
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
