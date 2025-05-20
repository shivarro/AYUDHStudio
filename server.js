const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'project-data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR);
}

app.use(express.json());
app.use(express.static('public'));

// Multer storage config—files go into project-data/<project>/audio/
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const projDir = path.join(DATA_DIR, req.params.name, 'audio');
    fs.mkdirSync(projDir, { recursive: true });
    cb(null, projDir);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});
const upload = multer({ storage });

// List all projects (name + description)
app.get('/api/projects', (req, res) => {
  fs.readdir(DATA_DIR, (err, items) => {
    if (err) return res.status(500).json({ error: err.message });
    const projects = items.filter(name => fs.statSync(path.join(DATA_DIR, name)).isDirectory())
      .map(name => {
        const metaPath = path.join(DATA_DIR, name, 'notes.json');
        let desc = '';
        if (fs.existsSync(metaPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath));
            desc = meta.description || '';
          } catch {}
        }
        return { name, description: desc };
      });
    res.json(projects);
  });
});

// Create a new project
app.post('/api/projects', (req, res) => {
  const { name, description = '' } = req.body;
  if (!name) return res.status(400).json({ error: 'Project name required' });
  const projPath = path.join(DATA_DIR, name);
  if (fs.existsSync(projPath)) {
    return res.status(400).json({ error: 'Project already exists' });
  }
  fs.mkdirSync(path.join(projPath, 'audio'), { recursive: true });
  const meta = { description, notes: [] };
  fs.writeFileSync(path.join(projPath, 'notes.json'), JSON.stringify(meta, null, 2));
  res.status(201).json({ message: 'Project created' });
});

// Get project details (audio list + notes)
app.get('/api/projects/:name', (req, res) => {
  const projDir = path.join(DATA_DIR, req.params.name);
  if (!fs.existsSync(projDir)) return res.status(404).json({ error: 'Not found' });

  // Audio files
  const audioDir = path.join(projDir, 'audio');
  const audio = fs.existsSync(audioDir)
    ? fs.readdirSync(audioDir)
    : [];

  // Notes
  const metaPath = path.join(projDir, 'notes.json');
  let notes = [], description = '';
  if (fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath));
    notes = meta.notes || [];
    description = meta.description || '';
  }

  res.json({ name: req.params.name, description, audio, notes });
});

// Upload an audio file
app.post('/api/projects/:name/upload', upload.single('file'), (req, res) => {
  res.json({ message: 'Uploaded', filename: req.file.originalname });
});

// Add a note
app.post('/api/projects/:name/notes', (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Note text required' });
  const metaPath = path.join(DATA_DIR, req.params.name, 'notes.json');
  if (!fs.existsSync(metaPath)) return res.status(404).json({ error: 'Project not found' });
  const meta = JSON.parse(fs.readFileSync(metaPath));
  meta.notes.push({ text, timestamp: new Date().toISOString() });
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  res.json({ message: 'Note added' });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
