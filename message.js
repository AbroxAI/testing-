// message.js
// Unified message renderer for Abrox UI
// - Matches UI classes: .msg, .bubble, .sender, .content, .time
// - Supports: avatars, admin/mod badges, verified badge, grouped messages, reply snippets,
//             attachments (image/video/pdf), pinned messages, accessibility, lucide icons.
// - Designed to be the single canonical renderer used by MessagePool, SimulationEngine etc.

(function unifiedMessageRenderer(){
  // Replace existing renderer to ensure a single canonical implementation
  function escapeHtml(s){
    return ('' + (s || '')).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  }

  function formatTime(ts){
    try{
      const d = new Date(ts || Date.now());
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }catch(e){
      return '';
    }
  }

  // small helper: create element from html string
  function elFrom(html){
    const tmp = document.createElement('div');
    tmp.innerHTML = html.trim();
    return tmp.firstChild;
  }

  // Try to create lucide icons if available (guard)
  function refreshIcons(){
    try{ if(window.lucide && typeof window.lucide.createIcons === 'function') window.lucide.createIcons(); }catch(e){}
  }

  // Determine whether to group with previous message
  function shouldGroupWithPrevious(chatEl, m){
    try{
      if(!chatEl || !chatEl.lastElementChild) return false;
      // find last message element (skip date pills etc)
      let prev = chatEl.lastElementChild;
      while(prev && prev.classList && !prev.classList.contains('msg')){
        prev = prev.previousElementSibling;
      }
      if(!prev) return false;
      const prevSender = prev.dataset.sender || '';
      const timeNow = Number(m.time || Date.now());
      const prevTime = Number(prev.dataset.time || 0);
      // group if same sender and messages are within 6 minutes
      if(prevSender && (prevSender === (m.displayName || m.name || '')) && (Math.abs(timeNow - prevTime) < (6 * 60 * 1000))) return true;
    }catch(e){}
    return false;
  }

  // Render attachments (image/video/pdf/other)
  function renderAttachment(att){
    if(!att) return '';
    const fname = escapeHtml(att.filename || '');
    const url = att.url || '';
    if(/\.(png|jpe?g|gif|webp)$/i.test(fname) || (url && /\.(png|jpe?g|gif|webp)$/i.test(url))){
      return `<div class="attachment attachment-image" role="group" aria-label="image attachment"><img src="${escapeHtml(url || ('/assets/' + fname))}" alt="${fname}" style="max-width:320px;border-radius:8px;display:block" loading="lazy"></div>`;
    }
    if(/\.(mp4|webm|ogg)$/i.test(fname) || (url && /\.(mp4|webm|ogg)$/i.test(url))){
      return `<div class="attachment attachment-video" role="group" aria-label="video attachment"><video controls style="max-width:320px;border-radius:8px;display:block"><source src="${escapeHtml(url || ('/assets/' + fname))}"></video></div>`;
    }
    if(/\.(pdf)$/i.test(fname) || (url && /\.pdf$/i.test(url))){
      return `<div class="attachment attachment-pdf" role="group" aria-label="document attachment"><a href="${escapeHtml(url || ('/assets/' + fname))}" target="_blank" rel="noopener noreferrer">${fname}</a></div>`;
    }
    // fallback: link
    return `<div class="attachment attachment-file" role="group" aria-label="file attachment"><a href="${escapeHtml(url || ('/assets/' + fname))}" target="_blank" rel="noopener noreferrer">${fname}</a></div>`;
  }

  // Main renderer
  function renderMessage(m, autoScroll){
    try{
      if(!m) return;

      const chat = document.getElementById('chat');
      if(!chat) return;

      // Normalize message fields to expected names used across your scripts
      const id = m.id || ('msg_local_' + Date.now());
      const displayName = m.displayName || m.name || 'Member';
      const role = (m.role || '').toUpperCase();
      const avatar = m.avatar || '';
      const textRaw = (m.text === undefined || m.text === null) ? '' : String(m.text);
      const timeStamp = (m.time !== undefined) ? Number(m.time) : (m.timestamp || Date.now());

      // date pill when day changes (only when real day boundary)
      const dayStr = new Date(timeStamp).toDateString();
      if(chat._lastDate !== dayStr){
        const pill = document.createElement('div');
        pill.className = 'date-pill';
        pill.textContent = (dayStr === (new Date()).toDateString()) ? 'Today' : dayStr;
        // add a bit more spacing for realism
        pill.style.marginTop = '18px';
        chat.appendChild(pill);
        chat._lastDate = dayStr;
        // ensure grouped reset so new day doesn't group with old
        chat._lastSender = null;
      }

      // grouping: if previous message same sender & close time
      const grouped = shouldGroupWithPrevious(chat, m);
      const wrapper = document.createElement('div');
      wrapper.className = 'msg ' + ((m.out || m.isOwn) ? 'out' : 'in') + (grouped ? ' grouped' : '');
      wrapper.dataset.id = id;
      wrapper.dataset.sender = displayName;
      wrapper.dataset.time = String(timeStamp);

      // badge logic
      let badgeHtml = '<span class="verified-bubble" title="Verified"><i data-lucide="award" style="width:12px;height:12px"></i></span>';
      if(role === 'ADMIN') badgeHtml = '<span class="role-pill admin">ADMIN</span>';
      else if(role === 'MOD') badgeHtml = '<span class="role-pill mod">MOD</span>';

      // avatar html: only show on inbound and when not grouped
      const avatarHtml = (!m.out && !grouped) ? `<img class="avatar" src="${escapeHtml(avatar)}" alt="${escapeHtml(displayName)}" loading="lazy" width="42" height="42">` : '';

      // reply preview if present
      let replySnippetHtml = '';
      if(m.replyTo){
        // try to resolve target message if in DOM or MessagePool
        let targetText = '';
        try{
          const domTarget = document.querySelector(`[data-id="${m.replyTo}"]`);
          if(domTarget) targetText = domTarget.querySelector('.content') ? domTarget.querySelector('.content').textContent : '';
          else if(window.MessagePool && typeof window.MessagePool.findById === 'function'){
            const found = window.MessagePool.findById(m.replyTo);
            if(found) targetText = found.text || '';
          }
        }catch(e){}
        if(targetText) replySnippetHtml = `<div class="reply-preview" aria-hidden="true"><div style="font-weight:700;font-size:12px">${escapeHtml((m.replyToName || '').slice(0,48) || 'Reply')}</div><div class="snippet" style="font-size:13px;opacity:.85">${escapeHtml(String(targetText).slice(0,120))}</div></div>`;
      }

      // attachments
      const attachHtml = renderAttachment(m.attachment || m.attachments || null);

      // content: preserve basic inline HTML only for safety? We'll escape raw text then convert newlines.
      let escaped = escapeHtml(textRaw).replace(/\n/g, '<br>');
      // If message contains basic markup (e.g., emoji chars) they'll pass through as-is.

      // build bubble content
      const bubbleParts = [];
      // sender row (only on inbound)
      if(!m.out){
        bubbleParts.push(`<div class="sender" aria-hidden="true">${escapeHtml(displayName)} ${badgeHtml}</div>`);
      }
      if(replySnippetHtml) bubbleParts.push(replySnippetHtml);
      bubbleParts.push(`<div class="content" role="article">${escaped}</div>`);
      if(attachHtml) bubbleParts.push(attachHtml);
      // time + seen icon
      bubbleParts.push(`<div class="time" aria-hidden="true"><i data-lucide="eye" class="w-3 h-3" style="margin-right:6px"></i>${formatTime(timeStamp)}</div>`);

      const bubbleHtml = `<div class="bubble" role="group" aria-label="message">${bubbleParts.join('')}</div>`;

      wrapper.innerHTML = `${avatarHtml}${bubbleHtml}`;

      // append and render icons
      chat.appendChild(wrapper);
      refreshIcons();

      // if message is pinned, update pinned banner (ui-adapter provides pinMessage but renderer can auto-pin rare pinned messages)
      if(m.pinned){
        try{ if(typeof window.pinMessage === 'function'){ window.pinMessage(id); } else {
          const pb = document.getElementById('pinnedText'); if(pb) pb.textContent = (m.text||'Pinned message').slice(0,160);
          const banner = document.getElementById('pinnedBanner'); if(banner) banner.classList.remove('hidden');
        } }catch(e){}
      }

      // if reply target exists, add data attribute for quick lookup
      if(m.replyTo) wrapper.dataset.replyTo = m.replyTo;

      // attach interactions if available (ui-adapter provides attachMessageInteractions)
      try{
        if(typeof window.attachMessageInteractions === 'function'){
          window.attachMessageInteractions(wrapper, m);
        } else {
          // fallback: wire basic context menu to allow reply/pin
          wrapper.addEventListener('contextmenu', (ev) => {
            ev.preventDefault();
            // try to reuse ui-adapter's showContextMenuAt if exists
            if(typeof window.showContextMenuAt === 'function') try{ window.showContextMenuAt(ev.clientX, ev.clientY, m, wrapper); return; }catch(e){}
            const menu = document.createElement('div');
            menu.className = 'context-menu';
            menu.style.position = 'fixed';
            menu.style.left = ev.clientX + 'px';
            menu.style.top = ev.clientY + 'px';
            menu.innerHTML = '<div class="menu-item" data-action="reply">Reply</div><div class="menu-item" data-action="pin">Pin</div>';
            document.body.appendChild(menu);
            menu.querySelector('[data-action="reply"]').addEventListener('click', ()=>{ menu.remove(); if(typeof window.setReplyTo === 'function') window.setReplyTo(id); });
            menu.querySelector('[data-action="pin"]').addEventListener('click', ()=>{ menu.remove(); if(typeof window.pinMessage === 'function') window.pinMessage(id); });
            setTimeout(()=>{ document.addEventListener('click', function closer(e){ if(!menu.contains(e.target)){ menu.remove(); document.removeEventListener('click', closer); } }); }, 10);
          });
        }
      }catch(e){ console.warn('attach interactions failed', e); }

      // Post-render: smooth spacing fix (addresses tight layout)
      try{
        const bubbleEl = wrapper.querySelector('.bubble');
        if(bubbleEl){
          bubbleEl.style.marginTop = grouped ? '2px' : '8px';
          bubbleEl.style.marginBottom = '6px';
        }
      }catch(e){}

      // update last-sender tracking on chat element
      try{ chat._lastSender = displayName; }catch(e){}

      // auto scroll behavior
      if(autoScroll === undefined) autoScroll = true;
      if(autoScroll){
        // If user scrolled up (not near bottom), show unread button instead of forcing scroll to end
        if(chat.scrollTop + chat.clientHeight < chat.scrollHeight - 60){
          const unreadBtn = document.getElementById('unreadBtn');
          if(unreadBtn){ unreadBtn.textContent = '⬇ New messages'; unreadBtn.style.display = 'block'; }
        } else {
          chat.scrollTop = chat.scrollHeight;
        }
      }

      return wrapper;
    }catch(err){
      console.error('renderMessage error', err, m);
      return null;
    }
  }

  // Expose (replace existing)
  window.renderMessage = renderMessage;

  // friendly log
  console.info('message.js — unified renderer installed.');
})();
