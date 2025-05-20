const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 4000;
// Change DATA_DIR to point at your rclone mount
const LOCAL_ROOT = process.env.LOCAL_ROOT || '/mnt/seedr/studio';

app.use(express.json());
app.use(express.static('public'));
// Serve everything in the rclone mount at /project-data
app.use('/project-data', express.static(LOCAL_ROOT));

// Multer disk storage into the rclone mount
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const projDir = path.join(LOCAL_ROOT, req.params.name, 'audio');
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
  fs.readdir(LOCAL_ROOT, (err, items) => {
    if (err) return res.status(500).json({ error: err.message });
    const projects = items
      .filter(name => fs.statSync(path.join(LOCAL_ROOT, name)).isDirectory())
      .map(name => {
        const metaPath = path.join(LOCAL_ROOT, name, 'notes.json');
        let description = '';
        if (fs.existsSync(metaPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath));
            description = meta.description || '';
          } catch {}
        }
        return { name, description };
      });
    res.json(projects);
  });
});

// Create a new project
app.post('/api/projects', (req, res) => {
  const { name, description = '' } = req.body;
  if (!name) return res.status(400).json({ error: 'Project name required' });

  const projPath = path.join(LOCAL_ROOT, name);
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
  const projDir = path.join(LOCAL_ROOT, req.params.name);
  if (!fs.existsSync(projDir)) return res.status(404).json({ error: 'Not found' });

  // Audio files
  const audioDir = path.join(projDir, 'audio');
  const audio = fs.existsSync(audioDir) ? fs.readdirSync(audioDir) : [];

  // Notes & description
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
  const { text, author } = req.body;
  if (!text) return res.status(400).json({ error: 'Note text required' });

  const metaPath = path.join(LOCAL_ROOT, req.params.name, 'notes.json');
  if (!fs.existsSync(metaPath)) return res.status(404).json({ error: 'Project not found' });

  const meta = JSON.parse(fs.readFileSync(metaPath));
  meta.notes.push({
    text,
    author: author || 'Anonymous',
    timestamp: new Date().toISOString()
  });
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

  res.json({ message: 'Note added' });
});

// DELETE a project (and all its audio + notes)
app.delete('/api/projects/:name', (req, res) => {
  const projDir = path.join(LOCAL_ROOT, req.params.name);
  if (!fs.existsSync(projDir)) {
    return res.status(404).json({ error: 'Project not found' });
  }

  fs.rmSync(projDir, { recursive: true, force: true });
  res.json({ message: 'Project deleted' });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
