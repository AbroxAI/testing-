// simulation-engine.js
// Demo simulation engine that wires MessagePool.createGeneratorView() + TypingEngine
// - Defaults: useStreamAPI: true (preferred for very large pools), simulateTypingBeforeSend: true
// - If simulateTypingBeforeSend is true the engine will call TypingEngine.triggerTyping() (or window._abrox.showTyping())
//   before rendering each message to create a natural "typing -> send" flow.
// - If useStreamAPI && !simulateTypingBeforeSend and MessagePool.streamToUI exists, the engine will call streamToUI()
//   which lets MessagePool drive rendering (fast).
// - If MessagePool.createGeneratorView() exists we use it for memory-light paging; otherwise we fall back to getRange()
// - Deterministic: call SimulationEngine.configure({ seedBase: 4000 }) before start to reproduce runs.
//
// API:
//   SimulationEngine.configure(opts)
//   SimulationEngine.start()
//   SimulationEngine.stop()
//   SimulationEngine.isRunning()
//   SimulationEngine.setRate(ratePerMin)
//   SimulationEngine.setUseStreamAPI(bool)
//   SimulationEngine.setSimulateTypingBeforeSend(bool)
//   SimulationEngine.triggerOnce()  // emits a single message immediately (respecting typing simulation mode)
//

(function globalSimulationEngine(){
  if(window.SimulationEngine) return;

  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
  function now(){ return Date.now(); }

  const DEFAULTS = {
    seedBase: null,                // if set => deterministic PRNG used for internal jitter decisions
    useStreamAPI: true,            // prefer MessagePool.streamToUI for very large pools (fast)
    simulateTypingBeforeSend: true,// simulate typing before sending (more realistic)
    ratePerMin: 45,                // messages per minute
    pageSize: 200,                 // generator view page size (if using generator view)
    jitterFraction: 0.25,          // jitter applied to intervals
    typingMinMs: 300,              // min typing indicator (ms)
    typingMaxMs: 1800,             // max typing indicator (ms)
    typingPerCharMs: 45,           // optional typing duration per character heuristic
    useGeneratorViewIfAvailable: true, // prefer generator view over getRange for prefill/streaming
    simulateTypingFraction: 0.75   // fraction of messages to simulate typing for (not all)
  };

  let cfg = Object.assign({}, DEFAULTS);
  let running = false;
  let mainTimer = null;
  let pageIdx = 0;    // absolute message index counter
  let currentStreamer = null; // holds stream object from MessagePool.streamToUI if in use
  let deterministicRnd = null;

  function createRnd(seed){
    if(seed === null || seed === undefined) return Math.random;
    // tiny xorshift32 local
    let x = (seed >>> 0) || 0x811c9dc5;
    return function(){
      x |= 0;
      x ^= x << 13; x >>>= 0;
      x ^= x >>> 17; x >>>= 0;
      x ^= x << 5; x >>>= 0;
      return (x >>> 0) / 4294967296;
    };
  }

  // small helper to call TypingEngine.triggerTyping or fallback to _abrox.showTyping
  function triggerTypingForNames(names, durationMs){
    durationMs = Math.max(50, Math.round(durationMs || 500));
    try{
      if(window.TypingEngine && typeof window.TypingEngine.triggerTyping === 'function'){
        window.TypingEngine.triggerTyping(names, durationMs);
        return;
      }
    }catch(e){}
    try{
      if(window._abrox && typeof window._abrox.showTyping === 'function'){
        window._abrox.showTyping(names);
        setTimeout(()=>{ try{ window._abrox.showTyping([]); }catch(e){} }, durationMs + 80);
        return;
      }
    }catch(e){}
    // otherwise no-op
  }

  // compute per-message typing duration heuristically
  function computeTypingDurationForMessage(m){
    if(!m || !m.text) return cfg.typingMinMs;
    const chars = (typeof m.text === 'string') ? m.text.length : 0;
    const est = Math.round(chars * cfg.typingPerCharMs);
    return clamp(est, cfg.typingMinMs, cfg.typingMaxMs);
  }

  // safe-get a view object (generator view preferred)
  function buildMessageView(){
    try{
      if(cfg.useGeneratorViewIfAvailable && window.MessagePool && typeof window.MessagePool.createGeneratorView === 'function'){
        const spanDays = (window.MessagePool && window.MessagePool.meta && window.MessagePool.meta.spanDays) || undefined;
        const gv = window.MessagePool.createGeneratorView({ pageSize: cfg.pageSize, seedBase: cfg.seedBase !== null ? cfg.seedBase : undefined, spanDays, cachePages: 12, allowWrap: true });
        window._abrox && (window._abrox._messagePoolView = gv);
        return gv;
      }

      if(window.MessagePool && typeof window.MessagePool.getRange === 'function'){
        return {
          pageSize: cfg.pageSize,
          totalSize: (window.MessagePool && window.MessagePool.messages && window.MessagePool.messages.length) || (window.MessagePool && window.MessagePool.meta && window.MessagePool.meta.size) || null,
          nextPage: function(start){ return window.MessagePool.getRange(start, cfg.pageSize); },
          get: function(i){ return (window.MessagePool.getMessageByIndex ? window.MessagePool.getMessageByIndex(i) : (window.MessagePool.getRange ? window.MessagePool.getRange(i,1)[0] : null)); }
        };
      }
    }catch(e){
      console.warn('SimulationEngine.buildMessageView error', e);
    }
    return null;
  }

  // main loop when using generator view / manual streaming
  function startManualStream(){
    if(running === false) return;
    const view = buildMessageView();
    if(!view){
      console.warn('SimulationEngine: No MessagePool view available — cannot start manual stream.');
      running = false;
      return;
    }

    const baseIntervalMs = Math.round(60000 / Math.max(1, cfg.ratePerMin));
    deterministicRnd = createRnd(cfg.seedBase);

    // initialize local page fetch state
    let currentPageStart = Math.floor(pageIdx / view.pageSize) * view.pageSize;
    let currentPage = view.nextPage ? view.nextPage(currentPageStart) || [] : [];
    let idxWithinPage = pageIdx - currentPageStart;
    if(idxWithinPage < 0) idxWithinPage = 0;

    // internal emitter
    function emitNext(){
      if(!running) return;

      if(idxWithinPage >= currentPage.length){
        currentPageStart += view.pageSize;
        // wrap if totalSize known
        if(view.totalSize && currentPageStart >= view.totalSize){
          currentPageStart = 0;
        }
        currentPage = view.nextPage ? view.nextPage(currentPageStart) || [] : [];
        idxWithinPage = 0;
        if(!currentPage || !currentPage.length){
          console.warn('SimulationEngine: no messages returned for page start', currentPageStart);
          // attempt to wrap to start one more time then stop
          if(currentPageStart !== 0){
            currentPageStart = 0;
            currentPage = view.nextPage ? view.nextPage(currentPageStart) || [] : [];
            if(!currentPage || !currentPage.length){ stop(); return; }
          } else {
            stop(); return;
          }
        }
      }

      const m = currentPage[idxWithinPage];
      pageIdx = currentPageStart + idxWithinPage;
      idxWithinPage++;

      // decide typing simulation
      const doTyping = cfg.simulateTypingBeforeSend && (deterministicRnd() < cfg.simulateTypingFraction);
      if(doTyping){
        const name = (m && (m.displayName || m.name)) ? (m.displayName || m.name) : 'Someone';
        const typingDur = computeTypingDurationForMessage(m);
        try{
          triggerTypingForNames([name], typingDur);
        }catch(e){}
        // render after typingDur + small jitter
        setTimeout(()=>{
          try{ if(window.renderMessage) window.renderMessage(m, true); }catch(e){ console.warn('SimulationEngine: renderMessage failed', e); }
        }, typingDur + Math.round((deterministicRnd() - 0.5) * 180));
      } else {
        try{ if(window.renderMessage) window.renderMessage(m, true); }catch(e){ console.warn('SimulationEngine: renderMessage failed', e); }
      }

      // schedule next emit with jitter
      const jitter = Math.round((deterministicRnd() - 0.5) * baseIntervalMs * cfg.jitterFraction);
      const nextDelay = Math.max(20, baseIntervalMs + jitter);
      mainTimer = setTimeout(emitNext, nextDelay);
    }

    // kick off
    mainTimer = setTimeout(emitNext, 0);
  }

  // start using MessagePool.streamToUI (fast) - only used when simulateTypingBeforeSend === false
  function startStreamAPI(){
    if(!window.MessagePool || typeof window.MessagePool.streamToUI !== 'function'){
      // fallback to manual stream
      startManualStream();
      return;
    }

    const opts = {
      startIndex: pageIdx || 0,
      ratePerMin: cfg.ratePerMin,
      jitterMs: Math.round((60000 / Math.max(1, cfg.ratePerMin)) * cfg.jitterFraction),
      onEmit: (m, idx) => {
        // MessagePool.streamToUI calls renderMessage internally in the MessagePool implementation
        pageIdx = idx + 1;
        // occasional typing nudges to TypingEngine to keep UI lively (independent)
        try{
          if(Math.random() < 0.02){
            const name = (m && (m.displayName || m.name)) ? (m.displayName || m.name) : null;
            if(name) triggerTypingForNames([name], Math.round(200 + Math.random()*900));
          }
        }catch(e){}
      }
    };

    try{
      currentStreamer = window.MessagePool.streamToUI(opts);
    }catch(e){
      console.warn('SimulationEngine.startStreamAPI: streamToUI threw error, falling back', e);
      currentStreamer = null;
      startManualStream();
    }
  }

  // Public API
  const SimulationEngine = {
    configure(opts){
      opts = opts || {};
      if(opts.seedBase !== undefined) cfg.seedBase = (opts.seedBase === null ? null : Number(opts.seedBase));
      if(opts.useStreamAPI !== undefined) cfg.useStreamAPI = !!opts.useStreamAPI;
      if(opts.simulateTypingBeforeSend !== undefined) cfg.simulateTypingBeforeSend = !!opts.simulateTypingBeforeSend;
      if(opts.ratePerMin !== undefined) cfg.ratePerMin = Math.max(1, Number(opts.ratePerMin));
      if(opts.pageSize !== undefined) cfg.pageSize = Math.max(1, Number(opts.pageSize));
      if(opts.jitterFraction !== undefined) cfg.jitterFraction = clamp(Number(opts.jitterFraction), 0, 1);
      if(opts.typingMinMs !== undefined) cfg.typingMinMs = Math.max(10, Number(opts.typingMinMs));
      if(opts.typingMaxMs !== undefined) cfg.typingMaxMs = Math.max(cfg.typingMinMs, Number(opts.typingMaxMs));
      if(opts.typingPerCharMs !== undefined) cfg.typingPerCharMs = Math.max(1, Number(opts.typingPerCharMs));
      if(opts.simulateTypingFraction !== undefined) cfg.simulateTypingFraction = clamp(Number(opts.simulateTypingFraction), 0, 1);
      return Object.assign({}, cfg);
    },

    start(){
      if(running) return;
      running = true;
      // cleanup previous
      this.stop();

      // determine which mode to start in
      if(cfg.useStreamAPI && !cfg.simulateTypingBeforeSend && window.MessagePool && typeof window.MessagePool.streamToUI === 'function'){
        startStreamAPI();
      } else {
        startManualStream();
      }
      return true;
    },

    stop(){
      running = false;
      if(mainTimer){ clearTimeout(mainTimer); mainTimer = null; }
      if(currentStreamer && typeof currentStreamer.stop === 'function'){ try{ currentStreamer.stop(); }catch(e){} currentStreamer = null; }
      return true;
    },

    isRunning(){ return running; },

    // emit a single message immediately (respects simulateTypingBeforeSend setting)
    triggerOnce(){
      const view = buildMessageView();
      if(!view) return null;

      // fetch message at current pageIdx
      let m = null;
      try{
        if(view.get) m = view.get(pageIdx);
        else if(view.nextPage) m = (view.nextPage(pageIdx) || [])[0];
      }catch(e){ console.warn('SimulationEngine.triggerOnce view.get failed', e); }

      if(!m) return null;
      // advance index for next calls
      pageIdx++;

      const doTyping = cfg.simulateTypingBeforeSend && (Math.random() < cfg.simulateTypingFraction);
      if(doTyping){
        const name = m.displayName || m.name || 'Someone';
        const typingDur = computeTypingDurationForMessage(m);
        triggerTypingForNames([name], typingDur);
        setTimeout(()=>{ try{ if(window.renderMessage) window.renderMessage(m, true); }catch(e){ console.warn('SimulationEngine.triggerOnce render failed', e); } }, typingDur + 80);
      } else {
        try{ if(window.renderMessage) window.renderMessage(m, true); }catch(e){ console.warn('SimulationEngine.triggerOnce render failed', e); }
      }
      return m;
    },

    // setter helpers
    setRate(r){ cfg.ratePerMin = Math.max(1, Number(r)); },
    setUseStreamAPI(b){ cfg.useStreamAPI = !!b; },
    setSimulateTypingBeforeSend(b){ cfg.simulateTypingBeforeSend = !!b; },

    // internal debug/state
    _cfg(){ return Object.assign({}, cfg); },
    _state(){ return { running, pageIdx }; }
  };

  // attach globally
  window.SimulationEngine = SimulationEngine;

  // module-ready handshake & DOM event
  try{ if(window._abrox && typeof window._abrox.moduleReady === 'function') window._abrox.moduleReady('SimulationEngine'); }catch(e){}
  try{ window.dispatchEvent(new CustomEvent('SimulationEngine.ready')); }catch(e){}

  console.info('SimulationEngine loaded — uses MessagePool.createGeneratorView() when available. Defaults:', DEFAULTS);

})();
