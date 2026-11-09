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
    readTags: false, readExp: true, readRes: false, optStyle: 'both',
    askExp: true, sayVerdict: true,
    aiIntent: false,          /* 本地认不出的说法，交给站内 AI 猜意图 */
    pitch: 1,                 /* 音调 0.6–1.6 */
    readHints: true,          /* 念完选项后要不要说「请选择 / 可以多选」这类提示 */
    btnCtl: true,             /* 答题页里的按钮能不能用说的点 */
    /* 识别 */
    lang: 'zh-CN', multiPause: 1200, needConfirm: false, autoJudgeSingle: true,
    autoNext: true, nextDelay: 1400, wake: '', sens: 'mid', mode: 'both',
    /* 行为 */
    handLink: true, stopOnSpeak: true,
    /* 命令词（逗号分隔，面板里能改） */
    cNext: '下一题,下一个,往后',
    cPrev: '上一题,前一题,往回',
    cExp: '念解析,读解析,讲解析,解析一下,念一遍解析',
    cHelp: '我不太懂,什么意思,不懂,没看懂,解释一下,为什么',
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
  let askT = null, askState = '', said = [];

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
    if (text) said.push(String(text).slice(0, 80));
    const s = synth();
    if (!s || !text) { done && done(); return; }
    if (cfg().stopOnSpeak) { try { s.cancel(); } catch (e) {} }
    const u = new SpeechSynthesisUtterance(String(text).replace(/\s+/g, ' ').trim());
    u.lang = cfg().lang || 'zh-CN';
    u.rate = Math.max(.6, Math.min(1.6, +cfg().rate || 1));
    u.volume = Math.max(0, Math.min(1, +cfg().vol == null ? 1 : +cfg().vol));
    u.pitch = Math.max(.6, Math.min(1.6, +(cfg().pitch == null ? 1 : cfg().pitch)));
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
    if (c.readHints) parts.push(isMulti() ? '可以多选，选完说确认' : '请选择');
    return parts.filter(Boolean).join('。');
  }
  function resetForQuestion() {
    askState = ''; clearTimeout(askT);
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

  /* ---------- 用说的点答题页上的按钮 ---------- */
  /* 「除了返回 / 主页 / 退出这种会把你带出答题页的，其它都能说」——
     做法：扫描页面上可见的按钮，取它的文字当别名，用户话里出现就点它。
     带删除/清空/重置的也不让说，避免一句话把东西弄没。 */
  const BTN_NO = /(返回|主页|首页|退出|离开|关闭|清空|删除|重置|卸载|重置全部)/;
  const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu;
  function quizButtons() {
    const out = [];
    const seen = {};
    Array.prototype.slice.call(document.querySelectorAll('#view button, #view .btn, #view .chip, #view .qbtn, #view [role="button"]'))
      .forEach(function (el) {
        if (el.disabled || el.getAttribute('aria-disabled') === 'true') return;
        const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!t || t.length > 16) return;
        if (BTN_NO.test(t)) return;                      /* 会离开答题页的不接管 */
        if (seen[t]) return;
        seen[t] = 1;
        out.push({ el: el, name: t });
      });
    return out;
  }
  function hitButton(t) {
    if (!cfg().btnCtl) return false;
    let best = null;
    quizButtons().forEach(function (c) {
      /* 一个按钮可能写「🎯 专注」「🖼 小窗」「⋯ 更多」：拆掉装饰再当别名 */
      const clean = c.name.replace(EMOJI, ' ').replace(/[（(].*?[)）]/g, ' ').replace(/\s+/g, ' ').trim();
      const keys = [clean].concat(clean.split(/[\/／|｜·、]/)).map(function (s) {
        return norm(s.replace(EMOJI, '').trim());
      }).filter(Boolean);
      keys.forEach(function (k) {
        if (k.length < 2) return;
        if (t.indexOf(k) >= 0 && (!best || k.length > best.k.length)) best = { el: c.el, k: k, name: c.name };
      });
    });
    if (!best) return false;
    best.el.click();
    flash('好的：' + best.name);
    return true;
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
  /* ---------- 判分之后：不念次数/正确率，只问要不要解析 ---------- */
  function quizMode() {
    /* 以页面上真实的模式为准：提示条写着「背题 / 速刷」，比 SET 更可靠（SET 可能是上一题的） */
    const h = document.querySelector('#view .qm-hint');
    const t = h ? (h.textContent || '') : '';
    if (/背题/.test(t)) return 'recite';
    if (/速刷/.test(t)) return 'speed';
    try { return (window.SET && SET.quizMode) || 'normal'; } catch (e) { return 'normal'; }
  }
  function isRecite() { return quizMode() === 'recite'; }
  function isSpeed() { return quizMode() === 'speed'; }
  function isOkNow() {
    const fb = document.querySelector('#view .fb');
    const t = fb ? (fb.innerText || '') : '';
    if (/回答正确|答对|正确无误/.test(t)) return true;
    if (/回答错|答错/.test(t)) return false;
    const r = document.querySelector('#view .fb .res');
    return r ? /(^|\s)(ok|right|good)(\s|$)/.test(r.className) : false;
  }
  function correctLetters() {
    return visibleOpts().filter(o => /(^|\s)(ok|right|good)(\s|$)/.test(o.className))
      .map((o, i) => ((o.querySelector('.k') || {}).textContent || LET[i]).trim());
  }
  function expText() {
    const fb = document.querySelector('#view .fb');
    if (!fb) return '';
    const wrap = fb.querySelector('.exp-wrap');
    if (!wrap) return '';
    /* 只念解析正文：标题行里有「▾ 收起 / ⠿ 块排序」按钮，整块 innerText 会把它们念出来 */
    const body = wrap.querySelector('.rich-edit') || wrap;
    let t = (body.innerText || body.textContent || '');
    t = t.replace(/^\s*(\u89e3\u6790|\u7b54\u6848|\u8003\u70b9)\s*[\uff1a:]\s*/, '');
    t = t.replace(/\s+/g, ' ')
      .replace(/[\u25be\u25b8]\s*(\u6536\u8d77|\u5c55\u5f00)/g, ' ')
      .replace(/\u283f\s*\u5757\u6392\u5e8f/g, ' ')
      .trim();
    return t.slice(0, 900);
  }
  function answerText() { const L = correctLetters(); return L.length ? '答案是 ' + L.join('、') + '。' : ''; }
  function speakExp(after) {
    const t = expText();
    if (!t) { speak('这道题还没有解析。', after); return; }
    speak('解析：' + t.slice(0, 520), after);
  }
  function askExplain(ok) {
    const head = cfg().sayVerdict ? (ok ? '答对了。' : '答错了。') : '';
    askState = 'exp';
    clearTimeout(askT);
    stopSpeak();
    speak(head + '要念一遍解析吗？说「要」或「不用」。', () => {
      if (!isOn()) return;
      if (cfg().mode !== 'read') startListen();
      askT = setTimeout(() => { if (askState === 'exp') askState = ''; }, 12000);
    });
  }
  function afterJudgeSpeak(ok) {
    if (isRecite()) return;
    if (cfg().readRes) {
      const fb = document.querySelector('#view .fb');
      speak(((fb ? fb.innerText : '') || '').replace(/\s+/g, ' ').trim().slice(0, 400));
      return;
    }
    if (ok && isSpeed()) { if (cfg().sayVerdict) speak('答对了。'); return; }
    if (cfg().askExp) { askExplain(ok); return; }
    if (cfg().readExp) { speak(cfg().sayVerdict ? (ok ? '答对了。' : '答错了。') : '', () => speakExp()); return; }
    if (cfg().sayVerdict) speak(ok ? '答对了。' : '答错了。');
    if (cfg().mode !== 'read') startListen();
  }
  /* 背题模式：直接念题干 + 选项 + 答案 + 解析 */
  function reciteSpeech() {
    const c = cfg(), parts = [];
    if (c.readNo) { const n = qNoText(); if (n) parts.push(n); }
    if (c.readStem) parts.push(stemText());
    if (c.readOpts) optionItems().forEach(o => parts.push(c.optStyle === 'letter' ? o.letter : (c.optStyle === 'text' ? o.text : o.letter + '\uff0c' + o.text)));
    const a = answerText(); if (a) parts.push(a);
    const e = expText(); if (e) parts.push('\u89e3\u6790\uff1a' + e.slice(0, 420));
    /* 每段末尾的句号先去掉，统一由 join 补，否则会念成「答案是 B。。解析：…」 */
    return parts.filter(Boolean)
      .map(function (x) { return String(x).replace(/[\u3002\uff0c\u3001\uff1b\s]+$/, ''); })
      .join('\u3002');
  }
  /* 说「我不太懂」→ 把这道题丢进站内 AI，写完念给你听 */
  function askAI() {
    const host = document.getElementById('aiHost');
    if (!host) { flash('这一页没有 AI 面板'); return; }
    const openBtn = document.getElementById('doAI');
    if (openBtn && !host.dataset.aiid) openBtn.click();
    speak('我把这道题发给 AI 了，写完我念给你听。');
    setTimeout(() => {
      const ta = host.querySelector('.ai-askq'), go = host.querySelector('.ai-ask');
      if (!ta || !go) { flash('AI 面板还没准备好，点「AI」试一次'); return; }
      ta.value = '这道题我没看懂。请用最容易懂的话讲一遍：考点是什么、为什么选它、其他选项错在哪。';
      go.click();
      waitAI(host, 0);
    }, 500);
  }
  function waitAI(host, n) {
    const out = host.querySelector('.aiout');
    const txt = out ? (out.innerText || '').trim() : '';
    if (txt && !/还没开始|正在/.test(txt) && n > 4) { speak(txt.slice(0, 620)); return; }
    if (n > 60 || !isOn()) return;
    setTimeout(() => waitAI(host, n + 1), 800);
  }

  /* ---------- 听 ---------- */
  function SR() { return window.SpeechRecognition || window.webkitSpeechRecognition || null; }
  function supported() { return !!SR(); }
  function setPill(state, heard) {
    const p = document.getElementById('voicePill');
    if (!p) return;
    p.setAttribute('data-state', state || 'idle');
    const s = p.querySelector('.vp-txt');
    if (s) s.textContent = state === 'listening' ? '正在听…'
      : state === 'speaking' ? '正在读…'
      : state === 'think' ? 'AI 在想…'
      : (isOn() ? '语音待命' : '语音已关');
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

    /* 「要不要念解析」的答复（先于命令词：这类回答通常没有字母） */
    if (askState === 'exp') {
      if (/(不用|不要|不必|别|算了|跳过|不了|否)/.test(t)) {
        askState = ''; clearTimeout(askT); stopSpeak();
        speak('好。', () => { if (cfg().mode !== 'read') startListen(); });
        return;
      }
      if (/(要|念|读|听|好|可以|行|嗯|需要|对)/.test(t)) {
        askState = ''; clearTimeout(askT); stopSpeak();
        speakExp(() => { if (cfg().mode !== 'read') startListen(); });
        return;
      }
    }

    if (hitCmd(t, c.cStop)) { off(); flash('语音模式已关'); return; }
    if (hitCmd(t, c.cExp)) { stopSpeak(); speakExp(() => { if (cfg().mode !== 'read') startListen(); }); return; }
    if (hitCmd(t, c.cPrev)) { const pb = document.getElementById('prev'); if (pb && !pb.disabled) pb.click(); return; }
    if (hitCmd(t, c.cHelp)) { askAI(); return; }
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

    /* 按钮：说「专注」「小窗」「脑图」「重做」「看解析」「更多」… */
    if (hitButton(t)) return;

    const letters = parseLetters(t);
    lastHeard = txt;
    if (!letters.length) { aiFallback(txt); return; }
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

  /* ---------- AI 兜底：本地正则没认出来时，问一句站内 AI 该干嘛 ---------- */
  let aiBusy = false;
  function aiGuess(txt) {
    const chat = window.aiChat;
    if (typeof chat !== 'function') return Promise.resolve(null);
    const sys = '你是语音指令解析器。用户在做医学单选题/多选题，页面会读题给他听。' +
      '把用户这句话解析成一条指令，只输出一行 JSON，不要解释、不要 markdown。' +
      '格式：{"act":"select|next|prev|repeat|explain|ask|fav|submit|stop|none","letters":["A"]}。' +
      'select 表示他要选选项，letters 放 A-H 的字母（可多个）；next=下一题；prev=上一题；' +
      'repeat=重读这道题；explain=念解析；ask=他没听懂想让人讲；fav=收藏；submit=提交多选；' +
      'stop=关掉语音；none=跟做题无关。';
    const usr = '用户说：' + txt;
    return chat([{ role: 'system', content: sys }, { role: 'user', content: usr }], null, null,
      { stream: false, temp: 0, maxTokens: 90 })
      .then(out => {
        const m = String(out || '').match(/\{[\s\S]*\}/);
        if (!m) return null;
        try { return JSON.parse(m[0]); } catch (e) { return null; }
      })
      .catch(() => null);
  }
  function runAct(a, letters) {
    const c = cfg();
    if (!a) { flash('没听清：' + lastHeard); return; }
    if (a === 'stop') { off(); flash('语音模式已关'); return; }
    if (a === 'next') { clearTimeout(nextT); goNext(); return; }
    if (a === 'prev') { const pb = document.getElementById('prev'); if (pb && !pb.disabled) pb.click(); return; }
    if (a === 'repeat') { readCurrent(); return; }
    if (a === 'explain') { stopSpeak(); speakExp(() => { if (c.mode !== 'read') startListen(); }); return; }
    if (a === 'ask') { askAI(); return; }
    if (a === 'fav') { const b = document.getElementById('btnFav'); if (b) b.click(); return; }
    if (a === 'submit') { clearTimeout(pauseT); if (!submitMulti()) flash('先选好选项再说提交'); return; }
    if (a === 'select' && letters && letters.length) {
      if (isMulti()) {
        const have = new Set(visibleOpts().map((o, i) => (
          /(^|\s)(on|sel|picked)(\s|$)/.test(o.className) ? LET[i] : null)).filter(Boolean));
        letters.forEach(l => { if (!have.has(l)) clickLetter(l); });
        pending = new Set(letters);
        clearTimeout(pauseT);
        pauseT = setTimeout(() => { if (isOn() && pending.size) submitMulti(); }, Math.max(500, +c.multiPause || 1200));
      } else {
        clickLetter(letters[letters.length - 1]);
      }
      return;
    }
    flash('没听清：' + lastHeard + '（可以点 ⚙ 里换成 AI 识别）');
  }
  function aiFallback(txt) {
    if (!cfg().aiIntent || aiBusy) return;
    aiBusy = true;
    setPill('think', 'AI 正在理解「' + txt + '」…');
    aiGuess(txt).then(r => {
      aiBusy = false;
      setPill(recOn ? 'listening' : 'idle');
      if (!r || r.act === 'none') { flash('没听清：' + txt); return; }
      const ls = Array.isArray(r.letters) ? r.letters.map(x => String(x).toUpperCase()).filter(x => LET.indexOf(x) >= 0) : [];
      runAct(r.act, ls);
    });
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
      row('音调', '<input type="range" min="0.6" max="1.6" step="0.05" data-vk="pitch" value="' + (c.pitch == null ? 1 : c.pitch) + '"><b class="vs-val" data-vv="pitch">' + (+(c.pitch == null ? 1 : c.pitch)).toFixed(2) + '</b>') +
      row('念提示词', chk('readHints'), '念完选项后要不要说「请选择 / 可以多选，选完说确认」；关掉更安静') +
      row('读题号', chk('readNo')) +
      row('读题干', chk('readStem')) +
      row('读选项', chk('readOpts')) +
      row('选项怎么读', '<select data-vk="optStyle">' +
        '<option value="both"' + (c.optStyle === 'both' ? ' selected' : '') + '>A，甲一</option>' +
        '<option value="text"' + (c.optStyle === 'text' ? ' selected' : '') + '>只读内容</option>' +
        '<option value="letter"' + (c.optStyle === 'letter' ? ' selected' : '') + '>只读 A B C</option></select>') +
      row('读考点标签', chk('readTags')) +
      row('判分后读结果', chk('readRes'), '通常关掉：只念题干和选项，不念次数、正确率') +
      row('问「要不要念解析」', chk('askExp'), '答错一定会问；答对时普通模式也会问，速刷模式直接下一题') +
      row('念一句对错', chk('sayVerdict'), '只念「答对了 / 答错了」，不念累计次数') +
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
      row('用说的点按钮', chk('btnCtl'), '答题页上的按钮基本都能说：专注、小窗、相似题、脑图、批注、白板、重做、导出、口诀、更多、看资料…… 返回 / 主页 / 退出这类会离开答题页的不管') +
      row('认不出时问 AI', chk('aiIntent'), '本地命令词没对上时，把这句话交给站内 AI 判断你是想选选项、下一题、念解析还是问它（要有配好 AI 才生效；会慢约 1 秒）') +

      '<div class="vs-sec">语音包（音色 + 语速 + 音调 + 音量 + 语言）</div>' +
      row('试听', '<button class="btn tiny" data-vtest="1">▶ 念一句试试</button>', '用现在的音色念一句示例') +
      row('导出', '<button class="btn tiny" data-vpack="export">⬇ 存成 .json</button>', '把这套音色参数存下来，换设备 / 发给别人都能用') +
      row('导入', '<input type="file" accept=".json,application/json" data-vpack="import">', '选一个语音包 .json，立刻套用') +
      '<div class="vs-sec">命令词（逗号分隔，可自己改）</div>' +
      row('下一题', '<input type="text" data-vk="cNext" value="' + escAttr(c.cNext) + '">') +
      row('上一题', '<input type="text" data-vk="cPrev" value="' + escAttr(c.cPrev) + '">') +
      row('念解析', '<input type="text" data-vk="cExp" value="' + escAttr(c.cExp) + '">') +
      row('我不太懂（问 AI）', '<input type="text" data-vk="cHelp" value="' + escAttr(c.cHelp) + '">', '说这些话就把这道题丢进站内 AI，写完念给你听') +
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
      if (ev.target.closest('[data-vtest]')) {
        speak('这是现在的音色，第三题，下列关于真核生物转录起始的叙述，错误的是。A，转录因子。B，TATA 盒。');
        return;
      }
      const ex = ev.target.closest('[data-vpack="export"]');
      if (ex) { exportPack(); return; }
      const rs = ev.target.closest('[data-vreset]');
      if (rs) {
        const keepOn = cfg().on;
        V = Object.assign({}, DEF, { on: keepOn });
        save(); closePanel(); openPanel(); paintChip();
        return;
      }
    });
    wrap.addEventListener('change', ev => {
      const im = ev.target.closest('[data-vpack="import"]');
      if (!im || !im.files || !im.files[0]) return;
      importPack(im.files[0]);
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
  /* ---------- 语音包：把「音色 + 语速 + 音调 + 音量 + 语言」存成一个 json ---------- */
  function exportPack() {
    const c = cfg();
    const name = (c.voiceName || '语音包') + ' ' + new Date().toISOString().slice(0, 10);
    const data = {
      app: 'shuati-voice-pack', v: 1, name: name,
      voiceURI: c.voiceURI || '', voiceName: c.voiceName || '', lang: c.lang,
      rate: c.rate, pitch: c.pitch == null ? 1 : c.pitch, vol: c.vol
    };
    try {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (name.replace(/[\\/:*?"<>|]/g, '_')) + '.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      flash('语音包已存下来（.json）');
    } catch (e) { flash('导出失败：' + (e && e.message)); }
  }
  function applyPack(o) {
    if (!o || (o.app && o.app !== 'shuati-voice-pack')) { flash('这不是语音包文件'); return; }
    const c = cfg();
    ['voiceURI', 'voiceName', 'lang', 'rate', 'pitch', 'vol'].forEach(k => {
      if (o[k] !== undefined && o[k] !== '') c[k] = o[k];
    });
    save(); paintChip(); closePanel(); openPanel();
    flash('已套用语音包：' + (o.name || o.voiceName || '未命名'));
  }
  function importPack(file) {
    const fr = new FileReader();
    fr.onload = function () {
      try { applyPack(JSON.parse(String(fr.result || ''))); }
      catch (e) { flash('这个文件读不出来：' + (e && e.message)); }
    };
    fr.onerror = function () { flash('文件读取失败'); };
    fr.readAsText(file);
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
    /* 背题模式下选项都被标成 .lock（不用作答），别把它当「已作答」，否则永远不念答案 */
    const answered = !isRecite() && !document.querySelector('#view .opt:not(.lock)') && !!document.querySelector('#view .opt.lock');
    if (k !== qk) {
      qk = k; resetForQuestion();
      if (!answered) {
        if (isRecite()) { stopListen(); speak(reciteSpeech()); }
        else readCurrent();
      } else { setPill('idle'); startListen(); }
      return;
    }
    if (answered) pending.clear();
    if (answered && !announced) { announced = true; stopListen(); afterJudgeSpeak(isOkNow()); }
  }
  function sync() { paintChip(); if (isOn() && inQuiz()) ensurePill(); }

  window.VOICE = {
    toggle: toggle, on: on, off: off, openPanel: openPanel, sync: sync,
    onQuizRender: onQuizRender, speak: speak, supported: supported,
    cfg: cfg, _heard: handleHeard, _parse: function (t) { return parseLetters(t); },
    _recite: reciteSpeech,
    _dbg: function () { return { pending: [].slice.call(pending), speaking: speaking, recOn: recOn, multi: isMulti(), submit: !!document.getElementById('doSubmit'), ask: askState, said: said.slice(-6) }; }
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
