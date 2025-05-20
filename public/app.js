// app.js

// Web Audio context
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let buffers = [];        // [{ name, buffer }]
let currentProject = ''; // name of project we’re viewing

// track currently playing source nodes & their start times
let sources = [];
let startTimes = [];
let progressInterval = null;

// API helpers
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

// Utility to create elements
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  Object.assign(e, attrs);
  children.forEach(c => e.append(c));
  return e;
}

// Load list of projects
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

// Show details for a single project (including tape deck)
async function showDetails(container, { name, description, audio, notes }) {
  container.innerHTML = '';
  currentProject = name;
  buffers = [];

  // Description
  if (description) {
    container.append(el('p', {}, description));
  }

  // TAPE DECK placeholder
  const deckPlaceholder = el('div', { className: 'tape-deck' }, 'Loading tracks…');
  container.append(deckPlaceholder);

  // Initialize and render tape deck controls
  await initializeTapeDeck(deckPlaceholder, name, audio);

  // Upload form
  const fileInput = el('input', { type: 'file' });
  const uploadBtn = el('button', {}, 'Upload Track');
  uploadBtn.onclick = () => {
    if (fileInput.files.length) {
      api.upload(name, fileInput.files[0]).then(() => loadProjects());
    }
  };
  container.append(el('div', {}, fileInput, uploadBtn));

  // Delete button with typed confirmation
  const delBtn = el('button', { style: 'margin-top:1em;color:red' }, 'Delete Project');
  delBtn.onclick = () => {
    const answer = prompt(`Type "yes" to permanently delete project "${name}"`);
    if (answer === 'yes') {
      fetch(`/api/projects/${encodeURIComponent(name)}`, { method: 'DELETE' })
        .then(r => {
          if (!r.ok) throw new Error('Delete failed');
          container.innerHTML = '';
          loadProjects();
        })
        .catch(err => alert(`Error: ${err.message}`));
    }
  };
  container.append(delBtn);

  // Notes section (unchanged)
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
          notesDiv.append(el('p', {}, `[${new Date().toLocaleString()}] ${textarea.value.trim()}`));
          textarea.value = '';
        });
    }
  };
  notesDiv.append(textarea, noteBtn);
  container.append(notesDiv);
}

// Fetch and decode a single track
async function loadTrack(projectName, filename) {
  const resp = await fetch(`/project-data/${encodeURIComponent(projectName)}/audio/${encodeURIComponent(filename)}`);
  const arrayBuffer = await resp.arrayBuffer();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  return { name: filename, buffer: audioBuffer };
}

// Build the tape deck UI and prepare buffers
async function initializeTapeDeck(container, projectName, audioList) {
  // Load & decode all tracks
  const loadPromises = audioList.map(fn => loadTrack(projectName, fn));
  buffers = await Promise.all(loadPromises);

  // Reset play state
  sources    = new Array(buffers.length).fill(null);
  startTimes = new Array(buffers.length).fill(0);

  // Clear placeholder
  container.innerHTML = '';

  // (optional) global Play All – you can uncomment if desired
  // const playAllBtn = el('button', { onclick: playAll }, '▶ Play All Tracks');
  // container.append(playAllBtn);

  // Global Stop All
  const stopAllBtn = el('button',
    { onclick: stopAll, style: 'margin-left:1em;color:red' },
    '■ Stop All'
  );
  container.append(stopAllBtn);

  // Per-track controls
  buffers.forEach((track, i) => {
    const trackDiv = el('div', { className: 'track', id: `track-${i}` },
      el('span', {}, track.name),
      el('label', {}, 'Offset (s):'),
      el('input', { type: 'number', id: `offset-${i}`, step: '0.01', value: 0 }),
      el('button', { onclick: () => playTrack(i) }, '▶ Solo'),
      el('button', { onclick: () => stopTrack(i), style: 'margin-left:0.5em;color:red' }, '■ Stop'),
      el('progress', {
        id:    `progress-${i}`,
        max:   track.buffer.duration,
        value: 0,
        style: 'width:150px; margin-left:0.5em;'
      }),
      el('button', { onclick: () => downloadTrack(i) }, '⬇ Download')
    );
    container.append(trackDiv);
  });
}

// Play a single track (with offset), ensuring only one instance
function playTrack(i) {
  // stop existing if any
  if (sources[i]) {
    sources[i].stop();
    sources[i] = null;
  }

  const offsetInput = document.getElementById(`offset-${i}`);
  const offset = parseFloat(offsetInput.value) || 0;
  const { buffer } = buffers[i];
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  src.connect(audioCtx.destination);

  // schedule start
  const when = audioCtx.currentTime + offset;
  startTimes[i] = when;
  sources[i]    = src;
  src.start(when);

  // start progress polling
  if (!progressInterval) {
    progressInterval = setInterval(updateAllProgress, 50);
  }
}

// Stop a single track and reset its progress bar
function stopTrack(i) {
  if (sources[i]) {
    sources[i].stop();
    sources[i] = null;
    const p = document.getElementById(`progress-${i}`);
    if (p) p.value = 0;
  }
}

// Stop all tracks & clear polling
function stopAll() {
  sources.forEach((_, i) => stopTrack(i));
  if (progressInterval) {
    clearInterval(progressInterval);
    progressInterval = null;
  }
}

// Update each track’s progress bar based on AudioContext time
function updateAllProgress() {
  sources.forEach((src, i) => {
    if (!src) return;
    const now     = audioCtx.currentTime;
    const elapsed = now - startTimes[i];
    const dur     = buffers[i].buffer.duration;
    const p       = document.getElementById(`progress-${i}`);
    if (elapsed >= 0 && elapsed <= dur) {
      p.value = elapsed;
    }
    if (elapsed >= dur) {
      stopTrack(i);
    }
  });
}

// Play all tracks together
function playAll() {
  stopAll();
  buffers.forEach((_, i) => playTrack(i));
}

// Download a track file
function downloadTrack(i) {
  const name = buffers[i].name;
  const url  = `/project-data/${encodeURIComponent(currentProject)}/audio/${encodeURIComponent(name)}`;
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// Project creation form handler
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

// Initial load
loadProjects();
