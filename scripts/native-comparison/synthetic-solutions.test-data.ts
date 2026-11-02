/** Synthetic contract references for local grader tests only. Never include these in worker briefs. */
export const SYNTHETIC_SOLUTIONS: Record<string, string> = {
  "diagnostic-record": String.raw`async (tools,state) => {
 const safe = (p) => typeof p === 'string' && p.length >= 1 && p.length <= 256 && !/^[\/]|^[A-Za-z]:|[\x00-\x1f\x7f\\]/.test(p) && p.split('/').every(x=>x!==''&&x!=='.'&&x!=='..') && /^[A-Za-z0-9_.-]+$/.test(p.split('/').pop());
 if(!safe(state.path)) return {status:'unsafe-input',errorCount:null,truncated:null,firstError:null,context:null};
 const r=await tools.check({path:state.path});
 const errorCount=r.counts.error??0,truncated=r.truncated??null;
 const d=r.diagnostics.find(x=>x.severity==='error');
 if(!d) return {status:errorCount===0&&truncated===null?'clean':'incomplete',errorCount,truncated,firstError:null,context:null};
 if(!safe(d.path)||!Number.isInteger(d.line)||d.line<1||d.line>1000000) return {status:'unsafe-location',errorCount,truncated,firstError:null,context:null};
 const text=await tools.readFile({path:d.path,range:[Math.max(1,d.line-2),d.line+2]});
 return {status:'error',errorCount,truncated,firstError:{path:d.path,line:d.line,message:d.message.slice(0,120)},context:text.slice(0,240)};
}`,
  "located-line-record": String.raw`async (tools,state) => {
 const safe = (p) => typeof p === 'string' && p.length >= 1 && p.length <= 256 && !/^[\/]|^[A-Za-z]:|[\x00-\x1f\x7f\\]/.test(p) && p.split('/').every(x=>x!==''&&x!=='.'&&x!=='..') && /^[A-Za-z0-9_.-]+$/.test(p.split('/').pop());
 const empty=(status,reason=null,truncated=false)=>({status,path:null,reason,lines:[],omittedVisibleMatches:0,truncated});
 if(!safe(state.path)||typeof state.term!=='string'||state.term.length<1||state.term.length>80) return empty('unsafe-input');
 let path=state.path,text;
 try { text=await tools.readFile({path,range:[1,80]}); }
 catch(e) {
  if(!/\bENOENT\b/.test(String(e))) throw e;
  const name=path.split('/').pop();
  const f=await tools.findFiles({pattern:name,path:'.'});
  if(f.truncated) return empty('unresolved','incomplete',true);
  if(f.files.length!==1) return empty('unresolved',f.files.length===0?'absent':'ambiguous');
  path=f.files[0];
  if(!safe(path)||path.split('/').pop()!==name) return empty('unsafe-location');
  text=await tools.readFile({path,range:[1,80]});
 }
 const all=text.split('\n');
 const marker=x=>x.startsWith('[truncated at line ');
 const matches=all.filter(x=>!marker(x)&&x.includes(state.term));
 return {status:'read',path,reason:null,lines:matches.slice(0,3).map(x=>x.slice(0,160)),omittedVisibleMatches:Math.max(0,matches.length-3),truncated:all.some(marker)};
}`,
};
