// message-pool.js
// Deterministic, large message pool generator for Abrox chat simulation.
//
// - Default pool size: 100000 messages (configurable)
// - Deterministic via seedBase so same seed reproduces same messages
// - Templates + tokenization & numeric variety to reduce duplicates
// - Integrates with SyntheticPeople for senders/avatars/roles
// - Methods: generatePool, regenerateAndInject, getMessageByIndex, getRange, pickRandom,
//            streamToUI (simulate live emission), exportToJSON, estimatePoolForDuration, preGenerateTemplates
// - Memory-friendly: createGeneratorView provides paged access without full allocation
//
// NOTE: This module does NOT auto-generate the full 100k pool on load — use MessagePool.generatePool()
//       or regenerateAndInject({ inject:true }) when you want to fill UI.

(function globalMessagePool(){
  if(window.MessagePool) return;

  /* ---------- small deterministic PRNG (xorshift32) ---------- */
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

  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
  function uid(prefix='msg'){ return prefix + '_' + Math.random().toString(36).slice(2,10); }

  /* ---------- Crypto vocabulary & templates (lightweight) ---------- */
  const TOKENS = ['BTC','ETH','SOL','LTC','DOGE','XRP','ADA','BNB','MATIC','AVAX','DOT','LINK','OP','ARB'];
  const INDICATORS = ['RSI','MACD','EMA50','EMA200','SMA20','OBV','VWAP','Volume'];
  const TIMEFRAMES = ['1m','5m','15m','1h','4h','1d','1w'];
  const ORDERS = ['buy','sell','long','short','swing','scalp','hodl'];
  const COMMON_PHRASES = [
    'Anyone watching {token}?',
    'Set a stop at {stop}.',
    'TP at {tp}.',
    'Looks like accumulation to me.',
    'This looks like a retrace — waiting for confirmation.',
    'FOMO incoming 🚀',
    'Diamond hands.',
    'Paper hands everywhere 😅',
    'Watching the order book — strong sell wall.',
    'Good time to DCA?',
    'That was a nasty wick on the 1h.',
    'Whale alert on {token} 🐳',
    'IIRC that indicator signals reversal.',
    'Use limit orders if you care about price.',
    'The bot produced a noisy signal today.',
    'Anyone sharing indicators? DM me.',
    'This feels like a fakeout.',
    'LFG to the moon 🚀💎',
    'That TA lines up with weekly resistance.',
    'Small position only — too risky for me.'
  ];
  const ATTACH_TITLES = ['chart.png','screenshot.jpg','trade.mp4','report.pdf','indicator.png'];
  const EMOJI = ['🚀','💎','🔥','📉','📈','🤖','🔒','⚠️','✅','❌','🐳'];

  /* ---------- Defaults (tuned for long-run realism) ---------- */
  const DEFAULT = {
    size: 100000,
    seedBase: 4000,
    spanDays: 730,
    minWords: 4,
    maxWords: 28,
    replyFraction: 0.06,
    attachmentFraction: 0.04,
    pinnedFraction: 0.0008,
    adminSpeakBoost: 0.04
  };

  /* ---------- Helpers ---------- */
  function pickFrom(arr, rnd) { if(!arr || !arr.length) return null; return arr[Math.floor(rnd()*arr.length)]; }
  function renderTemplate(template, env){ return template.replace(/\{(\w+)\}/g, (m,k)=> env[k] !== undefined ? env[k] : m); }
  function fmtPrice(v){ return (Math.round(v*100)/100).toLocaleString(); }
  function fmtPercent(p){ return (Math.round(p*100)/100).toFixed(2) + '%'; }

  function randPriceForToken(token, rnd){
    let base = 100 * (1 + (token.charCodeAt(0) % 7));
    if(token === 'BTC') base = 30000;
    if(token === 'ETH') base = 2000;
    if(token === 'DOGE') base = 0.08;
    const jitter = (rnd()-0.5) * base * 0.12;
    return Math.max(0.0001, base + jitter);
  }

  // FNV-ish content hash (fast, deterministic)
  function contentHash(s){
    let h = 2166136261 >>> 0;
    for(let i=0;i<s.length;i++){
      h ^= s.charCodeAt(i);
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return (h >>> 0).toString(16);
  }

  // small LRU for dedupe tracking
  function makeLRU(cap){
    const keys = [], set = new Set();
    return {
      has(k){ return set.has(k); },
      push(k){
        if(set.has(k)) return;
        keys.push(k); set.add(k);
        while(keys.length > cap){
          const rem = keys.shift(); set.delete(rem);
        }
      }
    };
  }

  /* ---------- MessagePool Implementation ---------- */
  const MessagePool = {
    messages: [],
    meta: Object.assign({}, DEFAULT),

    // generate a deterministic message for index i
    _generateMessageForIndex(i, opts){
      opts = opts || {};
      const seedBase = Number(opts.seedBase || this.meta.seedBase || DEFAULT.seedBase);
      const rnd = xorshift32(seedBase + (i * 15721)); // deterministic per-index

      // pick sender from SyntheticPeople if available
      let sender = null;
      const sp = (window.SyntheticPeople && Array.isArray(window.SyntheticPeople.people) && window.SyntheticPeople.people.length) ? window.SyntheticPeople : null;
      if(sp){
        const idx = Math.floor(rnd() * sp.people.length);
        sender = sp.people[idx];
      } else {
        sender = { name: 'Member_' + ((i % 5000) + 1), displayName: 'Member ' + ((i % 5000) + 1), role: 'VERIFIED', avatar: '' };
      }

      // template env
      const token = pickFrom(TOKENS, rnd);
      const indicator = pickFrom(INDICATORS, rnd);
      const timeframe = pickFrom(TIMEFRAMES, rnd);
      const order = pickFrom(ORDERS, rnd);

      const price = randPriceForToken(token, rnd);
      const tp = fmtPrice(price * (1 + (rnd()*0.08 + 0.02)));
      const stop = fmtPrice(price * (1 - (rnd()*0.12 + 0.01)));
      const pct = fmtPercent((rnd()-0.5) * 20);

      const env = { token, indicator, timeframe, order, tp, stop, pct };

      // choose template family
      const tPick = rnd();
      let text = '';
      if(tPick < 0.42){
        const tpl = pickFrom(COMMON_PHRASES, rnd);
        text = renderTemplate(tpl, env);
      } else if(tPick < 0.72){
        const words = Math.floor(rnd()*(this.meta.maxWords - this.meta.minWords) + this.meta.minWords);
        const parts = [];
        for(let w=0; w<words; w++){
          if(rnd() < 0.13) parts.push(pickFrom(TOKENS, rnd));
          else if(rnd() < 0.11) parts.push(pickFrom(EMOJI, rnd));
          else {
            parts.push(pickFrom(['check','signal','buy','sell','watch','nice','yikes','rekt','hold','wait','now','looks'], rnd));
          }
        }
        text = parts.join(' ');
      } else if(tPick < 0.87){
        text = `${(sender.displayName||sender.name).split(' ')[0]} posted: ${token} ${order} @ ${fmtPrice(price)} — TP ${tp} / SL ${stop} (${pct})`;
      } else {
        const q = pickFrom(['Anyone got thoughts on {token}?','Who else is holding {token}?','Is {indicator} bearish on {timeframe}?','Just saw a whale move on {token}'], rnd);
        text = renderTemplate(q, env);
      }

      // attachments
      const hasAttachment = rnd() < (opts.attachmentFraction || this.meta.attachmentFraction);
      const attachment = hasAttachment ? pickFrom(ATTACH_TITLES, rnd) : null;

      // replies (deterministic earlier index)
      const isReply = rnd() < (opts.replyFraction || this.meta.replyFraction);
      let replyTo = null;
      if(isReply && i > 8){
        const offset = 2 + Math.floor(rnd() * Math.min(500, i - 2));
        replyTo = 'msg_' + (i - offset);
      }

      // pinned (rare)
      const pinned = rnd() < (opts.pinnedFraction || this.meta.pinnedFraction);

      // timestamp distribution across spanDays
      const now = Date.now();
      const spanDays = Number(opts.spanDays || this.meta.spanDays || DEFAULT.spanDays);
      const frac = i / Math.max(1, (opts.size || this.meta.size || DEFAULT.size));
      const earliest = now - spanDays * 86400000;
      const jitter = (rnd() - 0.5) * 3600000; // ±1h
      const time = Math.round(earliest + frac * (spanDays * 86400000) + jitter);

      if(text.length < 6) text += ' ' + pickFrom(EMOJI, rnd);

      const msg = {
        id: 'msg_' + (i+1),
        name: sender.name || sender.displayName || ('Member_' + ((i%5000)+1)),
        displayName: sender.displayName || sender.name,
        role: sender.role || 'VERIFIED',
        avatar: sender.avatar || '',
        text: text,
        out: false,
        time: time,
        replyTo: replyTo,
        pinned: pinned,
        attachment: hasAttachment ? { filename: attachment, url: (/\.(png|jpe?g)$/i.test(attachment || '') ? 'assets/' + attachment : '') } : null
      };

      return msg;
    },

    // generate the full pool (dedupe LRU applied). This can be expensive for very large 'size'.
    generatePool(opts){
      opts = opts || {};
      const size = clamp(Number(opts.size || this.meta.size || DEFAULT.size), 50, 500000);
      const seedBase = Number(opts.seedBase || this.meta.seedBase || DEFAULT.seedBase);
      const spanDays = Number(opts.spanDays || this.meta.spanDays || DEFAULT.spanDays);

      this.meta.size = size;
      this.meta.seedBase = seedBase;
      this.meta.spanDays = spanDays;

      const lru = makeLRU(2048);
      const arr = new Array(size);

      for(let i=0;i<size;i++){
        let m = this._generateMessageForIndex(i, { size, seedBase, spanDays, replyFraction: this.meta.replyFraction, attachmentFraction: this.meta.attachmentFraction });
        let attempts = 0;
        let h = contentHash(m.text);
        while(lru.has(h) && attempts < 6){
          const alt = this._generateMessageForIndex(i + attempts + 1, { size, seedBase: seedBase + attempts + 1, spanDays });
          m.text = alt.text + ((attempts % 2 === 0) ? (' ' + pickFrom(EMOJI, xorshift32(seedBase + attempts + i))) : '');
          h = contentHash(m.text);
          attempts++;
        }
        lru.push(h);
        arr[i] = m;
      }

      this.messages = arr;
      this._idIndex = {};
      for(let i=0;i<this.messages.length;i++) this._idIndex[this.messages[i].id] = i;
      return this.messages;
    },

    // regenerate & optionally inject an initial window into UI
    async regenerateAndInject(opts){
      opts = opts || {};
      const pool = this.generatePool(opts);
      if(opts.inject && typeof window.renderMessage === 'function'){
        const initial = Math.min(pool.length, opts.initialCount || 40);
        for(let i=0;i<initial;i++){
          try{ window.renderMessage(pool[i], false); }catch(e){ console.warn('renderMessage failed', e); }
        }
      }
      return pool;
    },

    // getters
    getMessageByIndex(i){ if(!this.messages || !this.messages.length) return null; if(i<0||i>=this.messages.length) return null; return this.messages[i]; },
    getRange(start, count){ if(!this.messages || !this.messages.length) return []; start = clamp(start,0, Math.max(0,this.messages.length-1)); count = clamp(count,0,this.messages.length-start); return this.messages.slice(start, start+count); },
    pickRandom(filter){ const pool = filter ? this.messages.filter(filter) : this.messages; if(!pool || !pool.length) return null; return pool[Math.floor(Math.random()*pool.length)]; },

    // stream messages to UI like a live feed
    // opts: { startIndex, ratePerMin, jitterMs, onEmit(msg,idx) }
    streamToUI(opts){
      opts = opts || {};
      if(!this.messages || !this.messages.length){
        console.warn('MessagePool.streamToUI: no messages generated yet.');
        return { stop: ()=>{} };
      }
      const start = clamp(Number(opts.startIndex || 0), 0, this.messages.length-1);
      const ratePerMin = clamp(Number(opts.ratePerMin || 45), 1, 2000);
      const intervalMs = Math.round(60000 / ratePerMin);
      const jitter = Number(opts.jitterMs || Math.round(intervalMs * 0.25));
      let idx = start;
      let stopped = false;

      const timer = setInterval(()=>{
        if(stopped) return;
        const m = this.messages[idx];
        if(m){
          try{ window.renderMessage(m, true); }catch(e){ console.warn('renderMessage error', e); }
          if(typeof opts.onEmit === 'function') opts.onEmit(m, idx);
        }
        idx++;
        if(idx >= this.messages.length){
          idx = Math.max(0, Math.floor(Math.random() * Math.min(1000, this.messages.length)));
        }
      }, Math.max(20, intervalMs + (Math.random() * jitter - jitter/2)));

      return { stop: function(){ stopped = true; clearInterval(timer); } };
    },

    // export to JSON (careful — large)
    exportToJSON(opts){ opts = opts || {}; const start = clamp(Number(opts.start || 0), 0, this.messages.length); const end = clamp(Number(opts.end || this.messages.length), start, this.messages.length); return JSON.stringify(this.messages.slice(start,end)); },

    findById(id){ return (this._idIndex && this._idIndex[id] !== undefined) ? this.messages[this._idIndex[id]] : null; },

    estimatePoolForDuration({ msgsPerMin = 45, durationDays = 365 * 2, avgMsgsPerPersonPerDay = 5 } = {}){
      const totalMsgs = msgsPerMin * 60 * 24 * durationDays;
      const estimatedPeople = Math.ceil(totalMsgs / (avgMsgsPerPersonPerDay * durationDays));
      return { totalMsgs, estimatedPeople };
    },

    preGenerateTemplates(count, opts){
      opts = opts || {};
      const size = clamp(Number(count) || 500, 1, 200000);
      const seedBase = Number(opts.seedBase || this.meta.seedBase || DEFAULT.seedBase);
      const out = [];
      for(let i=0;i<size;i++){
        const m = this._generateMessageForIndex(i, { size, seedBase, spanDays: opts.spanDays || this.meta.spanDays });
        out.push(m.text);
      }
      return out;
    },

    /* ---------- Memory-light paging view for large pools ---------- */
    createGeneratorView(opts){
      opts = opts || {};
      const pageSize = Math.max(1, Number(opts.pageSize || 200));
      const seedBase = (opts.seedBase !== undefined) ? Number(opts.seedBase) : (this.meta && this.meta.seedBase) || DEFAULT.seedBase;
      const spanDays = (opts.spanDays !== undefined) ? Number(opts.spanDays) : (this.meta && this.meta.spanDays) || DEFAULT.spanDays;
      const cachePagesMax = Math.max(3, Number(opts.cachePages || 12));
      const allowWrap = !!opts.allowWrap;
      const totalSize = (this.messages && this.messages.length) ? this.messages.length : (this.meta && this.meta.size) ? Number(this.meta.size) : null;

      const pageOrder = [];
      const pageCache = new Map();

      function pushCache(key, page){
        if(pageCache.has(key)) return;
        pageCache.set(key, page);
        pageOrder.push(key);
        while(pageOrder.length > cachePagesMax){ const rem = pageOrder.shift(); pageCache.delete(rem); }
      }
      function touchCache(key){
        const i = pageOrder.indexOf(key);
        if(i !== -1){ pageOrder.splice(i,1); pageOrder.push(key); }
      }

      const self = this;

      function genMessageAt(index){
        index = Math.max(0, Math.floor(Number(index) || 0));
        if(totalSize !== null && index >= totalSize){
          if(allowWrap) index = index % totalSize;
          else return null;
        }
        if(Array.isArray(self.messages) && self.messages.length && self.messages[index]) return self.messages[index];
        if(typeof self._generateMessageForIndex === 'function') return self._generateMessageForIndex(index, { size: totalSize || undefined, seedBase: seedBase, spanDays: spanDays });
        return null;
      }

      const makePage = (start) => {
        start = Math.max(0, Math.floor(Number(start) || 0));
        if(totalSize !== null && start >= totalSize){
          if(allowWrap) start = start % totalSize;
          else return [];
        }
        const out = [];
        for(let i=0;i<pageSize;i++){
          let idx = start + i;
          if(totalSize !== null){
            if(idx >= totalSize){
              if(allowWrap) idx = idx % totalSize;
              else break;
            }
          }
          const m = genMessageAt(idx);
          if(!m) break;
          out.push(m);
        }
        return out;
      };

      return {
        pageSize,
        totalSize,
        get(index){
          index = Math.max(0, Math.floor(Number(index) || 0));
          const pageStart = Math.floor(index / pageSize) * pageSize;
          if(pageCache.has(pageStart)){ touchCache(pageStart); const page = pageCache.get(pageStart); return page[index - pageStart] || null; }
          try{ return genMessageAt(index); }catch(e){ console.warn('createGeneratorView.get failed for index', index, e); return null; }
        },
        nextPage(startIndex){
          startIndex = Math.max(0, Math.floor(Number(startIndex) || 0));
          const pageStart = Math.floor(startIndex / pageSize) * pageSize;
          if(pageCache.has(pageStart)){ touchCache(pageStart); return pageCache.get(pageStart).slice(); }
          try{ const page = makePage(pageStart); pushCache(pageStart, page); return page.slice(); }catch(e){ console.warn('createGeneratorView.nextPage failed for', pageStart, e); return []; }
        },
        prefetch(startIndex, pages){
          startIndex = Math.max(0, Math.floor(Number(startIndex) || 0));
          pages = Math.max(1, Math.floor(Number(pages) || 1));
          const results = [];
          for(let p=0;p<pages;p++){ const s = startIndex + p * pageSize; results.push(this.nextPage(s)); }
          return results;
        },
        clearCache(){ pageCache.clear(); pageOrder.length = 0; },
        info(){ return { pageSize, totalSize, cachedPages: pageOrder.slice(), cacheCount: pageOrder.length }; }
      };
    } // end createGeneratorView
  }; // end MessagePool object

  // attach globally
  window.MessagePool = MessagePool;

  // light auto-sanity: generate a small sample preview only if SyntheticPeople exists and there's no pool yet.
  setTimeout(()=>{
    try{
      if(window.SyntheticPeople && (!window.MessagePool.messages || !window.MessagePool.messages.length)){
        MessagePool.generatePool({ size: 500, seedBase: MessagePool.meta.seedBase, spanDays: MessagePool.meta.spanDays });
        if(window.renderMessage){
          const initial = Math.min(20, MessagePool.messages.length);
          for(let i=0;i<initial;i++) try{ window.renderMessage(MessagePool.messages[i], false); }catch(e){}
        }
      }
    }catch(e){
      console.warn('MessagePool auto-sanity failed', e);
    } finally {
      // module ready handshake for UI adapter
      try{ if(window._abrox && typeof window._abrox.moduleReady === 'function') window._abrox.moduleReady('MessagePool'); }catch(e){}
      try{ window.dispatchEvent(new CustomEvent('MessagePool.ready')); }catch(e){}
    }
  }, 240);

})();
