/* (C) 2016 Narazaka : Licensed under The MIT License - http://narazaka.net/license/MIT?2016 */

var NativeShiori = function(shiori, debug) {
  this.Module = shiori.Module;
  this.FS = shiori.FS;
  this.PATH = shiori.PATH;
  this.ERRNO_CODES = shiori.ERRNO_CODES;
  this.NODEFS = shiori.NODEFS;
  this.IDBFS = shiori.IDBFS;
  this.debug = debug;
  this._load = this.Module.cwrap('load', 'number', ['number', 'number']);
  this._request = this.Module.cwrap('request', 'number', ['number', 'number']);
  this._unload = this.Module.cwrap('unload', 'number');
};

NativeShiori.prototype.load = function(dirpath) {
  if (this.debug) console.log('nativeshiori.load()', dirpath);
  var dirpath_raw = this.Module.intArrayFromString(dirpath);
  dirpath_raw.pop(); // remove \0
  var dir = this._alloc_string(dirpath_raw);

  return this._load(dir.ptr, dir.size);
};

NativeShiori.prototype.request = function(request, raw_request) {
  if (this.debug) console.log('nativeshiori.request()\n', request);
  var request_raw;
  if (raw_request) {
    request_raw = request;
  } else {
    request_raw = this.Module.intArrayFromString(request);
    request_raw.pop(); // remove \0
  }
  var req = this._alloc_string(request_raw);
  var len = this._alloc_long(req.size);

  var res_ptr = this._request(req.ptr, len.ptr);

  var res_heap = this._view_string(res_ptr, len.heap[0]);
  var response = this.Module.intArrayToString(res_heap);

  this.Module._free(len.ptr);
  this.Module._free(res_ptr);

  if (this.debug) console.log('nativeshiori.request() returns\n', response);
  return response;
};

NativeShiori.prototype.unload = function() {
  if (this.debug) console.log('nativeshiori.unload()');
  return this._unload();
};

NativeShiori.prototype.mount = function(type, mount_point, root) {
  if (this.debug) console.log('nativeshiori.mount()', type, mount_point, root);
  this._mkpath(mount_point);
  var fs = type === 'IndexedDB' ? this.IDBFS : this.NODEFS;
  this.FS.mount(fs, {root: root}, mount_point);
};

NativeShiori.prototype.umount = function(mount_point) {
  if (this.debug) console.log('nativeshiori.umount()', mount_point);
  this.FS.unmount(mount_point); // unmount! not umount!
};

NativeShiori.prototype.push = function(dirpath, storage) {
  if (this.debug) console.log('nativeshiori.push()', dirpath, storage);
  this._push_FS(dirpath, storage);
};

NativeShiori.prototype.pull = function(dirpath) {
  if (this.debug) console.log('nativeshiori.pull()', dirpath);
  return this._pull_FS(dirpath);
};

NativeShiori.prototype._alloc_string = function(str_array) {
  var buf = new Uint8Array(str_array);
  var size = buf.length * buf.BYTES_PER_ELEMENT;
  var ptr = this.Module._malloc(size);
  var heap = new Uint8Array(this.Module.HEAPU8.buffer, ptr, size);
  heap.set(buf);
  return {ptr: ptr, size: size, heap: heap};
};

NativeShiori.prototype._view_string = function(ptr, size) {
  return new Uint8Array(this.Module.HEAPU8.buffer, ptr, size);
};

NativeShiori.prototype._alloc_long = function(n) {
  var buf = new Int32Array([n]);
  var size = buf.length * buf.BYTES_PER_ELEMENT;
  var ptr = this.Module._malloc(size);
  var heap = new Int32Array(this.Module.HEAP32.buffer, ptr, size);
  heap.set(buf);
  return {ptr: ptr, size: size, heap: heap};
};

NativeShiori.prototype._push_FS = function(base_directory, storage) {
  if (this.debug) console.log('nativeshiori._push_FS()', base_directory, storage);
  var filepath;
  for (filepath in storage) {
    if (!storage.hasOwnProperty(filepath)) continue;
    var dirname = this._dirname(filepath);
    var dir = this._catfile(base_directory, dirname);
    try {
      this.FS.stat(dir);
    } catch (e) {
      this._mkpath(dir);
    }
    if (!/\/$/.test(filepath)) {
      var content = new Uint8Array(storage[filepath]);
      var file = this._catfile(base_directory, filepath);
      if (this.debug) console.log('nativeshiori._push_FS() writeFile:', file);
      this.FS.writeFile(file, content, {encoding: 'binary'});
    }
  }
};

NativeShiori.prototype._pull_FS = function(base_directory) {
  if (this.debug) console.log('nativeshiori._pull_FS()', base_directory);
  var storage = {};
  var elements = this._readdirAll(base_directory);
  var i = 0;
  for (i = 0; i < elements.length; ++i) {
    var filepath = elements[i];
    var file = this._catfile(base_directory, filepath);
    if (this.debug) console.log('nativeshiori._pull_FS() readFile/unlink:', file);
    var content = this.FS.readFile(file, {encoding: 'binary'});
    this.FS.unlink(file);
    storage[filepath] = content.buffer;
  }
  return storage;
};

NativeShiori.prototype._canonical = function(path) {
  return path.replace(/\\/, '/').replace(/\/\/+/, '/');
};
NativeShiori.prototype._catfile = function() {
  var path = '';
  var i = 0;
  for (i = 0; i < arguments.length; ++i) {
    var token = arguments[i];
    path += token.replace(/^\/?/, '/').replace(/\/?$/, '');
  }
  return NativeShiori.prototype._canonical(path).replace(/\/?$/, '');
};

NativeShiori.prototype._catfile_rel = function() {
  return NativeShiori.prototype._catfile.apply(this, arguments).replace(/^\//, '');
};

NativeShiori.prototype._dirname = function(path) {
  return NativeShiori.prototype._canonical(path).replace(/\/?[^\/]*\/?$/, '');
};

NativeShiori.prototype._mkpath = function(path) {
  if (this.debug) console.log('nativeshiori._mkpath()', path);
  var FS = this.FS;
  var _dirname = this._dirname;
  var debug = this.debug;
  var mkdir;
  mkdir = function(path) {
    if (!path) path = '/';
    try {
      FS.stat(path);
    } catch (e) {
      mkdir(_dirname(path));
      if (debug) console.log('nativeshiori._mkpath() mkdir:', path);
      FS.mkdir(path);
    }
  };
  mkdir(this._canonical(path));
  return true;
};

NativeShiori.prototype._readdirAll = function(path) { // not contain directory
  if (this.debug) console.log('nativeshiori._readdirAll()', path);
  var FS = this.FS;
  var _catfile = this._catfile;
  var _catfile_rel = this._catfile_rel;
  var debug = this.debug;
  var readdir;
  readdir = function(basepath, path) {
    var abspath = _catfile(basepath, path);
    if (debug) console.log('nativeshiori._readdirAll() readdir:', abspath);
    var children = FS.readdir(abspath);
    var elements = [];
    var i = 0;
    for (i = 0; i < children.length; ++i) {
      var child = children[i];
      if (child === '.' || child === '..') continue;
      var childpath = _catfile_rel(path, child);
      var childabspath = _catfile(basepath, childpath);
      var stat = FS.stat(childabspath);
      if (FS.isDir(stat.mode)) {
        elements = elements.concat(readdir(basepath, childpath));
      } else {
        elements.push(childpath);
      }
    }
    return elements;
  };
  return readdir(this._canonical(path), '');
};

if (typeof module !== 'undefined' && module !== null && module.exports) module.exports = NativeShiori;
