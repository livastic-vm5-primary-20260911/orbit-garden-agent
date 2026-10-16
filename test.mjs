import assert from 'node:assert/strict';
const base=process.env.ORBIT_SERVER||'http://127.0.0.1:8731';
async function req(path,method='GET',body,token) {
  const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{'Authorization':'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
  const t=await r.text();
  return {status:r.status,json:JSON.parse(t)};
}
const health=await req('/api/health');
assert.equal(health.status,200);
const docs=await req('/api/docs');
assert.equal(docs.status,200);
assert.equal(docs.json.name,'Orbit Garden');
const create=await req('/api/games','POST',{name:'Test Owner'});
assert.equal(create.status,201);
const {code,token:ownerToken,playerId:ownerId}=create.json;
assert.match(code,/^[A-F0-9]{6}$/);
const join=await req('/api/games/'+code+'/join','POST',{name:'Test Agent',type:'agent'});
assert.equal(join.status,201);
const {token:agentToken,playerId:agentId}=join.json;
const blocked=await req('/api/games/'+code+'/start','POST',{totalPlayers:2},agentToken);
assert.equal(blocked.status,400);
const begin=await req('/api/games/'+code+'/start','POST',{totalPlayers:3},ownerToken);
assert.equal(begin.status,200);
assert.equal(begin.json.players.length,3);
assert.equal(begin.json.board.filter(t=>t.home).length,3);
assert.equal(begin.json.status,'playing');
const late=await req('/api/games/'+code+'/join','POST',{name:'Late Joiner'});
assert.equal(late.status,400);
const unauth=await req('/api/games/'+code+'/move','POST',{action:'claim',pos:1},'bogus');
assert.equal(unauth.status,401);
const illegal=await req('/api/games/'+code+'/move','POST',{action:'claim',pos:23},ownerToken);
assert.equal(illegal.status,409);
let count=0;
for(let i=0;i<48;i++){
  const state=(await req('/api/games/'+code,'GET',null,ownerToken)).json;
  if(state.status==='finished')break;
  const token=state.turnPlayerId===ownerId?ownerToken:state.turnPlayerId===agentId?agentToken:null;
  if(token) {
    const s=(await req('/api/games/'+code,'GET',null,token)).json;
    let choice=s.legalMoves.find(x=>x.action==='claim'&&x.pos===12);
    if(!choice)choice=s.legalMoves.find(x=>x.action==='claim');
    if(!choice)choice=s.legalMoves.find(x=>x.action==='raid');
    if(!choice)choice=s.legalMoves.find(x=>x.action==='fortify');
    if(!choice)choice=s.legalMoves[0];
    assert.ok(choice,'legal move exists');
    const a=await req('/api/games/'+code+'/move','POST',choice,token);
    assert.equal(a.status,200,JSON.stringify(a.json));
    count++;
  }else {
    await new Promise(ok=>setTimeout(ok,55));
  }
}
const end=(await req('/api/games/'+code,'GET',null,ownerToken)).json;
assert.equal(end.status,'finished');
assert.equal(end.round,9);
assert.ok(end.winner);
assert.equal(end.scores.length,3);
assert.equal(end.history.length,29);
const replay=await req('/api/games/'+code+'/replay');
assert.equal(replay.status,200);
assert.equal(replay.json.history.length,29);
for(const resource of ['/','/style.css','/app.js','/bot.js']) {
  const r=await fetch(base+resource);assert.equal(r.status,200,'GET '+resource);
}
console.log('ALL TESTS PASSED: 2 humans + 1 bot, '+count+' authenticated human/agent moves, illegal-move, auth, replay, static routes');
