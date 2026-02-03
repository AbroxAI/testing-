// synthetic-people.js
// Lightweight synthetic people generator with mixed avatar providers
(function SyntheticPeopleIIFE(){
  if(window.SyntheticPeople) return;

  // simple id helper
  function uid(i){ return 'p_' + Math.random().toString(36).slice(2,9) + (typeof i !== 'undefined' ? ('_' + i) : ''); }

  const DEFAULT = { size: 4872, seedBase: 2026, previewSize: 500 };

  // xorshift32 seeded RNG factory (deterministic when seed provided)
  function xorshift32(seed){
    let x = (seed >>> 0) || 0x811c9dc5;
    return function(){
      x |= 0;
      x ^= x << 13; x >>>= 0;
      x ^= x >>> 17; x >>>= 0;
      x ^= x << 5; x >>>= 0;
      return (x >>> 0) / 4294967296;
    };
  }

  function pick(arr, rnd){ if(!arr || !arr.length) return null; return arr[Math.floor(rnd()*arr.length)]; }

  // avatar mix providers (deterministic pick by index)
  function makeAvatar(name, idx){
    const enc = encodeURIComponent(name || ('u'+idx));
    const prov = idx % 4;
    // Use small deterministic choices to avoid large-network pressure
    switch(prov){
      case 0: return `https://api.dicebear.com/6.x/miniavs/svg?seed=${enc}`;
      case 1: return `https://api.dicebear.com/6.x/identicon/svg?seed=${enc}`;
      case 2: return `https://api.multiavatar.com/${enc}.png`;
      default: return `https://api.dicebear.com/6.x/pixel-art/svg?seed=${enc}`;
    }
  }

  const namesSeed = [
    'Profit Hunters','Kitty Star','Trader Joe','Luna','Rex','Maya','Zed','Nina','Omar','Kofi',
    'Sage','Ava','Noah','Liam','Olivia','Kai','Samuel','Daniel','Zara','Nina'
  ];

  const SyntheticPeople = {
    people: [],
    meta: Object.assign({}, DEFAULT),

    /**
     * generatePool({ size, seedBase })
     * deterministic pool generation using seedBase when provided.
     */
    generatePool(opts){
      opts = opts || {};
      const size = Math.max(10, Number(opts.size || this.meta.size || DEFAULT.size));
      const seedBase = Number(opts.seedBase || this.meta.seedBase || DEFAULT.seedBase);
      this.meta.size = size;
      this.meta.seedBase = seedBase;

      const rnd = xorshift32(seedBase);
      const out = new Array(size);

      for(let i=0;i<size;i++){
        const baseName = (i < namesSeed.length) ? namesSeed[i] : ('Member ' + (i+1));
        const displayName = (i < namesSeed.length) ? (baseName + (i === 0 ? '' : ' #' + (i+1))) : baseName;
        // small deterministic role assignment
        let role = 'VERIFIED';
        if(displayName.indexOf('Profit Hunters') !== -1) role = 'ADMIN';
        else if(displayName.indexOf('Kitty Star') !== -1) role = 'MOD';
        else if(rnd() < 0.009) role = 'MOD';

        // lastActive: spread within last 48h deterministically
        const lastActive = Date.now() - Math.round(rnd() * 1000 * 60 * 60 * 48);

        out[i] = {
          id: uid(i),
          name: displayName.replace(/\s+/g,'_'),
          displayName: displayName,
          role: role,
          avatar: makeAvatar(displayName, i),
          lastActive: lastActive
        };
      }

      this.people = out;
      return this.people;
    },

    /**
     * exportForSimulation() -> limited subset for UI consumption
     */
    exportForSimulation(limit){
      const l = Math.max(0, Math.min(Number(limit || 500), (this.people || []).length));
      return (this.people || []).slice(0, l).map(p => ({ id: p.id, displayName: p.displayName, avatar: p.avatar, role: p.role, lastActive: p.lastActive }));
    },

    /**
     * simulatePresenceStep({ percent = 0.01 })
     * Nudges the lastActive timestamps for a small subset to simulate presence changes.
     */
    simulatePresenceStep(opts){
      opts = opts || {};
      const pct = Math.max(0, Math.min(1, Number(opts.percent || 0.01)));
      if(!this.people || !this.people.length) return;
      const count = Math.max(1, Math.round(this.people.length * pct));
      const rnd = Math.random;
      for(let i=0;i<count;i++){
        const idx = Math.floor(rnd() * this.people.length);
        this.people[idx].lastActive = Date.now() - Math.round(Math.random() * 1000 * 60 * 5); // active within last 5 minutes
      }
    },

    /**
     * injectToUI(targetFn)
     * If a UI hook exists (window._abrox.setSampleMembers) call it with a prepared export.
     * Returns the array passed to UI or null.
     */
    injectToUI(limit){
      try{
        const payload = this.exportForSimulation(limit || Math.min(this.meta.size || DEFAULT.size, DEFAULT.previewSize));
        if(window._abrox && typeof window._abrox.setSampleMembers === 'function'){
          try{ window._abrox.setSampleMembers(payload); }catch(e){ console.warn('SyntheticPeople.injectToUI call failed', e); }
        }
        return payload;
      }catch(e){
        console.warn('SyntheticPeople.injectToUI failed', e);
        return null;
      }
    },

    /**
     * getById(id)
     */
    getById(id){
      if(!this.people) return null;
      return this.people.find(p => p.id === id || p.name === id || p.displayName === id) || null;
    }
  };

  // expose globally
  window.SyntheticPeople = SyntheticPeople;

  // auto-generate a preview pool (small) for quick demo, then inject to UI if available
  setTimeout(()=>{
    try{
      if(!SyntheticPeople.people || !SyntheticPeople.people.length){
        SyntheticPeople.generatePool({ size: Math.min(DEFAULT.previewSize, SyntheticPeople.meta.size || DEFAULT.size), seedBase: SyntheticPeople.meta.seedBase || DEFAULT.seedBase });
      }
      // attempt auto-inject for UI adapters that expect earlier arrival
      SyntheticPeople.injectToUI(Math.min(120, SyntheticPeople.people.length));
    }catch(e){
      console.warn('SyntheticPeople auto-init failed', e);
    } finally {
      // hand the module-ready handshake so other modules can wait
      try{ if(window._abrox && typeof window._abrox.moduleReady === 'function') window._abrox.moduleReady('SyntheticPeople'); }catch(e){}
      try{ window.dispatchEvent(new CustomEvent('SyntheticPeople.ready')); }catch(e){}
      console.info('SyntheticPeople loaded');
    }
  }, 60);

})();
