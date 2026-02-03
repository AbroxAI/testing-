// message.js — unified renderer for Abrox
// Single source of truth for rendering messages used by MessagePool, SimulationEngine, UI adapter
// - Exports window.renderMessage(msg, isNew)
// - Exports window.attachMessageInteractions(domEl, msg)
// - Exports small helpers: window.clearChat(), window.scrollChatToEnd()
// This implementation purposely *replaces* any prior renderMessage to unify behavior.

(function unifiedMessageRenderer(){
  // Always replace to ensure one canonical renderer
  function escapeHtml(s){ return (''+s).replace(/[&<>"]+/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c] || c)); }
  function formatTime(ts){ try{ const d = new Date(ts || Date.now()); return d.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}); }catch(e){ return ''; } }

  // small helper: insert date pill with generous spacing for realism
  function insertDatePill(chatEl, ts){
    const day = new Date(ts).toDateString();
    if(chatEl._lastDate === day) return;
    // create noticeable vertical gap for day transitions to avoid "tight" feeling
    const spacer = document.createElement('div');
    spacer.style.height = '10px';
    spacer.className = 'date-spacer';
    chatEl.appendChild(spacer);

    const pill = document.createElement('div');
    pill.className = 'date-pill';
    pill.textContent = (day === (new Date()).toDateString() ? 'Today' : day);
    chatEl.appendChild(pill);
    chatEl._lastDate = day;
  }

  // grouping: if previous message same sender within 6 minutes, group (hide avatar & sender)
  function shouldGroup(prevMsg, msg){
    if(!prevMsg || !msg) return false;
    if(prevMsg.displayName !== msg.displayName) return false;
    const dt = Math.abs((msg.time || Date.now()) - (prevMsg.time || Date.now()));
    return dt < (6 * 60 * 1000); // 6 minutes
  }

  // main renderer
  function renderMessage(m, isNew){
    try{
      const chat = document.getElementById('chat'); if(!chat || !m) return;

      // date pill
      insertDatePill(chat, m.time || Date.now());

      // determine grouping by peeking at last rendered message object stored on element
      const lastRendered = chat._lastRenderedMessage || null;
      const grouped = shouldGroup(lastRendered, m);

      const el = document.createElement('div');
      el.className = 'msg ' + ((m.out) ? 'out' : 'in') + (grouped ? ' grouped' : '');
      el.dataset.id = m.id || ('msg_' + Math.random().toString(36).slice(2,9));

      // avatar html — hide for grouped in messages
      const avatarHtml = (!m.out && !grouped) ? `<img class="avatar" src="${escapeHtml(m.avatar||'')||'assets/default-avatar.png'}" alt="${escapeHtml(m.displayName||m.name||'')}">` : '';

      // badge
      const badge = (m.role === 'ADMIN') ? '<span class="role-pill admin">ADMIN</span>' : (m.role === 'MOD') ? '<span class="role-pill mod">MOD</span>' : (m.role === 'YOU' ? '<span class="role-pill mod">YOU</span>' : '<span class="verified-bubble" title="Verified"><i data-lucide="award" style="width:12px;height:12px"></i></span>');

      // content: handle attachments, reply preview (if replyTo is present try to resolve snippet)
      let contentHtml = '';
      if(m.replyTo){
        const ref = (window.MessagePool && window.MessagePool.findById) ? window.MessagePool.findById(m.replyTo) : document.querySelector(`[data-id="${m.replyTo}"]`);
        let snippet = '';
        try{ if(ref){ snippet = (typeof ref === 'string') ? ref : (ref.text || ref.content || ''); snippet = snippet.slice(0,120); } }catch(e){}
        if(snippet) contentHtml += `<div class="reply-preview" data-reply-id="${escapeHtml(m.replyTo)}"><div class="snippet">${escapeHtml(snippet)}</div></div>`;
      }

      // message body text (sanitize)
      const textHtml = `<div class="content">${escapeHtml(m.text || '')}</div>`;

      // attachments preview
      let attachHtml = '';
      if(m.attachment){
        const a = m.attachment;
        if(a.url || a.filename){
          const filename = escapeHtml(a.filename || a.name || 'file');
          // image preview if available
          if(/\.(png|jpe?g|gif|webp)$/i.test(filename) && (a.url || '').length){
            attachHtml = `<div class="attachment"><img src="${escapeHtml(a.url)}" alt="${filename}" loading="lazy" style="max-width:220px;border-radius:8px"></div>`;
          } else {
            attachHtml = `<div class="attachment"><div class="attachment-file">📎 ${filename}</div></div>`;
          }
        }
      }

      // seen-by placeholder: if m.seenBy array exists, show count next to time
      const seenHtml = (Array.isArray(m.seenBy) && m.seenBy.length) ? `<span class="seen" title="Seen by ${m.seenBy.join(', ')}">· ${m.seenBy.length} seen</span>` : '';

      // time + eye icon
      const timeHtml = `<div class="time"><i data-lucide="eye" class="w-3 h-3"></i> · ${formatTime(m.time || Date.now())} ${seenHtml}</div>`;

      // compose inner HTML
      const senderHtml = !m.out ? `<div class="sender">${escapeHtml(m.displayName || m.name)} ${badge}</div>` : '';

      el.innerHTML = `${avatarHtml}
        <div class="bubble" role="article">
          ${senderHtml}
          ${contentHtml}
          ${textHtml}
          ${attachHtml}
          ${timeHtml}
        </div>`;

      // append and render icons
      chat.appendChild(el);
      try{ if(window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons(); }catch(e){}

      // update lastRendered pointer (store minimal meta)
      chat._lastRenderedMessage = { displayName: m.displayName || m.name, time: m.time || Date.now(), id: m.id };

      // auto-scroll logic
      ensureChatScrollToEnd(chat, isNew);

      // attach interactions
      attachMessageInteractions(el, m);

      return el;
    }catch(err){ console.error('renderMessage error', err, m); }
  }

  function ensureChatScrollToEnd(chat, isNew){
    if(!chat) return;
    // if user is near bottom, scroll; otherwise show unread button
    if(chat.scrollTop + chat.clientHeight >= chat.scrollHeight - 80 || isNew){
      chat.scrollTop = chat.scrollHeight;
      const unread = document.getElementById('unreadBtn'); if(unread) unread.style.display = 'none';
    } else {
      const unread = document.getElementById('unreadBtn'); if(unread){ unread.textContent = '⬇ New messages'; unread.style.display = 'block'; }
    }
  }

  // interactions: context menu, longpress, swipe reply support stub
  function attachMessageInteractions(domEl, msg){
    if(!domEl) return;

    // existing handlers cleanup
    domEl.oncontextmenu = null;

    domEl.addEventListener('contextmenu', function(ev){
      ev.preventDefault(); showContextMenuAt(ev.clientX, ev.clientY, msg, domEl);
    });

    // touch long-press -> context menu
    let touchTimer = null, startX=0, startY=0;
    domEl.addEventListener('touchstart', function(ev){
      if(touchTimer) clearTimeout(touchTimer);
      const t = ev.touches && ev.touches[0]; if(!t) return;
      startX = t.clientX; startY = t.clientY;
      touchTimer = setTimeout(()=>{ showContextMenuAt(t.clientX, t.clientY, msg, domEl); touchTimer = null; }, 520);
    }, {passive:true});
    domEl.addEventListener('touchmove', function(ev){ if(!touchTimer) return; const t = ev.touches && ev.touches[0]; if(!t) return; if(Math.abs(t.clientX - startX) > 12 || Math.abs(t.clientY - startY) > 12){ clearTimeout(touchTimer); touchTimer = null; } }, {passive:true});
    domEl.addEventListener('touchend', function(){ if(touchTimer){ clearTimeout(touchTimer); touchTimer = null; } });

    // click -> toggle reply preview (if message has replyTo) or focus
    domEl.addEventListener('click', function(ev){
      // if clicked on reply preview, jump to referenced message
      const rp = ev.target.closest && ev.target.closest('.reply-preview');
      if(rp && rp.dataset && rp.dataset.replyId){
        const ref = document.querySelector(`[data-id="${rp.dataset.replyId}"]`);
        if(ref){ ref.scrollIntoView({ behavior:'smooth', block:'center' }); ref.classList.add('blink-highlight'); setTimeout(()=>ref.classList.remove('blink-highlight'), 900); }
        return;
      }
    });
  }

  // simple context menu (Reply / Pin)
  function showContextMenuAt(x,y,msg, anchorEl){
    document.querySelectorAll('.context-menu').forEach(n=>n.remove());
    const menu = document.createElement('div'); menu.className = 'context-menu';
    menu.style.position = 'fixed'; menu.style.left = x + 'px'; menu.style.top = y + 'px'; menu.style.zIndex = 9999;
    menu.innerHTML = `<div class="menu-item" data-action="reply">Reply</div><div class="menu-item" data-action="pin">Pin</div>`;
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    if(rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
    if(rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 8) + 'px';
    menu.querySelector('[data-action="reply"]').addEventListener('click', ()=>{ menu.remove(); if(typeof window.setReplyTo === 'function') window.setReplyTo(msg.id); });
    menu.querySelector('[data-action="pin"]').addEventListener('click', ()=>{ menu.remove(); if(typeof window.pinMessage === 'function') window.pinMessage(msg.id); });
    setTimeout(()=>{ document.addEventListener('click', function closer(e){ if(!menu.contains(e.target)){ menu.remove(); document.removeEventListener('click', closer); } }); }, 10);
  }

  // helpers
  window.attachMessageInteractions = attachMessageInteractions;
  window.renderMessage = renderMessage;
  window.clearChat = function(){ const chat = document.getElementById('chat'); if(chat) chat.innerHTML = ''; if(chat) chat._lastDate = null; };
  window.scrollChatToEnd = function(){ const chat = document.getElementById('chat'); if(chat) chat.scrollTop = chat.scrollHeight; };

  console.info('Unified message renderer loaded — window.renderMessage is the canonical renderer.');
})();
