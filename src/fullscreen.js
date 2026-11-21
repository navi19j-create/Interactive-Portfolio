export function enableFullscreen(shell, button) {
  function update() {
    const expanded = document.fullscreenElement === shell || shell.classList.contains('expanded-view');
    button.textContent = expanded ? 'Exit fullscreen' : 'Fullscreen';
    button.setAttribute('aria-pressed', String(expanded));
  }
  function closeExpanded() {
    shell.classList.remove('expanded-view');
    document.documentElement.classList.remove('viewer-open');
    update();
    button.focus({preventScroll:true});
  }
  async function enter() {
    if (document.fullscreenElement === shell || shell.classList.contains('expanded-view')) return;
    try {
      if (!shell.requestFullscreen) throw new Error('Browser fullscreen unavailable');
      await shell.requestFullscreen();
    } catch {
      shell.classList.add('expanded-view');
      document.documentElement.classList.add('viewer-open');
    }
    update();
  }
  button.addEventListener('click', async () => {
    if (document.fullscreenElement === shell) {await document.exitFullscreen();return;}
    if (shell.classList.contains('expanded-view')) {closeExpanded();return;}
    await enter();
  });
  document.addEventListener('fullscreenchange',update);
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape' && shell.classList.contains('expanded-view')) closeExpanded();
  });
  update();
  return enter;
}
