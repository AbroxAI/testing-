// emoji-pack.js (patched & locked)
// Lightweight emoji picker for Abrox chat UI
// - Attach to emoji button and insert into input/textarea/contenteditable
// - Searchable, keyboard friendly, mobile-friendly
// - Exposes EmojiPack.init(opts), .open(), .close(), .toggle(), .insert(ch)
// - Defensive: won't create duplicate DOM or styles; works even if UI elements are slightly different

(function EmojiPackIIFE(){
  if (window.EmojiPack && window.EmojiPack._locked) return;
  const EmojiPack = { _locked: true };

  // Defaults (can be overridden via init)
  let CONF = {
    inputId: 'input',          // primary input id
    buttonId: 'emojiBtn',      // emoji button id (lucide icon)
    popoverId: 'emojiPopover',
    gridId: 'emojiGrid',
    searchId: 'emojiSearch',
    autoInit: true,            // auto init at DOMContentLoaded
    closeOnTouchSelect: true,  // close picker after touch selection (mobile)
    emojiPerPage: 200
  };

  // Small curated emoji list — extend as needed
  const EMOJIS = [
    "😀","😁","😂","🤣","😅","😊","😇","🙂","🙃","😉",
    "😎","🤩","😍","😘","😗","😋","🤔","🤨","😐","😑",
    "😶","🙄","😏","😣","😥","😮","🤐","😪","😴","😌",
    "😛","😜","🤪","😝","🤤","😒","😓","😔","😕","☹️",
    "😖","😞","😢","😭","😤","😠","😡","🤯","😳","🥵",
    "🥶","🤢","🤮","🤧","😷","🤒","🤕","🤑","🤠","😺",
    "😸","😹","😻","😽","🙈","🙉","🙊","💩","👍","👎",
    "👏","🙌","🙏","🤝","👌","✌️","🤟","🤘","🤙","🖕",
    "💪","🦾","🦿","🧠","🚀","💎","🔥","📈","📉","🐳",
    "🔒","⚠️","✅","❌","💬","📌","🎯","🎉","💰","🤖"
  ];

  // Short name->emoji hints for search (small map)
  const NAME_MAP = {
    rocket: '🚀', diamond: '💎', fire: '🔥', chart: '📈', down: '📉', whale: '🐳',
    lock: '🔒', check: '✅', cross: '❌', robot: '🤖', money: '💰', party: '🎉', eye: '👁️'
  };

  // helpers
  function elm(tag, options = {}) {
    const e = document.createElement(tag);
    if (options.cls) e.className = options.cls;
    if (options.html) e.innerHTML = options.html;
    if (options.text) e.textContent = options.text;
    if (options.attrs) Object.keys(options.attrs).forEach(k => e.setAttribute(k, options.attrs[k]));
    return e;
  }

  function once(fn){
    let ran = false;
    return function(...args){
      if(ran) return;
      ran = true;
      return fn(...args);
    };
  }

  // ensure we add a single style block (id-based)
  function ensureStyles(){
    if(document.getElementById('emoji-pack-styles')) return;
    const style = document.createElement('style');
    style.id = 'emoji-pack-styles';
    style.textContent = `
      .emoji-popover{ position:absolute; z-index:99999; width:320px; max-width:calc(100vw - 24px);
        background:#11121a; border:1px solid #343a4a; border-radius:12px; padding:8px; box-shadow:0 12px 30px rgba(0,0,0,0.6);
        color:#fff; font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial; }
      .emoji-popover .emoji-search{ width:100%; padding:8px 10px; border-radius:8px; border:1px solid #2b3140; background:#0f1114; color:var(--muted); outline:none; margin-bottom:8px; font-size:14px; }
      .emoji-grid{ display:grid; grid-template-columns:repeat(8, 1fr); gap:6px; max-height:220px; overflow:auto; padding:4px; }
      .emoji-item{ height:36px; display:flex; align-items:center; justify-content:center; border-radius:8px; cursor:pointer; font-size:20px; border:none; background:transparent; color:inherit; }
      .emoji-item:active{ transform:scale(.98); }
      .emoji-item:hover{ background: rgba(255,255,255,0.02); }
      @media (max-width:420px){ .emoji-popover{ width:92vw; padding:6px; } .emoji-grid{ grid-template-columns:repeat(7, 1fr); gap:5px; } .emoji-item{ height:32px; font-size:18px; } }
    `;
    document.head.appendChild(style);
  }

  // Insert text into input/textarea/contenteditable at caret
  function insertAtCaret(target, text) {
    try {
      if(!target) return;
      target.focus();

      // contenteditable
      if(target.isContentEditable){
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) {
          // append fallback
          target.innerText = target.innerText + text;
          placeCaretAtEnd(target);
        } else {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const node = document.createTextNode(text);
          range.insertNode(node);
          // move caret after inserted node
          range.setStartAfter(node);
          range.setEndAfter(node);
          sel.removeAllRanges();
          sel.addRange(range);
        }
        // Dispatch input event
        target.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }

      // input/textarea
      if (typeof target.selectionStart === 'number') {
        const start = target.selectionStart;
        const end = target.selectionEnd;
        const before = target.value.slice(0, start);
        const after = target.value.slice(end);
        target.value = before + text + after;
        const newPos = start + text.length;
        target.setSelectionRange(newPos, newPos);
        target.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }

      // fallback append
      target.value = (target.value || '') + text;
      target.dispatchEvent(new Event('input', { bubbles: true }));
    } catch (err) {
      console.warn('EmojiPack insertAtCaret failed', err);
    }
  }

  // place caret at end of contenteditable
  function placeCaretAtEnd(el) {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // Get target input: input/textarea or contenteditable
  function resolveTargetInput(){
    // try provided id first
    if(CONF.inputId){
      const byId = document.getElementById(CONF.inputId);
      if(byId) return byId;
    }
    // try common selectors
    const q = document.querySelector('input[aria-label="Message input"], textarea[aria-label="Message input"]');
    if(q) return q;
    // try any contenteditable in footer/ main
    const ce = document.querySelector('[contenteditable="true"][role="textbox"], [contenteditable="true"]');
    if(ce) return ce;
    // try any input/textarea in footer
    const footerInp = document.querySelector('footer input, footer textarea, .input-shell input, .input-shell textarea');
    if(footerInp) return footerInp;
    // last resort: first input or textarea on page
    return document.querySelector('input, textarea, [contenteditable="true"]') || null;
  }

  // Build popover DOM
  function buildPopover(){
    ensureStyles();
    let pop = document.getElementById(CONF.popoverId);
    if(pop) return pop;

    pop = elm('div', { attrs: { id: CONF.popoverId, role: 'dialog', 'aria-label': 'Emoji picker' }, cls: 'emoji-popover' });

    const search = elm('input', { cls: 'emoji-search', attrs: { id: CONF.searchId, placeholder: 'Search emoji (e.g. rocket, diamond)', 'aria-label': 'Search emoji' }});
    pop.appendChild(search);

    const grid = elm('div', { cls: 'emoji-grid', attrs: { id: CONF.gridId }});
    pop.appendChild(grid);

    document.body.appendChild(pop);

    // render grid
    function renderGrid(list){
      grid.innerHTML = '';
      const toRender = (list && list.length) ? list.slice(0, CONF.emojiPerPage) : EMOJIS.slice(0, CONF.emojiPerPage);
      for(const ch of toRender){
        const btn = elm('button', { cls: 'emoji-item', text: ch, attrs: { type: 'button', title: ch }});
        // click handler inserts emoji
        btn.addEventListener('click', () => {
          const input = resolveTargetInput();
          insertAtCaret(input, ch);
          // mobile behavior: close on touch devices
          if(CONF.closeOnTouchSelect && ('ontouchstart' in window || window.matchMedia('(max-width:420px)').matches)){
            EmojiPack.close();
          }
        }, { passive: true });
        grid.appendChild(btn);
      }
    }

    renderGrid(EMOJIS);

    // search binding (very small fuzzy via NAME_MAP + simple substring)
    search.addEventListener('input', (e)=>{
      const q = (e.target.value || '').trim().toLowerCase();
      if(!q){ renderGrid(EMOJIS); return; }
      // gather matches from NAME_MAP first
      const picks = [];
      for(const key in NAME_MAP){
        if(key.indexOf(q) !== -1) picks.push(NAME_MAP[key]);
      }
      // then include any literal emoji that contain query (rare)
      for(const e of EMOJIS){
        // quick attempt: if the emoji's title char equals query (not likely) skip — this is best-effort
        if(e.indexOf(q) !== -1) picks.push(e);
      }
      // fallback: if still empty, try prefix match on names (not implemented large DB)
      if(!picks.length) {
        // show the whole list as fallback to avoid empty UI
        renderGrid(EMOJIS);
        return;
      }
      renderGrid(Array.from(new Set(picks)));
    });

    // keyboard close (Esc)
    pop.addEventListener('keydown', (ev) => { if(ev.key === 'Escape') EmojiPack.close(); });

    return pop;
  }

  // Positioning: calculate after pop exists and has layout
  function positionPopover(pop, anchor){
    if(!pop || !anchor) return;
    // Ensure pop rendered so getBoundingClientRect works
    pop.style.display = 'block';
    pop.style.visibility = 'hidden';
    // allow layout reads
    requestAnimationFrame(() => {
      const rect = anchor.getBoundingClientRect();
      const popRect = pop.getBoundingClientRect();
      const pad = 8;
      // prefer above, else below
      let top = rect.top - popRect.height - pad;
      if(top < 8) top = rect.bottom + pad;
      let left = rect.left + (rect.width / 2) - (popRect.width / 2);
      left = Math.max(8, Math.min(left, window.innerWidth - popRect.width - 8));
      pop.style.left = `${Math.round(left + window.scrollX)}px`;
      pop.style.top = `${Math.round(top + window.scrollY)}px`;
      pop.style.visibility = '';
    });
  }

  // Click-outside / touch handlers
  let _docClickHandler = null;
  function bindDocClose(pop, anchor){
    // detach previous
    if(_docClickHandler) document.removeEventListener('click', _docClickHandler);
    _docClickHandler = function(ev){
      if(!pop) return;
      const tgt = ev.target;
      if(tgt.closest && (tgt.closest('#' + CONF.popoverId) || tgt.closest('#' + CONF.buttonId))) return;
      EmojiPack.close();
    };
    // small delay so the immediate click that opened it doesn't close it
    setTimeout(() => {
      document.addEventListener('click', _docClickHandler);
      document.addEventListener('touchstart', _docClickHandler, { passive: true });
    }, 20);
  }

  // Public API methods
  EmojiPack.open = function(){
    try{
      const anchor = document.getElementById(CONF.buttonId) || document.querySelector('button[aria-label="Emoji"]');
      if(!anchor) return;
      const pop = buildPopover();
      positionPopover(pop, anchor);
      // focus search
      const s = document.getElementById(CONF.searchId);
      if(s){ s.focus(); s.select(); }
      // doc-close
      bindDocClose(pop, anchor);
      // ensure lucide icons exist (no-op if lucide not present)
      try { if(window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons(); } catch(e){}
      pop.style.display = 'block';
      EmojiPack._open = true;
      return pop;
    }catch(err){
      console.warn('EmojiPack.open failed', err);
    }
  };

  EmojiPack.close = function(){
    try{
      const pop = document.getElementById(CONF.popoverId);
      if(pop) pop.style.display = 'none';
      // remove doc click handler
      if(_docClickHandler){
        document.removeEventListener('click', _docClickHandler);
        document.removeEventListener('touchstart', _docClickHandler);
        _docClickHandler = null;
      }
      EmojiPack._open = false;
    }catch(e){
      console.warn('EmojiPack.close failed', e);
    }
  };

  EmojiPack.toggle = function(){
    const open = !!EmojiPack._open;
    if(open) EmojiPack.close(); else EmojiPack.open();
  };

  EmojiPack.insert = function(ch){
    const input = resolveTargetInput();
    if(!input) return;
    insertAtCaret(input, String(ch || ''));
  };

  // init with optional overrides: { inputId, buttonId, autoInit, closeOnTouchSelect }
  EmojiPack.init = function(opts = {}){
    try{
      CONF = Object.assign({}, CONF, (opts || {}));
      // build popover (lazy) & attach button handlers
      ensureStyles();
      // find or create button
      let btn = document.getElementById(CONF.buttonId);
      if(!btn){
        btn = document.querySelector('button[aria-label="Emoji"]');
      }
      if(!btn){
        // fallback: create unobtrusive button in footer
        const footer = document.querySelector('footer') || document.body;
        const fallback = elm('button', { text: '😊', cls: 'emoji-fallback', attrs: { id: CONF.buttonId, 'aria-label': 'Emoji' }});
        fallback.style.border = 'none';
        fallback.style.background = 'transparent';
        fallback.style.fontSize = '18px';
        fallback.style.cursor = 'pointer';
        try { footer.prepend(fallback); btn = fallback; } catch(e){}
      }
      if(!btn) return;

      // remove previous listeners to avoid duplicates
      btn.removeEventListener('click', _btnClick);
      btn.addEventListener('click', _btnClick);
      // keyboard toggle
      btn.addEventListener('keydown', (ev) => { if(ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); EmojiPack.toggle(); } });

      // reposition on viewport changes
      window.addEventListener('resize', () => { if(EmojiPack._open){ const pop = document.getElementById(CONF.popoverId); if(pop) positionPopover(pop, btn); }});
      window.addEventListener('scroll', () => { if(EmojiPack._open){ const pop = document.getElementById(CONF.popoverId); if(pop) positionPopover(pop, btn); }}, { passive: true });
    }catch(e){
      console.warn('EmojiPack.init failed', e);
    }
  };

  // button click handler (kept as named fn to detach safely)
  function _btnClick(ev){
    ev.preventDefault();
    EmojiPack.toggle();
  }

  // auto-init if desired
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', () => { if(CONF.autoInit) { try{ EmojiPack.init(); }catch(e){} } });
  } else {
    if(CONF.autoInit) { try{ EmojiPack.init(); }catch(e){} }
  }

  // expose
  window.EmojiPack = EmojiPack;

  console.info('emoji-pack (patched) loaded — call EmojiPack.init({inputId, buttonId}) to lock selectors if desired.');
})();
