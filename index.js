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
  const pending = {};

  const throttle = (abspath, evname, evarg) => {
    const funcKey = `func : ${abspath}`;

    if (pending[funcKey]) {
      clearTimeout(pending[funcKey]);
    } else {
      // save only the first set of arguments
      pending[abspath] = [evname, evarg];
    }

    pending[funcKey] = setTimeout(() => {
      const [name, arg] = pending[abspath];
      events.emit(name, arg);
    }, 50);
  };

  const removeFile = (abspath) => {
    const watcher = files[abspath];

    if (watcher) {
      watcher.close();
      delete files[abspath];
      events.emit('unlink', { path: abspath });
    }
  };

  const onFileChange = abspath => (type) => {
    if (type === 'rename') {
      return removeFile(abspath);
    }

    throttle(abspath, 'change', { path: abspath });
  };

  const onDirChange = abspath => () => {
    readdir(abspath, pattern).then(paths => {
      // find only files that exist in this directory
      const existing = Object.keys(files)
        .filter(file => path.dirname(file) === abspath)
        .filter(file => !dirs[file]);
      // diff returns items in the first array that are not in the second
      const newFiles = diff(paths, existing);
      const removedFiles = diff(existing, paths);

      if (removedFiles.length) {
        removedFiles.forEach(file => removedFiles(file));
      }

      if (newFiles.length) {
        newFiles.forEach(file => watchFile(file));
      }
    });
  };

  const watch = (file, func) => fs.watch(file, { persistent }, func);

  const watchFile = abspath => {
    files[abspath] = watch(abspath, onFileChange(abspath));
    events.emit('add', { path: abspath });
  };

  const watchDir = abspath => {
    dirs[abspath] = watch(abspath, onDirChange(abspath));

    dirs[abspath].on('error', err => {
      // TODO an EPERM error is fired when the directory is deleted
      console.log('error:', abspath, err);
    });

    events.emit('addDir', { path: abspath });
  };

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
    watchDir(cwd);
    events.emit('ready');
  }).on('error', err => {
    events.emit('error', err);
  });

  return events;
};
