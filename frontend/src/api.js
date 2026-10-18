export class ApiError extends Error {
  constructor(message,status,fields={}) { super(message); this.status=status; this.fields=fields; }
}
export async function api(path,{body,csrf,...options}={}) {
  const headers={...options.headers};
  if (body !== undefined) headers['Content-Type']='application/json';
  if (csrf) headers['X-CSRF-Token']=csrf;
  const response=await fetch(path,{...options,headers,credentials:'same-origin',...(body!==undefined ? {body:JSON.stringify(body)} : {})});
  let data;
  if (response.status!==204) {
    try { data=await response.json(); }
    catch { throw new ApiError('The server returned an unreadable response. Please try again.',response.status); }
  }
  if (!response.ok) throw new ApiError(data?.error || 'Request failed. Please try again.',response.status,data?.fields);
  return data;
}
