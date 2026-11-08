// Fixed-sentence preview; an unsaved voice selection never changes settings.
export function createVoicePreview({audio,status,request}){
 let controller=null,url=null,epoch=0;
 function stop(text='试听已停止，未保存任何设置。'){
  epoch++;controller?.abort();controller=null;audio.onended=audio.onerror=null;audio.pause();audio.removeAttribute('src');audio.load();audio.hidden=true;
  if(url)URL.revokeObjectURL(url);url=null;if(text!==null)status.textContent=text;
 }
 async function play(voice){
  stop(null);const current=epoch;controller=new AbortController();const signal=controller.signal;status.textContent='正在读取云端双语样音…';
  try{
   const value=await request({voice},{signal,timeoutMs:12000});if(current!==epoch||signal.aborted)return;
   if((voice&&value.voice!==voice)||typeof value.voice!=='string'||value.audioFormat!=='wav'||typeof value.audioBase64!=='string'||value.audioBase64.length>2097152)throw Error('试听音频格式异常，未修改设置');
   const bytes=Uint8Array.from(atob(value.audioBase64),c=>c.charCodeAt(0));
   if(bytes.length<44||String.fromCharCode(...bytes.slice(0,4))!=='RIFF'||String.fromCharCode(...bytes.slice(8,12))!=='WAVE')throw Error('没有收到可播放的试听音频');
   url=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));audio.src=url;audio.hidden=false;status.textContent='正在试听 '+value.voice+' · 中文 + English。喜欢这个音色后，请另行保存。';
   audio.onended=()=>{if(current===epoch)status.textContent='试听结束。选择好后请另行保存音色。';};
   audio.onerror=()=>{if(current===epoch)status.textContent='浏览器无法播放这段试听，请重试。设置未改变。';};
   try{await audio.play();}catch{if(current===epoch)status.textContent='试听已生成，点击下方播放按钮即可收听。设置尚未保存。';}
  }catch(e){if(current===epoch&&!signal.aborted)status.textContent=e.message;}
  finally{if(current===epoch)controller=null;}
 }
 return {play,stop};
}
