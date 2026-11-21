export function setupSubmissions(recipient) {
  const form = document.getElementById('share-playlist');
  const input = document.getElementById('playlist-url');
  const status = document.getElementById('share-status');
  const key = 'pocket-player.playlist-draft';
  try {input.value=localStorage.getItem(key) || '';} catch {}
  form.querySelector('button').textContent = recipient ? 'Open email draft' : 'Save draft';
  status.textContent = recipient ? 'Your email app will open with the playlist link.' : 'Email delivery is coming. Save a draft on this device.';
  input.addEventListener('input',()=>input.setCustomValidity(''));
  form.addEventListener('submit',event=>{
    event.preventDefault();
    let url;
    try {url=new URL(input.value.trim());} catch {}
    if(url?.protocol!=='https:' || !url.hostname || url.username || url.password){
      input.setCustomValidity('Enter an HTTPS playlist link.');input.reportValidity();return;
    }
    let saved=false;
    try {localStorage.setItem(key,url.href);saved=true;} catch {}
    if(recipient){
      location.href='mailto:'+encodeURIComponent(recipient)+'?subject='+encodeURIComponent('My current playlist')+'&body='+encodeURIComponent(url.href);
      status.textContent='Finish sending in your email app.';
    } else {
      status.textContent=saved ? 'Draft saved on this device. You can send it when email opens.' : 'This browser could not save the draft. Keep a copy of your link.';
    }
  });
}
