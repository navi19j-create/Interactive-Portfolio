import {playlist} from './playlist-settings.js';
import listedCredits from './playlist-credits.json';

let apiPromise;
function loadAPI() {
  if(window.YT?.Player) return Promise.resolve(window.YT);
  if(apiPromise) return apiPromise;
  apiPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    const fail=()=>{clearTimeout(timer);script.remove();apiPromise=null;reject(new Error('YouTube could not be reached.'));};
    const timer=setTimeout(fail,14000);
    window.onYouTubeIframeAPIReady=()=>{clearTimeout(timer);resolve(window.YT);};
    script.onerror=fail;script.src='https://www.youtube.com/iframe_api';document.head.append(script);
  });
  return apiPromise;
}

export function youtubeSource(onUpdate, notify, playLocal) {
  const slot=document.getElementById('youtube-slot');
  let tracks = listedCredits;
  const known = new Map(listedCredits.map(item=>[item.id,item]));
  const blocked = new Map();
  const statusLabels = new Map();
  let player, ready = false, active = false, discovering = false, generation = 0, timer, ticker;
  let requested = false, awaitingGesture = false, index = 0, volume = 60, state = 'Stopped';
  let direction = 1, attempts = new Set();
  const track = () => tracks[index];
  const creditList=document.getElementById('credited-tracks');
  for(const track of listedCredits){
    const item=document.createElement('li');
    const link=document.createElement('a');
    link.href='https://www.youtube.com/watch?v='+track.id+'&list='+playlist.id;
    link.target='_blank';link.rel='noopener noreferrer';link.textContent=track.title;
    const byline=document.createElement('span');byline.textContent=track.channel;
    const availability=document.createElement('small');
    availability.className='embed-verdict';
    statusLabels.set(track.id,availability);
    item.append(link,byline,availability);creditList.append(item);
  }

  function mark(text) {
    const label=statusLabels.get(track().id);
    if(label)label.textContent=text;
  }
  function release() {
    generation++;
    clearTimeout(timer);
    clearInterval(ticker);
    ready=false;
    player?.destroy();
    player=null;
    slot.replaceChildren();
  }
  function close() {
    active=false; requested=false; awaitingGesture=false; attempts.clear();
    release();
  }
  function candidate(start) {
    for(let offset=0;offset<tracks.length;offset++){
      const i=(start+direction*offset+tracks.length*2)%tracks.length;
      if(!blocked.has(tracks[i].id) && !attempts.has(tracks[i].id))return i;
    }
    return -1;
  }
  function exhausted() {
    release();
    requested=false;awaitingGesture=false;state='Unavailable';
    const message='None of the '+tracks.length+' tracks played in this embed. Open the playlist in YouTube Music, choose local audio, or press Play to retry.';
    const explanation=document.createElement('p');
    explanation.textContent='YouTube declined embedded playback for all '+tracks.length+' tracks in this session.';
    const fallback=document.createElement('button');
    fallback.type='button';fallback.className='solid';fallback.textContent='Play local audio';
    fallback.onclick=playLocal;
    const endCard=document.createElement('div');
    endCard.className='embed-end';endCard.append(explanation,fallback);
    slot.replaceChildren(endCard);
    notify(message);onUpdate();
  }
  function advance(start) {
    const i=candidate(start);
    if(i<0){exhausted();return;}
    mount(i,true);
  }
  function failTrack(code) {
    clearTimeout(timer);
    state='Unavailable';
    const restricted=[100,101,150].includes(code);
    if(restricted){
      blocked.set(track().id,code);
      mark('Unavailable in this session · YouTube '+code);
    }
    if(requested && restricted){
      notify('Skipping '+track().title+' · YouTube '+code);
      advance(index+direction);
    }else{
      requested=false;
      const reason=code===153?'YouTube could not verify the player identity.':restricted?'This track is unavailable in this embed.':'YouTube playback error '+code+'.';
      notify(reason+(restricted?' Press Play to try the next track.':' Use the YouTube Music link or press Play to retry.'));
      onUpdate();
    }
  }
  async function mount(i,play,discover=false) {
    release();
    const token=generation, current=()=>active && token===generation;
    index=i;requested=play;discovering=discover;awaitingGesture=false;state=play?'Trying track':'Stopped';
    if(play){attempts.add(track().id);notify('Trying '+track().title+'…');}
    onUpdate();
    try{
      const YT=await loadAPI();
      if(!current())return;
      const element=document.createElement('div');slot.append(element);
      timer=setTimeout(()=>{
        if(!current() || ready)return;
        release();requested=false;state='Unavailable';notify('The player could not connect. Press Play to retry, or open YouTube Music.');onUpdate();
      },14000);
      let firstTime=null,confirmed=false;
      player=new YT.Player(element,{
        width:'100%',height:'100%',videoId:track().id,
        playerVars:{playsinline:1,origin:location.origin,controls:1,...(discover?{listType:'playlist',list:playlist.id}:{})},
        events:{
          onReady:event=>{
            if(!current())return;
            clearTimeout(timer);ready=true;event.target.setVolume(volume);
            const live=discover && event.target.getPlaylist?.();
            if(live?.length){
              const initialId=track().id;
              tracks=[...new Set(live)].map((id,n)=>known.get(id) || {id,title:'Track '+(n+1),channel:''});
              index=Math.max(0,tracks.findIndex(item=>item.id===initialId));
            }
            if(requested)event.target.playVideo();
            else if(!blocked.has(track().id))notify('Press Play on the device or in the YouTube player.');
            ticker=setInterval(()=>{
              if(!current())return;
              if(state==='Playing' && !confirmed){
                const t=player.getCurrentTime();
                if(firstTime===null)firstTime=t;
                if(t-firstTime>=1){confirmed=true;attempts.clear();mark('Playback confirmed in this session');notify('Playing '+track().title);}
              }
              onUpdate();
            },400);
          },
          onStateChange:event=>{
            if(!current())return;
            if(event.data===0 && requested){attempts.clear();direction=1;advance(index+1);return;}
            if(event.data===1){requested=true;awaitingGesture=false;state='Playing';}
            if(event.data===2){requested=false;state=state==='Stopped'?'Stopped':'Paused';}
            if(event.data===3)state='Buffering';
            if(event.data===5 && !requested)state='Stopped';
            onUpdate();
          },
          onError:event=>{
            if(!current())return;
            if(discover && !requested){
              release();state='Stopped';slot.textContent='';
              notify('Press Play to check the individual tracks.');onUpdate();return;
            }
            failTrack(event.data);
          },
          onAutoplayBlocked:()=>{
            if(!current())return;
            awaitingGesture=true;state='Press Play';notify('Press Play inside the visible YouTube player to allow playback.');onUpdate();
          }
        }
      });
    }catch{
      if(current()){release();requested=false;state='Unavailable';notify('YouTube could not load. Open the playlist in YouTube Music or press Play to retry.');onUpdate();}
    }
  }
  function open(){
    close();active=true;direction=1;index=0;
    const next=candidate(0);
    if(next===-1){exhausted();return;}
    notify('Connecting to YouTube…');mount(next,false,true);
  }
  function pause(){
    requested=false;awaitingGesture=false;
    if(ready)player.pauseVideo();
  }
  function choose(i,step=1){
    attempts.clear();direction=step;
    advance((i+tracks.length)%tracks.length);
  }
  function command(action){
    if(action==='play'){
      if(state==='Playing'){pause();return;}
      if(state==='Unavailable' && !player)blocked.clear();
      attempts.clear();direction=1;
      if(blocked.has(track().id)){advance(index+1);return;}
      if(discovering){advance(index);return;}
      if(!player || state==='Unavailable'){advance(index);return;}
      requested=true;attempts.add(track().id);
      if(ready)player.playVideo();
      if(awaitingGesture)notify('Press Play inside the visible YouTube player to start this track.');
    }
    if(action==='next' || action==='prev'){
      const step=action==='next'?1:-1;
      choose(index+step,step);
    }
    if(action==='stop'){
      pause();state='Stopped';if(ready)player.seekTo(0,true);onUpdate();
    }
    if(action==='up' || action==='down'){
      volume=Math.max(0,Math.min(100,volume+(action==='up'?10:-10)));
      if(ready)player.setVolume(volume);notify('Volume '+volume+'%');
    }
  }
  return {open,close,command,choose,pause,get index(){return index;},get count(){return tracks.length;},
    label:i=>tracks[i].title,
    get info(){return {title:track().title,credit:track().channel?'YouTube channel · '+track().channel:'Playlist by '+playlist.creator,
      seconds:ready?(player.getCurrentTime?.()||0):0,state,playing:state==='Playing'};}};
}
