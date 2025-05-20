const api = {
  list: () => fetch('/api/projects').then(r => r.json()),
  create: (name, desc) =>
    fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description: desc })
    }),
  details: name => fetch(`/api/projects/${encodeURIComponent(name)}`).then(r => r.json()),
  upload: (name, file) => {
    const data = new FormData();
    data.append('file', file);
    return fetch(`/api/projects/${encodeURIComponent(name)}/upload`, {
      method: 'POST',
      body: data
    });
  },
  addNote: (name, text) =>
    fetch(`/api/projects/${encodeURIComponent(name)}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    })
};

function el(tag, attrs={}, ...children) {
  const e = document.createElement(tag);
  for (let k in attrs) e[k] = attrs[k];
  children.forEach(c => e.append(c));
  return e;
}

function loadProjects() {
  api.list().then(list => {
    const container = document.getElementById('project-list');
    container.innerHTML = '';
    list.forEach(p => {
      const projDiv = el('div', { className: 'project' });
      const header = el('div',
        { className: 'project-header' },
        el('strong', {}, p.name),
        el('span', {}, '▶')
      );
      projDiv.append(header);
      const detailsDiv = el('div', { className: 'project-details', style: 'display:none;' });
      projDiv.append(detailsDiv);

      header.onclick = () => {
        if (detailsDiv.style.display === 'none') {
          api.details(p.name).then(d => showDetails(detailsDiv, d));
          detailsDiv.style.display = 'block';
        } else {
          detailsDiv.style.display = 'none';
        }
      };

      container.append(projDiv);
    });
  });
}

function showDetails(container, { name, description, audio, notes }) {
  container.innerHTML = '';
  if (description) {
    container.append(el('p', {}, description));
  }
  // Audio list
  audio.forEach(fn => {
    const src = `/project-data/${encodeURIComponent(name)}/audio/${encodeURIComponent(fn)}`;
    container.append(
      el('div', {},
        el('label', {}, fn),
        el('audio', { controls: true, src })
      )
    );
  });

  // Upload form
  const fileInput = el('input', { type: 'file' });
  const uploadBtn = el('button', {}, 'Upload');
  uploadBtn.onclick = () => {
    if (fileInput.files.length) {
      api.upload(name, fileInput.files[0]).then(() => loadProjects());
    }
  };
  container.append(el('div', {}, fileInput, uploadBtn));

  // Notes
  const notesDiv = el('div', { className: 'notes' },
    el('h4', {}, 'Notes')
  );
  notes.forEach(n => {
    notesDiv.append(el('p', {}, `[${new Date(n.timestamp).toLocaleString()}] ${n.text}`));
  });
  const textarea = el('textarea');
  const noteBtn = el('button', {}, 'Add Note');
  noteBtn.onclick = () => {
    if (textarea.value.trim()) {
      api.addNote(name, textarea.value.trim())
        .then(() => {
          showDetails(container, { name, description, audio, notes: [...notes, { text: textarea.value.trim(), timestamp: new Date().toISOString() }] });
          textarea.value = '';
        });
    }
  };
  notesDiv.append(textarea, noteBtn);
  container.append(notesDiv);
}

document.getElementById('project-form').onsubmit = e => {
  e.preventDefault();
  const name = document.getElementById('proj-name').value.trim();
  const desc = document.getElementById('proj-desc').value.trim();
  if (!name) return;
  api.create(name, desc)
    .then(r => r.json())
    .then(() => {
      document.getElementById('proj-name').value = '';
      document.getElementById('proj-desc').value = '';
      loadProjects();
    });
};

loadProjects();
