const path = require('path');
const EventEmitter = require('events');
const fs = require('fs');
const globby = require('globby');
const diff = require('lodash.difference');

const readdir = (dir, pattern) => {
  return globby(pattern, {
    cwd: dir,
    deep: 1
  }).then(paths => paths.map(f => path.resolve(dir, f)));
};

module.exports = (pattern, {
  cwd = process.cwd(),
  persistent = true
} = {}) => {
  const events = new EventEmitter();
  const dirs = {};
  const files = {};

  const watchFile = abspath => {
    files[abspath] = watch(abspath, (type, name) => {
      events.emit('change', {
        path: abspath,
        type, name,
        entity: 'file'
      });
    });
    events.emit('add', { path: abspath });
  };

  const watchDir = abspath => {
    dirs[abspath] = watch(abspath, () => {
      readdir(abspath, pattern).then(paths => {
        const existing = Object.keys(files).filter(file => file.slice(0, abspath.length) === abspath);
        // diff returns items in the first array that are not in the second
        const newFiles = diff(paths, existing);
        const removedFiles = diff(existing, paths);

        if (removedFiles.length) {
          removedFiles.forEach(file => {
            files[file].close();
            delete files[file];
            events.emit('remove', { path: file });
          });
        }

        if (newFiles.length) {
          newFiles.forEach(file => {
            watchFile(file);
          });
        }
      });
    });
    events.emit('addDir', { path: abspath });
  };

  const watch = (file, func) => fs.watch(file, { persistent }, func);
  globby.stream(pattern, {
    onlyFiles: false,
    markDirectories: true,
    cwd,
    concurrency: 1
  }).on('data', file => {
    const abspath = path.resolve(cwd, file);

    if (/\/$/.test(file)) {
      watchDir(abspath);
    } else {
      watchFile(abspath);
    }
  }).on('end', () => {
    events.emit('ready', {
      files: Object.keys(files),
      dirs: Object.keys(dirs)
    });
  }).on('error', err => {
    events.emit('error', err);
  });

  return events;
};
