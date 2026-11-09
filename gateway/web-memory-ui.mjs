export async function mountWebMemory(container, request, current, setDirty) {
  if (!current()) return;
  container.innerHTML = `
    <p class="muted">保存用户偏好和已核对的项目结论。开启资料中的记忆开关后，网页提交 Voxi Agent 新任务时，匹配到的条目会作为参考背景写入任务记录。</p>
    <p class="web-memory-status" role="status">正在读取网页任务记忆…</p>
    <form class="web-memory-form" hidden>
      <label class="field">类型<select name="category"><option value="project">项目结论</option><option value="preference">用户偏好</option></select></label>
      <label class="field">标题<input name="title" required maxlength="80"></label>
      <label class="field">记忆内容<textarea name="text" required maxlength="450" rows="3"></textarea></label>
      <label class="field">检索词<input name="keywords" required maxlength="180" placeholder="用逗号分隔，例如 MiniCam, 4G, 卡顿"></label>
      <label class="field">来源（可选）<input name="source" maxlength="200" placeholder="例如 11 月 7 日固定 180 秒播放测试"></label>
      <div class="row"><button>添加记忆</button><button type="button" class="secondary" hidden>取消编辑</button></div>
    </form>
    <div class="web-memory-items"></div>`;
  const status = container.querySelector('.web-memory-status');
  const form = container.querySelector('form');
  const save = form.querySelector('button');
  const cancel = form.querySelector('button.secondary');
  const items = container.querySelector('.web-memory-items');
  const fields = form.elements;
  let editing, busy = false, dirty = false;
  function reset() {
    form.reset();
    editing = undefined;
    save.textContent = '添加记忆';
    cancel.hidden = true;
    dirty = false;
    setDirty(false);
  }
  function render({items: memories}) {
    items.replaceChildren();
    for (const memory of memories) {
      const card = document.createElement('article');
      card.className = 'item web-memory-item';
      const title = document.createElement('strong');
      title.textContent = memory.title;
      const text = document.createElement('p');
      text.textContent = memory.text;
      const meta = document.createElement('p');
      meta.className = 'muted';
      meta.textContent = (memory.category === 'project' ? '项目结论' : '用户偏好') +
        ' · ' + memory.keywords.join('、') + (memory.source ? ' · 来源 ' + memory.source : '');
      const actions = document.createElement('div');
      actions.className = 'row';
      const edit = document.createElement('button');
      edit.className = 'secondary';
      edit.textContent = '编辑';
      edit.onclick = () => {
        if (busy || (dirty && !confirm('放弃当前未保存的修改？'))) return;
        reset();
        editing = memory.id;
        for (const name of ['category','title','text','source']) fields.namedItem(name).value = memory[name];
        fields.namedItem('keywords').value = memory.keywords.join('，');
        save.textContent = '保存修改';
        cancel.hidden = false;
        fields.namedItem('title').focus();
      };
      const del = document.createElement('button');
      del.className = 'danger';
      del.textContent = '删除';
      del.onclick = () => {
        if (confirm('删除这条记忆？之后提交的新任务将不再引用它。')) {
          return mutate({action:'delete',id:memory.id}, '已删除。');
        }
      };
      actions.append(edit, del);
      card.append(title, text, meta, actions);
      items.append(card);
    }
    if (!memories.length) items.textContent = '暂无网页任务记忆。';
  }
  async function mutate(body, message) {
    if (busy || !current()) return;
    busy = true;
    save.disabled = true;
    try {
      const data = await request(body);
      if (!current()) return;
      if (body.action === 'save' || editing === body.id) reset();
      render(data);
      status.textContent = message;
    } catch (error) {
      if (current()) status.textContent = error.message;
    } finally {
      busy = false;
      save.disabled = false;
    }
  }
  form.oninput = () => { dirty = true; setDirty(true); };
  form.onsubmit = event => {
    event.preventDefault();
    return mutate({action:'save',id:editing,...Object.fromEntries(new FormData(form))}, '已保存。');
  };
  cancel.onclick = reset;
  try {
    const data = await request();
    if (!current()) return;
    render(data);
    form.hidden = false;
    status.textContent = '';
  } catch (error) {
    if (current()) status.textContent = error.message;
  }
}
