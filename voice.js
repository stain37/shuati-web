/* 语音刷题（web640）
   两件事：
     1) 朗读：把题干 / 选项 / 判分结果念出来（speechSynthesis，系统中文语音，不联网、不花钱）；
     2) 听写：听你说「A」「ABC」「甲乙丙」，替你点选项、提交、翻页（webkitSpeechRecognition）。
   所有参数存 SET.voice，进面板就能调；开关本身也记住，进出答题页不丢。
   识别/朗读都只走浏览器原生能力 —— 不支持的环境退化成「只朗读 + 大按钮」，不会假装能听。 */
(function () {
  'use strict';
  const LSKEY = 'qbank.set.v2';

  const DEF = {
    on: false,
    /* 朗读 */
    rate: 0.95, vol: 1, voiceURI: '', readNo: true, readStem: true, readOpts: true,
    readTags: false, readExp: true, readRes: true, optStyle: 'both',
    /* 识别 */
    lang: 'zh-CN', multiPause: 1200, needConfirm: false, autoJudgeSingle: true,
    autoNext: true, nextDelay: 1400, wake: '', sens: 'mid', mode: 'both',
    /* 行为 */
    handLink: true, stopOnSpeak: true,
    /* 命令词（逗号分隔，面板里能改） */
    cNext: '下一题,下一个,过,跳过',
    cRepeat: '重读,重复,再说一遍,再读一遍,再来一遍',
    cAnswer: '答案,看答案,公布答案',
    cFav: '收藏',
    cSubmit: '确认,确定,提交,就这样'
  };

  const LET = 'ABCDEFGH';
  const HOMO = {
    甲: 'A', 诶: 'A', 哎: 'A', 欸: 'A', 啊: 'A',
    乙: 'B', 必: 'B', 比: 'B', 逼: 'B', 币: 'B', 毕: 'B', 笔: 'B',
    丙: 'C', 西: 'C', 希: 'C', 席: 'C', 习: 'C', 洗: 'C',
    丁: 'D', 第: 'D', 地: 'D', 低: 'D', 底: 'D', 抵: 'D', 滴: 'D',
    戊: 'E', 五: 'E', 无: 'E', 乌: 'E', 屋: 'E', 误: 'E',
    己: 'F', 几: 'F', 机: 'F', 基: 'F', 鸡: 'F',
    庚: 'G', 更: 'G', 耕: 'G', 跟: 'G',
    辛: 'H', 心: 'H', 新: 'H', 欣: 'H', 星: 'H'
  };
  const NUM = { 一: 'A', 二: 'B', 三: 'C', 四: 'D', 五: 'E', 六: 'F', 七: 'G', 八: 'H' };

  let V = null;                 // 合并后的设置
  let rec = null, recOn = false;
  let speaking = false, pending = new Set(), qk = '', announced = false;
  let pauseT = null, nextT = null, lastHeard = '';

  /* ---------- 设置 ---------- */
  function cfg() {
    if (V) return V;
    const base = (window.SET && SET.voice && typeof SET.voice === 'object') ? SET.voice : {};
    V = Object.assign({}, DEF, base);
    return V;
  }
  function save() {
    try {
      if (!window.SET) return;
      SET.voice = cfg();
      if (typeof writeLS === 'function' && typeof LS !== 'undefined' && LS.set) writeLS(LS.set, SET);
    } catch (e) {}
  }
  function isOn() { return !!cfg().on; }

  /* ---------- 朗读 ---------- */
  function synth() { return window.speechSynthesis || null; }
  function zhVoices() {
    const s = synth(); if (!s) return [];
    return (s.getVoices() || []).filter(v => /^zh/i.test(v.lang || ''));
  }
  function pickVoice() {
    const s = synth(); if (!s) return null;
    const all = s.getVoices() || [];
    const want = cfg().voiceURI;
    if (want) { const f = all.find(v => v.voiceURI === want); if (f) return f; }
    const zh = all.filter(v => /^zh/i.test(v.lang || ''));
    return zh[0] || null;
  }
  function stopSpeak() {
    const s = synth(); if (!s) return;
    try { s.cancel(); } catch (e) {}
    speaking = false;
    setPill('idle');
  }
  function speak(text, done) {
    const s = synth();
    if (!s || !text) { done && done(); return; }
    if (cfg().stopOnSpeak) { try { s.cancel(); } catch (e) {} }
    const u = new SpeechSynthesisUtterance(String(text).replace(/\s+/g, ' ').trim());
    u.lang = cfg().lang || 'zh-CN';
    u.rate = Math.max(.6, Math.min(1.6, +cfg().rate || 1));
    u.volume = Math.max(0, Math.min(1, +cfg().vol == null ? 1 : +cfg().vol));
    const v = pickVoice(); if (v) u.voice = v;
    speaking = true; setPill('speaking');
    let fin = false;
    const finish = () => { if (fin) return; fin = true; speaking = false; setPill('idle'); done && done(); };
    u.onend = finish;
    u.onerror = finish;
    /* 兜底：某些浏览器（含无声卡的机器）永远不触发 onend，按字数估一个上限，别把流程卡死 */
    setTimeout(finish, Math.min(30000, 1200 + String(text).length * 105 / Math.max(.6, u.rate)));
    try { s.speak(u); } catch (e) { speaking = false; done && done(); }
  }

  /* ---------- 当前题目 ---------- */
  function inQuiz() { return document.body.classList.contains('quiz') && !!document.querySelector('#view .stem'); }
  function visibleOpts() {
    return Array.prototype.slice.call(document.querySelectorAll('#view .opts .opt'));
  }
  function isMulti() { return !!document.getElementById('doSubmit'); }
  function stemText() {
    const el = document.querySelector('#view .stem');
    return el ? (el.innerText || el.textContent || '').trim() : '';
  }
  function optionItems() {
    return visibleOpts().map((el, i) => {
      const k = (el.querySelector('.k') ? el.querySelector('.k').textContent : '').trim() || LET[i];
      const t = (el.querySelector('.otx') ? el.querySelector('.otx').innerText : el.innerText || '').trim();
      return { letter: k, text: t };
    });
  }
  function tagLine() {
    const t = document.querySelector('#view .tagrow, #view .tags');
    return t ? (t.innerText || '').replace(/\s+/g, ' ').trim() : '';
  }
  function qNoText() {
    const n = document.querySelector('#view .qno');
    return n ? (n.innerText || '').trim() : '';
  }
  function questionSpeech() {
    const c = cfg(), parts = [];
    if (c.readNo) { const n = qNoText(); if (n) parts.push(n.replace(/第\s*(\d+)\s*题/, '第 $1 题')); }
    if (c.readTags) { const t = tagLine(); if (t) parts.push('考点：' + t); }
    if (c.readStem) parts.push(stemText());
    if (c.readOpts) {
      optionItems().forEach((o, i) => {
        if (c.optStyle === 'letter') parts.push(o.letter);
        else if (c.optStyle === 'text') parts.push(o.text);
        else parts.push(o.letter + '，' + o.text);
      });
    }
    parts.push(isMulti() ? '可以多选，选完说确认' : '请选择');
    return parts.filter(Boolean).join('。');
  }
  function resetForQuestion() {
    pending = new Set();
    announced = false;
    clearTimeout(pauseT); clearTimeout(nextT);
  }
  function readCurrent() {
    if (!inQuiz() || cfg().mode === 'listen') { startListen(); return; }
    stopListen();
    speak(questionSpeech(), () => {
      if (!isOn()) return;
      if (cfg().mode !== 'read') startListen();
    });
  }

  /* ---------- 认得出来什么 ---------- */
  function norm(t) {
    return String(t || '')
      .toLowerCase()
      .replace(/[\s,，。、；;：:！!？?."'“”‘’（）()【】\[\]]/g, '')
      .replace(/[０-９]/g, m => String.fromCharCode(m.charCodeAt(0) - 0xfee0));
  }
  function hitCmd(txt, list) {
    const arr = String(list || '').split(/[,，]/).map(s => norm(s)).filter(Boolean);
    return arr.some(w => txt.indexOf(w) >= 0);
  }
  function parseLetters(txt) {
    const out = [];
    let t = norm(txt);
    /* 「第三个 / 第二题 / 一」这种序数先换掉，否则「第」会被当成 D、「三」又被算一次 */
    t = t.replace(/第([一二三四五六七八])|([一二三四五六七八])(?:个|题|项|条)/g,
      (m, a, b) => ' ' + (NUM[a || b] || '').toLowerCase() + ' ');
    /* 英文/拼音字母 */
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (/[a-h]/.test(ch)) out.push(ch.toUpperCase());
      else if (HOMO[ch]) out.push(HOMO[ch]);
      else if (NUM[ch]) out.push(NUM[ch]);
    }
    /* 只留题目真实有的选项范围 */
    const n = visibleOpts().length;
    return out.filter(l => LET.indexOf(l) < Math.max(1, n));
  }

  /* ---------- 动作 ---------- */
  function clickLetter(l) {
    const i = LET.indexOf(l);
    const opts = visibleOpts();
    const el = opts[i];
    if (!el) return false;
    if (!el.onclick) { flash('这题已经作答了，说「下一题」继续'); return false; }
    el.click();
    return true;
  }
  function submitMulti() {
    const b = document.getElementById('doSubmit');
    if (b && !b.disabled) { b.click(); return true; }
    return false;
  }
  function goNext() {
    const b = document.getElementById('next');
    if (b && !b.disabled) b.click();
  }
  function flash(msg) { try { if (typeof toast === 'function') toast(msg, 1800); } catch (e) {} }
  function sayAnswer() {
    const fb = document.querySelector('#view .fb');
    const txt = fb ? (fb.innerText || '').replace(/\s+/g, ' ').trim() : '';
    if (txt) speak(txt);
    else {
      const opts = visibleOpts();
      const right = opts.filter(o => / ok|right|good/.test(o.className)).map(o => (o.querySelector('.k') || {}).textContent);
      speak(right.length ? '答案是 ' + right.join('、') : '还没有答案');
    }
  }
  function speakResult() {
    if (!cfg().readRes) return;
    const fb = document.querySelector('#view .fb');
    const txt = fb ? (fb.innerText || '').replace(/\s+/g, ' ').trim() : '';
    const okEl = document.querySelector('#view .fb .res');
    const ok = okEl ? /正确|对/.test(okEl.className + okEl.innerText) && !/错/.test(okEl.innerText) : null;
    const line = ok === true ? '回答正确。' : ok === false ? '回答错误。' : '';
    const body = cfg().readExp || ok !== false ? txt : '';
    speak((line + body).slice(0, 400), () => {
      if (!isOn()) return;
      if (cfg().autoNext) {
        nextT = setTimeout(goNext, Math.max(300, +cfg().nextDelay || 1400));
      } else startListen();
    });
  }

  /* ---------- 听 ---------- */
  function SR() { return window.SpeechRecognition || window.webkitSpeechRecognition || null; }
  function supported() { return !!SR(); }
  function setPill(state, heard) {
    const p = document.getElementById('voicePill');
    if (!p) return;
    p.setAttribute('data-state', state || 'idle');
    const s = p.querySelector('.vp-txt');
    if (s) s.textContent = state === 'listening' ? '正在听…' : state === 'speaking' ? '正在读…' : (isOn() ? '语音待命' : '语音已关');
    if (heard != null) {
      lastHeard = heard;
      const h = p.querySelector('.vp-heard');
      if (h) h.textContent = heard ? '「' + heard + '」' : '';
    }
  }
  function startListen() {
    if (!isOn() || !inQuiz() || !supported()) return;
    if (rec && recOn) return;
    if (!rec) {
      const Ctor = SR();
      rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = cfg().lang || 'zh-CN';
      rec.maxAlternatives = 3;
      rec.onresult = ev => {
        let finalTxt = '', interim = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i];
          if (r.isFinal) finalTxt += r[0].transcript; else interim += r[0].transcript;
        }
        if (interim) setPill('listening', interim.trim());
        if (finalTxt) handleHeard(finalTxt.trim());
      };
      rec.onerror = ev => {
        recOn = false;
        if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
          flash('麦克风没开：点地址栏左边的🔒，把「麦克风」改成允许');
          cfg().on = false; save(); paintChip(); setPill('idle');
        }
      };
      rec.onend = () => {
        recOn = false;
        /* 常开：没有在朗读、还在语音模式、还在答题页，就自己接着听 */
        if (isOn() && inQuiz() && !speaking) setTimeout(() => { if (isOn() && inQuiz() && !recOn) startListen(); }, 260);
      };
    }
    rec.lang = cfg().lang || 'zh-CN';
    try { rec.start(); recOn = true; setPill('listening'); } catch (e) { recOn = false; }
  }
  function stopListen() {
    if (!rec) return;
    try { rec.stop(); } catch (e) {}
    recOn = false;
    setPill('idle');
  }

  function handleHeard(txt) {
    const t = norm(txt);
    if (!t) return;
    const c = cfg();
    if (c.wake && t.indexOf(norm(c.wake)) < 0) return;   /* 设了唤醒词：先说它才理你 */
    if (c.stopOnSpeak && speaking) { stopSpeak(); }

    if (hitCmd(t, c.cStop)) { off(); flash('语音模式已关'); return; }
    if (hitCmd(t, c.cNext)) { clearTimeout(nextT); goNext(); return; }
    if (hitCmd(t, c.cRepeat)) { readCurrent(); return; }
    if (hitCmd(t, c.cAnswer)) { sayAnswer(); return; }
    if (hitCmd(t, c.cFav)) { const b = document.getElementById('btnFav'); if (b) b.click(); return; }

    /* 多选的「确认 / 提交」：这时候往往没有字母，必须在解析字母之前拦住 */
    if (isMulti() && pending.size && hitCmd(t, c.cSubmit)) {
      clearTimeout(pauseT);
      if (!submitMulti()) flash('先选好选项再说「提交」');
      return;
    }

    const letters = parseLetters(t);
    if (!letters.length) return;
    const multi = isMulti();

    /* 灵敏度：高 = 必须说满 2 个字符才算，防环境噪音误触 */
    if (c.sens === 'high' && t.length < 2) return;

    if (!multi) {
      clearTimeout(pauseT);
      if (c.autoJudgeSingle) { clickLetter(letters[letters.length - 1]); }
      else { pending = new Set([letters[letters.length - 1]]); clickLetter(letters[letters.length - 1]); }
      return;
    }

    /* 多选：以「页面上已经点亮的选项」为准做差量 —— 不信自己记的集合，
       否则页面重画 / 上次提交失败后，pending 会跟真实状态对不上。 */
    const have = new Set(visibleOpts().map((o, i) => (
      /(^|\s)(on|sel|picked)(\s|$)/.test(o.className) ? LET[i] : null)).filter(Boolean));
    letters.forEach(l => { if (!have.has(l)) clickLetter(l); });
    pending = new Set(letters);
    if (hitCmd(t, c.cSubmit)) { clearTimeout(pauseT); submitMulti(); return; }
    if (c.needConfirm) { setPill('listening', txt.trim() + '（说「确认」提交）'); return; }
    clearTimeout(pauseT);
    pauseT = setTimeout(() => {
      if (isOn() && pending.size) submitMulti();
    }, Math.max(500, +c.multiPause || 1200));
  }

  /* ---------- 开关 ---------- */
  function paintChip() {
    const b = document.getElementById('btnVoice');
    if (!b) return;
    b.classList.toggle('on', isOn());
    b.textContent = isOn() ? '🎙 语音中' : '🎙 语音';
  }
  function ensurePill() {
    let p = document.getElementById('voicePill');
    if (p) return p;
    p = document.createElement('div');
    p.id = 'voicePill';
    p.innerHTML = '<span class="vp-dot"></span><span class="vp-txt">语音待命</span>' +
      '<span class="vp-heard"></span>' +
      '<button class="vp-b" data-vp="repeat" title="重读这道题">↻</button>' +
      '<button class="vp-b" data-vp="mute" title="暂停 / 继续">⏸</button>' +
      '<button class="vp-b" data-vp="set" title="语音设置">⚙</button>' +
      '<button class="vp-b" data-vp="off" title="关掉语音模式">✕</button>';
    p.addEventListener('click', ev => {
      const b = ev.target.closest('[data-vp]');
      if (!b) return;
      ev.stopPropagation();
      const a = b.getAttribute('data-vp');
      if (a === 'repeat') readCurrent();
      else if (a === 'mute') { if (speaking) stopSpeak(); else if (recOn) stopListen(); else readCurrent(); }
      else if (a === 'set') openPanel();
      else if (a === 'off') off();
    });
    document.body.appendChild(p);
    return p;
  }
  function on() {
    cfg().on = true; save();
    if (cfg().handLink && window.SET && (!SET.hand || SET.hand === 'off')) { SET.hand = 'right'; if (typeof writeLS === 'function') writeLS(LS.set, SET); if (typeof applyHandMode === 'function') applyHandMode(); }
    ensurePill(); paintChip(); setPill('idle');
    if (!supported()) {
      flash('这个浏览器不支持语音识别，只能朗读；换成 Chrome / Edge 或安卓 Chrome 试试');
    }
    resetForQuestion(); readCurrent();
    if (window.SET && typeof renderQuiz === 'function' && QZ && QZ.bankId) { /* 让单手类布局重画一次 */ }
  }
  function off() {
    cfg().on = false; save();
    stopListen(); stopSpeak();
    clearTimeout(pauseT); clearTimeout(nextT);
    const p = document.getElementById('voicePill'); if (p) p.remove();
    paintChip();
  }
  function toggle() { if (isOn()) off(); else on(); }

  /* ---------- 面板 ---------- */
  function row(label, inner, hint) {
    return '<label class="vs-row"><span class="vs-lab">' + label + '</span>' +
      '<span class="vs-ctl">' + inner + '</span>' +
      (hint ? '<em class="vs-hint">' + hint + '</em>' : '') + '</label>';
  }
  function chk(key) {
    return '<input type="checkbox" data-vk="' + key + '"' + (cfg()[key] ? ' checked' : '') + '>';
  }
  function openPanel() {
    closePanel();
    const c = cfg();
    const vs = zhVoices();
    const voiceOpts = ['<option value="">系统默认中文</option>'].concat(
      vs.map(v => '<option value="' + v.voiceURI + '"' + (c.voiceURI === v.voiceURI ? ' selected' : '') + '>' +
        (v.name || v.voiceURI) + '（' + v.lang + '）</option>')).join('');
    const wrap = document.createElement('div');
    wrap.id = 'voicePanel';
    wrap.innerHTML = '<div class="vs-scrim" data-vclose="1"></div>' +
      '<div class="vs-card" role="dialog" aria-label="语音刷题设置">' +
      '<div class="vs-cap">语音刷题 <button class="vs-x" data-vclose="1">✕</button></div>' +
      '<div class="vs-scroll">' +
      '<div class="vs-sec">开 / 关</div>' +
      row('语音模式', '<input type="checkbox" data-vk="on"' + (c.on ? ' checked' : '') + '>', '开着的时候进出答题页都记得；离开答题页浮动条自动收起') +
      row('怎么用', '<select data-vk="mode">' +
        '<option value="both"' + (c.mode === 'both' ? ' selected' : '') + '>边读边听（默认）</option>' +
        '<option value="read"' + (c.mode === 'read' ? ' selected' : '') + '>只听不判（自己点）</option>' +
        '<option value="listen"' + (c.mode === 'listen' ? ' selected' : '') + '>只判不读（默答）</option></select>') +
      row('跟着单手模式', chk('handLink'), '打开语音时自动把选项放大、翻页贴到拇指区') +

      '<div class="vs-sec">朗读</div>' +
      row('语速', '<input type="range" min="0.6" max="1.6" step="0.05" data-vk="rate" value="' + c.rate + '"><b class="vs-val" data-vv="rate">' + c.rate + '×</b>') +
      row('音量', '<input type="range" min="0" max="1" step="0.05" data-vk="vol" value="' + c.vol + '"><b class="vs-val" data-vv="vol">' + Math.round(c.vol * 100) + '%</b>') +
      row('音色', '<select data-vk="voiceURI">' + voiceOpts + '</select>', '系统的中文语音；没有列出来就先点一下页面再打开面板') +
      row('读题号', chk('readNo')) +
      row('读题干', chk('readStem')) +
      row('读选项', chk('readOpts')) +
      row('选项怎么读', '<select data-vk="optStyle">' +
        '<option value="both"' + (c.optStyle === 'both' ? ' selected' : '') + '>A，甲一</option>' +
        '<option value="text"' + (c.optStyle === 'text' ? ' selected' : '') + '>只读内容</option>' +
        '<option value="letter"' + (c.optStyle === 'letter' ? ' selected' : '') + '>只读 A B C</option></select>') +
      row('读考点标签', chk('readTags')) +
      row('判分后读结果', chk('readRes')) +
      row('答错读解析', chk('readExp')) +

      '<div class="vs-sec">听你说</div>' +
      row('语言 / 口音', '<select data-vk="lang">' +
        ['zh-CN', 'zh-TW', 'yue-Hant-HK', 'en-US'].map(l => '<option value="' + l + '"' + (c.lang === l ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>') +
      row('多选停顿', '<input type="range" min="600" max="2500" step="100" data-vk="multiPause" value="' + c.multiPause + '"><b class="vs-val" data-vv="multiPause">' + (c.multiPause / 1000).toFixed(1) + 's</b>', '多选说完停这么久就提交') +
      row('必须说「确认」才提交', chk('needConfirm')) +
      row('单选说完立刻判', chk('autoJudgeSingle')) +
      row('判完自动下一题', chk('autoNext')) +
      row('自动跳题等待', '<input type="range" min="500" max="4000" step="100" data-vk="nextDelay" value="' + c.nextDelay + '"><b class="vs-val" data-vv="nextDelay">' + (c.nextDelay / 1000).toFixed(1) + 's</b>') +
      row('麦克风灵敏度', '<select data-vk="sens">' +
        ['low', 'mid', 'high'].map(s => '<option value="' + s + '"' + (c.sens === s ? ' selected' : '') + '>' + ({ low: '低（小声也说）', mid: '中（默认）', high: '高（要清晰、防噪音）' }[s]) + '</option>').join('') + '</select>') +
      row('唤醒词', '<input type="text" data-vk="wake" value="' + escAttr(c.wake) + '" placeholder="例如：小刷（留空＝一直听）">') +

      '<div class="vs-sec">命令词（逗号分隔，可自己改）</div>' +
      row('下一题', '<input type="text" data-vk="cNext" value="' + escAttr(c.cNext) + '">') +
      row('重读', '<input type="text" data-vk="cRepeat" value="' + escAttr(c.cRepeat) + '">') +
      row('看答案', '<input type="text" data-vk="cAnswer" value="' + escAttr(c.cAnswer) + '">') +
      row('收藏', '<input type="text" data-vk="cFav" value="' + escAttr(c.cFav) + '">') +
      row('提交（多选）', '<input type="text" data-vk="cSubmit" value="' + escAttr(c.cSubmit) + '">') +
      row('关掉语音', '<input type="text" data-vk="cStop" value="' + escAttr(c.cStop) + '">') +
      '</div>' +
      '<div class="vs-foot"><button class="btn" data-vreset="1">恢复默认</button>' +
      '<button class="btn primary" data-vclose="1">好</button></div>' +
      '</div>';
    document.body.appendChild(wrap);
    wrap.addEventListener('click', ev => {
      if (ev.target.closest('[data-vclose]')) { closePanel(); return; }
      const rs = ev.target.closest('[data-vreset]');
      if (rs) {
        const keepOn = cfg().on;
        V = Object.assign({}, DEF, { on: keepOn });
        save(); closePanel(); openPanel(); paintChip();
        return;
      }
    });
    wrap.addEventListener('input', ev => {
      const el = ev.target;
      const k = el.getAttribute('data-vk');
      if (!k) return;
      let val;
      if (el.type === 'checkbox') val = el.checked;
      else if (el.type === 'range') val = +el.value;
      else val = el.value;
      cfg()[k] = val;
      save();
      const vv = wrap.querySelector('[data-vv="' + k + '"]');
      if (vv) vv.textContent = k === 'rate' ? val + '×' : k === 'vol' ? Math.round(val * 100) + '%' : (val / 1000).toFixed(1) + 's';
      if (k === 'on') { if (val) on(); else off(); }
      if (k === 'rate' || k === 'vol' || k === 'voiceURI' || k === 'lang') { /* 下一次朗读生效 */ }
      if (k === 'needConfirm' || k === 'mode') resetForQuestion();
    });
    fillVoicesSoon();
  }
  function fillVoicesSoon() {
    const s = synth(); if (!s) return;
    const re = () => {
      const sel = document.querySelector('#voicePanel select[data-vk="voiceURI"]');
      if (!sel) return;
      const vs = zhVoices();
      if (!vs.length) return;
      const cur = cfg().voiceURI;
      sel.innerHTML = '<option value="">系统默认中文</option>' + vs.map(v =>
        '<option value="' + v.voiceURI + '"' + (cur === v.voiceURI ? ' selected' : '') + '>' + (v.name || v.voiceURI) + '（' + v.lang + '）</option>').join('');
    };
    try { s.onvoiceschanged = re; } catch (e) {}
    setTimeout(re, 260); setTimeout(re, 900);
  }
  function closePanel() { const p = document.getElementById('voicePanel'); if (p) p.remove(); }
  function escAttr(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

  /* ---------- 和答题页对接 ---------- */
  function qKeyNow() {
    const n = (document.querySelector('#view .qno') || {}).textContent || '';
    const s = stemText().slice(0, 40);
    return location.hash + '|' + n.trim() + '|' + s;
  }
  function onQuizRender() {
    paintChip();
    if (!isOn()) { const p = document.getElementById('voicePill'); if (p) p.remove(); stopListen(); stopSpeak(); return; }
    if (!inQuiz()) { stopListen(); stopSpeak(); const p = document.getElementById('voicePill'); if (p) p.remove(); return; }
    ensurePill();
    const k = qKeyNow();
    const locked = !document.querySelector('#view .opt:not(.lock) .k') ? false : false;   /* 占位，下面用真实判断 */
    const answered = !document.querySelector('#view .opt:not(.lock)') && !!document.querySelector('#view .opt.lock');
    if (k !== qk) {
      qk = k; resetForQuestion();
      if (!answered) readCurrent(); else { setPill('idle'); startListen(); }
      return;
    }
    if (answered) pending.clear();
    if (answered && !announced) { announced = true; stopListen(); speakResult(); }
  }
  function sync() { paintChip(); if (isOn() && inQuiz()) ensurePill(); }

  window.VOICE = {
    toggle: toggle, on: on, off: off, openPanel: openPanel, sync: sync,
    onQuizRender: onQuizRender, speak: speak, supported: supported,
    cfg: cfg, _heard: handleHeard, _parse: function (t) { return parseLetters(t); },
    _dbg: function () { return { pending: [].slice.call(pending), speaking: speaking, recOn: recOn, multi: isMulti(), submit: !!document.getElementById('doSubmit') }; }
  };

  /* 首屏：把设置并进来，并给 chip 挂事件（renderQuiz 每次重画都会新建这个按钮） */
  function boot() {
    cfg();
    document.addEventListener('click', ev => {
      const b = ev.target.closest('#btnVoice');
      if (!b) return;
      ev.stopPropagation();
      if (ev.detail === 0) { toggle(); return; }
      toggle();
    }, true);
    /* 长按按钮 500ms 打开设置面板 */
    let holdT = null;
    document.addEventListener('pointerdown', ev => {
      const b = ev.target.closest('#btnVoice');
      if (!b) return;
      holdT = setTimeout(() => { holdT = null; openPanel(); }, 500);
    }, true);
    document.addEventListener('pointerup', () => { if (holdT) { clearTimeout(holdT); holdT = null; } }, true);
    document.addEventListener('contextmenu', ev => {
      if (ev.target.closest('#btnVoice')) { ev.preventDefault(); openPanel(); }
    });
    window.addEventListener('beforeunload', () => { try { stopListen(); synth() && synth().cancel(); } catch (e) {} });

    /* 答题页每次重画都跑一遍：新题就朗读、答完就报结果。
       用 MutationObserver 盯 #view，就不用改 app.js 的 renderQuiz。 */
    let moT = null, tries = 0;
    const hookView = () => {
      const v = document.getElementById('view');
      if (!v) { if (tries++ < 40) return setTimeout(hookView, 250); return; }
      new MutationObserver(() => { clearTimeout(moT); moT = setTimeout(() => { try { onQuizRender(); } catch (e) {} }, 160); })
        .observe(v, { childList: true, subtree: true });
      setTimeout(() => { try { onQuizRender(); } catch (e) {} }, 400);
    };
    hookView();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
