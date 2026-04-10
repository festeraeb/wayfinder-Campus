export class AppUI {
  constructor() {
    this.categories = document.querySelectorAll('.category');
    this.init();
  }

  init() {
    this.setupAddButtons();
    this.setupSelfNaming();
    this.loadState();
  }

  setupAddButtons() {
    document.querySelectorAll('.add-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.target;
        const list = document.querySelector(`[data-color="${target}"] .task-list`);
        const limit = parseInt(list.dataset.limit || 99);
        
        if (list.children.length >= limit) {
          alert(`🛑 ${list.previousElementSibling.querySelector('h2').textContent} is full (Max ${limit}).\nComplete an item or move one to "Next Up" first.`);
          return;
        }
        this.addTask(list, '');
      });
    });
  }

  addTask(listEl, text = '') {
    const li = document.createElement('li');
    li.className = 'task-item';
    li.draggable = true;
    
    const span = document.createElement('span');
    span.textContent = text || 'New item...';
    span.contentEditable = true;
    span.addEventListener('blur', () => this.saveState());
    span.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); span.blur(); }
    });

    const actions = document.createElement('div');
    actions.className = 'task-actions';
    
    const doneBtn = document.createElement('button');
    doneBtn.textContent = '✅';
    doneBtn.onclick = () => {
      li.classList.add('done');
      const doneList = document.querySelector('[data-color="green"] .task-list');
      doneList.appendChild(li);
      this.saveState();
    };

    const delBtn = document.createElement('button');
    delBtn.textContent = '🗑️';
    delBtn.onclick = () => { li.remove(); this.saveState(); };

    actions.appendChild(doneBtn);
    actions.appendChild(delBtn);
    li.appendChild(span);
    li.appendChild(actions);
    listEl.appendChild(li);
    span.focus();
    this.saveState();
  }

  setupSelfNaming() {
    document.querySelectorAll('h2[contenteditable]').forEach(h2 => {
      h2.addEventListener('blur', this.saveState);
    });
  }

  saveState() {
    const state = {};
    this.categories.forEach(cat => {
      const color = cat.dataset.color;
      const title = cat.querySelector('h2').textContent;
      const items = Array.from(cat.querySelectorAll('.task-list .task-item span')).map(s => s.textContent);
      state[color] = { title, items };
    });
    localStorage.setItem('cesarops_board_state', JSON.stringify(state));
  }

  loadState() {
    const saved = localStorage.getItem('cesarops_board_state');
    if (saved) {
      const state = JSON.parse(saved);
      Object.keys(state).forEach(color => {
        const cat = document.querySelector(`[data-color="${color}"]`);
        if (!cat) return;
        cat.querySelector('h2').textContent = state[color].title;
        const list = cat.querySelector('.task-list');
        list.innerHTML = '';
        state[color].items.forEach(text => this.addTask(list, text));
      });
    }
  }
}
