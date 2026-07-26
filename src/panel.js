// The in-page control panel. Lives in a shadow root so glowfic's stylesheet
// and this one cannot interfere with each other.

import {
  buildHeader,
  entriesFromDocument,
  entryFromPost,
  entryFromReply,
  estimateTokens,
  fetchPost,
  fetchReplies,
  fileStem,
  formatEntry,
  openingAuthor,
  pageCount,
  parseThreadUrl,
  perPageFromDocument,
  replyRangeForPages,
  splitTranscript,
} from './glowfic.js';

const HOST_ID = 'glowfic-clean-export';

const CSS = `
:host { all: initial; }
.panel {
  position: fixed; top: 16px; right: 16px; z-index: 2147483647;
  width: 330px; max-height: calc(100vh - 32px); overflow-y: auto;
  background: #fff; color: #1a1a1a; border: 1px solid #b9b0a2; border-radius: 8px;
  box-shadow: 0 6px 28px rgba(0,0,0,.28);
  font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
}
header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 9px 12px; background: #6d4c7d; color: #fff; border-radius: 7px 7px 0 0;
  font-weight: 600;
}
button.close {
  background: none; border: 0; color: #fff; font-size: 18px; line-height: 1;
  cursor: pointer; padding: 0 2px;
}
.body { padding: 12px; }
.meta { margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid #e6e1d8; }
.title { font-weight: 600; }
.sub { color: #6a6259; font-size: 12px; margin-top: 2px; }
label { display: block; margin: 5px 0; cursor: pointer; }
label.inline { display: flex; align-items: center; gap: 5px; }
input[type=number] { width: 58px; padding: 2px 4px; font: inherit; }
fieldset { border: 0; padding: 0; margin: 0 0 10px; }
legend { font-weight: 600; margin-bottom: 3px; padding: 0; }
.options { margin-bottom: 12px; padding-top: 10px; border-top: 1px solid #e6e1d8; }
.actions { display: flex; gap: 8px; }
button.action {
  flex: 1; padding: 7px 10px; font: inherit; font-weight: 600; cursor: pointer;
  background: #6d4c7d; color: #fff; border: 0; border-radius: 5px;
}
button.action.secondary { background: #efece7; color: #33302c; }
button.action:disabled { opacity: .5; cursor: default; }
.status { margin-top: 10px; font-size: 12px; color: #6a6259; min-height: 16px; }
.status.error { color: #a3282d; }
.result { margin-top: 12px; padding-top: 10px; border-top: 1px solid #e6e1d8; }
.result[hidden] { display: none; }
.size { font-weight: 600; margin-bottom: 6px; }
.warn { color: #8a5a12; font-size: 12px; margin-bottom: 8px; }
`;

export function openPanel() {
  document.getElementById(HOST_ID)?.remove();

  const thread = parseThreadUrl(location.href);
  if (!thread) {
    alert('Open a glowfic thread first — this works on glowfic.com/posts/... pages.');
    return;
  }

  const host = document.createElement('div');
  host.id = HOST_ID;
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${CSS}</style>` + template();
  document.body.appendChild(host);

  const panel = new Panel(root, thread);
  // Exposed so tests can await the metadata load; nothing in the page uses it.
  panel.ready = panel.start();
  return panel;
}

function template() {
  return `
<div class="panel">
  <header><span>Glowfic → clean transcript</span><button class="close" title="Close">×</button></header>
  <div class="body">
    <div class="meta"><div class="title">Loading…</div><div class="sub"></div></div>
    <fieldset class="scope" disabled>
      <legend>What to export</legend>
      <label><input type="radio" name="scope" value="all" checked> <span class="all-label">Whole thread</span></label>
      <label><input type="radio" name="scope" value="page"> <span class="page-label">This page</span></label>
      <label class="inline"><input type="radio" name="scope" value="range"> Pages
        <input type="number" class="from" min="1" value="1"> –
        <input type="number" class="to" min="1" value="1">
      </label>
    </fieldset>
    <div class="options">
      <label><input type="checkbox" class="icons" checked> Include icon keywords</label>
      <label><input type="checkbox" class="links" checked> Keep links</label>
    </div>
    <div class="actions"><button class="action fetch" disabled>Get transcript</button></div>
    <div class="status"></div>
    <div class="result" hidden>
      <div class="size"></div>
      <div class="warn" hidden></div>
      <label class="inline">Split every <input type="number" class="chunk" min="20" value="300">k characters</label>
      <div class="actions">
        <button class="action secondary copy">Copy</button>
        <button class="action download">Download</button>
      </div>
    </div>
  </div>
</div>`;
}

// Above roughly a quarter million characters a transcript stops being something
// you can comfortably paste, so the panel steers toward split downloads.
const PASTE_LIMIT_CHARS = 250_000;

class Panel {
  constructor(root, thread) {
    this.root = root;
    this.thread = thread;
    this.post = null;
    this.entries = [];
    this.$ = (selector) => root.querySelector(selector);

    this.$('.close').addEventListener('click', () => this.close());
    this.$('.fetch').addEventListener('click', () => {
      this.busy = this.run();
    });
    this.$('.copy').addEventListener('click', () => this.copy());
    this.$('.download').addEventListener('click', () => this.download());
    this.onKeydown = (event) => event.key === 'Escape' && this.close();
    document.addEventListener('keydown', this.onKeydown);
  }

  close() {
    document.removeEventListener('keydown', this.onKeydown);
    document.getElementById(HOST_ID)?.remove();
  }

  async start() {
    try {
      this.post = await fetchPost(this.thread.postId);
    } catch (error) {
      this.fail(error);
      return;
    }

    this.perPage = perPageFromDocument(document, location.href);
    this.pages = pageCount(this.post.num_replies, this.perPage);
    const authors = this.post.authors.map((author) => author.username).join(', ');

    this.$('.title').textContent = this.post.subject;
    this.$('.sub').textContent = `${authors} · ${this.post.num_replies} replies · ${this.pages} pages`;
    this.$('.all-label').textContent = `Whole thread (${this.post.num_replies + 1} entries)`;
    this.$('.page-label').textContent = this.thread.flat
      ? 'Everything shown on this page'
      : `This page (${this.thread.page} of ${this.pages})`;
    this.$('.from').value = this.thread.page;
    this.$('.from').max = this.pages;
    this.$('.to').value = Math.min(this.thread.page + 4, this.pages);
    this.$('.to').max = this.pages;
    this.$('.scope').disabled = false;
    this.$('.fetch').disabled = false;
  }

  get options() {
    return {
      icons: this.$('.icons').checked,
      links: this.$('.links').checked,
    };
  }

  async run() {
    const scope = this.root.querySelector('input[name=scope]:checked').value;
    this.$('.fetch').disabled = true;
    this.$('.result').hidden = true;
    this.status('Fetching…');

    try {
      this.entries = await this.collect(scope);
      this.scopeNote = this.describe(scope);
      this.report();
    } catch (error) {
      this.fail(error);
    } finally {
      this.$('.fetch').disabled = false;
    }
  }

  async collect(scope) {
    if (scope === 'page') return entriesFromDocument(document);

    const { start, end } = scope === 'all'
      ? { start: 0, end: this.post.num_replies }
      : replyRangeForPages(this.pageInput('.from'), this.pageInput('.to'), this.perPage);

    const replies = await fetchReplies(this.thread.postId, {
      start,
      end,
      onProgress: ({ page, pages }) =>
        this.status(pages ? `Fetching… batch ${page} of ${pages}` : `Fetching… batch ${page}`),
    });

    const entries = replies.map(entryFromReply);
    // The opening post is not a reply, so it only belongs to the first page.
    if (start === 0) {
      entries.unshift(entryFromPost(this.post, openingAuthor(this.post, replies, document)));
    }
    return entries;
  }

  pageInput(selector) {
    const value = Number(this.$(selector).value) || 1;
    return Math.min(Math.max(1, value), this.pages);
  }

  describe(scope) {
    if (scope === 'all') return null;
    if (scope === 'page') {
      return this.thread.flat ? 'Flat view' : `Page ${this.thread.page} of ${this.pages}`;
    }
    const from = this.pageInput('.from');
    const to = this.pageInput('.to');
    return `Pages ${from}–${to} of ${this.pages}`;
  }

  transcript() {
    const options = { ...this.options, scope: this.scopeNote };
    const header = buildHeader(this.post, options);
    const body = this.entries.map((entry) => formatEntry(entry, options)).join('\n\n');
    return `${header}\n\n${body}\n`;
  }

  parts() {
    const maxChars = (Number(this.$('.chunk').value) || 300) * 1000;
    return splitTranscript(this.post, this.entries, {
      ...this.options,
      scope: this.scopeNote,
      maxChars,
    });
  }

  report() {
    const text = this.transcript();
    const tokens = estimateTokens(text);
    this.status('');
    this.$('.result').hidden = false;
    this.$('.size').textContent =
      `${this.entries.length} entries · ${text.length.toLocaleString()} characters · ~${Math.round(tokens / 1000)}k tokens`;

    const warn = this.$('.warn');
    warn.hidden = text.length <= PASTE_LIMIT_CHARS;
    warn.textContent = warn.hidden
      ? ''
      : 'Too big to paste comfortably — download and attach the files instead.';
    this.updateDownloadLabel();
    this.$('.chunk').oninput = () => this.updateDownloadLabel();
  }

  updateDownloadLabel() {
    const count = this.parts().length;
    this.$('.download').textContent = count > 1 ? `Download ${count} files` : 'Download .md';
  }

  async copy() {
    const text = this.transcript();
    try {
      await navigator.clipboard.writeText(text);
      this.status(`Copied ${text.length.toLocaleString()} characters.`);
    } catch {
      this.status('Clipboard blocked — use Download instead.', true);
    }
  }

  async download() {
    const parts = this.parts();
    const stem = fileStem(this.post);
    parts.forEach((text, index) => {
      const suffix = parts.length > 1 ? `-part${index + 1}` : '';
      save(text, `${stem}${suffix}.md`);
    });
    this.status(`Saved ${parts.length} file${parts.length > 1 ? 's' : ''}.`);
  }

  status(message, isError = false) {
    const element = this.$('.status');
    element.textContent = message;
    element.classList.toggle('error', isError);
  }

  fail(error) {
    this.status(error.message || String(error), true);
  }
}

function save(text, filename) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
