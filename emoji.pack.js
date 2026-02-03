// emoji-pack.js
// Lightweight emoji picker for Abrox chat UI
// - Attach to #emojiBtn and insert into #input
// - Searchable, keyboard friendly, mobile-friendly
// - Exposes EmojiPack.open/close/toggle
(function EmojiPackIIFE(){
  if(window.EmojiPack) return;
  const EmojiPack = {};
  const DEFAULT_INPUT_ID = 'input';
  const DEFAULT_BTN_ID = 'emojiBtn';
  const POPOVER_ID = 'emojiPopover';
  const GRID_ID = 'emojiGrid';
  const SEARCH_ID = 'emojiSearch';

  // Short, curated emoji set — extend as needed
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

  // Utility: create element with classes & attrs
  function el(tag, opts = {}) {
    const e = document.createElement(tag);
    if(opts.cls) e.className = opts.cls;
    if(opts.html) e.innerHTML = opts.html;
    if(opts.text) e.textContent = opts.text;
    if(opts.attrs) {
      for(const k in opts.attrs) e.setAttribute(k, opts.attrs[k]);
    }
    return e;
  }

  // Insert text at caret position for an <input> or <textarea>
  function insertAtCaret(input, text) {
    try {
      input.focus();
      // modern browsers
      if (typeof input.selectionStart === 'number') {
        const start = input.selectionStart;
        const end = input.selectionEnd;
        const before = input.value.slice(0, start);
        const after = input.value.slice(end);
        input.value = before + text + after;
        // set caret after inserted emoji
        const newPos = start + text.length;
        input.setSelectionRange(newPos, newPos);
      } else {
        // fallback: append
        input.value += text;
      }
      // fire input event so UI glue toggles send button
      const ev = new Event('input', { bubbles: true });
      input.dispatchEvent(ev);
      // small visual nudge on mobile
      input.scrollIntoView({ block: 'nearest' });
    } catch (err) {
      console.warn('EmojiPack insertAtCaret failed', err);
    }
  }

  // Build popover DOM lazily
  function buildPopover() {
    if(document.getElementById(POPOVER_ID)) return document.getElementById(POPOVER_ID);

    const pop = el('div', { cls: 'emoji-popover', attrs: { id: POPOVER_ID, role: 'dialog', 'aria-label': 'Emoji picker' }});
    // basic minimal styles injected inline to avoid CSS file changes
    const style = document.createElement('style');
    style.textContent = `
      .emoji-popover{
        position: absolute;
        z-index: 99999;
        width: 320px;
        max-width: calc(100vw - 24px);
        background: #11121a;
        border: 1px solid #343a4a;
        border-radius: 12px;
        padding: 8px;
        box-shadow: 0 12px 30px rgba(0,0,0,0.6);
        color: #fff;
        font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial;
      }
      .emoji-popover .emoji-search{
        width:100%; padding:8px 10px; border-radius:8px; border:1px solid #2b3140; background:#0f1114; color:var(--muted); outline:none; margin-bottom:8px; font-size:14px;
      }
      .emoji-grid{
        display:grid;
        grid-template-columns: repeat(8, 1fr);
        gap:6px;
        max-height:220px;
        overflow:auto;
        padding:4px;
      }
      .emoji-item{
        height:36px; display:flex;align-items:center;justify-content:center;border-radius:8px;cursor:pointer;font-size:20px;
      }
      .emoji-item:active { transform: scale(.98); }
      .emoji-item:hover{ background: rgba(255,255,255,0.02); }
      @media (max-width:420px){
        .emoji-popover{ width: 92vw; padding:6px; }
        .emoji-grid{ grid-template-columns: repeat(7, 1fr); gap:5px; }
        .emoji-item{ height:32px; font-size:18px; }
      }
    `;
    document.head.appendChild(style);

    const search = el('input', { cls: 'emoji-search', attrs: { id: SEARCH_ID, placeholder: 'Search emoji (type e.g. rocket, heart)', 'aria-label': 'Search emoji' }});
    pop.appendChild(search);

    const grid = el('div', { cls: 'emoji-grid', attrs: { id: GRID_ID }});
    pop.appendChild(grid);

    document.body.appendChild(pop);

    // fill grid
    function renderGrid(list) {
      grid.innerHTML = '';
      for(const ch of list){
        const it = el('button', { cls: 'emoji-item', attrs: { type: 'button', title: ch } });
        it.textContent = ch;
        it.addEventListener('click', (ev) => {
          const input = document.getElementById(DEFAULT_INPUT_ID) || document.querySelector('input[aria-label="Message input"], textarea[aria-label="Message input"]');
          if(input) insertAtCaret(input, ch);
          // small UX: keep picker open for multi-insert but on mobile close after selection
          if(('ontouchstart' in window) || window.matchMedia('(max-width:420px)').matches) {
            EmojiPack.close();
          }
        }, { passive: true });
        grid.appendChild(it);
      }
    }

    renderGrid(EMOJIS);

    // basic fuzzy search on the emoji list by name (very small internal map)
    const NAME_MAP = {
      rocket: '🚀', diamond: '💎', fire: '🔥', chart: '📈', down: '📉', whale: '🐳',
      lock: '🔒', check: '✅', cross: '❌', robot: '🤖', money: '💰', party: '🎉', eye: '👁️'
    };

    search.addEventListener('input', (e)=>{
      const q = (e.target.value || '').trim().toLowerCase();
      if(!q) { renderGrid(EMOJIS); return; }
      // pick any exact name map matches first
      const picks = [];
      for(const k in NAME_MAP){
        if(k.indexOf(q) !== -1) picks.push(NAME_MAP[k]);
      }
      // include any emojis that contain the query as a unicode description fallback (very limited)
      // For broader matching you would use an emoji database; here we fallback to substring filter on a small list
      if(picks.length < 10){
        for(const e of EMOJIS){
          try{
            // use toString(unicode) fallback — this isn't searchable by name, so only include if the char loosely matches query char
            if(e.indexOf(q) !== -1) picks.push(e); // likely never matches; kept as fallback
          }catch(_){}
        }
      }
      // ensure uniqueness and not empty
      const uniq = Array.from(new Set(picks.length ? picks : EMOJIS));
      renderGrid(uniq.slice(0, 200));
    });

    // keyboard: Esc closes
    pop.addEventListener('keydown', (ev) => {
      if(ev.key === 'Escape') { EmojiPack.close(); }
    });

    return pop;
  }

  // Position popover anchored to emoji button
  function positionPopover(pop, anchorBtn) {
    if(!pop || !anchorBtn) return;
    const rect = anchorBtn.getBoundingClientRect();
    const pad = 8;
    // prefer above the button if space, otherwise below
    const aboveSpace = rect.top;
    const popRect = pop.getBoundingClientRect();
    let top = rect.top - popRect.height - pad;
    if(top < 8) {
      // not enough space above -> place below
      top = rect.bottom + pad;
    }
    // align horizontally to the right edge of the button but keep in viewport
    let left = rect.left + (rect.width/2) - (popRect.width/2);
    left = Math.max(8, Math.min(left, window.innerWidth - popRect.width - 8));
    pop.style.top = `${Math.round(top + window.scrollY)}px`;
    pop.style.left = `${Math.round(left + window.scrollX)}px`;
  }

  // Open/close/toggle
  let _open = false;
  let _popEl = null;
  let _anchorBtn = null;
  function getAnchorBtn(){
    if(_anchorBtn) return _anchorBtn;
    _anchorBtn = document.getElementById(DEFAULT_BTN_ID) || document.querySelector('button[aria-label="Emoji"]');
    return _anchorBtn;
  }

  EmojiPack.open = function(){
    try{
      const anchor = getAnchorBtn();
      if(!anchor) return;
      _popEl = buildPopover();
      _popEl.style.display = 'block';
      positionPopover(_popEl, anchor);
      // focus search input for quick typing
      const s = document.getElementById(SEARCH_ID);
      if(s){ s.focus(); s.select(); }
      _open = true;
      // click-outside to close
      setTimeout(()=> {
        const onDocClick = (ev) => {
          if(!_popEl) return;
          if(ev.target.closest && (ev.target.closest('#' + POPOVER_ID) || ev.target.closest('#' + DEFAULT_BTN_ID))) return;
          EmojiPack.close();
          document.removeEventListener('click', onDocClick);
          document.removeEventListener('touchstart', onDocClick);
        };
        document.addEventListener('click', onDocClick);
        document.addEventListener('touchstart', onDocClick, { passive:true });
      }, 20);
    }catch(err){
      console.warn('EmojiPack.open failed', err);
    }
  };

  EmojiPack.close = function(){
    try{
      if(!_open) return;
      const p = document.getElementById(POPOVER_ID);
      if(p) p.style.display = 'none';
      _open = false;
    }catch(e){
      console.warn('EmojiPack.close failed', e);
    }
  };

  EmojiPack.toggle = function(){
    if(_open) EmojiPack.close(); else EmojiPack.open();
  };

  // Attach event listeners to the emoji button and make sure lucide icons are created
  function init() {
    try {
      const btn = getAnchorBtn();
      if(!btn) {
        // If the button is missing, attempt to create a small fallback in the footer
        const footer = document.querySelector('footer') || document.body;
        const fallback = el('button', { cls: 'emoji-fallback', text: '😊', attrs: { id: DEFAULT_BTN_ID, 'aria-label': 'Emoji' }});
        fallback.style.border = 'none';
        fallback.style.background = 'transparent';
        fallback.style.fontSize = '18px';
        fallback.style.cursor = 'pointer';
        // append to footer left side (non-destructive)
        if(footer) footer.prepend(fallback);
      }
    } catch (e) {
      console.warn('EmojiPack init fallback creation failed', e);
    }

    const button = getAnchorBtn();
    if(!button) return;

    // ensure lucide icons are rendered (if used) — safe to call repeatedly
    try { if(window.lucide && typeof lucide.createIcons === 'function') lucide.createIcons(); } catch(e){}

    button.removeEventListener('click', onBtnClick); // detach in case of re-init
    button.addEventListener('click', onBtnClick);
    // also toggle with keyboard (Enter / Space)
    button.addEventListener('keydown', (ev)=>{ if(ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); EmojiPack.toggle(); } });
    // reposition on resize/scroll if open
    window.addEventListener('resize', ()=> { if(_open && _popEl) positionPopover(_popEl, getAnchorBtn()); });
    window.addEventListener('scroll', ()=> { if(_open && _popEl) positionPopover(_popEl, getAnchorBtn()); }, { passive:true });
  }

  function onBtnClick(ev){
    ev.preventDefault();
    EmojiPack.toggle();
  }

  // Public small helper to insert emoji programmatically
  EmojiPack.insert = function(ch){
    const input = document.getElementById(DEFAULT_INPUT_ID) || document.querySelector('input[aria-label="Message input"], textarea[aria-label="Message input"]');
    if(!input) return;
    insertAtCaret(input, String(ch || ''));
  };

  // Auto-init when DOM ready
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 0);
  }

  // expose globally
  window.EmojiPack = EmojiPack;
  console.info('emoji-pack loaded');
})();
