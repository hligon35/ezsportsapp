// Careers page filtering logic
// Lightweight, no dependencies. Enhances if #job-filters exists.

(function(){
  const form = document.getElementById('job-filters');
  if(!form) return; // Not on careers page
  const jobsSection = document.querySelector('.jobs');
  const jobs = Array.from(jobsSection.querySelectorAll('.job'));
  const countEl = document.getElementById('job-count');

  function normalize(str){
    return (str||'').toLowerCase();
  }

  function applyFilters(){
    const data = new FormData(form);
    const q = normalize(data.get('q'));
    const location = normalize(data.get('location'));
    const team = normalize(data.get('team'));
    const type = normalize(data.get('type'));

    let visible = 0;
    jobs.forEach(job => {
      const matchQ = !q || job.dataset.title.includes(q);
      const matchLoc = !location || job.dataset.location === location;
      const matchTeam = !team || job.dataset.team === team;
      const matchType = !type || job.dataset.type === type;
      const show = matchQ && matchLoc && matchTeam && matchType;
      job.style.display = show ? '' : 'none';
      if(show) visible++;
    });
    if(countEl){
      countEl.textContent = visible + ' role' + (visible === 1 ? '' : 's') + ' found';
    }
  }

  // Debounce for search
  let t; function debounced(){ clearTimeout(t); t = setTimeout(applyFilters, 120); }

  form.addEventListener('input', (e)=>{
    if(e.target.name === 'q') debounced(); else applyFilters();
  });
  form.addEventListener('change', applyFilters);
  form.addEventListener('reset', ()=>{ setTimeout(applyFilters, 0); });

  // Initial
  applyFilters();
})();
