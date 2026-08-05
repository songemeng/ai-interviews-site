// 阅读器渲染核心：文本清洗、分段、说话人识别、文章 HTML 拼装。
// 浏览器（app.js 的 SPA 阅读器）与 Node（scripts/export-static.js 预渲染 /i/<id>/ 页）共用，
// 保证「站内点开」和「直接访问文章 URL」输出同一份 markup。
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.ReaderCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const MEDIA_ZH = { audio: '音频', video: '视频', text: '文字' };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // 清掉 YouTube 字幕垃圾：[音乐]/[Applause] 等标记、">>" 说话人残留
  function cleanTranscript(text) {
    return text
      .replace(/\[(?:音乐|掌声|笑声|鼓掌|music|applause|laughter|laughs|cheering|silence|inaudible)\]/gi, ' ')
      .replace(/\s*>>\s*/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // 段首 "Name: " / "Name："视为说话人标签；全文有 ≥2 个名字、各出现 ≥3 次才按对话稿渲染，
  // 避免把 "Note:"、"作者："这类偶发前缀误判成说话人
  const SPK_NAME = "(?:[A-Z][A-Za-z.\\-'’]*(?: [A-Z][A-Za-z.\\-'’]*){0,3}|[一-鿿·]{2,6})";
  const SPK_HEAD = new RegExp(`^(${SPK_NAME})(?:：|:[ \\t])\\s*`);
  function speakerSet(text) {
    const cnt = {};
    for (const m of text.matchAll(new RegExp(`^(${SPK_NAME})(?:：|:[ \\t])`, 'gm'))) cnt[m[1]] = (cnt[m[1]] || 0) + 1;
    const names = Object.keys(cnt).filter(n => cnt[n] >= 3);
    return names.length >= 2 ? new Set(names) : null;
  }

  function splitLong(p, target) {
    if (p.length <= target * 1.7) return [p];
    const sentences = p.match(/[^.!?。！？…]+[.!?。！？…]+["'」』)\]]?\s*/g) || [p];
    const out = [];
    let cur = '';
    for (const s of sentences) {
      cur += s;
      if (cur.length >= target) { out.push(cur.trim()); cur = ''; }
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  // 有自然段就尊重自然段（只拆超长段）；没有就按句子聚合到目标长度
  function paragraphs(text, lang, speakers) {
    const target = lang === 'zh' ? 200 : 420;
    // 对话稿：说话人标签强制另起一段（有些源的发言之间只有单个换行）
    if (speakers) text = text.replace(new RegExp(`\\n+(?=${SPK_NAME}(?:：|:[ \\t]))`, 'g'), '\n\n');
    const joinLines = (s) => s
      .replace(/([一-鿿，。！？；：、])\n+(?=[一-鿿])/g, '$1')
      .replace(/\n+/g, ' ');
    const paras = /\n\s*\n/.test(text)
      ? text.split(/\n\s*\n/).map(s => joinLines(s.trim())).filter(Boolean)
      : [joinLines(text)];
    return paras.flatMap(p => splitLong(p, target));
  }

  const readMinutes = (chars, lang) => Math.max(1, Math.round(chars / (lang === 'zh' ? 400 : 1000)));

  // 转写列表 → { zh: 翻译稿, en: 原文稿 }
  function pickTranscripts(transcripts) {
    const tr = {};
    for (const t of transcripts || []) {
      if (t.kind === 'translation') tr.zh = t;
      else tr.en = tr.en || t;
    }
    return tr;
  }

  // 正文 HTML：清洗 → 分段 → 说话人标签（同一人连续发言不重复显示）→ 每 10 段一个 chunk
  //（chunk 配合 content-visibility 跳过屏外渲染）
  // 每段带 data-spk（含未重复显示标签的连续发言段），供「只看某些说话人」筛选
  function bodyHTML(content, lang) {
    const text = cleanTranscript(content);
    const speakers = speakerSet(text);
    const paras = paragraphs(text, lang, speakers);
    let lastSpk = null, curSpk = null;
    const paraHTML = (p) => {
      const m = speakers && p.match(SPK_HEAD);
      if (!m || !speakers.has(m[1])) return esc(p);
      curSpk = m[1];
      const body = esc(p.slice(m[0].length));
      if (m[1] === lastSpk) return body;
      lastSpk = m[1];
      return `<span class="spk">${esc(m[1])}</span>${body}`;
    };
    let pi = 0;
    const chunks = [];
    for (let c = 0; c < paras.length; c += 10) chunks.push(paras.slice(c, c + 10));
    const html = chunks.map((ch, idx) => `<section class="chunk${idx < 2 ? ' chunk-eager' : ''}">${
      ch.map(p => {
        const inner = paraHTML(p);
        return `<p data-pi="${pi++}"${curSpk ? ` data-spk="${esc(curSpk)}"` : ''}>${inner}</p>`;
      }).join('')}</section>`).join('');
    return { html, chars: text.length, speakers: speakers ? [...speakers] : null };
  }

  const EMPTY_HTML = '<p class="r-empty">这条还没有文字稿——来自纯音频平台，待「音频下载 + 转文字」阶段处理。可点标题下方的「原文」链接收听。</p>';

  // #r-article 的完整 innerHTML：头部 + 封面 + 正文 + tags 页脚
  function articleHTML(i, t, lang, prefs) {
    prefs = Object.assign({ size: 19, font: 'sans' }, prefs);
    const tags = i.tags ? JSON.parse(i.tags) : [];

    let body = EMPTY_HTML;
    let chars = 0;
    let speakers = null;
    if (t) ({ html: body, chars, speakers } = bodyHTML(t.content, lang));

    const metaBits = [
      i.published_date, i.host && `${i.host}`, i.duration,
      chars ? `约 ${readMinutes(chars, lang)} 分钟读完` : (MEDIA_ZH[i.media_type] || ''),
    ].filter(Boolean);

    // tag 不进顶部——沉到文末，顶部只留最关键的信息
    const footHTML = tags.length
      ? `<footer class="r-foot">${tags.map(tg => `<button class="tag" data-tag="${esc(tg)}"># ${esc(tg)}</button>`).join('')}</footer>`
      : '';

    // 对话稿：说话人筛选条（默认全亮=全显示；点名字切换隐藏该说话人的段落）
    const spkBarHTML = speakers && speakers.length >= 2
      ? `<div class="r-spk-bar"><span class="r-spk-label">只看</span>${
          speakers.map(s => `<button class="spk-chip on" data-spkf="${esc(s)}">${esc(s)}</button>`).join('')}</div>`
      : '';

    const html = `
    <header class="r-head">
      <div class="r-kicker">${esc(i.person)}${i.role ? ` · ${esc(i.role)}` : (i.company ? ` · ${esc(i.company)}` : '')}</div>
      <h1 class="r-title">${esc(i.title_zh || i.title)}</h1>
      ${i.title_zh ? `<p class="r-title-en">${esc(i.title)}</p>` : ''}
      <div class="r-meta">${metaBits.map(esc).join(' · ')}${metaBits.length ? ' · ' : ''}<a class="r-src" href="${esc(i.url)}" target="_blank" rel="noopener">原文
        <svg viewBox="0 0 12 12" width="9" height="9"><path fill="currentColor" d="M3.5 1a.75.75 0 0 0 0 1.5h4.94L1.72 9.22a.75.75 0 1 0 1.06 1.06L9.5 3.56v4.94a.75.75 0 0 0 1.5 0V1H3.5z"/></svg></a>
      </div>
      ${i.summary ? `<div class="r-brief">${esc(i.summary)}</div>` : ''}
    </header>
    ${i.thumb ? `<figure class="r-cover"><img src="${esc(i.thumb)}" alt="" decoding="async" onerror="this.parentNode.remove()" /></figure>` : ''}
    ${spkBarHTML}
    <div class="r-body ${prefs.font === 'sans' ? 'sans' : ''}" id="r-body" style="font-size:${prefs.size}px">${body}</div>
    ${footHTML}`;

    return { html, chars, speakers };
  }

  return {
    MEDIA_ZH, esc, cleanTranscript, SPK_NAME, SPK_HEAD, speakerSet,
    splitLong, paragraphs, readMinutes, pickTranscripts, bodyHTML, articleHTML,
  };
});
