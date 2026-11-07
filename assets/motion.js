// Sumline polish (design.md § Polish V2): visual classes only, no behaviour. It marks a real
// state change on #tool for the length of its reveal, so a re-render inside one state never
// replays an animation; arms the hero once when it is below the fold; marks new file rows.
// With JS off or reduced motion on, nothing here runs and every element is drawn complete.
(function () {
  var rm = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  var tool = document.getElementById('tool');
  var timers = {};
  function flash(cls, ms) {
    if (rm.matches || !tool) return;
    tool.classList.remove(cls);
    void tool.offsetWidth;
    tool.classList.add(cls);
    clearTimeout(timers[cls]);
    timers[cls] = setTimeout(function () { tool.classList.remove(cls); }, ms);
  }
  if (tool && window.MutationObserver) {
    var prev = tool.dataset.state;
    new MutationObserver(function () {
      var s = tool.dataset.state;
      if (s === prev) return;
      if ((s === 'preview' && (prev === 'input' || prev === 'reading')) || s === 'done') flash('m-reveal', 1400);
      else if (s === 'running' && (prev === 'checkout' || prev === 'preview')) flash('m-run', 400);
      else if (s === 'input' && (prev === 'done' || prev === 'failed')) flash('m-back', 400);
      prev = s;
    }).observe(tool, { attributes: true, attributeFilter: ['data-state'] });
    var list = document.getElementById('file-list');
    if (list) {
      var seen = {};
      new MutationObserver(function () {
        if (rm.matches) return;
        var rows = list.querySelectorAll('li.file');
        for (var i = 0; i < rows.length; i++) {
          var li = rows[i], id = li.dataset.id, st = li.dataset.state;
          if (!(id in seen)) li.classList.add('m-new');
          if ((st === 'locked' || st === 'error') && seen[id] !== st) li.classList.add('m-alert');
          seen[id] = st;
        }
      }).observe(list, { childList: true });
    }
  }
  var hero = document.querySelector('.hero[data-slot="hero"]');
  if (hero && !rm.matches && 'IntersectionObserver' in window && hero.getBoundingClientRect().top >= innerHeight) {
    hero.classList.add('m-armed');
    var io = new IntersectionObserver(function (es) {
      for (var i = 0; i < es.length; i++) if (es[i].isIntersecting) {
        io.disconnect();
        hero.classList.add('m-play');
        hero.classList.remove('m-armed');
        return;
      }
    }, { threshold: 0.4 });
    io.observe(hero);
  }
  // the demo poster loads only when the video nears the viewport (V5: lazy, outside first view)
  var vids = document.querySelectorAll('video[data-poster]');
  function setPoster(v) { v.setAttribute('poster', v.dataset.poster); v.removeAttribute('data-poster'); }
  if (vids.length && 'IntersectionObserver' in window) {
    var vo = new IntersectionObserver(function (es) {
      for (var i = 0; i < es.length; i++) if (es[i].isIntersecting) { setPoster(es[i].target); vo.unobserve(es[i].target); }
    }, { rootMargin: '200px' });
    for (var j = 0; j < vids.length; j++) vo.observe(vids[j]);
  } else for (var k = 0; k < vids.length; k++) setPoster(vids[k]);
})();
