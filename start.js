(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){

},{}],2:[function(require,module,exports){
/*
 * EJS Embedded JavaScript templates
 * Copyright 2112 Matthew Eernisse (mde@fleegix.org)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *         http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
*/

'use strict';

/**
 * @file Embedded JavaScript templating engine. {@link http://ejs.co}
 * @author Matthew Eernisse <mde@fleegix.org>
 * @author Tiancheng "Timothy" Gu <timothygu99@gmail.com>
 * @project EJS
 * @license {@link http://www.apache.org/licenses/LICENSE-2.0 Apache License, Version 2.0}
 */

/**
 * EJS internal functions.
 *
 * Technically this "module" lies in the same file as {@link module:ejs}, for
 * the sake of organization all the private functions re grouped into this
 * module.
 *
 * @module ejs-internal
 * @private
 */

/**
 * Embedded JavaScript templating engine.
 *
 * @module ejs
 * @public
 */

var fs = require('fs');
var path = require('path');
var utils = require('./utils');

var scopeOptionWarned = false;
var _VERSION_STRING = require('../package.json').version;
var _DEFAULT_DELIMITER = '%';
var _DEFAULT_LOCALS_NAME = 'locals';
var _NAME = 'ejs';
var _REGEX_STRING = '(<%%|%%>|<%=|<%-|<%_|<%#|<%|%>|-%>|_%>)';
var _OPTS_PASSABLE_WITH_DATA = ['delimiter', 'scope', 'context', 'debug', 'compileDebug',
  'client', '_with', 'rmWhitespace', 'strict', 'filename', 'async'];
// We don't allow 'cache' option to be passed in the data obj for
// the normal `render` call, but this is where Express 2 & 3 put it
// so we make an exception for `renderFile`
var _OPTS_PASSABLE_WITH_DATA_EXPRESS = _OPTS_PASSABLE_WITH_DATA.concat('cache');
var _BOM = /^\uFEFF/;

/**
 * EJS template function cache. This can be a LRU object from lru-cache NPM
 * module. By default, it is {@link module:utils.cache}, a simple in-process
 * cache that grows continuously.
 *
 * @type {Cache}
 */

exports.cache = utils.cache;

/**
 * Custom file loader. Useful for template preprocessing or restricting access
 * to a certain part of the filesystem.
 *
 * @type {fileLoader}
 */

exports.fileLoader = fs.readFileSync;

/**
 * Name of the object containing the locals.
 *
 * This variable is overridden by {@link Options}`.localsName` if it is not
 * `undefined`.
 *
 * @type {String}
 * @public
 */

exports.localsName = _DEFAULT_LOCALS_NAME;

/**
 * Promise implementation -- defaults to the native implementation if available
 * This is mostly just for testability
 *
 * @type {Function}
 * @public
 */

exports.promiseImpl = (new Function('return this;'))().Promise;

/**
 * Get the path to the included file from the parent file path and the
 * specified path.
 *
 * @param {String}  name     specified path
 * @param {String}  filename parent file path
 * @param {Boolean} isDir    parent file path whether is directory
 * @return {String}
 */
exports.resolveInclude = function(name, filename, isDir) {
  var dirname = path.dirname;
  var extname = path.extname;
  var resolve = path.resolve;
  var includePath = resolve(isDir ? filename : dirname(filename), name);
  var ext = extname(name);
  if (!ext) {
    includePath += '.ejs';
  }
  return includePath;
};

/**
 * Get the path to the included file by Options
 *
 * @param  {String}  path    specified path
 * @param  {Options} options compilation options
 * @return {String}
 */
function getIncludePath(path, options) {
  var includePath;
  var filePath;
  var views = options.views;

  // Abs path
  if (path.charAt(0) == '/') {
    includePath = exports.resolveInclude(path.replace(/^\/*/,''), options.root || '/', true);
  }
  // Relative paths
  else {
    // Look relative to a passed filename first
    if (options.filename) {
      filePath = exports.resolveInclude(path, options.filename);
      if (fs.existsSync(filePath)) {
        includePath = filePath;
      }
    }
    // Then look in any views directories
    if (!includePath) {
      if (Array.isArray(views) && views.some(function (v) {
        filePath = exports.resolveInclude(path, v, true);
        return fs.existsSync(filePath);
      })) {
        includePath = filePath;
      }
    }
    if (!includePath) {
      throw new Error('Could not find the include file "' +
          options.escapeFunction(path) + '"');
    }
  }
  return includePath;
}

/**
 * Get the template from a string or a file, either compiled on-the-fly or
 * read from cache (if enabled), and cache the template if needed.
 *
 * If `template` is not set, the file specified in `options.filename` will be
 * read.
 *
 * If `options.cache` is true, this function reads the file from
 * `options.filename` so it must be set prior to calling this function.
 *
 * @memberof module:ejs-internal
 * @param {Options} options   compilation options
 * @param {String} [template] template source
 * @return {(TemplateFunction|ClientFunction)}
 * Depending on the value of `options.client`, either type might be returned.
 * @static
 */

function handleCache(options, template) {
  var func;
  var filename = options.filename;
  var hasTemplate = arguments.length > 1;

  if (options.cache) {
    if (!filename) {
      throw new Error('cache option requires a filename');
    }
    func = exports.cache.get(filename);
    if (func) {
      return func;
    }
    if (!hasTemplate) {
      template = fileLoader(filename).toString().replace(_BOM, '');
    }
  }
  else if (!hasTemplate) {
    // istanbul ignore if: should not happen at all
    if (!filename) {
      throw new Error('Internal EJS error: no file name or template '
                    + 'provided');
    }
    template = fileLoader(filename).toString().replace(_BOM, '');
  }
  func = exports.compile(template, options);
  if (options.cache) {
    exports.cache.set(filename, func);
  }
  return func;
}

/**
 * Try calling handleCache with the given options and data and call the
 * callback with the result. If an error occurs, call the callback with
 * the error. Used by renderFile().
 *
 * @memberof module:ejs-internal
 * @param {Options} options    compilation options
 * @param {Object} data        template data
 * @param {RenderFileCallback} cb callback
 * @static
 */

function tryHandleCache(options, data, cb) {
  var result;
  if (!cb) {
    if (typeof exports.promiseImpl == 'function') {
      return new exports.promiseImpl(function (resolve, reject) {
        try {
          result = handleCache(options)(data);
          resolve(result);
        }
        catch (err) {
          reject(err);
        }
      });
    }
    else {
      throw new Error('Please provide a callback function');
    }
  }
  else {
    try {
      result = handleCache(options)(data);
    }
    catch (err) {
      return cb(err);
    }

    cb(null, result);
  }
}

/**
 * fileLoader is independent
 *
 * @param {String} filePath ejs file path.
 * @return {String} The contents of the specified file.
 * @static
 */

function fileLoader(filePath){
  return exports.fileLoader(filePath);
}

/**
 * Get the template function.
 *
 * If `options.cache` is `true`, then the template is cached.
 *
 * @memberof module:ejs-internal
 * @param {String}  path    path for the specified file
 * @param {Options} options compilation options
 * @return {(TemplateFunction|ClientFunction)}
 * Depending on the value of `options.client`, either type might be returned
 * @static
 */

function includeFile(path, options) {
  var opts = utils.shallowCopy({}, options);
  opts.filename = getIncludePath(path, opts);
  return handleCache(opts);
}

/**
 * Get the JavaScript source of an included file.
 *
 * @memberof module:ejs-internal
 * @param {String}  path    path for the specified file
 * @param {Options} options compilation options
 * @return {Object}
 * @static
 */

function includeSource(path, options) {
  var opts = utils.shallowCopy({}, options);
  var includePath;
  var template;
  includePath = getIncludePath(path, opts);
  template = fileLoader(includePath).toString().replace(_BOM, '');
  opts.filename = includePath;
  var templ = new Template(template, opts);
  templ.generateSource();
  return {
    source: templ.source,
    filename: includePath,
    template: template
  };
}

/**
 * Re-throw the given `err` in context to the `str` of ejs, `filename`, and
 * `lineno`.
 *
 * @implements RethrowCallback
 * @memberof module:ejs-internal
 * @param {Error}  err      Error object
 * @param {String} str      EJS source
 * @param {String} filename file name of the EJS file
 * @param {String} lineno   line number of the error
 * @static
 */

function rethrow(err, str, flnm, lineno, esc){
  var lines = str.split('\n');
  var start = Math.max(lineno - 3, 0);
  var end = Math.min(lines.length, lineno + 3);
  var filename = esc(flnm); // eslint-disable-line
  // Error context
  var context = lines.slice(start, end).map(function (line, i){
    var curr = i + start + 1;
    return (curr == lineno ? ' >> ' : '    ')
      + curr
      + '| '
      + line;
  }).join('\n');

  // Alter exception message
  err.path = filename;
  err.message = (filename || 'ejs') + ':'
    + lineno + '\n'
    + context + '\n\n'
    + err.message;

  throw err;
}

function stripSemi(str){
  return str.replace(/;(\s*$)/, '$1');
}

/**
 * Compile the given `str` of ejs into a template function.
 *
 * @param {String}  template EJS template
 *
 * @param {Options} opts     compilation options
 *
 * @return {(TemplateFunction|ClientFunction)}
 * Depending on the value of `opts.client`, either type might be returned.
 * Note that the return type of the function also depends on the value of `opts.async`.
 * @public
 */

exports.compile = function compile(template, opts) {
  var templ;

  // v1 compat
  // 'scope' is 'context'
  // FIXME: Remove this in a future version
  if (opts && opts.scope) {
    if (!scopeOptionWarned){
      console.warn('`scope` option is deprecated and will be removed in EJS 3');
      scopeOptionWarned = true;
    }
    if (!opts.context) {
      opts.context = opts.scope;
    }
    delete opts.scope;
  }
  templ = new Template(template, opts);
  return templ.compile();
};

/**
 * Render the given `template` of ejs.
 *
 * If you would like to include options but not data, you need to explicitly
 * call this function with `data` being an empty object or `null`.
 *
 * @param {String}   template EJS template
 * @param {Object}  [data={}] template data
 * @param {Options} [opts={}] compilation and rendering options
 * @return {(String|Promise<String>)}
 * Return value type depends on `opts.async`.
 * @public
 */

exports.render = function (template, d, o) {
  var data = d || {};
  var opts = o || {};

  // No options object -- if there are optiony names
  // in the data, copy them to options
  if (arguments.length == 2) {
    utils.shallowCopyFromList(opts, data, _OPTS_PASSABLE_WITH_DATA);
  }

  return handleCache(opts, template)(data);
};

/**
 * Render an EJS file at the given `path` and callback `cb(err, str)`.
 *
 * If you would like to include options but not data, you need to explicitly
 * call this function with `data` being an empty object or `null`.
 *
 * @param {String}             path     path to the EJS file
 * @param {Object}            [data={}] template data
 * @param {Options}           [opts={}] compilation and rendering options
 * @param {RenderFileCallback} cb callback
 * @public
 */

exports.renderFile = function () {
  var args = Array.prototype.slice.call(arguments);
  var filename = args.shift();
  var cb;
  var opts = {filename: filename};
  var data;
  var viewOpts;

  // Do we have a callback?
  if (typeof arguments[arguments.length - 1] == 'function') {
    cb = args.pop();
  }
  // Do we have data/opts?
  if (args.length) {
    // Should always have data obj
    data = args.shift();
    // Normal passed opts (data obj + opts obj)
    if (args.length) {
      // Use shallowCopy so we don't pollute passed in opts obj with new vals
      utils.shallowCopy(opts, args.pop());
    }
    // Special casing for Express (settings + opts-in-data)
    else {
      // Express 3 and 4
      if (data.settings) {
        // Pull a few things from known locations
        if (data.settings.views) {
          opts.views = data.settings.views;
        }
        if (data.settings['view cache']) {
          opts.cache = true;
        }
        // Undocumented after Express 2, but still usable, esp. for
        // items that are unsafe to be passed along with data, like `root`
        viewOpts = data.settings['view options'];
        if (viewOpts) {
          utils.shallowCopy(opts, viewOpts);
        }
      }
      // Express 2 and lower, values set in app.locals, or people who just
      // want to pass options in their data. NOTE: These values will override
      // anything previously set in settings  or settings['view options']
      utils.shallowCopyFromList(opts, data, _OPTS_PASSABLE_WITH_DATA_EXPRESS);
    }
    opts.filename = filename;
  }
  else {
    data = {};
  }

  return tryHandleCache(opts, data, cb);
};

/**
 * Clear intermediate JavaScript cache. Calls {@link Cache#reset}.
 * @public
 */

exports.clearCache = function () {
  exports.cache.reset();
};

function Template(text, opts) {
  opts = opts || {};
  var options = {};
  this.templateText = text;
  this.mode = null;
  this.truncate = false;
  this.currentLine = 1;
  this.source = '';
  this.dependencies = [];
  options.client = opts.client || false;
  options.escapeFunction = opts.escape || utils.escapeXML;
  options.compileDebug = opts.compileDebug !== false;
  options.debug = !!opts.debug;
  options.filename = opts.filename;
  options.delimiter = opts.delimiter || exports.delimiter || _DEFAULT_DELIMITER;
  options.strict = opts.strict || false;
  options.context = opts.context;
  options.cache = opts.cache || false;
  options.rmWhitespace = opts.rmWhitespace;
  options.root = opts.root;
  options.outputFunctionName = opts.outputFunctionName;
  options.localsName = opts.localsName || exports.localsName || _DEFAULT_LOCALS_NAME;
  options.views = opts.views;
  options.async = opts.async;

  if (options.strict) {
    options._with = false;
  }
  else {
    options._with = typeof opts._with != 'undefined' ? opts._with : true;
  }

  this.opts = options;

  this.regex = this.createRegex();
}

Template.modes = {
  EVAL: 'eval',
  ESCAPED: 'escaped',
  RAW: 'raw',
  COMMENT: 'comment',
  LITERAL: 'literal'
};

Template.prototype = {
  createRegex: function () {
    var str = _REGEX_STRING;
    var delim = utils.escapeRegExpChars(this.opts.delimiter);
    str = str.replace(/%/g, delim);
    return new RegExp(str);
  },

  compile: function () {
    var src;
    var fn;
    var opts = this.opts;
    var prepended = '';
    var appended = '';
    var escapeFn = opts.escapeFunction;
    var asyncCtor;

    if (!this.source) {
      this.generateSource();
      prepended += '  var __output = [], __append = __output.push.bind(__output);' + '\n';
      if (opts.outputFunctionName) {
        prepended += '  var ' + opts.outputFunctionName + ' = __append;' + '\n';
      }
      if (opts._with !== false) {
        prepended +=  '  with (' + opts.localsName + ' || {}) {' + '\n';
        appended += '  }' + '\n';
      }
      appended += '  return __output.join("");' + '\n';
      this.source = prepended + this.source + appended;
    }

    if (opts.compileDebug) {
      src = 'var __line = 1' + '\n'
        + '  , __lines = ' + JSON.stringify(this.templateText) + '\n'
        + '  , __filename = ' + (opts.filename ?
        JSON.stringify(opts.filename) : 'undefined') + ';' + '\n'
        + 'try {' + '\n'
        + this.source
        + '} catch (e) {' + '\n'
        + '  rethrow(e, __lines, __filename, __line, escapeFn);' + '\n'
        + '}' + '\n';
    }
    else {
      src = this.source;
    }

    if (opts.client) {
      src = 'escapeFn = escapeFn || ' + escapeFn.toString() + ';' + '\n' + src;
      if (opts.compileDebug) {
        src = 'rethrow = rethrow || ' + rethrow.toString() + ';' + '\n' + src;
      }
    }

    if (opts.strict) {
      src = '"use strict";\n' + src;
    }
    if (opts.debug) {
      console.log(src);
    }

    try {
      if (opts.async) {
        // Have to use generated function for this, since in envs without support,
        // it breaks in parsing
        try {
          asyncCtor = (new Function('return (async function(){}).constructor;'))();
        }
        catch(e) {
          if (e instanceof SyntaxError) {
            throw new Error('This environment does not support async/await');
          }
          else {
            throw e;
          }
        }
      }
      else {
        asyncCtor = Function;
      }
      fn = new asyncCtor(opts.localsName + ', escapeFn, include, rethrow', src);
    }
    catch(e) {
      // istanbul ignore else
      if (e instanceof SyntaxError) {
        if (opts.filename) {
          e.message += ' in ' + opts.filename;
        }
        e.message += ' while compiling ejs\n\n';
        e.message += 'If the above error is not helpful, you may want to try EJS-Lint:\n';
        e.message += 'https://github.com/RyanZim/EJS-Lint';
        if (!e.async) {
          e.message += '\n';
          e.message += 'Or, if you meant to create an async function, pass async: true as an option.';
        }
      }
      throw e;
    }

    if (opts.client) {
      fn.dependencies = this.dependencies;
      return fn;
    }

    // Return a callable function which will execute the function
    // created by the source-code, with the passed data as locals
    // Adds a local `include` function which allows full recursive include
    var returnedFn = function (data) {
      var include = function (path, includeData) {
        var d = utils.shallowCopy({}, data);
        if (includeData) {
          d = utils.shallowCopy(d, includeData);
        }
        return includeFile(path, opts)(d);
      };
      return fn.apply(opts.context, [data || {}, escapeFn, include, rethrow]);
    };
    returnedFn.dependencies = this.dependencies;
    return returnedFn;
  },

  generateSource: function () {
    var opts = this.opts;

    if (opts.rmWhitespace) {
      // Have to use two separate replace here as `^` and `$` operators don't
      // work well with `\r`.
      this.templateText =
        this.templateText.replace(/\r/g, '').replace(/^\s+|\s+$/gm, '');
    }

    // Slurp spaces and tabs before <%_ and after _%>
    this.templateText =
      this.templateText.replace(/[ \t]*<%_/gm, '<%_').replace(/_%>[ \t]*/gm, '_%>');

    var self = this;
    var matches = this.parseTemplateText();
    var d = this.opts.delimiter;

    if (matches && matches.length) {
      matches.forEach(function (line, index) {
        var opening;
        var closing;
        var include;
        var includeOpts;
        var includeObj;
        var includeSrc;
        // If this is an opening tag, check for closing tags
        // FIXME: May end up with some false positives here
        // Better to store modes as k/v with '<' + delimiter as key
        // Then this can simply check against the map
        if ( line.indexOf('<' + d) === 0        // If it is a tag
          && line.indexOf('<' + d + d) !== 0) { // and is not escaped
          closing = matches[index + 2];
          if (!(closing == d + '>' || closing == '-' + d + '>' || closing == '_' + d + '>')) {
            throw new Error('Could not find matching close tag for "' + line + '".');
          }
        }
        // HACK: backward-compat `include` preprocessor directives
        if ((include = line.match(/^\s*include\s+(\S+)/))) {
          opening = matches[index - 1];
          // Must be in EVAL or RAW mode
          if (opening && (opening == '<' + d || opening == '<' + d + '-' || opening == '<' + d + '_')) {
            includeOpts = utils.shallowCopy({}, self.opts);
            includeObj = includeSource(include[1], includeOpts);
            if (self.opts.compileDebug) {
              includeSrc =
                  '    ; (function(){' + '\n'
                  + '      var __line = 1' + '\n'
                  + '      , __lines = ' + JSON.stringify(includeObj.template) + '\n'
                  + '      , __filename = ' + JSON.stringify(includeObj.filename) + ';' + '\n'
                  + '      try {' + '\n'
                  + includeObj.source
                  + '      } catch (e) {' + '\n'
                  + '        rethrow(e, __lines, __filename, __line, escapeFn);' + '\n'
                  + '      }' + '\n'
                  + '    ; }).call(this)' + '\n';
            }else{
              includeSrc = '    ; (function(){' + '\n' + includeObj.source +
                  '    ; }).call(this)' + '\n';
            }
            self.source += includeSrc;
            self.dependencies.push(exports.resolveInclude(include[1],
              includeOpts.filename));
            return;
          }
        }
        self.scanLine(line);
      });
    }

  },

  parseTemplateText: function () {
    var str = this.templateText;
    var pat = this.regex;
    var result = pat.exec(str);
    var arr = [];
    var firstPos;

    while (result) {
      firstPos = result.index;

      if (firstPos !== 0) {
        arr.push(str.substring(0, firstPos));
        str = str.slice(firstPos);
      }

      arr.push(result[0]);
      str = str.slice(result[0].length);
      result = pat.exec(str);
    }

    if (str) {
      arr.push(str);
    }

    return arr;
  },

  _addOutput: function (line) {
    if (this.truncate) {
      // Only replace single leading linebreak in the line after
      // -%> tag -- this is the single, trailing linebreak
      // after the tag that the truncation mode replaces
      // Handle Win / Unix / old Mac linebreaks -- do the \r\n
      // combo first in the regex-or
      line = line.replace(/^(?:\r\n|\r|\n)/, '');
      this.truncate = false;
    }
    else if (this.opts.rmWhitespace) {
      // rmWhitespace has already removed trailing spaces, just need
      // to remove linebreaks
      line = line.replace(/^\n/, '');
    }
    if (!line) {
      return line;
    }

    // Preserve literal slashes
    line = line.replace(/\\/g, '\\\\');

    // Convert linebreaks
    line = line.replace(/\n/g, '\\n');
    line = line.replace(/\r/g, '\\r');

    // Escape double-quotes
    // - this will be the delimiter during execution
    line = line.replace(/"/g, '\\"');
    this.source += '    ; __append("' + line + '")' + '\n';
  },

  scanLine: function (line) {
    var self = this;
    var d = this.opts.delimiter;
    var newLineCount = 0;

    newLineCount = (line.split('\n').length - 1);

    switch (line) {
    case '<' + d:
    case '<' + d + '_':
      this.mode = Template.modes.EVAL;
      break;
    case '<' + d + '=':
      this.mode = Template.modes.ESCAPED;
      break;
    case '<' + d + '-':
      this.mode = Template.modes.RAW;
      break;
    case '<' + d + '#':
      this.mode = Template.modes.COMMENT;
      break;
    case '<' + d + d:
      this.mode = Template.modes.LITERAL;
      this.source += '    ; __append("' + line.replace('<' + d + d, '<' + d) + '")' + '\n';
      break;
    case d + d + '>':
      this.mode = Template.modes.LITERAL;
      this.source += '    ; __append("' + line.replace(d + d + '>', d + '>') + '")' + '\n';
      break;
    case d + '>':
    case '-' + d + '>':
    case '_' + d + '>':
      if (this.mode == Template.modes.LITERAL) {
        this._addOutput(line);
      }

      this.mode = null;
      this.truncate = line.indexOf('-') === 0 || line.indexOf('_') === 0;
      break;
    default:
      // In script mode, depends on type of tag
      if (this.mode) {
        // If '//' is found without a line break, add a line break.
        switch (this.mode) {
        case Template.modes.EVAL:
        case Template.modes.ESCAPED:
        case Template.modes.RAW:
          if (line.lastIndexOf('//') > line.lastIndexOf('\n')) {
            line += '\n';
          }
        }
        switch (this.mode) {
        // Just executing code
        case Template.modes.EVAL:
          this.source += '    ; ' + line + '\n';
          break;
          // Exec, esc, and output
        case Template.modes.ESCAPED:
          this.source += '    ; __append(escapeFn(' + stripSemi(line) + '))' + '\n';
          break;
          // Exec and output
        case Template.modes.RAW:
          this.source += '    ; __append(' + stripSemi(line) + ')' + '\n';
          break;
        case Template.modes.COMMENT:
          // Do nothing
          break;
          // Literal <%% mode, append as raw output
        case Template.modes.LITERAL:
          this._addOutput(line);
          break;
        }
      }
      // In string mode, just add the output
      else {
        this._addOutput(line);
      }
    }

    if (self.opts.compileDebug && newLineCount) {
      this.currentLine += newLineCount;
      this.source += '    ; __line = ' + this.currentLine + '\n';
    }
  }
};

/**
 * Escape characters reserved in XML.
 *
 * This is simply an export of {@link module:utils.escapeXML}.
 *
 * If `markup` is `undefined` or `null`, the empty string is returned.
 *
 * @param {String} markup Input string
 * @return {String} Escaped string
 * @public
 * @func
 * */
exports.escapeXML = utils.escapeXML;

/**
 * Express.js support.
 *
 * This is an alias for {@link module:ejs.renderFile}, in order to support
 * Express.js out-of-the-box.
 *
 * @func
 */

exports.__express = exports.renderFile;

// Add require support
/* istanbul ignore else */
if (require.extensions) {
  require.extensions['.ejs'] = function (module, flnm) {
    var filename = flnm || /* istanbul ignore next */ module.filename;
    var options = {
      filename: filename,
      client: true
    };
    var template = fileLoader(filename).toString();
    var fn = exports.compile(template, options);
    module._compile('module.exports = ' + fn.toString() + ';', filename);
  };
}

/**
 * Version of EJS.
 *
 * @readonly
 * @type {String}
 * @public
 */

exports.VERSION = _VERSION_STRING;

/**
 * Name for detection of EJS.
 *
 * @readonly
 * @type {String}
 * @public
 */

exports.name = _NAME;

/* istanbul ignore if */
if (typeof window != 'undefined') {
  window.ejs = exports;
}

},{"../package.json":4,"./utils":3,"fs":1,"path":5}],3:[function(require,module,exports){
/*
 * EJS Embedded JavaScript templates
 * Copyright 2112 Matthew Eernisse (mde@fleegix.org)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *         http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
*/

/**
 * Private utility functions
 * @module utils
 * @private
 */

'use strict';

var regExpChars = /[|\\{}()[\]^$+*?.]/g;

/**
 * Escape characters reserved in regular expressions.
 *
 * If `string` is `undefined` or `null`, the empty string is returned.
 *
 * @param {String} string Input string
 * @return {String} Escaped string
 * @static
 * @private
 */
exports.escapeRegExpChars = function (string) {
  // istanbul ignore if
  if (!string) {
    return '';
  }
  return String(string).replace(regExpChars, '\\$&');
};

var _ENCODE_HTML_RULES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&#34;',
  "'": '&#39;'
};
var _MATCH_HTML = /[&<>'"]/g;

function encode_char(c) {
  return _ENCODE_HTML_RULES[c] || c;
}

/**
 * Stringified version of constants used by {@link module:utils.escapeXML}.
 *
 * It is used in the process of generating {@link ClientFunction}s.
 *
 * @readonly
 * @type {String}
 */

var escapeFuncStr =
  'var _ENCODE_HTML_RULES = {\n'
+ '      "&": "&amp;"\n'
+ '    , "<": "&lt;"\n'
+ '    , ">": "&gt;"\n'
+ '    , \'"\': "&#34;"\n'
+ '    , "\'": "&#39;"\n'
+ '    }\n'
+ '  , _MATCH_HTML = /[&<>\'"]/g;\n'
+ 'function encode_char(c) {\n'
+ '  return _ENCODE_HTML_RULES[c] || c;\n'
+ '};\n';

/**
 * Escape characters reserved in XML.
 *
 * If `markup` is `undefined` or `null`, the empty string is returned.
 *
 * @implements {EscapeCallback}
 * @param {String} markup Input string
 * @return {String} Escaped string
 * @static
 * @private
 */

exports.escapeXML = function (markup) {
  return markup == undefined
    ? ''
    : String(markup)
      .replace(_MATCH_HTML, encode_char);
};
exports.escapeXML.toString = function () {
  return Function.prototype.toString.call(this) + ';\n' + escapeFuncStr;
};

/**
 * Naive copy of properties from one object to another.
 * Does not recurse into non-scalar properties
 * Does not check to see if the property has a value before copying
 *
 * @param  {Object} to   Destination object
 * @param  {Object} from Source object
 * @return {Object}      Destination object
 * @static
 * @private
 */
exports.shallowCopy = function (to, from) {
  from = from || {};
  for (var p in from) {
    to[p] = from[p];
  }
  return to;
};

/**
 * Naive copy of a list of key names, from one object to another.
 * Only copies property if it is actually defined
 * Does not recurse into non-scalar properties
 *
 * @param  {Object} to   Destination object
 * @param  {Object} from Source object
 * @param  {Array} list List of properties to copy
 * @return {Object}      Destination object
 * @static
 * @private
 */
exports.shallowCopyFromList = function (to, from, list) {
  for (var i = 0; i < list.length; i++) {
    var p = list[i];
    if (typeof from[p] != 'undefined') {
      to[p] = from[p];
    }
  }
  return to;
};

/**
 * Simple in-process cache implementation. Does not implement limits of any
 * sort.
 *
 * @implements Cache
 * @static
 * @private
 */
exports.cache = {
  _data: {},
  set: function (key, val) {
    this._data[key] = val;
  },
  get: function (key) {
    return this._data[key];
  },
  reset: function () {
    this._data = {};
  }
};

},{}],4:[function(require,module,exports){
module.exports={
  "_args": [
    [
      "ejs@2.6.1",
      "/Users/aacshadhikari/Desktop/practice/darwin-street-food"
    ]
  ],
  "_development": true,
  "_from": "ejs@2.6.1",
  "_id": "ejs@2.6.1",
  "_inBundle": false,
  "_integrity": "sha512-0xy4A/twfrRCnkhfk8ErDi5DqdAsAqeGxht4xkCUrsvhhbQNs7E+4jV0CN7+NKIY0aHE72+XvqtBIXzD31ZbXQ==",
  "_location": "/ejs",
  "_phantomChildren": {},
  "_requested": {
    "type": "version",
    "registry": true,
    "raw": "ejs@2.6.1",
    "name": "ejs",
    "escapedName": "ejs",
    "rawSpec": "2.6.1",
    "saveSpec": null,
    "fetchSpec": "2.6.1"
  },
  "_requiredBy": [
    "#DEV:/"
  ],
  "_resolved": "https://registry.npmjs.org/ejs/-/ejs-2.6.1.tgz",
  "_spec": "2.6.1",
  "_where": "/Users/aacshadhikari/Desktop/practice/darwin-street-food",
  "author": {
    "name": "Matthew Eernisse",
    "email": "mde@fleegix.org",
    "url": "http://fleegix.org"
  },
  "bugs": {
    "url": "https://github.com/mde/ejs/issues"
  },
  "contributors": [
    {
      "name": "Timothy Gu",
      "email": "timothygu99@gmail.com",
      "url": "https://timothygu.github.io"
    }
  ],
  "dependencies": {},
  "description": "Embedded JavaScript templates",
  "devDependencies": {
    "browserify": "^13.1.1",
    "eslint": "^4.14.0",
    "git-directory-deploy": "^1.5.1",
    "istanbul": "~0.4.3",
    "jake": "^8.0.16",
    "jsdoc": "^3.4.0",
    "lru-cache": "^4.0.1",
    "mocha": "^5.0.5",
    "uglify-js": "^3.3.16"
  },
  "engines": {
    "node": ">=0.10.0"
  },
  "homepage": "https://github.com/mde/ejs",
  "keywords": [
    "template",
    "engine",
    "ejs"
  ],
  "license": "Apache-2.0",
  "main": "./lib/ejs.js",
  "name": "ejs",
  "repository": {
    "type": "git",
    "url": "git://github.com/mde/ejs.git"
  },
  "scripts": {
    "coverage": "istanbul cover node_modules/mocha/bin/_mocha",
    "devdoc": "jake doc[dev]",
    "doc": "jake doc",
    "lint": "eslint \"**/*.js\" Jakefile",
    "test": "jake test"
  },
  "version": "2.6.1"
}

},{}],5:[function(require,module,exports){
(function (process){
// .dirname, .basename, and .extname methods are extracted from Node.js v8.11.1,
// backported and transplited with Babel, with backwards-compat fixes

// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// resolves . and .. elements in a path array with directory names there
// must be no slashes, empty elements, or device names (c:\) in the array
// (so also no leading and trailing slashes - it does not distinguish
// relative and absolute paths)
function normalizeArray(parts, allowAboveRoot) {
  // if the path tries to go above the root, `up` ends up > 0
  var up = 0;
  for (var i = parts.length - 1; i >= 0; i--) {
    var last = parts[i];
    if (last === '.') {
      parts.splice(i, 1);
    } else if (last === '..') {
      parts.splice(i, 1);
      up++;
    } else if (up) {
      parts.splice(i, 1);
      up--;
    }
  }

  // if the path is allowed to go above the root, restore leading ..s
  if (allowAboveRoot) {
    for (; up--; up) {
      parts.unshift('..');
    }
  }

  return parts;
}

// path.resolve([from ...], to)
// posix version
exports.resolve = function() {
  var resolvedPath = '',
      resolvedAbsolute = false;

  for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
    var path = (i >= 0) ? arguments[i] : process.cwd();

    // Skip empty and invalid entries
    if (typeof path !== 'string') {
      throw new TypeError('Arguments to path.resolve must be strings');
    } else if (!path) {
      continue;
    }

    resolvedPath = path + '/' + resolvedPath;
    resolvedAbsolute = path.charAt(0) === '/';
  }

  // At this point the path should be resolved to a full absolute path, but
  // handle relative paths to be safe (might happen when process.cwd() fails)

  // Normalize the path
  resolvedPath = normalizeArray(filter(resolvedPath.split('/'), function(p) {
    return !!p;
  }), !resolvedAbsolute).join('/');

  return ((resolvedAbsolute ? '/' : '') + resolvedPath) || '.';
};

// path.normalize(path)
// posix version
exports.normalize = function(path) {
  var isAbsolute = exports.isAbsolute(path),
      trailingSlash = substr(path, -1) === '/';

  // Normalize the path
  path = normalizeArray(filter(path.split('/'), function(p) {
    return !!p;
  }), !isAbsolute).join('/');

  if (!path && !isAbsolute) {
    path = '.';
  }
  if (path && trailingSlash) {
    path += '/';
  }

  return (isAbsolute ? '/' : '') + path;
};

// posix version
exports.isAbsolute = function(path) {
  return path.charAt(0) === '/';
};

// posix version
exports.join = function() {
  var paths = Array.prototype.slice.call(arguments, 0);
  return exports.normalize(filter(paths, function(p, index) {
    if (typeof p !== 'string') {
      throw new TypeError('Arguments to path.join must be strings');
    }
    return p;
  }).join('/'));
};


// path.relative(from, to)
// posix version
exports.relative = function(from, to) {
  from = exports.resolve(from).substr(1);
  to = exports.resolve(to).substr(1);

  function trim(arr) {
    var start = 0;
    for (; start < arr.length; start++) {
      if (arr[start] !== '') break;
    }

    var end = arr.length - 1;
    for (; end >= 0; end--) {
      if (arr[end] !== '') break;
    }

    if (start > end) return [];
    return arr.slice(start, end - start + 1);
  }

  var fromParts = trim(from.split('/'));
  var toParts = trim(to.split('/'));

  var length = Math.min(fromParts.length, toParts.length);
  var samePartsLength = length;
  for (var i = 0; i < length; i++) {
    if (fromParts[i] !== toParts[i]) {
      samePartsLength = i;
      break;
    }
  }

  var outputParts = [];
  for (var i = samePartsLength; i < fromParts.length; i++) {
    outputParts.push('..');
  }

  outputParts = outputParts.concat(toParts.slice(samePartsLength));

  return outputParts.join('/');
};

exports.sep = '/';
exports.delimiter = ':';

exports.dirname = function (path) {
  if (typeof path !== 'string') path = path + '';
  if (path.length === 0) return '.';
  var code = path.charCodeAt(0);
  var hasRoot = code === 47 /*/*/;
  var end = -1;
  var matchedSlash = true;
  for (var i = path.length - 1; i >= 1; --i) {
    code = path.charCodeAt(i);
    if (code === 47 /*/*/) {
        if (!matchedSlash) {
          end = i;
          break;
        }
      } else {
      // We saw the first non-path separator
      matchedSlash = false;
    }
  }

  if (end === -1) return hasRoot ? '/' : '.';
  if (hasRoot && end === 1) {
    // return '//';
    // Backwards-compat fix:
    return '/';
  }
  return path.slice(0, end);
};

function basename(path) {
  if (typeof path !== 'string') path = path + '';

  var start = 0;
  var end = -1;
  var matchedSlash = true;
  var i;

  for (i = path.length - 1; i >= 0; --i) {
    if (path.charCodeAt(i) === 47 /*/*/) {
        // If we reached a path separator that was not part of a set of path
        // separators at the end of the string, stop now
        if (!matchedSlash) {
          start = i + 1;
          break;
        }
      } else if (end === -1) {
      // We saw the first non-path separator, mark this as the end of our
      // path component
      matchedSlash = false;
      end = i + 1;
    }
  }

  if (end === -1) return '';
  return path.slice(start, end);
}

// Uses a mixed approach for backwards-compatibility, as ext behavior changed
// in new Node.js versions, so only basename() above is backported here
exports.basename = function (path, ext) {
  var f = basename(path);
  if (ext && f.substr(-1 * ext.length) === ext) {
    f = f.substr(0, f.length - ext.length);
  }
  return f;
};

exports.extname = function (path) {
  if (typeof path !== 'string') path = path + '';
  var startDot = -1;
  var startPart = 0;
  var end = -1;
  var matchedSlash = true;
  // Track the state of characters (if any) we see before our first dot and
  // after any path separator we find
  var preDotState = 0;
  for (var i = path.length - 1; i >= 0; --i) {
    var code = path.charCodeAt(i);
    if (code === 47 /*/*/) {
        // If we reached a path separator that was not part of a set of path
        // separators at the end of the string, stop now
        if (!matchedSlash) {
          startPart = i + 1;
          break;
        }
        continue;
      }
    if (end === -1) {
      // We saw the first non-path separator, mark this as the end of our
      // extension
      matchedSlash = false;
      end = i + 1;
    }
    if (code === 46 /*.*/) {
        // If this is our first dot, mark it as the start of our extension
        if (startDot === -1)
          startDot = i;
        else if (preDotState !== 1)
          preDotState = 1;
    } else if (startDot !== -1) {
      // We saw a non-dot and non-path separator before our dot, so we should
      // have a good chance at having a non-empty extension
      preDotState = -1;
    }
  }

  if (startDot === -1 || end === -1 ||
      // We saw a non-dot character immediately before the dot
      preDotState === 0 ||
      // The (right-most) trimmed path component is exactly '..'
      preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
    return '';
  }
  return path.slice(startDot, end);
};

function filter (xs, f) {
    if (xs.filter) return xs.filter(f);
    var res = [];
    for (var i = 0; i < xs.length; i++) {
        if (f(xs[i], i, xs)) res.push(xs[i]);
    }
    return res;
}

// String.prototype.substr - negative index don't work in IE8
var substr = 'ab'.substr(-1) === 'b'
    ? function (str, start, len) { return str.substr(start, len) }
    : function (str, start, len) {
        if (start < 0) start = str.length + start;
        return str.substr(start, len);
    }
;

}).call(this,require('_process'))

},{"_process":6}],6:[function(require,module,exports){
// shim for using process in browser
var process = module.exports = {};

// cached from whatever global is present so that test runners that stub it
// don't break things.  But we need to wrap it in a try catch in case it is
// wrapped in strict mode code which doesn't define any globals.  It's inside a
// function because try/catches deoptimize in certain engines.

var cachedSetTimeout;
var cachedClearTimeout;

function defaultSetTimout() {
    throw new Error('setTimeout has not been defined');
}
function defaultClearTimeout () {
    throw new Error('clearTimeout has not been defined');
}
(function () {
    try {
        if (typeof setTimeout === 'function') {
            cachedSetTimeout = setTimeout;
        } else {
            cachedSetTimeout = defaultSetTimout;
        }
    } catch (e) {
        cachedSetTimeout = defaultSetTimout;
    }
    try {
        if (typeof clearTimeout === 'function') {
            cachedClearTimeout = clearTimeout;
        } else {
            cachedClearTimeout = defaultClearTimeout;
        }
    } catch (e) {
        cachedClearTimeout = defaultClearTimeout;
    }
} ())
function runTimeout(fun) {
    if (cachedSetTimeout === setTimeout) {
        //normal enviroments in sane situations
        return setTimeout(fun, 0);
    }
    // if setTimeout wasn't available but was latter defined
    if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
        cachedSetTimeout = setTimeout;
        return setTimeout(fun, 0);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedSetTimeout(fun, 0);
    } catch(e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't trust the global object when called normally
            return cachedSetTimeout.call(null, fun, 0);
        } catch(e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error
            return cachedSetTimeout.call(this, fun, 0);
        }
    }


}
function runClearTimeout(marker) {
    if (cachedClearTimeout === clearTimeout) {
        //normal enviroments in sane situations
        return clearTimeout(marker);
    }
    // if clearTimeout wasn't available but was latter defined
    if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
        cachedClearTimeout = clearTimeout;
        return clearTimeout(marker);
    }
    try {
        // when when somebody has screwed with setTimeout but no I.E. maddness
        return cachedClearTimeout(marker);
    } catch (e){
        try {
            // When we are in I.E. but the script has been evaled so I.E. doesn't  trust the global object when called normally
            return cachedClearTimeout.call(null, marker);
        } catch (e){
            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error.
            // Some versions of I.E. have different rules for clearTimeout vs setTimeout
            return cachedClearTimeout.call(this, marker);
        }
    }



}
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    if (!draining || !currentQueue) {
        return;
    }
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = runTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            if (currentQueue) {
                currentQueue[queueIndex].run();
            }
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    runClearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        runTimeout(drainQueue);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;
process.prependListener = noop;
process.prependOnceListener = noop;

process.listeners = function (name) { return [] }

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],7:[function(require,module,exports){
(function(self) {
  'use strict';

  if (self.fetch) {
    return
  }

  var support = {
    searchParams: 'URLSearchParams' in self,
    iterable: 'Symbol' in self && 'iterator' in Symbol,
    blob: 'FileReader' in self && 'Blob' in self && (function() {
      try {
        new Blob()
        return true
      } catch(e) {
        return false
      }
    })(),
    formData: 'FormData' in self,
    arrayBuffer: 'ArrayBuffer' in self
  }

  if (support.arrayBuffer) {
    var viewClasses = [
      '[object Int8Array]',
      '[object Uint8Array]',
      '[object Uint8ClampedArray]',
      '[object Int16Array]',
      '[object Uint16Array]',
      '[object Int32Array]',
      '[object Uint32Array]',
      '[object Float32Array]',
      '[object Float64Array]'
    ]

    var isDataView = function(obj) {
      return obj && DataView.prototype.isPrototypeOf(obj)
    }

    var isArrayBufferView = ArrayBuffer.isView || function(obj) {
      return obj && viewClasses.indexOf(Object.prototype.toString.call(obj)) > -1
    }
  }

  function normalizeName(name) {
    if (typeof name !== 'string') {
      name = String(name)
    }
    if (/[^a-z0-9\-#$%&'*+.\^_`|~]/i.test(name)) {
      throw new TypeError('Invalid character in header field name')
    }
    return name.toLowerCase()
  }

  function normalizeValue(value) {
    if (typeof value !== 'string') {
      value = String(value)
    }
    return value
  }

  // Build a destructive iterator for the value list
  function iteratorFor(items) {
    var iterator = {
      next: function() {
        var value = items.shift()
        return {done: value === undefined, value: value}
      }
    }

    if (support.iterable) {
      iterator[Symbol.iterator] = function() {
        return iterator
      }
    }

    return iterator
  }

  function Headers(headers) {
    this.map = {}

    if (headers instanceof Headers) {
      headers.forEach(function(value, name) {
        this.append(name, value)
      }, this)
    } else if (Array.isArray(headers)) {
      headers.forEach(function(header) {
        this.append(header[0], header[1])
      }, this)
    } else if (headers) {
      Object.getOwnPropertyNames(headers).forEach(function(name) {
        this.append(name, headers[name])
      }, this)
    }
  }

  Headers.prototype.append = function(name, value) {
    name = normalizeName(name)
    value = normalizeValue(value)
    var oldValue = this.map[name]
    this.map[name] = oldValue ? oldValue+','+value : value
  }

  Headers.prototype['delete'] = function(name) {
    delete this.map[normalizeName(name)]
  }

  Headers.prototype.get = function(name) {
    name = normalizeName(name)
    return this.has(name) ? this.map[name] : null
  }

  Headers.prototype.has = function(name) {
    return this.map.hasOwnProperty(normalizeName(name))
  }

  Headers.prototype.set = function(name, value) {
    this.map[normalizeName(name)] = normalizeValue(value)
  }

  Headers.prototype.forEach = function(callback, thisArg) {
    for (var name in this.map) {
      if (this.map.hasOwnProperty(name)) {
        callback.call(thisArg, this.map[name], name, this)
      }
    }
  }

  Headers.prototype.keys = function() {
    var items = []
    this.forEach(function(value, name) { items.push(name) })
    return iteratorFor(items)
  }

  Headers.prototype.values = function() {
    var items = []
    this.forEach(function(value) { items.push(value) })
    return iteratorFor(items)
  }

  Headers.prototype.entries = function() {
    var items = []
    this.forEach(function(value, name) { items.push([name, value]) })
    return iteratorFor(items)
  }

  if (support.iterable) {
    Headers.prototype[Symbol.iterator] = Headers.prototype.entries
  }

  function consumed(body) {
    if (body.bodyUsed) {
      return Promise.reject(new TypeError('Already read'))
    }
    body.bodyUsed = true
  }

  function fileReaderReady(reader) {
    return new Promise(function(resolve, reject) {
      reader.onload = function() {
        resolve(reader.result)
      }
      reader.onerror = function() {
        reject(reader.error)
      }
    })
  }

  function readBlobAsArrayBuffer(blob) {
    var reader = new FileReader()
    var promise = fileReaderReady(reader)
    reader.readAsArrayBuffer(blob)
    return promise
  }

  function readBlobAsText(blob) {
    var reader = new FileReader()
    var promise = fileReaderReady(reader)
    reader.readAsText(blob)
    return promise
  }

  function readArrayBufferAsText(buf) {
    var view = new Uint8Array(buf)
    var chars = new Array(view.length)

    for (var i = 0; i < view.length; i++) {
      chars[i] = String.fromCharCode(view[i])
    }
    return chars.join('')
  }

  function bufferClone(buf) {
    if (buf.slice) {
      return buf.slice(0)
    } else {
      var view = new Uint8Array(buf.byteLength)
      view.set(new Uint8Array(buf))
      return view.buffer
    }
  }

  function Body() {
    this.bodyUsed = false

    this._initBody = function(body) {
      this._bodyInit = body
      if (!body) {
        this._bodyText = ''
      } else if (typeof body === 'string') {
        this._bodyText = body
      } else if (support.blob && Blob.prototype.isPrototypeOf(body)) {
        this._bodyBlob = body
      } else if (support.formData && FormData.prototype.isPrototypeOf(body)) {
        this._bodyFormData = body
      } else if (support.searchParams && URLSearchParams.prototype.isPrototypeOf(body)) {
        this._bodyText = body.toString()
      } else if (support.arrayBuffer && support.blob && isDataView(body)) {
        this._bodyArrayBuffer = bufferClone(body.buffer)
        // IE 10-11 can't handle a DataView body.
        this._bodyInit = new Blob([this._bodyArrayBuffer])
      } else if (support.arrayBuffer && (ArrayBuffer.prototype.isPrototypeOf(body) || isArrayBufferView(body))) {
        this._bodyArrayBuffer = bufferClone(body)
      } else {
        throw new Error('unsupported BodyInit type')
      }

      if (!this.headers.get('content-type')) {
        if (typeof body === 'string') {
          this.headers.set('content-type', 'text/plain;charset=UTF-8')
        } else if (this._bodyBlob && this._bodyBlob.type) {
          this.headers.set('content-type', this._bodyBlob.type)
        } else if (support.searchParams && URLSearchParams.prototype.isPrototypeOf(body)) {
          this.headers.set('content-type', 'application/x-www-form-urlencoded;charset=UTF-8')
        }
      }
    }

    if (support.blob) {
      this.blob = function() {
        var rejected = consumed(this)
        if (rejected) {
          return rejected
        }

        if (this._bodyBlob) {
          return Promise.resolve(this._bodyBlob)
        } else if (this._bodyArrayBuffer) {
          return Promise.resolve(new Blob([this._bodyArrayBuffer]))
        } else if (this._bodyFormData) {
          throw new Error('could not read FormData body as blob')
        } else {
          return Promise.resolve(new Blob([this._bodyText]))
        }
      }

      this.arrayBuffer = function() {
        if (this._bodyArrayBuffer) {
          return consumed(this) || Promise.resolve(this._bodyArrayBuffer)
        } else {
          return this.blob().then(readBlobAsArrayBuffer)
        }
      }
    }

    this.text = function() {
      var rejected = consumed(this)
      if (rejected) {
        return rejected
      }

      if (this._bodyBlob) {
        return readBlobAsText(this._bodyBlob)
      } else if (this._bodyArrayBuffer) {
        return Promise.resolve(readArrayBufferAsText(this._bodyArrayBuffer))
      } else if (this._bodyFormData) {
        throw new Error('could not read FormData body as text')
      } else {
        return Promise.resolve(this._bodyText)
      }
    }

    if (support.formData) {
      this.formData = function() {
        return this.text().then(decode)
      }
    }

    this.json = function() {
      return this.text().then(JSON.parse)
    }

    return this
  }

  // HTTP methods whose capitalization should be normalized
  var methods = ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'POST', 'PUT']

  function normalizeMethod(method) {
    var upcased = method.toUpperCase()
    return (methods.indexOf(upcased) > -1) ? upcased : method
  }

  function Request(input, options) {
    options = options || {}
    var body = options.body

    if (input instanceof Request) {
      if (input.bodyUsed) {
        throw new TypeError('Already read')
      }
      this.url = input.url
      this.credentials = input.credentials
      if (!options.headers) {
        this.headers = new Headers(input.headers)
      }
      this.method = input.method
      this.mode = input.mode
      if (!body && input._bodyInit != null) {
        body = input._bodyInit
        input.bodyUsed = true
      }
    } else {
      this.url = String(input)
    }

    this.credentials = options.credentials || this.credentials || 'omit'
    if (options.headers || !this.headers) {
      this.headers = new Headers(options.headers)
    }
    this.method = normalizeMethod(options.method || this.method || 'GET')
    this.mode = options.mode || this.mode || null
    this.referrer = null

    if ((this.method === 'GET' || this.method === 'HEAD') && body) {
      throw new TypeError('Body not allowed for GET or HEAD requests')
    }
    this._initBody(body)
  }

  Request.prototype.clone = function() {
    return new Request(this, { body: this._bodyInit })
  }

  function decode(body) {
    var form = new FormData()
    body.trim().split('&').forEach(function(bytes) {
      if (bytes) {
        var split = bytes.split('=')
        var name = split.shift().replace(/\+/g, ' ')
        var value = split.join('=').replace(/\+/g, ' ')
        form.append(decodeURIComponent(name), decodeURIComponent(value))
      }
    })
    return form
  }

  function parseHeaders(rawHeaders) {
    var headers = new Headers()
    // Replace instances of \r\n and \n followed by at least one space or horizontal tab with a space
    // https://tools.ietf.org/html/rfc7230#section-3.2
    var preProcessedHeaders = rawHeaders.replace(/\r?\n[\t ]+/g, ' ')
    preProcessedHeaders.split(/\r?\n/).forEach(function(line) {
      var parts = line.split(':')
      var key = parts.shift().trim()
      if (key) {
        var value = parts.join(':').trim()
        headers.append(key, value)
      }
    })
    return headers
  }

  Body.call(Request.prototype)

  function Response(bodyInit, options) {
    if (!options) {
      options = {}
    }

    this.type = 'default'
    this.status = options.status === undefined ? 200 : options.status
    this.ok = this.status >= 200 && this.status < 300
    this.statusText = 'statusText' in options ? options.statusText : 'OK'
    this.headers = new Headers(options.headers)
    this.url = options.url || ''
    this._initBody(bodyInit)
  }

  Body.call(Response.prototype)

  Response.prototype.clone = function() {
    return new Response(this._bodyInit, {
      status: this.status,
      statusText: this.statusText,
      headers: new Headers(this.headers),
      url: this.url
    })
  }

  Response.error = function() {
    var response = new Response(null, {status: 0, statusText: ''})
    response.type = 'error'
    return response
  }

  var redirectStatuses = [301, 302, 303, 307, 308]

  Response.redirect = function(url, status) {
    if (redirectStatuses.indexOf(status) === -1) {
      throw new RangeError('Invalid status code')
    }

    return new Response(null, {status: status, headers: {location: url}})
  }

  self.Headers = Headers
  self.Request = Request
  self.Response = Response

  self.fetch = function(input, init) {
    return new Promise(function(resolve, reject) {
      var request = new Request(input, init)
      var xhr = new XMLHttpRequest()

      xhr.onload = function() {
        var options = {
          status: xhr.status,
          statusText: xhr.statusText,
          headers: parseHeaders(xhr.getAllResponseHeaders() || '')
        }
        options.url = 'responseURL' in xhr ? xhr.responseURL : options.headers.get('X-Request-URL')
        var body = 'response' in xhr ? xhr.response : xhr.responseText
        resolve(new Response(body, options))
      }

      xhr.onerror = function() {
        reject(new TypeError('Network request failed'))
      }

      xhr.ontimeout = function() {
        reject(new TypeError('Network request failed'))
      }

      xhr.open(request.method, request.url, true)

      if (request.credentials === 'include') {
        xhr.withCredentials = true
      } else if (request.credentials === 'omit') {
        xhr.withCredentials = false
      }

      if ('responseType' in xhr && support.blob) {
        xhr.responseType = 'blob'
      }

      request.headers.forEach(function(value, name) {
        xhr.setRequestHeader(name, value)
      })

      xhr.send(typeof request._bodyInit === 'undefined' ? null : request._bodyInit)
    })
  }
  self.fetch.polyfill = true
})(typeof self !== 'undefined' ? self : this);

},{}],8:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
	value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var store = 'darwin-street-food';
var version = 1;
var vendorStoreName = 'vendors';

var DBHandler = function () {
	function DBHandler() {
		_classCallCheck(this, DBHandler);

		this.pendingActions = [];
		this.connect();

		this.saveData = this.saveData.bind(this);
		this.getAllData = this.getAllData.bind(this);
		this._getAllDataForPromise = this._getAllDataForPromise.bind(this);
	}

	_createClass(DBHandler, [{
		key: 'errorHandler',
		value: function errorHandler(evt) {
			console.error('DB Error', evt.target.error);
		}
	}, {
		key: 'upgradeDB',
		value: function upgradeDB(evt) {
			var db = evt.target.result;

			if (evt.oldVersion < 1) {
				var vendorStore = db.createObjectStore(vendorStoreName, { keyPath: 'id' });
				vendorStore.createIndex('name', 'name', { unique: true });
			}
		}
	}, {
		key: 'connect',
		value: function connect() {
			var _this = this;

			var connRequest = indexedDB.open(store, version);

			connRequest.addEventListener('success', function (evt) {
				_this.db = evt.target.result;
				_this.db.addEventListener('error', _this.errorHandler);

				if (_this.pendingActions) {
					while (_this.pendingActions.length < 0) {
						_this.pendingActions.pop()();
					}
				}
			});

			connRequest.addEventListener('upgradeneeded', this.upgradeDB);

			connRequest.addEventListener('error', this.errorHandler);
		}
	}, {
		key: 'saveData',
		value: function saveData(data) {
			var _this2 = this;

			if (!this.db) {
				this.pendingActions.push(function () {
					return _this2.saveData(data);
				});
				return;
			}

			var dataArr = Array.isArray(data) ? data : [data];

			var transaction = this.db.transaction(vendorStoreName, 'readwrite');
			var vendorStore = transaction.objectStore(vendorStoreName);

			dataArr.forEach(function (vendorData) {
				return vendorStore.get(vendorData.id).onsuccess = function (evt) {
					if (evt.target.result) {
						if (JSON.stringify(evt.target.result) !== JSON.stringify(vendorData)) {
							vendorStore.put(vendorData);
						}
					} else {
						vendorStore.add(vendorData);
					}
				};
			});
		}
	}, {
		key: '_getAllDataForPromise',
		value: function _getAllDataForPromise(resolve, reject) {
			var _this3 = this;

			if (!this.db) {
				this.pendingActions.push(function () {
					return _this3._getAllDataForPromise(resolve, reject);
				});
				return;
			}
			var vendorData = [];
			var vendorStore = this.db.transaction(vendorStoreName).objectStore(vendorStoreName);
			var cursor = vendorStore.openCursor();

			cursor.onsuccess = function (evt) {
				var cursor = evt.target.result;
				if (cursor) {
					vendorData.push(cursor.value);
					return cursor.continue();
				}
				resolve(vendorData);
			};

			cursor.onerror = function (evt) {
				return reject(evt.target.error);
			};
		}
	}, {
		key: 'getAllData',
		value: function getAllData() {
			return new Promise(this._getAllDataForPromise);
		}
	}]);

	return DBHandler;
}();

exports.default = DBHandler;

},{}],9:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
	value: true
});

var _ejs = require('ejs');

var _ejs2 = _interopRequireDefault(_ejs);

var _timeConvert = require('./time-convert');

var _timeConvert2 = _interopRequireDefault(_timeConvert);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
var templateString = undefined;
var template = undefined;
var target = undefined;

var getTarget = function getTarget() {
	if (!target) {
		target = document.querySelector('main');
	}
	return target;
};

var renderDay = function renderDay(data) {
	if (!template) {
		templateString = document.getElementById('dayTemplate').innerHTML;
		template = _ejs2.default.compile(templateString);
	}

	return template(data);
};

function drawDay(day, vendors) {
	var open = [];

	vendors.forEach(function (vendor) {
		var openIndex = vendor.locations.findIndex(function (location) {
			return location.days[day].open;
		});

		if (openIndex >= 0) {
			var openLocation = vendor.locations[openIndex];
			var openDay = openLocation.days[day];

			open.push(Object.assign({}, vendor, {
				openLocation: openLocation,
				openDay: {
					day: openDay.day,
					start: (0, _timeConvert2.default)(openDay.start),
					end: (0, _timeConvert2.default)(openDay.end)
				}
			}));
		}
	});

	var content = renderDay({
		day: days[day],
		dayIndex: day,
		vendors: open
	});

	getTarget().innerHTML += content;
}

function drawDays(dayData) {
	getTarget().innerHTML = null;

	var now = new Date();
	var today = now.getDay();

	drawDay(today, dayData);
}

exports.default = drawDays;

},{"./time-convert":13,"ejs":2}],10:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
		value: true
});

var url = 'https://opendata.arcgis.com/datasets/f62cbfbf11494495984097ef8ed6a8a9_0.geojson';

function loadList() {
		return fetch(url).then(function (response) {
				return response.json();
		}).then(function (data) {
				return data.features ? data.features.map(function (feature) {
						return feature.properties;
				}) : undefined;
		});
};

exports.default = loadList;

},{}],11:[function(require,module,exports){
'use strict';

require('whatwg-fetch');

var _loadList = require('./load-list');

var _loadList2 = _interopRequireDefault(_loadList);

var _tidyList = require('./tidy-list');

var _tidyList2 = _interopRequireDefault(_tidyList);

var _drawDays = require('./draw-days');

var _drawDays2 = _interopRequireDefault(_drawDays);

var _dbHandler = require('./db-handler');

var _dbHandler2 = _interopRequireDefault(_dbHandler);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var dbHandler = new _dbHandler2.default();

dbHandler.getAllData().then(_drawDays2.default);

var fetchVendors = (0, _loadList2.default)().then(_tidyList2.default);

fetchVendors.then(_drawDays2.default);
fetchVendors.then(dbHandler.saveData);
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').then(function (registration) {
      // Registration was successful
      console.log('ServiceWorker registration successful with scope: ', registration.scope);
    }, function (err) {
      // registration failed :(
      console.log('ServiceWorker registration failed: ', err);
    });
  });
}

},{"./db-handler":8,"./draw-days":9,"./load-list":10,"./tidy-list":12,"whatwg-fetch":7}],12:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
	value: true
});

var days = {
	'Sunday': 'Sun',
	'Monday': 'Mon',
	'Tuesday': 'Tues',
	'Wednesday': 'Wed',
	'Thursday': 'Thurs',
	'Friday': 'Fri',
	'Saturday': 'Sat'
};

function tidyList(listData) {
	return listData.filter(function (record, index) {
		return listData.findIndex(function (findRecord) {
			return findRecord.Name === record.Name;
		}) === index;
	}).map(function (record) {
		return {
			id: record.OBJECTID,
			name: record.Name,
			website: record.Website,
			type: record.Type,
			locations: listData.filter(function (locationRecord) {
				return locationRecord.Name === record.Name;
			}).map(function (locationRecord) {
				return {
					name: locationRecord.Location,
					openTimes: locationRecord.Open_Times_Description,
					days: Object.keys(days).map(function (day) {
						return {
							day: day,
							open: record[day] === 'Yes',
							start: record[days[day] + '_Start'],
							end: record[days[day] + '_End']
						};
					})
				};
			})
		};
	});
}

exports.default = tidyList;

},{}],13:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, "__esModule", {
	value: true
});

/**
* Convert a 24 hour time to 12 hour
* from https://stackoverflow.com/questions/13898423/javascript-convert-24-hour-time-of-day-string-to-12-hour-time-with-am-pm-and-no
* @param {string} time A 24 hour time string
* @return {string} A formatted 12 hour time string
**/
function tConvert(time) {
	// Check correct time format and split into components
	time = time.toString().match(/^([01]\d|2[0-3])([0-5]\d)$/) || [time];

	if (time.length > 1) {
		// If time format correct
		var suffix = time[1] < 12 ? 'AM' : 'PM'; // Set AM/PM
		var hours = time[1] % 12 || 12; // Adjust hours
		var minutes = time[2];

		return hours + ':' + minutes + suffix;
	}
	return time;
}

exports.default = tConvert;

},{}]},{},[11])
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9saWIvX2VtcHR5LmpzIiwibm9kZV9tb2R1bGVzL2Vqcy9saWIvZWpzLmpzIiwibm9kZV9tb2R1bGVzL2Vqcy9saWIvdXRpbHMuanMiLCJub2RlX21vZHVsZXMvZWpzL3BhY2thZ2UuanNvbiIsIm5vZGVfbW9kdWxlcy9wYXRoLWJyb3dzZXJpZnkvaW5kZXguanMiLCJub2RlX21vZHVsZXMvcHJvY2Vzcy9icm93c2VyLmpzIiwibm9kZV9tb2R1bGVzL3doYXR3Zy1mZXRjaC9mZXRjaC5qcyIsInNyYy9qcy9kYi1oYW5kbGVyLmpzIiwic3JjL2pzL2RyYXctZGF5cy5qcyIsInNyYy9qcy9sb2FkLWxpc3QuanMiLCJzcmMvanMvc3RhcnQuanMiLCJzcmMvanMvdGlkeS1saXN0LmpzIiwic3JjL2pzL3RpbWUtY29udmVydC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBOztBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzM2QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ25GQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUM5U0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4TEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7Ozs7Ozs7Ozs7O0FDbGRBLElBQU0sUUFBUSxvQkFBZDtBQUNBLElBQU0sVUFBVSxDQUFoQjtBQUNBLElBQU0sa0JBQWtCLFNBQXhCOztJQUVNLFM7QUFDTCxzQkFBYztBQUFBOztBQUViLE9BQUssY0FBTCxHQUFzQixFQUF0QjtBQUNBLE9BQUssT0FBTDs7QUFFQSxPQUFLLFFBQUwsR0FBZ0IsS0FBSyxRQUFMLENBQWMsSUFBZCxDQUFtQixJQUFuQixDQUFoQjtBQUNBLE9BQUssVUFBTCxHQUFrQixLQUFLLFVBQUwsQ0FBZ0IsSUFBaEIsQ0FBcUIsSUFBckIsQ0FBbEI7QUFDQSxPQUFLLHFCQUFMLEdBQTZCLEtBQUsscUJBQUwsQ0FBMkIsSUFBM0IsQ0FBZ0MsSUFBaEMsQ0FBN0I7QUFDQTs7OzsrQkFFWSxHLEVBQUs7QUFDakIsV0FBUSxLQUFSLENBQWMsVUFBZCxFQUEwQixJQUFJLE1BQUosQ0FBVyxLQUFyQztBQUNBOzs7NEJBRVMsRyxFQUFLO0FBQ2QsT0FBTSxLQUFLLElBQUksTUFBSixDQUFXLE1BQXRCOztBQUVBLE9BQUcsSUFBSSxVQUFKLEdBQWlCLENBQXBCLEVBQXVCO0FBQ3RCLFFBQU0sY0FBYyxHQUFHLGlCQUFILENBQXFCLGVBQXJCLEVBQXNDLEVBQUMsU0FBUyxJQUFWLEVBQXRDLENBQXBCO0FBQ0EsZ0JBQVksV0FBWixDQUF3QixNQUF4QixFQUFnQyxNQUFoQyxFQUF3QyxFQUFDLFFBQVEsSUFBVCxFQUF4QztBQUNBO0FBQ0Q7Ozs0QkFFUztBQUFBOztBQUNULE9BQU0sY0FBYyxVQUFVLElBQVYsQ0FBZSxLQUFmLEVBQXNCLE9BQXRCLENBQXBCOztBQUVBLGVBQVksZ0JBQVosQ0FBNkIsU0FBN0IsRUFBd0MsVUFBQyxHQUFELEVBQVM7QUFDaEQsVUFBSyxFQUFMLEdBQVUsSUFBSSxNQUFKLENBQVcsTUFBckI7QUFDQSxVQUFLLEVBQUwsQ0FBUSxnQkFBUixDQUF5QixPQUF6QixFQUFrQyxNQUFLLFlBQXZDOztBQUVBLFFBQUcsTUFBSyxjQUFSLEVBQXdCO0FBQ3ZCLFlBQU0sTUFBSyxjQUFMLENBQW9CLE1BQXBCLEdBQTZCLENBQW5DLEVBQXNDO0FBQ3JDLFlBQUssY0FBTCxDQUFvQixHQUFwQjtBQUNBO0FBQ0Q7QUFDRCxJQVREOztBQVdBLGVBQVksZ0JBQVosQ0FBNkIsZUFBN0IsRUFBOEMsS0FBSyxTQUFuRDs7QUFFQSxlQUFZLGdCQUFaLENBQTZCLE9BQTdCLEVBQXNDLEtBQUssWUFBM0M7QUFDQTs7OzJCQUVRLEksRUFBTTtBQUFBOztBQUNkLE9BQUcsQ0FBQyxLQUFLLEVBQVQsRUFBYTtBQUNaLFNBQUssY0FBTCxDQUFvQixJQUFwQixDQUF5QjtBQUFBLFlBQU0sT0FBSyxRQUFMLENBQWMsSUFBZCxDQUFOO0FBQUEsS0FBekI7QUFDQTtBQUNBOztBQUVELE9BQU0sVUFBVSxNQUFNLE9BQU4sQ0FBYyxJQUFkLElBQ2IsSUFEYSxHQUViLENBQUMsSUFBRCxDQUZIOztBQUlBLE9BQU0sY0FBYyxLQUFLLEVBQUwsQ0FBUSxXQUFSLENBQW9CLGVBQXBCLEVBQXFDLFdBQXJDLENBQXBCO0FBQ0EsT0FBSSxjQUFjLFlBQVksV0FBWixDQUF3QixlQUF4QixDQUFsQjs7QUFFQSxXQUFRLE9BQVIsQ0FBZ0IsVUFBQyxVQUFEO0FBQUEsV0FBZ0IsWUFDOUIsR0FEOEIsQ0FDMUIsV0FBVyxFQURlLEVBRTlCLFNBRjhCLEdBRWxCLFVBQUMsR0FBRCxFQUFTO0FBQ3JCLFNBQUcsSUFBSSxNQUFKLENBQVcsTUFBZCxFQUFzQjtBQUNyQixVQUFHLEtBQUssU0FBTCxDQUFlLElBQUksTUFBSixDQUFXLE1BQTFCLE1BQXNDLEtBQUssU0FBTCxDQUFlLFVBQWYsQ0FBekMsRUFBcUU7QUFDcEUsbUJBQVksR0FBWixDQUFnQixVQUFoQjtBQUNBO0FBQ0QsTUFKRCxNQUlPO0FBQ04sa0JBQVksR0FBWixDQUFnQixVQUFoQjtBQUNBO0FBQ0QsS0FWYztBQUFBLElBQWhCO0FBWUE7Ozt3Q0FFcUIsTyxFQUFTLE0sRUFBUTtBQUFBOztBQUN0QyxPQUFHLENBQUMsS0FBSyxFQUFULEVBQWE7QUFDWixTQUFLLGNBQUwsQ0FBb0IsSUFBcEIsQ0FBeUI7QUFBQSxZQUFNLE9BQUsscUJBQUwsQ0FBMkIsT0FBM0IsRUFBb0MsTUFBcEMsQ0FBTjtBQUFBLEtBQXpCO0FBQ0E7QUFDQTtBQUNELE9BQU0sYUFBYSxFQUFuQjtBQUNBLE9BQU0sY0FBYyxLQUFLLEVBQUwsQ0FBUSxXQUFSLENBQW9CLGVBQXBCLEVBQXFDLFdBQXJDLENBQWlELGVBQWpELENBQXBCO0FBQ0EsT0FBTSxTQUFTLFlBQVksVUFBWixFQUFmOztBQUVBLFVBQU8sU0FBUCxHQUFtQixVQUFDLEdBQUQsRUFBUztBQUMzQixRQUFNLFNBQVMsSUFBSSxNQUFKLENBQVcsTUFBMUI7QUFDQSxRQUFHLE1BQUgsRUFBVztBQUNWLGdCQUFXLElBQVgsQ0FBZ0IsT0FBTyxLQUF2QjtBQUNBLFlBQU8sT0FBTyxRQUFQLEVBQVA7QUFDQTtBQUNELFlBQVEsVUFBUjtBQUNBLElBUEQ7O0FBU0EsVUFBTyxPQUFQLEdBQWlCLFVBQUMsR0FBRDtBQUFBLFdBQVMsT0FBTyxJQUFJLE1BQUosQ0FBVyxLQUFsQixDQUFUO0FBQUEsSUFBakI7QUFDQTs7OytCQUVZO0FBQ1osVUFBTyxJQUFJLE9BQUosQ0FBWSxLQUFLLHFCQUFqQixDQUFQO0FBQ0E7Ozs7OztrQkFLYSxTOzs7Ozs7Ozs7QUN0R2Y7Ozs7QUFDQTs7Ozs7O0FBRUEsSUFBTSxPQUFPLENBQUMsUUFBRCxFQUFXLFFBQVgsRUFBcUIsU0FBckIsRUFBZ0MsV0FBaEMsRUFBNkMsVUFBN0MsRUFBeUQsUUFBekQsRUFBbUUsVUFBbkUsQ0FBYjtBQUNBLElBQUksaUJBQWlCLFNBQXJCO0FBQ0EsSUFBSSxXQUFXLFNBQWY7QUFDQSxJQUFJLFNBQVMsU0FBYjs7QUFFQSxJQUFNLFlBQVksU0FBWixTQUFZLEdBQU07QUFDdkIsS0FBRyxDQUFDLE1BQUosRUFBWTtBQUNYLFdBQVMsU0FBUyxhQUFULENBQXVCLE1BQXZCLENBQVQ7QUFDQTtBQUNELFFBQU8sTUFBUDtBQUNBLENBTEQ7O0FBT0EsSUFBTSxZQUFZLFNBQVosU0FBWSxDQUFDLElBQUQsRUFBVTtBQUMzQixLQUFHLENBQUMsUUFBSixFQUFjO0FBQ2IsbUJBQWlCLFNBQVMsY0FBVCxDQUF3QixhQUF4QixFQUF1QyxTQUF4RDtBQUNBLGFBQVcsY0FBSSxPQUFKLENBQVksY0FBWixDQUFYO0FBQ0E7O0FBRUQsUUFBTyxTQUFTLElBQVQsQ0FBUDtBQUNBLENBUEQ7O0FBU0EsU0FBUyxPQUFULENBQWlCLEdBQWpCLEVBQXNCLE9BQXRCLEVBQStCO0FBQzlCLEtBQUksT0FBTyxFQUFYOztBQUVBLFNBQVEsT0FBUixDQUFnQixVQUFDLE1BQUQsRUFBWTtBQUMzQixNQUFJLFlBQVksT0FBTyxTQUFQLENBQWlCLFNBQWpCLENBQ2YsVUFBQyxRQUFEO0FBQUEsVUFBYyxTQUFTLElBQVQsQ0FBYyxHQUFkLEVBQW1CLElBQWpDO0FBQUEsR0FEZSxDQUFoQjs7QUFJQSxNQUFHLGFBQWEsQ0FBaEIsRUFBbUI7QUFDbEIsT0FBSSxlQUFlLE9BQU8sU0FBUCxDQUFpQixTQUFqQixDQUFuQjtBQUNBLE9BQUksVUFBVSxhQUFhLElBQWIsQ0FBa0IsR0FBbEIsQ0FBZDs7QUFFQSxRQUFLLElBQUwsQ0FBVSxPQUFPLE1BQVAsQ0FDVCxFQURTLEVBRVQsTUFGUyxFQUdUO0FBQ0MsOEJBREQ7QUFFQyxhQUFTO0FBQ1IsVUFBSyxRQUFRLEdBREw7QUFFUixZQUFPLDJCQUFZLFFBQVEsS0FBcEIsQ0FGQztBQUdSLFVBQUssMkJBQVksUUFBUSxHQUFwQjtBQUhHO0FBRlYsSUFIUyxDQUFWO0FBWUE7QUFFRCxFQXZCRDs7QUF5QkEsS0FBTSxVQUFVLFVBQVU7QUFDekIsT0FBSyxLQUFLLEdBQUwsQ0FEb0I7QUFFekIsWUFBVSxHQUZlO0FBR3pCLFdBQVM7QUFIZ0IsRUFBVixDQUFoQjs7QUFNQSxhQUFZLFNBQVosSUFBeUIsT0FBekI7QUFDQTs7QUFFRCxTQUFTLFFBQVQsQ0FBa0IsT0FBbEIsRUFBMkI7QUFDMUIsYUFBWSxTQUFaLEdBQXdCLElBQXhCOztBQUVBLEtBQUksTUFBTSxJQUFJLElBQUosRUFBVjtBQUNBLEtBQUksUUFBUSxJQUFJLE1BQUosRUFBWjs7QUFFQSxTQUFRLEtBQVIsRUFBZSxPQUFmO0FBR0E7O2tCQUVjLFE7Ozs7Ozs7OztBQ3ZFZixJQUFNLE1BQU0saUZBQVo7O0FBRUEsU0FBUyxRQUFULEdBQW9CO0FBQ25CLFNBQU8sTUFBTSxHQUFOLEVBQ0wsSUFESyxDQUNBLFVBQUMsUUFBRDtBQUFBLFdBQWMsU0FBUyxJQUFULEVBQWQ7QUFBQSxHQURBLEVBRUwsSUFGSyxDQUVBLFVBQUMsSUFBRDtBQUFBLFdBQVUsS0FBSyxRQUFMLEdBQ1osS0FBSyxRQUFMLENBQWMsR0FBZCxDQUFrQixVQUFDLE9BQUQ7QUFBQSxhQUFhLFFBQVEsVUFBckI7QUFBQSxLQUFsQixDQURZLEdBRVosU0FGRTtBQUFBLEdBRkEsQ0FBUDtBQU9BOztrQkFFYyxROzs7OztBQ2JmOztBQUNBOzs7O0FBQ0E7Ozs7QUFDQTs7OztBQUNBOzs7Ozs7QUFFQSxJQUFNLFlBQVksSUFBSSxtQkFBSixFQUFsQjs7QUFFQSxVQUFVLFVBQVYsR0FDRSxJQURGLENBQ08sa0JBRFA7O0FBR0EsSUFBTSxlQUFlLDBCQUNuQixJQURtQixDQUNkLGtCQURjLENBQXJCOztBQUdBLGFBQWEsSUFBYixDQUFrQixrQkFBbEI7QUFDQSxhQUFhLElBQWIsQ0FBa0IsVUFBVSxRQUE1QjtBQUNBLElBQUksbUJBQW1CLFNBQXZCLEVBQWtDO0FBQ2hDLFNBQU8sZ0JBQVAsQ0FBd0IsTUFBeEIsRUFBZ0MsWUFBVztBQUN6QyxjQUFVLGFBQVYsQ0FBd0IsUUFBeEIsQ0FBaUMsT0FBakMsRUFBMEMsSUFBMUMsQ0FBK0MsVUFBUyxZQUFULEVBQXVCO0FBQ3BFO0FBQ0EsY0FBUSxHQUFSLENBQVksb0RBQVosRUFBa0UsYUFBYSxLQUEvRTtBQUNELEtBSEQsRUFHRyxVQUFTLEdBQVQsRUFBYztBQUNmO0FBQ0EsY0FBUSxHQUFSLENBQVkscUNBQVosRUFBbUQsR0FBbkQ7QUFDRCxLQU5EO0FBT0QsR0FSRDtBQVNEOzs7Ozs7Ozs7QUN6QkQsSUFBTSxPQUFPO0FBQ1osV0FBVSxLQURFO0FBRVosV0FBVSxLQUZFO0FBR1osWUFBVyxNQUhDO0FBSVosY0FBYSxLQUpEO0FBS1osYUFBWSxPQUxBO0FBTVosV0FBVSxLQU5FO0FBT1osYUFBWTtBQVBBLENBQWI7O0FBV0EsU0FBUyxRQUFULENBQWtCLFFBQWxCLEVBQTRCO0FBQzNCLFFBQU8sU0FBUyxNQUFULENBQWdCLFVBQUMsTUFBRCxFQUFTLEtBQVQ7QUFBQSxTQUFtQixTQUFTLFNBQVQsQ0FBbUIsVUFBQyxVQUFEO0FBQUEsVUFBZ0IsV0FBVyxJQUFYLEtBQW9CLE9BQU8sSUFBM0M7QUFBQSxHQUFuQixNQUF3RSxLQUEzRjtBQUFBLEVBQWhCLEVBQ0wsR0FESyxDQUNELFVBQUMsTUFBRDtBQUFBLFNBQWE7QUFDakIsT0FBSSxPQUFPLFFBRE07QUFFakIsU0FBTSxPQUFPLElBRkk7QUFHakIsWUFBUyxPQUFPLE9BSEM7QUFJakIsU0FBTSxPQUFPLElBSkk7QUFLakIsY0FBVyxTQUFTLE1BQVQsQ0FBZ0IsVUFBQyxjQUFEO0FBQUEsV0FBb0IsZUFBZSxJQUFmLEtBQXdCLE9BQU8sSUFBbkQ7QUFBQSxJQUFoQixFQUNULEdBRFMsQ0FDTCxVQUFDLGNBQUQ7QUFBQSxXQUFxQjtBQUN6QixXQUFNLGVBQWUsUUFESTtBQUV6QixnQkFBVyxlQUFlLHNCQUZEO0FBR3pCLFdBQU0sT0FBTyxJQUFQLENBQVksSUFBWixFQUNKLEdBREksQ0FDQSxVQUFDLEdBQUQ7QUFBQSxhQUFVO0FBQ2QsZUFEYztBQUVkLGFBQU0sT0FBTyxHQUFQLE1BQWdCLEtBRlI7QUFHZCxjQUFPLE9BQVUsS0FBSyxHQUFMLENBQVYsWUFITztBQUlkLFlBQUssT0FBVSxLQUFLLEdBQUwsQ0FBVjtBQUpTLE9BQVY7QUFBQSxNQURBO0FBSG1CLEtBQXJCO0FBQUEsSUFESztBQUxNLEdBQWI7QUFBQSxFQURDLENBQVA7QUFtQkE7O2tCQUVjLFE7Ozs7Ozs7OztBQ2pDZjs7Ozs7O0FBTUEsU0FBUyxRQUFULENBQW1CLElBQW5CLEVBQXlCO0FBQ3hCO0FBQ0EsUUFBTyxLQUFLLFFBQUwsR0FBaUIsS0FBakIsQ0FBd0IsNEJBQXhCLEtBQXlELENBQUMsSUFBRCxDQUFoRTs7QUFFQSxLQUFJLEtBQUssTUFBTCxHQUFjLENBQWxCLEVBQXFCO0FBQUU7QUFDdEIsTUFBTSxTQUFTLEtBQUssQ0FBTCxJQUFVLEVBQVYsR0FBZSxJQUFmLEdBQXNCLElBQXJDLENBRG9CLENBQ3VCO0FBQzNDLE1BQU0sUUFBUSxLQUFLLENBQUwsSUFBVSxFQUFWLElBQWdCLEVBQTlCLENBRm9CLENBRWM7QUFDbEMsTUFBTSxVQUFVLEtBQUssQ0FBTCxDQUFoQjs7QUFFQSxTQUFVLEtBQVYsU0FBbUIsT0FBbkIsR0FBNkIsTUFBN0I7QUFDQTtBQUNELFFBQU8sSUFBUDtBQUNBOztrQkFFYyxRIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24oKXtmdW5jdGlvbiByKGUsbix0KXtmdW5jdGlvbiBvKGksZil7aWYoIW5baV0pe2lmKCFlW2ldKXt2YXIgYz1cImZ1bmN0aW9uXCI9PXR5cGVvZiByZXF1aXJlJiZyZXF1aXJlO2lmKCFmJiZjKXJldHVybiBjKGksITApO2lmKHUpcmV0dXJuIHUoaSwhMCk7dmFyIGE9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitpK1wiJ1wiKTt0aHJvdyBhLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsYX12YXIgcD1uW2ldPXtleHBvcnRzOnt9fTtlW2ldWzBdLmNhbGwocC5leHBvcnRzLGZ1bmN0aW9uKHIpe3ZhciBuPWVbaV1bMV1bcl07cmV0dXJuIG8obnx8cil9LHAscC5leHBvcnRzLHIsZSxuLHQpfXJldHVybiBuW2ldLmV4cG9ydHN9Zm9yKHZhciB1PVwiZnVuY3Rpb25cIj09dHlwZW9mIHJlcXVpcmUmJnJlcXVpcmUsaT0wO2k8dC5sZW5ndGg7aSsrKW8odFtpXSk7cmV0dXJuIG99cmV0dXJuIHJ9KSgpIiwiIiwiLypcbiAqIEVKUyBFbWJlZGRlZCBKYXZhU2NyaXB0IHRlbXBsYXRlc1xuICogQ29weXJpZ2h0IDIxMTIgTWF0dGhldyBFZXJuaXNzZSAobWRlQGZsZWVnaXgub3JnKVxuICpcbiAqIExpY2Vuc2VkIHVuZGVyIHRoZSBBcGFjaGUgTGljZW5zZSwgVmVyc2lvbiAyLjAgKHRoZSBcIkxpY2Vuc2VcIik7XG4gKiB5b3UgbWF5IG5vdCB1c2UgdGhpcyBmaWxlIGV4Y2VwdCBpbiBjb21wbGlhbmNlIHdpdGggdGhlIExpY2Vuc2UuXG4gKiBZb3UgbWF5IG9idGFpbiBhIGNvcHkgb2YgdGhlIExpY2Vuc2UgYXRcbiAqXG4gKiAgICAgICAgIGh0dHA6Ly93d3cuYXBhY2hlLm9yZy9saWNlbnNlcy9MSUNFTlNFLTIuMFxuICpcbiAqIFVubGVzcyByZXF1aXJlZCBieSBhcHBsaWNhYmxlIGxhdyBvciBhZ3JlZWQgdG8gaW4gd3JpdGluZywgc29mdHdhcmVcbiAqIGRpc3RyaWJ1dGVkIHVuZGVyIHRoZSBMaWNlbnNlIGlzIGRpc3RyaWJ1dGVkIG9uIGFuIFwiQVMgSVNcIiBCQVNJUyxcbiAqIFdJVEhPVVQgV0FSUkFOVElFUyBPUiBDT05ESVRJT05TIE9GIEFOWSBLSU5ELCBlaXRoZXIgZXhwcmVzcyBvciBpbXBsaWVkLlxuICogU2VlIHRoZSBMaWNlbnNlIGZvciB0aGUgc3BlY2lmaWMgbGFuZ3VhZ2UgZ292ZXJuaW5nIHBlcm1pc3Npb25zIGFuZFxuICogbGltaXRhdGlvbnMgdW5kZXIgdGhlIExpY2Vuc2UuXG4gKlxuKi9cblxuJ3VzZSBzdHJpY3QnO1xuXG4vKipcbiAqIEBmaWxlIEVtYmVkZGVkIEphdmFTY3JpcHQgdGVtcGxhdGluZyBlbmdpbmUuIHtAbGluayBodHRwOi8vZWpzLmNvfVxuICogQGF1dGhvciBNYXR0aGV3IEVlcm5pc3NlIDxtZGVAZmxlZWdpeC5vcmc+XG4gKiBAYXV0aG9yIFRpYW5jaGVuZyBcIlRpbW90aHlcIiBHdSA8dGltb3RoeWd1OTlAZ21haWwuY29tPlxuICogQHByb2plY3QgRUpTXG4gKiBAbGljZW5zZSB7QGxpbmsgaHR0cDovL3d3dy5hcGFjaGUub3JnL2xpY2Vuc2VzL0xJQ0VOU0UtMi4wIEFwYWNoZSBMaWNlbnNlLCBWZXJzaW9uIDIuMH1cbiAqL1xuXG4vKipcbiAqIEVKUyBpbnRlcm5hbCBmdW5jdGlvbnMuXG4gKlxuICogVGVjaG5pY2FsbHkgdGhpcyBcIm1vZHVsZVwiIGxpZXMgaW4gdGhlIHNhbWUgZmlsZSBhcyB7QGxpbmsgbW9kdWxlOmVqc30sIGZvclxuICogdGhlIHNha2Ugb2Ygb3JnYW5pemF0aW9uIGFsbCB0aGUgcHJpdmF0ZSBmdW5jdGlvbnMgcmUgZ3JvdXBlZCBpbnRvIHRoaXNcbiAqIG1vZHVsZS5cbiAqXG4gKiBAbW9kdWxlIGVqcy1pbnRlcm5hbFxuICogQHByaXZhdGVcbiAqL1xuXG4vKipcbiAqIEVtYmVkZGVkIEphdmFTY3JpcHQgdGVtcGxhdGluZyBlbmdpbmUuXG4gKlxuICogQG1vZHVsZSBlanNcbiAqIEBwdWJsaWNcbiAqL1xuXG52YXIgZnMgPSByZXF1aXJlKCdmcycpO1xudmFyIHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzJyk7XG5cbnZhciBzY29wZU9wdGlvbldhcm5lZCA9IGZhbHNlO1xudmFyIF9WRVJTSU9OX1NUUklORyA9IHJlcXVpcmUoJy4uL3BhY2thZ2UuanNvbicpLnZlcnNpb247XG52YXIgX0RFRkFVTFRfREVMSU1JVEVSID0gJyUnO1xudmFyIF9ERUZBVUxUX0xPQ0FMU19OQU1FID0gJ2xvY2Fscyc7XG52YXIgX05BTUUgPSAnZWpzJztcbnZhciBfUkVHRVhfU1RSSU5HID0gJyg8JSV8JSU+fDwlPXw8JS18PCVffDwlI3w8JXwlPnwtJT58XyU+KSc7XG52YXIgX09QVFNfUEFTU0FCTEVfV0lUSF9EQVRBID0gWydkZWxpbWl0ZXInLCAnc2NvcGUnLCAnY29udGV4dCcsICdkZWJ1ZycsICdjb21waWxlRGVidWcnLFxuICAnY2xpZW50JywgJ193aXRoJywgJ3JtV2hpdGVzcGFjZScsICdzdHJpY3QnLCAnZmlsZW5hbWUnLCAnYXN5bmMnXTtcbi8vIFdlIGRvbid0IGFsbG93ICdjYWNoZScgb3B0aW9uIHRvIGJlIHBhc3NlZCBpbiB0aGUgZGF0YSBvYmogZm9yXG4vLyB0aGUgbm9ybWFsIGByZW5kZXJgIGNhbGwsIGJ1dCB0aGlzIGlzIHdoZXJlIEV4cHJlc3MgMiAmIDMgcHV0IGl0XG4vLyBzbyB3ZSBtYWtlIGFuIGV4Y2VwdGlvbiBmb3IgYHJlbmRlckZpbGVgXG52YXIgX09QVFNfUEFTU0FCTEVfV0lUSF9EQVRBX0VYUFJFU1MgPSBfT1BUU19QQVNTQUJMRV9XSVRIX0RBVEEuY29uY2F0KCdjYWNoZScpO1xudmFyIF9CT00gPSAvXlxcdUZFRkYvO1xuXG4vKipcbiAqIEVKUyB0ZW1wbGF0ZSBmdW5jdGlvbiBjYWNoZS4gVGhpcyBjYW4gYmUgYSBMUlUgb2JqZWN0IGZyb20gbHJ1LWNhY2hlIE5QTVxuICogbW9kdWxlLiBCeSBkZWZhdWx0LCBpdCBpcyB7QGxpbmsgbW9kdWxlOnV0aWxzLmNhY2hlfSwgYSBzaW1wbGUgaW4tcHJvY2Vzc1xuICogY2FjaGUgdGhhdCBncm93cyBjb250aW51b3VzbHkuXG4gKlxuICogQHR5cGUge0NhY2hlfVxuICovXG5cbmV4cG9ydHMuY2FjaGUgPSB1dGlscy5jYWNoZTtcblxuLyoqXG4gKiBDdXN0b20gZmlsZSBsb2FkZXIuIFVzZWZ1bCBmb3IgdGVtcGxhdGUgcHJlcHJvY2Vzc2luZyBvciByZXN0cmljdGluZyBhY2Nlc3NcbiAqIHRvIGEgY2VydGFpbiBwYXJ0IG9mIHRoZSBmaWxlc3lzdGVtLlxuICpcbiAqIEB0eXBlIHtmaWxlTG9hZGVyfVxuICovXG5cbmV4cG9ydHMuZmlsZUxvYWRlciA9IGZzLnJlYWRGaWxlU3luYztcblxuLyoqXG4gKiBOYW1lIG9mIHRoZSBvYmplY3QgY29udGFpbmluZyB0aGUgbG9jYWxzLlxuICpcbiAqIFRoaXMgdmFyaWFibGUgaXMgb3ZlcnJpZGRlbiBieSB7QGxpbmsgT3B0aW9uc31gLmxvY2Fsc05hbWVgIGlmIGl0IGlzIG5vdFxuICogYHVuZGVmaW5lZGAuXG4gKlxuICogQHR5cGUge1N0cmluZ31cbiAqIEBwdWJsaWNcbiAqL1xuXG5leHBvcnRzLmxvY2Fsc05hbWUgPSBfREVGQVVMVF9MT0NBTFNfTkFNRTtcblxuLyoqXG4gKiBQcm9taXNlIGltcGxlbWVudGF0aW9uIC0tIGRlZmF1bHRzIHRvIHRoZSBuYXRpdmUgaW1wbGVtZW50YXRpb24gaWYgYXZhaWxhYmxlXG4gKiBUaGlzIGlzIG1vc3RseSBqdXN0IGZvciB0ZXN0YWJpbGl0eVxuICpcbiAqIEB0eXBlIHtGdW5jdGlvbn1cbiAqIEBwdWJsaWNcbiAqL1xuXG5leHBvcnRzLnByb21pc2VJbXBsID0gKG5ldyBGdW5jdGlvbigncmV0dXJuIHRoaXM7JykpKCkuUHJvbWlzZTtcblxuLyoqXG4gKiBHZXQgdGhlIHBhdGggdG8gdGhlIGluY2x1ZGVkIGZpbGUgZnJvbSB0aGUgcGFyZW50IGZpbGUgcGF0aCBhbmQgdGhlXG4gKiBzcGVjaWZpZWQgcGF0aC5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gIG5hbWUgICAgIHNwZWNpZmllZCBwYXRoXG4gKiBAcGFyYW0ge1N0cmluZ30gIGZpbGVuYW1lIHBhcmVudCBmaWxlIHBhdGhcbiAqIEBwYXJhbSB7Qm9vbGVhbn0gaXNEaXIgICAgcGFyZW50IGZpbGUgcGF0aCB3aGV0aGVyIGlzIGRpcmVjdG9yeVxuICogQHJldHVybiB7U3RyaW5nfVxuICovXG5leHBvcnRzLnJlc29sdmVJbmNsdWRlID0gZnVuY3Rpb24obmFtZSwgZmlsZW5hbWUsIGlzRGlyKSB7XG4gIHZhciBkaXJuYW1lID0gcGF0aC5kaXJuYW1lO1xuICB2YXIgZXh0bmFtZSA9IHBhdGguZXh0bmFtZTtcbiAgdmFyIHJlc29sdmUgPSBwYXRoLnJlc29sdmU7XG4gIHZhciBpbmNsdWRlUGF0aCA9IHJlc29sdmUoaXNEaXIgPyBmaWxlbmFtZSA6IGRpcm5hbWUoZmlsZW5hbWUpLCBuYW1lKTtcbiAgdmFyIGV4dCA9IGV4dG5hbWUobmFtZSk7XG4gIGlmICghZXh0KSB7XG4gICAgaW5jbHVkZVBhdGggKz0gJy5lanMnO1xuICB9XG4gIHJldHVybiBpbmNsdWRlUGF0aDtcbn07XG5cbi8qKlxuICogR2V0IHRoZSBwYXRoIHRvIHRoZSBpbmNsdWRlZCBmaWxlIGJ5IE9wdGlvbnNcbiAqXG4gKiBAcGFyYW0gIHtTdHJpbmd9ICBwYXRoICAgIHNwZWNpZmllZCBwYXRoXG4gKiBAcGFyYW0gIHtPcHRpb25zfSBvcHRpb25zIGNvbXBpbGF0aW9uIG9wdGlvbnNcbiAqIEByZXR1cm4ge1N0cmluZ31cbiAqL1xuZnVuY3Rpb24gZ2V0SW5jbHVkZVBhdGgocGF0aCwgb3B0aW9ucykge1xuICB2YXIgaW5jbHVkZVBhdGg7XG4gIHZhciBmaWxlUGF0aDtcbiAgdmFyIHZpZXdzID0gb3B0aW9ucy52aWV3cztcblxuICAvLyBBYnMgcGF0aFxuICBpZiAocGF0aC5jaGFyQXQoMCkgPT0gJy8nKSB7XG4gICAgaW5jbHVkZVBhdGggPSBleHBvcnRzLnJlc29sdmVJbmNsdWRlKHBhdGgucmVwbGFjZSgvXlxcLyovLCcnKSwgb3B0aW9ucy5yb290IHx8ICcvJywgdHJ1ZSk7XG4gIH1cbiAgLy8gUmVsYXRpdmUgcGF0aHNcbiAgZWxzZSB7XG4gICAgLy8gTG9vayByZWxhdGl2ZSB0byBhIHBhc3NlZCBmaWxlbmFtZSBmaXJzdFxuICAgIGlmIChvcHRpb25zLmZpbGVuYW1lKSB7XG4gICAgICBmaWxlUGF0aCA9IGV4cG9ydHMucmVzb2x2ZUluY2x1ZGUocGF0aCwgb3B0aW9ucy5maWxlbmFtZSk7XG4gICAgICBpZiAoZnMuZXhpc3RzU3luYyhmaWxlUGF0aCkpIHtcbiAgICAgICAgaW5jbHVkZVBhdGggPSBmaWxlUGF0aDtcbiAgICAgIH1cbiAgICB9XG4gICAgLy8gVGhlbiBsb29rIGluIGFueSB2aWV3cyBkaXJlY3Rvcmllc1xuICAgIGlmICghaW5jbHVkZVBhdGgpIHtcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KHZpZXdzKSAmJiB2aWV3cy5zb21lKGZ1bmN0aW9uICh2KSB7XG4gICAgICAgIGZpbGVQYXRoID0gZXhwb3J0cy5yZXNvbHZlSW5jbHVkZShwYXRoLCB2LCB0cnVlKTtcbiAgICAgICAgcmV0dXJuIGZzLmV4aXN0c1N5bmMoZmlsZVBhdGgpO1xuICAgICAgfSkpIHtcbiAgICAgICAgaW5jbHVkZVBhdGggPSBmaWxlUGF0aDtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKCFpbmNsdWRlUGF0aCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdDb3VsZCBub3QgZmluZCB0aGUgaW5jbHVkZSBmaWxlIFwiJyArXG4gICAgICAgICAgb3B0aW9ucy5lc2NhcGVGdW5jdGlvbihwYXRoKSArICdcIicpO1xuICAgIH1cbiAgfVxuICByZXR1cm4gaW5jbHVkZVBhdGg7XG59XG5cbi8qKlxuICogR2V0IHRoZSB0ZW1wbGF0ZSBmcm9tIGEgc3RyaW5nIG9yIGEgZmlsZSwgZWl0aGVyIGNvbXBpbGVkIG9uLXRoZS1mbHkgb3JcbiAqIHJlYWQgZnJvbSBjYWNoZSAoaWYgZW5hYmxlZCksIGFuZCBjYWNoZSB0aGUgdGVtcGxhdGUgaWYgbmVlZGVkLlxuICpcbiAqIElmIGB0ZW1wbGF0ZWAgaXMgbm90IHNldCwgdGhlIGZpbGUgc3BlY2lmaWVkIGluIGBvcHRpb25zLmZpbGVuYW1lYCB3aWxsIGJlXG4gKiByZWFkLlxuICpcbiAqIElmIGBvcHRpb25zLmNhY2hlYCBpcyB0cnVlLCB0aGlzIGZ1bmN0aW9uIHJlYWRzIHRoZSBmaWxlIGZyb21cbiAqIGBvcHRpb25zLmZpbGVuYW1lYCBzbyBpdCBtdXN0IGJlIHNldCBwcmlvciB0byBjYWxsaW5nIHRoaXMgZnVuY3Rpb24uXG4gKlxuICogQG1lbWJlcm9mIG1vZHVsZTplanMtaW50ZXJuYWxcbiAqIEBwYXJhbSB7T3B0aW9uc30gb3B0aW9ucyAgIGNvbXBpbGF0aW9uIG9wdGlvbnNcbiAqIEBwYXJhbSB7U3RyaW5nfSBbdGVtcGxhdGVdIHRlbXBsYXRlIHNvdXJjZVxuICogQHJldHVybiB7KFRlbXBsYXRlRnVuY3Rpb258Q2xpZW50RnVuY3Rpb24pfVxuICogRGVwZW5kaW5nIG9uIHRoZSB2YWx1ZSBvZiBgb3B0aW9ucy5jbGllbnRgLCBlaXRoZXIgdHlwZSBtaWdodCBiZSByZXR1cm5lZC5cbiAqIEBzdGF0aWNcbiAqL1xuXG5mdW5jdGlvbiBoYW5kbGVDYWNoZShvcHRpb25zLCB0ZW1wbGF0ZSkge1xuICB2YXIgZnVuYztcbiAgdmFyIGZpbGVuYW1lID0gb3B0aW9ucy5maWxlbmFtZTtcbiAgdmFyIGhhc1RlbXBsYXRlID0gYXJndW1lbnRzLmxlbmd0aCA+IDE7XG5cbiAgaWYgKG9wdGlvbnMuY2FjaGUpIHtcbiAgICBpZiAoIWZpbGVuYW1lKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ2NhY2hlIG9wdGlvbiByZXF1aXJlcyBhIGZpbGVuYW1lJyk7XG4gICAgfVxuICAgIGZ1bmMgPSBleHBvcnRzLmNhY2hlLmdldChmaWxlbmFtZSk7XG4gICAgaWYgKGZ1bmMpIHtcbiAgICAgIHJldHVybiBmdW5jO1xuICAgIH1cbiAgICBpZiAoIWhhc1RlbXBsYXRlKSB7XG4gICAgICB0ZW1wbGF0ZSA9IGZpbGVMb2FkZXIoZmlsZW5hbWUpLnRvU3RyaW5nKCkucmVwbGFjZShfQk9NLCAnJyk7XG4gICAgfVxuICB9XG4gIGVsc2UgaWYgKCFoYXNUZW1wbGF0ZSkge1xuICAgIC8vIGlzdGFuYnVsIGlnbm9yZSBpZjogc2hvdWxkIG5vdCBoYXBwZW4gYXQgYWxsXG4gICAgaWYgKCFmaWxlbmFtZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnRlcm5hbCBFSlMgZXJyb3I6IG5vIGZpbGUgbmFtZSBvciB0ZW1wbGF0ZSAnXG4gICAgICAgICAgICAgICAgICAgICsgJ3Byb3ZpZGVkJyk7XG4gICAgfVxuICAgIHRlbXBsYXRlID0gZmlsZUxvYWRlcihmaWxlbmFtZSkudG9TdHJpbmcoKS5yZXBsYWNlKF9CT00sICcnKTtcbiAgfVxuICBmdW5jID0gZXhwb3J0cy5jb21waWxlKHRlbXBsYXRlLCBvcHRpb25zKTtcbiAgaWYgKG9wdGlvbnMuY2FjaGUpIHtcbiAgICBleHBvcnRzLmNhY2hlLnNldChmaWxlbmFtZSwgZnVuYyk7XG4gIH1cbiAgcmV0dXJuIGZ1bmM7XG59XG5cbi8qKlxuICogVHJ5IGNhbGxpbmcgaGFuZGxlQ2FjaGUgd2l0aCB0aGUgZ2l2ZW4gb3B0aW9ucyBhbmQgZGF0YSBhbmQgY2FsbCB0aGVcbiAqIGNhbGxiYWNrIHdpdGggdGhlIHJlc3VsdC4gSWYgYW4gZXJyb3Igb2NjdXJzLCBjYWxsIHRoZSBjYWxsYmFjayB3aXRoXG4gKiB0aGUgZXJyb3IuIFVzZWQgYnkgcmVuZGVyRmlsZSgpLlxuICpcbiAqIEBtZW1iZXJvZiBtb2R1bGU6ZWpzLWludGVybmFsXG4gKiBAcGFyYW0ge09wdGlvbnN9IG9wdGlvbnMgICAgY29tcGlsYXRpb24gb3B0aW9uc1xuICogQHBhcmFtIHtPYmplY3R9IGRhdGEgICAgICAgIHRlbXBsYXRlIGRhdGFcbiAqIEBwYXJhbSB7UmVuZGVyRmlsZUNhbGxiYWNrfSBjYiBjYWxsYmFja1xuICogQHN0YXRpY1xuICovXG5cbmZ1bmN0aW9uIHRyeUhhbmRsZUNhY2hlKG9wdGlvbnMsIGRhdGEsIGNiKSB7XG4gIHZhciByZXN1bHQ7XG4gIGlmICghY2IpIHtcbiAgICBpZiAodHlwZW9mIGV4cG9ydHMucHJvbWlzZUltcGwgPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgcmV0dXJuIG5ldyBleHBvcnRzLnByb21pc2VJbXBsKGZ1bmN0aW9uIChyZXNvbHZlLCByZWplY3QpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICByZXN1bHQgPSBoYW5kbGVDYWNoZShvcHRpb25zKShkYXRhKTtcbiAgICAgICAgICByZXNvbHZlKHJlc3VsdCk7XG4gICAgICAgIH1cbiAgICAgICAgY2F0Y2ggKGVycikge1xuICAgICAgICAgIHJlamVjdChlcnIpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1BsZWFzZSBwcm92aWRlIGEgY2FsbGJhY2sgZnVuY3Rpb24nKTtcbiAgICB9XG4gIH1cbiAgZWxzZSB7XG4gICAgdHJ5IHtcbiAgICAgIHJlc3VsdCA9IGhhbmRsZUNhY2hlKG9wdGlvbnMpKGRhdGEpO1xuICAgIH1cbiAgICBjYXRjaCAoZXJyKSB7XG4gICAgICByZXR1cm4gY2IoZXJyKTtcbiAgICB9XG5cbiAgICBjYihudWxsLCByZXN1bHQpO1xuICB9XG59XG5cbi8qKlxuICogZmlsZUxvYWRlciBpcyBpbmRlcGVuZGVudFxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBmaWxlUGF0aCBlanMgZmlsZSBwYXRoLlxuICogQHJldHVybiB7U3RyaW5nfSBUaGUgY29udGVudHMgb2YgdGhlIHNwZWNpZmllZCBmaWxlLlxuICogQHN0YXRpY1xuICovXG5cbmZ1bmN0aW9uIGZpbGVMb2FkZXIoZmlsZVBhdGgpe1xuICByZXR1cm4gZXhwb3J0cy5maWxlTG9hZGVyKGZpbGVQYXRoKTtcbn1cblxuLyoqXG4gKiBHZXQgdGhlIHRlbXBsYXRlIGZ1bmN0aW9uLlxuICpcbiAqIElmIGBvcHRpb25zLmNhY2hlYCBpcyBgdHJ1ZWAsIHRoZW4gdGhlIHRlbXBsYXRlIGlzIGNhY2hlZC5cbiAqXG4gKiBAbWVtYmVyb2YgbW9kdWxlOmVqcy1pbnRlcm5hbFxuICogQHBhcmFtIHtTdHJpbmd9ICBwYXRoICAgIHBhdGggZm9yIHRoZSBzcGVjaWZpZWQgZmlsZVxuICogQHBhcmFtIHtPcHRpb25zfSBvcHRpb25zIGNvbXBpbGF0aW9uIG9wdGlvbnNcbiAqIEByZXR1cm4geyhUZW1wbGF0ZUZ1bmN0aW9ufENsaWVudEZ1bmN0aW9uKX1cbiAqIERlcGVuZGluZyBvbiB0aGUgdmFsdWUgb2YgYG9wdGlvbnMuY2xpZW50YCwgZWl0aGVyIHR5cGUgbWlnaHQgYmUgcmV0dXJuZWRcbiAqIEBzdGF0aWNcbiAqL1xuXG5mdW5jdGlvbiBpbmNsdWRlRmlsZShwYXRoLCBvcHRpb25zKSB7XG4gIHZhciBvcHRzID0gdXRpbHMuc2hhbGxvd0NvcHkoe30sIG9wdGlvbnMpO1xuICBvcHRzLmZpbGVuYW1lID0gZ2V0SW5jbHVkZVBhdGgocGF0aCwgb3B0cyk7XG4gIHJldHVybiBoYW5kbGVDYWNoZShvcHRzKTtcbn1cblxuLyoqXG4gKiBHZXQgdGhlIEphdmFTY3JpcHQgc291cmNlIG9mIGFuIGluY2x1ZGVkIGZpbGUuXG4gKlxuICogQG1lbWJlcm9mIG1vZHVsZTplanMtaW50ZXJuYWxcbiAqIEBwYXJhbSB7U3RyaW5nfSAgcGF0aCAgICBwYXRoIGZvciB0aGUgc3BlY2lmaWVkIGZpbGVcbiAqIEBwYXJhbSB7T3B0aW9uc30gb3B0aW9ucyBjb21waWxhdGlvbiBvcHRpb25zXG4gKiBAcmV0dXJuIHtPYmplY3R9XG4gKiBAc3RhdGljXG4gKi9cblxuZnVuY3Rpb24gaW5jbHVkZVNvdXJjZShwYXRoLCBvcHRpb25zKSB7XG4gIHZhciBvcHRzID0gdXRpbHMuc2hhbGxvd0NvcHkoe30sIG9wdGlvbnMpO1xuICB2YXIgaW5jbHVkZVBhdGg7XG4gIHZhciB0ZW1wbGF0ZTtcbiAgaW5jbHVkZVBhdGggPSBnZXRJbmNsdWRlUGF0aChwYXRoLCBvcHRzKTtcbiAgdGVtcGxhdGUgPSBmaWxlTG9hZGVyKGluY2x1ZGVQYXRoKS50b1N0cmluZygpLnJlcGxhY2UoX0JPTSwgJycpO1xuICBvcHRzLmZpbGVuYW1lID0gaW5jbHVkZVBhdGg7XG4gIHZhciB0ZW1wbCA9IG5ldyBUZW1wbGF0ZSh0ZW1wbGF0ZSwgb3B0cyk7XG4gIHRlbXBsLmdlbmVyYXRlU291cmNlKCk7XG4gIHJldHVybiB7XG4gICAgc291cmNlOiB0ZW1wbC5zb3VyY2UsXG4gICAgZmlsZW5hbWU6IGluY2x1ZGVQYXRoLFxuICAgIHRlbXBsYXRlOiB0ZW1wbGF0ZVxuICB9O1xufVxuXG4vKipcbiAqIFJlLXRocm93IHRoZSBnaXZlbiBgZXJyYCBpbiBjb250ZXh0IHRvIHRoZSBgc3RyYCBvZiBlanMsIGBmaWxlbmFtZWAsIGFuZFxuICogYGxpbmVub2AuXG4gKlxuICogQGltcGxlbWVudHMgUmV0aHJvd0NhbGxiYWNrXG4gKiBAbWVtYmVyb2YgbW9kdWxlOmVqcy1pbnRlcm5hbFxuICogQHBhcmFtIHtFcnJvcn0gIGVyciAgICAgIEVycm9yIG9iamVjdFxuICogQHBhcmFtIHtTdHJpbmd9IHN0ciAgICAgIEVKUyBzb3VyY2VcbiAqIEBwYXJhbSB7U3RyaW5nfSBmaWxlbmFtZSBmaWxlIG5hbWUgb2YgdGhlIEVKUyBmaWxlXG4gKiBAcGFyYW0ge1N0cmluZ30gbGluZW5vICAgbGluZSBudW1iZXIgb2YgdGhlIGVycm9yXG4gKiBAc3RhdGljXG4gKi9cblxuZnVuY3Rpb24gcmV0aHJvdyhlcnIsIHN0ciwgZmxubSwgbGluZW5vLCBlc2Mpe1xuICB2YXIgbGluZXMgPSBzdHIuc3BsaXQoJ1xcbicpO1xuICB2YXIgc3RhcnQgPSBNYXRoLm1heChsaW5lbm8gLSAzLCAwKTtcbiAgdmFyIGVuZCA9IE1hdGgubWluKGxpbmVzLmxlbmd0aCwgbGluZW5vICsgMyk7XG4gIHZhciBmaWxlbmFtZSA9IGVzYyhmbG5tKTsgLy8gZXNsaW50LWRpc2FibGUtbGluZVxuICAvLyBFcnJvciBjb250ZXh0XG4gIHZhciBjb250ZXh0ID0gbGluZXMuc2xpY2Uoc3RhcnQsIGVuZCkubWFwKGZ1bmN0aW9uIChsaW5lLCBpKXtcbiAgICB2YXIgY3VyciA9IGkgKyBzdGFydCArIDE7XG4gICAgcmV0dXJuIChjdXJyID09IGxpbmVubyA/ICcgPj4gJyA6ICcgICAgJylcbiAgICAgICsgY3VyclxuICAgICAgKyAnfCAnXG4gICAgICArIGxpbmU7XG4gIH0pLmpvaW4oJ1xcbicpO1xuXG4gIC8vIEFsdGVyIGV4Y2VwdGlvbiBtZXNzYWdlXG4gIGVyci5wYXRoID0gZmlsZW5hbWU7XG4gIGVyci5tZXNzYWdlID0gKGZpbGVuYW1lIHx8ICdlanMnKSArICc6J1xuICAgICsgbGluZW5vICsgJ1xcbidcbiAgICArIGNvbnRleHQgKyAnXFxuXFxuJ1xuICAgICsgZXJyLm1lc3NhZ2U7XG5cbiAgdGhyb3cgZXJyO1xufVxuXG5mdW5jdGlvbiBzdHJpcFNlbWkoc3RyKXtcbiAgcmV0dXJuIHN0ci5yZXBsYWNlKC87KFxccyokKS8sICckMScpO1xufVxuXG4vKipcbiAqIENvbXBpbGUgdGhlIGdpdmVuIGBzdHJgIG9mIGVqcyBpbnRvIGEgdGVtcGxhdGUgZnVuY3Rpb24uXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9ICB0ZW1wbGF0ZSBFSlMgdGVtcGxhdGVcbiAqXG4gKiBAcGFyYW0ge09wdGlvbnN9IG9wdHMgICAgIGNvbXBpbGF0aW9uIG9wdGlvbnNcbiAqXG4gKiBAcmV0dXJuIHsoVGVtcGxhdGVGdW5jdGlvbnxDbGllbnRGdW5jdGlvbil9XG4gKiBEZXBlbmRpbmcgb24gdGhlIHZhbHVlIG9mIGBvcHRzLmNsaWVudGAsIGVpdGhlciB0eXBlIG1pZ2h0IGJlIHJldHVybmVkLlxuICogTm90ZSB0aGF0IHRoZSByZXR1cm4gdHlwZSBvZiB0aGUgZnVuY3Rpb24gYWxzbyBkZXBlbmRzIG9uIHRoZSB2YWx1ZSBvZiBgb3B0cy5hc3luY2AuXG4gKiBAcHVibGljXG4gKi9cblxuZXhwb3J0cy5jb21waWxlID0gZnVuY3Rpb24gY29tcGlsZSh0ZW1wbGF0ZSwgb3B0cykge1xuICB2YXIgdGVtcGw7XG5cbiAgLy8gdjEgY29tcGF0XG4gIC8vICdzY29wZScgaXMgJ2NvbnRleHQnXG4gIC8vIEZJWE1FOiBSZW1vdmUgdGhpcyBpbiBhIGZ1dHVyZSB2ZXJzaW9uXG4gIGlmIChvcHRzICYmIG9wdHMuc2NvcGUpIHtcbiAgICBpZiAoIXNjb3BlT3B0aW9uV2FybmVkKXtcbiAgICAgIGNvbnNvbGUud2FybignYHNjb3BlYCBvcHRpb24gaXMgZGVwcmVjYXRlZCBhbmQgd2lsbCBiZSByZW1vdmVkIGluIEVKUyAzJyk7XG4gICAgICBzY29wZU9wdGlvbldhcm5lZCA9IHRydWU7XG4gICAgfVxuICAgIGlmICghb3B0cy5jb250ZXh0KSB7XG4gICAgICBvcHRzLmNvbnRleHQgPSBvcHRzLnNjb3BlO1xuICAgIH1cbiAgICBkZWxldGUgb3B0cy5zY29wZTtcbiAgfVxuICB0ZW1wbCA9IG5ldyBUZW1wbGF0ZSh0ZW1wbGF0ZSwgb3B0cyk7XG4gIHJldHVybiB0ZW1wbC5jb21waWxlKCk7XG59O1xuXG4vKipcbiAqIFJlbmRlciB0aGUgZ2l2ZW4gYHRlbXBsYXRlYCBvZiBlanMuXG4gKlxuICogSWYgeW91IHdvdWxkIGxpa2UgdG8gaW5jbHVkZSBvcHRpb25zIGJ1dCBub3QgZGF0YSwgeW91IG5lZWQgdG8gZXhwbGljaXRseVxuICogY2FsbCB0aGlzIGZ1bmN0aW9uIHdpdGggYGRhdGFgIGJlaW5nIGFuIGVtcHR5IG9iamVjdCBvciBgbnVsbGAuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9ICAgdGVtcGxhdGUgRUpTIHRlbXBsYXRlXG4gKiBAcGFyYW0ge09iamVjdH0gIFtkYXRhPXt9XSB0ZW1wbGF0ZSBkYXRhXG4gKiBAcGFyYW0ge09wdGlvbnN9IFtvcHRzPXt9XSBjb21waWxhdGlvbiBhbmQgcmVuZGVyaW5nIG9wdGlvbnNcbiAqIEByZXR1cm4geyhTdHJpbmd8UHJvbWlzZTxTdHJpbmc+KX1cbiAqIFJldHVybiB2YWx1ZSB0eXBlIGRlcGVuZHMgb24gYG9wdHMuYXN5bmNgLlxuICogQHB1YmxpY1xuICovXG5cbmV4cG9ydHMucmVuZGVyID0gZnVuY3Rpb24gKHRlbXBsYXRlLCBkLCBvKSB7XG4gIHZhciBkYXRhID0gZCB8fCB7fTtcbiAgdmFyIG9wdHMgPSBvIHx8IHt9O1xuXG4gIC8vIE5vIG9wdGlvbnMgb2JqZWN0IC0tIGlmIHRoZXJlIGFyZSBvcHRpb255IG5hbWVzXG4gIC8vIGluIHRoZSBkYXRhLCBjb3B5IHRoZW0gdG8gb3B0aW9uc1xuICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PSAyKSB7XG4gICAgdXRpbHMuc2hhbGxvd0NvcHlGcm9tTGlzdChvcHRzLCBkYXRhLCBfT1BUU19QQVNTQUJMRV9XSVRIX0RBVEEpO1xuICB9XG5cbiAgcmV0dXJuIGhhbmRsZUNhY2hlKG9wdHMsIHRlbXBsYXRlKShkYXRhKTtcbn07XG5cbi8qKlxuICogUmVuZGVyIGFuIEVKUyBmaWxlIGF0IHRoZSBnaXZlbiBgcGF0aGAgYW5kIGNhbGxiYWNrIGBjYihlcnIsIHN0cilgLlxuICpcbiAqIElmIHlvdSB3b3VsZCBsaWtlIHRvIGluY2x1ZGUgb3B0aW9ucyBidXQgbm90IGRhdGEsIHlvdSBuZWVkIHRvIGV4cGxpY2l0bHlcbiAqIGNhbGwgdGhpcyBmdW5jdGlvbiB3aXRoIGBkYXRhYCBiZWluZyBhbiBlbXB0eSBvYmplY3Qgb3IgYG51bGxgLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSAgICAgICAgICAgICBwYXRoICAgICBwYXRoIHRvIHRoZSBFSlMgZmlsZVxuICogQHBhcmFtIHtPYmplY3R9ICAgICAgICAgICAgW2RhdGE9e31dIHRlbXBsYXRlIGRhdGFcbiAqIEBwYXJhbSB7T3B0aW9uc30gICAgICAgICAgIFtvcHRzPXt9XSBjb21waWxhdGlvbiBhbmQgcmVuZGVyaW5nIG9wdGlvbnNcbiAqIEBwYXJhbSB7UmVuZGVyRmlsZUNhbGxiYWNrfSBjYiBjYWxsYmFja1xuICogQHB1YmxpY1xuICovXG5cbmV4cG9ydHMucmVuZGVyRmlsZSA9IGZ1bmN0aW9uICgpIHtcbiAgdmFyIGFyZ3MgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMpO1xuICB2YXIgZmlsZW5hbWUgPSBhcmdzLnNoaWZ0KCk7XG4gIHZhciBjYjtcbiAgdmFyIG9wdHMgPSB7ZmlsZW5hbWU6IGZpbGVuYW1lfTtcbiAgdmFyIGRhdGE7XG4gIHZhciB2aWV3T3B0cztcblxuICAvLyBEbyB3ZSBoYXZlIGEgY2FsbGJhY2s/XG4gIGlmICh0eXBlb2YgYXJndW1lbnRzW2FyZ3VtZW50cy5sZW5ndGggLSAxXSA9PSAnZnVuY3Rpb24nKSB7XG4gICAgY2IgPSBhcmdzLnBvcCgpO1xuICB9XG4gIC8vIERvIHdlIGhhdmUgZGF0YS9vcHRzP1xuICBpZiAoYXJncy5sZW5ndGgpIHtcbiAgICAvLyBTaG91bGQgYWx3YXlzIGhhdmUgZGF0YSBvYmpcbiAgICBkYXRhID0gYXJncy5zaGlmdCgpO1xuICAgIC8vIE5vcm1hbCBwYXNzZWQgb3B0cyAoZGF0YSBvYmogKyBvcHRzIG9iailcbiAgICBpZiAoYXJncy5sZW5ndGgpIHtcbiAgICAgIC8vIFVzZSBzaGFsbG93Q29weSBzbyB3ZSBkb24ndCBwb2xsdXRlIHBhc3NlZCBpbiBvcHRzIG9iaiB3aXRoIG5ldyB2YWxzXG4gICAgICB1dGlscy5zaGFsbG93Q29weShvcHRzLCBhcmdzLnBvcCgpKTtcbiAgICB9XG4gICAgLy8gU3BlY2lhbCBjYXNpbmcgZm9yIEV4cHJlc3MgKHNldHRpbmdzICsgb3B0cy1pbi1kYXRhKVxuICAgIGVsc2Uge1xuICAgICAgLy8gRXhwcmVzcyAzIGFuZCA0XG4gICAgICBpZiAoZGF0YS5zZXR0aW5ncykge1xuICAgICAgICAvLyBQdWxsIGEgZmV3IHRoaW5ncyBmcm9tIGtub3duIGxvY2F0aW9uc1xuICAgICAgICBpZiAoZGF0YS5zZXR0aW5ncy52aWV3cykge1xuICAgICAgICAgIG9wdHMudmlld3MgPSBkYXRhLnNldHRpbmdzLnZpZXdzO1xuICAgICAgICB9XG4gICAgICAgIGlmIChkYXRhLnNldHRpbmdzWyd2aWV3IGNhY2hlJ10pIHtcbiAgICAgICAgICBvcHRzLmNhY2hlID0gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICAvLyBVbmRvY3VtZW50ZWQgYWZ0ZXIgRXhwcmVzcyAyLCBidXQgc3RpbGwgdXNhYmxlLCBlc3AuIGZvclxuICAgICAgICAvLyBpdGVtcyB0aGF0IGFyZSB1bnNhZmUgdG8gYmUgcGFzc2VkIGFsb25nIHdpdGggZGF0YSwgbGlrZSBgcm9vdGBcbiAgICAgICAgdmlld09wdHMgPSBkYXRhLnNldHRpbmdzWyd2aWV3IG9wdGlvbnMnXTtcbiAgICAgICAgaWYgKHZpZXdPcHRzKSB7XG4gICAgICAgICAgdXRpbHMuc2hhbGxvd0NvcHkob3B0cywgdmlld09wdHMpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICAvLyBFeHByZXNzIDIgYW5kIGxvd2VyLCB2YWx1ZXMgc2V0IGluIGFwcC5sb2NhbHMsIG9yIHBlb3BsZSB3aG8ganVzdFxuICAgICAgLy8gd2FudCB0byBwYXNzIG9wdGlvbnMgaW4gdGhlaXIgZGF0YS4gTk9URTogVGhlc2UgdmFsdWVzIHdpbGwgb3ZlcnJpZGVcbiAgICAgIC8vIGFueXRoaW5nIHByZXZpb3VzbHkgc2V0IGluIHNldHRpbmdzICBvciBzZXR0aW5nc1sndmlldyBvcHRpb25zJ11cbiAgICAgIHV0aWxzLnNoYWxsb3dDb3B5RnJvbUxpc3Qob3B0cywgZGF0YSwgX09QVFNfUEFTU0FCTEVfV0lUSF9EQVRBX0VYUFJFU1MpO1xuICAgIH1cbiAgICBvcHRzLmZpbGVuYW1lID0gZmlsZW5hbWU7XG4gIH1cbiAgZWxzZSB7XG4gICAgZGF0YSA9IHt9O1xuICB9XG5cbiAgcmV0dXJuIHRyeUhhbmRsZUNhY2hlKG9wdHMsIGRhdGEsIGNiKTtcbn07XG5cbi8qKlxuICogQ2xlYXIgaW50ZXJtZWRpYXRlIEphdmFTY3JpcHQgY2FjaGUuIENhbGxzIHtAbGluayBDYWNoZSNyZXNldH0uXG4gKiBAcHVibGljXG4gKi9cblxuZXhwb3J0cy5jbGVhckNhY2hlID0gZnVuY3Rpb24gKCkge1xuICBleHBvcnRzLmNhY2hlLnJlc2V0KCk7XG59O1xuXG5mdW5jdGlvbiBUZW1wbGF0ZSh0ZXh0LCBvcHRzKSB7XG4gIG9wdHMgPSBvcHRzIHx8IHt9O1xuICB2YXIgb3B0aW9ucyA9IHt9O1xuICB0aGlzLnRlbXBsYXRlVGV4dCA9IHRleHQ7XG4gIHRoaXMubW9kZSA9IG51bGw7XG4gIHRoaXMudHJ1bmNhdGUgPSBmYWxzZTtcbiAgdGhpcy5jdXJyZW50TGluZSA9IDE7XG4gIHRoaXMuc291cmNlID0gJyc7XG4gIHRoaXMuZGVwZW5kZW5jaWVzID0gW107XG4gIG9wdGlvbnMuY2xpZW50ID0gb3B0cy5jbGllbnQgfHwgZmFsc2U7XG4gIG9wdGlvbnMuZXNjYXBlRnVuY3Rpb24gPSBvcHRzLmVzY2FwZSB8fCB1dGlscy5lc2NhcGVYTUw7XG4gIG9wdGlvbnMuY29tcGlsZURlYnVnID0gb3B0cy5jb21waWxlRGVidWcgIT09IGZhbHNlO1xuICBvcHRpb25zLmRlYnVnID0gISFvcHRzLmRlYnVnO1xuICBvcHRpb25zLmZpbGVuYW1lID0gb3B0cy5maWxlbmFtZTtcbiAgb3B0aW9ucy5kZWxpbWl0ZXIgPSBvcHRzLmRlbGltaXRlciB8fCBleHBvcnRzLmRlbGltaXRlciB8fCBfREVGQVVMVF9ERUxJTUlURVI7XG4gIG9wdGlvbnMuc3RyaWN0ID0gb3B0cy5zdHJpY3QgfHwgZmFsc2U7XG4gIG9wdGlvbnMuY29udGV4dCA9IG9wdHMuY29udGV4dDtcbiAgb3B0aW9ucy5jYWNoZSA9IG9wdHMuY2FjaGUgfHwgZmFsc2U7XG4gIG9wdGlvbnMucm1XaGl0ZXNwYWNlID0gb3B0cy5ybVdoaXRlc3BhY2U7XG4gIG9wdGlvbnMucm9vdCA9IG9wdHMucm9vdDtcbiAgb3B0aW9ucy5vdXRwdXRGdW5jdGlvbk5hbWUgPSBvcHRzLm91dHB1dEZ1bmN0aW9uTmFtZTtcbiAgb3B0aW9ucy5sb2NhbHNOYW1lID0gb3B0cy5sb2NhbHNOYW1lIHx8IGV4cG9ydHMubG9jYWxzTmFtZSB8fCBfREVGQVVMVF9MT0NBTFNfTkFNRTtcbiAgb3B0aW9ucy52aWV3cyA9IG9wdHMudmlld3M7XG4gIG9wdGlvbnMuYXN5bmMgPSBvcHRzLmFzeW5jO1xuXG4gIGlmIChvcHRpb25zLnN0cmljdCkge1xuICAgIG9wdGlvbnMuX3dpdGggPSBmYWxzZTtcbiAgfVxuICBlbHNlIHtcbiAgICBvcHRpb25zLl93aXRoID0gdHlwZW9mIG9wdHMuX3dpdGggIT0gJ3VuZGVmaW5lZCcgPyBvcHRzLl93aXRoIDogdHJ1ZTtcbiAgfVxuXG4gIHRoaXMub3B0cyA9IG9wdGlvbnM7XG5cbiAgdGhpcy5yZWdleCA9IHRoaXMuY3JlYXRlUmVnZXgoKTtcbn1cblxuVGVtcGxhdGUubW9kZXMgPSB7XG4gIEVWQUw6ICdldmFsJyxcbiAgRVNDQVBFRDogJ2VzY2FwZWQnLFxuICBSQVc6ICdyYXcnLFxuICBDT01NRU5UOiAnY29tbWVudCcsXG4gIExJVEVSQUw6ICdsaXRlcmFsJ1xufTtcblxuVGVtcGxhdGUucHJvdG90eXBlID0ge1xuICBjcmVhdGVSZWdleDogZnVuY3Rpb24gKCkge1xuICAgIHZhciBzdHIgPSBfUkVHRVhfU1RSSU5HO1xuICAgIHZhciBkZWxpbSA9IHV0aWxzLmVzY2FwZVJlZ0V4cENoYXJzKHRoaXMub3B0cy5kZWxpbWl0ZXIpO1xuICAgIHN0ciA9IHN0ci5yZXBsYWNlKC8lL2csIGRlbGltKTtcbiAgICByZXR1cm4gbmV3IFJlZ0V4cChzdHIpO1xuICB9LFxuXG4gIGNvbXBpbGU6IGZ1bmN0aW9uICgpIHtcbiAgICB2YXIgc3JjO1xuICAgIHZhciBmbjtcbiAgICB2YXIgb3B0cyA9IHRoaXMub3B0cztcbiAgICB2YXIgcHJlcGVuZGVkID0gJyc7XG4gICAgdmFyIGFwcGVuZGVkID0gJyc7XG4gICAgdmFyIGVzY2FwZUZuID0gb3B0cy5lc2NhcGVGdW5jdGlvbjtcbiAgICB2YXIgYXN5bmNDdG9yO1xuXG4gICAgaWYgKCF0aGlzLnNvdXJjZSkge1xuICAgICAgdGhpcy5nZW5lcmF0ZVNvdXJjZSgpO1xuICAgICAgcHJlcGVuZGVkICs9ICcgIHZhciBfX291dHB1dCA9IFtdLCBfX2FwcGVuZCA9IF9fb3V0cHV0LnB1c2guYmluZChfX291dHB1dCk7JyArICdcXG4nO1xuICAgICAgaWYgKG9wdHMub3V0cHV0RnVuY3Rpb25OYW1lKSB7XG4gICAgICAgIHByZXBlbmRlZCArPSAnICB2YXIgJyArIG9wdHMub3V0cHV0RnVuY3Rpb25OYW1lICsgJyA9IF9fYXBwZW5kOycgKyAnXFxuJztcbiAgICAgIH1cbiAgICAgIGlmIChvcHRzLl93aXRoICE9PSBmYWxzZSkge1xuICAgICAgICBwcmVwZW5kZWQgKz0gICcgIHdpdGggKCcgKyBvcHRzLmxvY2Fsc05hbWUgKyAnIHx8IHt9KSB7JyArICdcXG4nO1xuICAgICAgICBhcHBlbmRlZCArPSAnICB9JyArICdcXG4nO1xuICAgICAgfVxuICAgICAgYXBwZW5kZWQgKz0gJyAgcmV0dXJuIF9fb3V0cHV0LmpvaW4oXCJcIik7JyArICdcXG4nO1xuICAgICAgdGhpcy5zb3VyY2UgPSBwcmVwZW5kZWQgKyB0aGlzLnNvdXJjZSArIGFwcGVuZGVkO1xuICAgIH1cblxuICAgIGlmIChvcHRzLmNvbXBpbGVEZWJ1Zykge1xuICAgICAgc3JjID0gJ3ZhciBfX2xpbmUgPSAxJyArICdcXG4nXG4gICAgICAgICsgJyAgLCBfX2xpbmVzID0gJyArIEpTT04uc3RyaW5naWZ5KHRoaXMudGVtcGxhdGVUZXh0KSArICdcXG4nXG4gICAgICAgICsgJyAgLCBfX2ZpbGVuYW1lID0gJyArIChvcHRzLmZpbGVuYW1lID9cbiAgICAgICAgSlNPTi5zdHJpbmdpZnkob3B0cy5maWxlbmFtZSkgOiAndW5kZWZpbmVkJykgKyAnOycgKyAnXFxuJ1xuICAgICAgICArICd0cnkgeycgKyAnXFxuJ1xuICAgICAgICArIHRoaXMuc291cmNlXG4gICAgICAgICsgJ30gY2F0Y2ggKGUpIHsnICsgJ1xcbidcbiAgICAgICAgKyAnICByZXRocm93KGUsIF9fbGluZXMsIF9fZmlsZW5hbWUsIF9fbGluZSwgZXNjYXBlRm4pOycgKyAnXFxuJ1xuICAgICAgICArICd9JyArICdcXG4nO1xuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgIHNyYyA9IHRoaXMuc291cmNlO1xuICAgIH1cblxuICAgIGlmIChvcHRzLmNsaWVudCkge1xuICAgICAgc3JjID0gJ2VzY2FwZUZuID0gZXNjYXBlRm4gfHwgJyArIGVzY2FwZUZuLnRvU3RyaW5nKCkgKyAnOycgKyAnXFxuJyArIHNyYztcbiAgICAgIGlmIChvcHRzLmNvbXBpbGVEZWJ1Zykge1xuICAgICAgICBzcmMgPSAncmV0aHJvdyA9IHJldGhyb3cgfHwgJyArIHJldGhyb3cudG9TdHJpbmcoKSArICc7JyArICdcXG4nICsgc3JjO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChvcHRzLnN0cmljdCkge1xuICAgICAgc3JjID0gJ1widXNlIHN0cmljdFwiO1xcbicgKyBzcmM7XG4gICAgfVxuICAgIGlmIChvcHRzLmRlYnVnKSB7XG4gICAgICBjb25zb2xlLmxvZyhzcmMpO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICBpZiAob3B0cy5hc3luYykge1xuICAgICAgICAvLyBIYXZlIHRvIHVzZSBnZW5lcmF0ZWQgZnVuY3Rpb24gZm9yIHRoaXMsIHNpbmNlIGluIGVudnMgd2l0aG91dCBzdXBwb3J0LFxuICAgICAgICAvLyBpdCBicmVha3MgaW4gcGFyc2luZ1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGFzeW5jQ3RvciA9IChuZXcgRnVuY3Rpb24oJ3JldHVybiAoYXN5bmMgZnVuY3Rpb24oKXt9KS5jb25zdHJ1Y3RvcjsnKSkoKTtcbiAgICAgICAgfVxuICAgICAgICBjYXRjaChlKSB7XG4gICAgICAgICAgaWYgKGUgaW5zdGFuY2VvZiBTeW50YXhFcnJvcikge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdUaGlzIGVudmlyb25tZW50IGRvZXMgbm90IHN1cHBvcnQgYXN5bmMvYXdhaXQnKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgZWxzZSB7XG4gICAgICAgICAgICB0aHJvdyBlO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgZWxzZSB7XG4gICAgICAgIGFzeW5jQ3RvciA9IEZ1bmN0aW9uO1xuICAgICAgfVxuICAgICAgZm4gPSBuZXcgYXN5bmNDdG9yKG9wdHMubG9jYWxzTmFtZSArICcsIGVzY2FwZUZuLCBpbmNsdWRlLCByZXRocm93Jywgc3JjKTtcbiAgICB9XG4gICAgY2F0Y2goZSkge1xuICAgICAgLy8gaXN0YW5idWwgaWdub3JlIGVsc2VcbiAgICAgIGlmIChlIGluc3RhbmNlb2YgU3ludGF4RXJyb3IpIHtcbiAgICAgICAgaWYgKG9wdHMuZmlsZW5hbWUpIHtcbiAgICAgICAgICBlLm1lc3NhZ2UgKz0gJyBpbiAnICsgb3B0cy5maWxlbmFtZTtcbiAgICAgICAgfVxuICAgICAgICBlLm1lc3NhZ2UgKz0gJyB3aGlsZSBjb21waWxpbmcgZWpzXFxuXFxuJztcbiAgICAgICAgZS5tZXNzYWdlICs9ICdJZiB0aGUgYWJvdmUgZXJyb3IgaXMgbm90IGhlbHBmdWwsIHlvdSBtYXkgd2FudCB0byB0cnkgRUpTLUxpbnQ6XFxuJztcbiAgICAgICAgZS5tZXNzYWdlICs9ICdodHRwczovL2dpdGh1Yi5jb20vUnlhblppbS9FSlMtTGludCc7XG4gICAgICAgIGlmICghZS5hc3luYykge1xuICAgICAgICAgIGUubWVzc2FnZSArPSAnXFxuJztcbiAgICAgICAgICBlLm1lc3NhZ2UgKz0gJ09yLCBpZiB5b3UgbWVhbnQgdG8gY3JlYXRlIGFuIGFzeW5jIGZ1bmN0aW9uLCBwYXNzIGFzeW5jOiB0cnVlIGFzIGFuIG9wdGlvbi4nO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICB0aHJvdyBlO1xuICAgIH1cblxuICAgIGlmIChvcHRzLmNsaWVudCkge1xuICAgICAgZm4uZGVwZW5kZW5jaWVzID0gdGhpcy5kZXBlbmRlbmNpZXM7XG4gICAgICByZXR1cm4gZm47XG4gICAgfVxuXG4gICAgLy8gUmV0dXJuIGEgY2FsbGFibGUgZnVuY3Rpb24gd2hpY2ggd2lsbCBleGVjdXRlIHRoZSBmdW5jdGlvblxuICAgIC8vIGNyZWF0ZWQgYnkgdGhlIHNvdXJjZS1jb2RlLCB3aXRoIHRoZSBwYXNzZWQgZGF0YSBhcyBsb2NhbHNcbiAgICAvLyBBZGRzIGEgbG9jYWwgYGluY2x1ZGVgIGZ1bmN0aW9uIHdoaWNoIGFsbG93cyBmdWxsIHJlY3Vyc2l2ZSBpbmNsdWRlXG4gICAgdmFyIHJldHVybmVkRm4gPSBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAgdmFyIGluY2x1ZGUgPSBmdW5jdGlvbiAocGF0aCwgaW5jbHVkZURhdGEpIHtcbiAgICAgICAgdmFyIGQgPSB1dGlscy5zaGFsbG93Q29weSh7fSwgZGF0YSk7XG4gICAgICAgIGlmIChpbmNsdWRlRGF0YSkge1xuICAgICAgICAgIGQgPSB1dGlscy5zaGFsbG93Q29weShkLCBpbmNsdWRlRGF0YSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGluY2x1ZGVGaWxlKHBhdGgsIG9wdHMpKGQpO1xuICAgICAgfTtcbiAgICAgIHJldHVybiBmbi5hcHBseShvcHRzLmNvbnRleHQsIFtkYXRhIHx8IHt9LCBlc2NhcGVGbiwgaW5jbHVkZSwgcmV0aHJvd10pO1xuICAgIH07XG4gICAgcmV0dXJuZWRGbi5kZXBlbmRlbmNpZXMgPSB0aGlzLmRlcGVuZGVuY2llcztcbiAgICByZXR1cm4gcmV0dXJuZWRGbjtcbiAgfSxcblxuICBnZW5lcmF0ZVNvdXJjZTogZnVuY3Rpb24gKCkge1xuICAgIHZhciBvcHRzID0gdGhpcy5vcHRzO1xuXG4gICAgaWYgKG9wdHMucm1XaGl0ZXNwYWNlKSB7XG4gICAgICAvLyBIYXZlIHRvIHVzZSB0d28gc2VwYXJhdGUgcmVwbGFjZSBoZXJlIGFzIGBeYCBhbmQgYCRgIG9wZXJhdG9ycyBkb24ndFxuICAgICAgLy8gd29yayB3ZWxsIHdpdGggYFxccmAuXG4gICAgICB0aGlzLnRlbXBsYXRlVGV4dCA9XG4gICAgICAgIHRoaXMudGVtcGxhdGVUZXh0LnJlcGxhY2UoL1xcci9nLCAnJykucmVwbGFjZSgvXlxccyt8XFxzKyQvZ20sICcnKTtcbiAgICB9XG5cbiAgICAvLyBTbHVycCBzcGFjZXMgYW5kIHRhYnMgYmVmb3JlIDwlXyBhbmQgYWZ0ZXIgXyU+XG4gICAgdGhpcy50ZW1wbGF0ZVRleHQgPVxuICAgICAgdGhpcy50ZW1wbGF0ZVRleHQucmVwbGFjZSgvWyBcXHRdKjwlXy9nbSwgJzwlXycpLnJlcGxhY2UoL18lPlsgXFx0XSovZ20sICdfJT4nKTtcblxuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB2YXIgbWF0Y2hlcyA9IHRoaXMucGFyc2VUZW1wbGF0ZVRleHQoKTtcbiAgICB2YXIgZCA9IHRoaXMub3B0cy5kZWxpbWl0ZXI7XG5cbiAgICBpZiAobWF0Y2hlcyAmJiBtYXRjaGVzLmxlbmd0aCkge1xuICAgICAgbWF0Y2hlcy5mb3JFYWNoKGZ1bmN0aW9uIChsaW5lLCBpbmRleCkge1xuICAgICAgICB2YXIgb3BlbmluZztcbiAgICAgICAgdmFyIGNsb3Npbmc7XG4gICAgICAgIHZhciBpbmNsdWRlO1xuICAgICAgICB2YXIgaW5jbHVkZU9wdHM7XG4gICAgICAgIHZhciBpbmNsdWRlT2JqO1xuICAgICAgICB2YXIgaW5jbHVkZVNyYztcbiAgICAgICAgLy8gSWYgdGhpcyBpcyBhbiBvcGVuaW5nIHRhZywgY2hlY2sgZm9yIGNsb3NpbmcgdGFnc1xuICAgICAgICAvLyBGSVhNRTogTWF5IGVuZCB1cCB3aXRoIHNvbWUgZmFsc2UgcG9zaXRpdmVzIGhlcmVcbiAgICAgICAgLy8gQmV0dGVyIHRvIHN0b3JlIG1vZGVzIGFzIGsvdiB3aXRoICc8JyArIGRlbGltaXRlciBhcyBrZXlcbiAgICAgICAgLy8gVGhlbiB0aGlzIGNhbiBzaW1wbHkgY2hlY2sgYWdhaW5zdCB0aGUgbWFwXG4gICAgICAgIGlmICggbGluZS5pbmRleE9mKCc8JyArIGQpID09PSAwICAgICAgICAvLyBJZiBpdCBpcyBhIHRhZ1xuICAgICAgICAgICYmIGxpbmUuaW5kZXhPZignPCcgKyBkICsgZCkgIT09IDApIHsgLy8gYW5kIGlzIG5vdCBlc2NhcGVkXG4gICAgICAgICAgY2xvc2luZyA9IG1hdGNoZXNbaW5kZXggKyAyXTtcbiAgICAgICAgICBpZiAoIShjbG9zaW5nID09IGQgKyAnPicgfHwgY2xvc2luZyA9PSAnLScgKyBkICsgJz4nIHx8IGNsb3NpbmcgPT0gJ18nICsgZCArICc+JykpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignQ291bGQgbm90IGZpbmQgbWF0Y2hpbmcgY2xvc2UgdGFnIGZvciBcIicgKyBsaW5lICsgJ1wiLicpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICAvLyBIQUNLOiBiYWNrd2FyZC1jb21wYXQgYGluY2x1ZGVgIHByZXByb2Nlc3NvciBkaXJlY3RpdmVzXG4gICAgICAgIGlmICgoaW5jbHVkZSA9IGxpbmUubWF0Y2goL15cXHMqaW5jbHVkZVxccysoXFxTKykvKSkpIHtcbiAgICAgICAgICBvcGVuaW5nID0gbWF0Y2hlc1tpbmRleCAtIDFdO1xuICAgICAgICAgIC8vIE11c3QgYmUgaW4gRVZBTCBvciBSQVcgbW9kZVxuICAgICAgICAgIGlmIChvcGVuaW5nICYmIChvcGVuaW5nID09ICc8JyArIGQgfHwgb3BlbmluZyA9PSAnPCcgKyBkICsgJy0nIHx8IG9wZW5pbmcgPT0gJzwnICsgZCArICdfJykpIHtcbiAgICAgICAgICAgIGluY2x1ZGVPcHRzID0gdXRpbHMuc2hhbGxvd0NvcHkoe30sIHNlbGYub3B0cyk7XG4gICAgICAgICAgICBpbmNsdWRlT2JqID0gaW5jbHVkZVNvdXJjZShpbmNsdWRlWzFdLCBpbmNsdWRlT3B0cyk7XG4gICAgICAgICAgICBpZiAoc2VsZi5vcHRzLmNvbXBpbGVEZWJ1Zykge1xuICAgICAgICAgICAgICBpbmNsdWRlU3JjID1cbiAgICAgICAgICAgICAgICAgICcgICAgOyAoZnVuY3Rpb24oKXsnICsgJ1xcbidcbiAgICAgICAgICAgICAgICAgICsgJyAgICAgIHZhciBfX2xpbmUgPSAxJyArICdcXG4nXG4gICAgICAgICAgICAgICAgICArICcgICAgICAsIF9fbGluZXMgPSAnICsgSlNPTi5zdHJpbmdpZnkoaW5jbHVkZU9iai50ZW1wbGF0ZSkgKyAnXFxuJ1xuICAgICAgICAgICAgICAgICAgKyAnICAgICAgLCBfX2ZpbGVuYW1lID0gJyArIEpTT04uc3RyaW5naWZ5KGluY2x1ZGVPYmouZmlsZW5hbWUpICsgJzsnICsgJ1xcbidcbiAgICAgICAgICAgICAgICAgICsgJyAgICAgIHRyeSB7JyArICdcXG4nXG4gICAgICAgICAgICAgICAgICArIGluY2x1ZGVPYmouc291cmNlXG4gICAgICAgICAgICAgICAgICArICcgICAgICB9IGNhdGNoIChlKSB7JyArICdcXG4nXG4gICAgICAgICAgICAgICAgICArICcgICAgICAgIHJldGhyb3coZSwgX19saW5lcywgX19maWxlbmFtZSwgX19saW5lLCBlc2NhcGVGbik7JyArICdcXG4nXG4gICAgICAgICAgICAgICAgICArICcgICAgICB9JyArICdcXG4nXG4gICAgICAgICAgICAgICAgICArICcgICAgOyB9KS5jYWxsKHRoaXMpJyArICdcXG4nO1xuICAgICAgICAgICAgfWVsc2V7XG4gICAgICAgICAgICAgIGluY2x1ZGVTcmMgPSAnICAgIDsgKGZ1bmN0aW9uKCl7JyArICdcXG4nICsgaW5jbHVkZU9iai5zb3VyY2UgK1xuICAgICAgICAgICAgICAgICAgJyAgICA7IH0pLmNhbGwodGhpcyknICsgJ1xcbic7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBzZWxmLnNvdXJjZSArPSBpbmNsdWRlU3JjO1xuICAgICAgICAgICAgc2VsZi5kZXBlbmRlbmNpZXMucHVzaChleHBvcnRzLnJlc29sdmVJbmNsdWRlKGluY2x1ZGVbMV0sXG4gICAgICAgICAgICAgIGluY2x1ZGVPcHRzLmZpbGVuYW1lKSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHNlbGYuc2NhbkxpbmUobGluZSk7XG4gICAgICB9KTtcbiAgICB9XG5cbiAgfSxcblxuICBwYXJzZVRlbXBsYXRlVGV4dDogZnVuY3Rpb24gKCkge1xuICAgIHZhciBzdHIgPSB0aGlzLnRlbXBsYXRlVGV4dDtcbiAgICB2YXIgcGF0ID0gdGhpcy5yZWdleDtcbiAgICB2YXIgcmVzdWx0ID0gcGF0LmV4ZWMoc3RyKTtcbiAgICB2YXIgYXJyID0gW107XG4gICAgdmFyIGZpcnN0UG9zO1xuXG4gICAgd2hpbGUgKHJlc3VsdCkge1xuICAgICAgZmlyc3RQb3MgPSByZXN1bHQuaW5kZXg7XG5cbiAgICAgIGlmIChmaXJzdFBvcyAhPT0gMCkge1xuICAgICAgICBhcnIucHVzaChzdHIuc3Vic3RyaW5nKDAsIGZpcnN0UG9zKSk7XG4gICAgICAgIHN0ciA9IHN0ci5zbGljZShmaXJzdFBvcyk7XG4gICAgICB9XG5cbiAgICAgIGFyci5wdXNoKHJlc3VsdFswXSk7XG4gICAgICBzdHIgPSBzdHIuc2xpY2UocmVzdWx0WzBdLmxlbmd0aCk7XG4gICAgICByZXN1bHQgPSBwYXQuZXhlYyhzdHIpO1xuICAgIH1cblxuICAgIGlmIChzdHIpIHtcbiAgICAgIGFyci5wdXNoKHN0cik7XG4gICAgfVxuXG4gICAgcmV0dXJuIGFycjtcbiAgfSxcblxuICBfYWRkT3V0cHV0OiBmdW5jdGlvbiAobGluZSkge1xuICAgIGlmICh0aGlzLnRydW5jYXRlKSB7XG4gICAgICAvLyBPbmx5IHJlcGxhY2Ugc2luZ2xlIGxlYWRpbmcgbGluZWJyZWFrIGluIHRoZSBsaW5lIGFmdGVyXG4gICAgICAvLyAtJT4gdGFnIC0tIHRoaXMgaXMgdGhlIHNpbmdsZSwgdHJhaWxpbmcgbGluZWJyZWFrXG4gICAgICAvLyBhZnRlciB0aGUgdGFnIHRoYXQgdGhlIHRydW5jYXRpb24gbW9kZSByZXBsYWNlc1xuICAgICAgLy8gSGFuZGxlIFdpbiAvIFVuaXggLyBvbGQgTWFjIGxpbmVicmVha3MgLS0gZG8gdGhlIFxcclxcblxuICAgICAgLy8gY29tYm8gZmlyc3QgaW4gdGhlIHJlZ2V4LW9yXG4gICAgICBsaW5lID0gbGluZS5yZXBsYWNlKC9eKD86XFxyXFxufFxccnxcXG4pLywgJycpO1xuICAgICAgdGhpcy50cnVuY2F0ZSA9IGZhbHNlO1xuICAgIH1cbiAgICBlbHNlIGlmICh0aGlzLm9wdHMucm1XaGl0ZXNwYWNlKSB7XG4gICAgICAvLyBybVdoaXRlc3BhY2UgaGFzIGFscmVhZHkgcmVtb3ZlZCB0cmFpbGluZyBzcGFjZXMsIGp1c3QgbmVlZFxuICAgICAgLy8gdG8gcmVtb3ZlIGxpbmVicmVha3NcbiAgICAgIGxpbmUgPSBsaW5lLnJlcGxhY2UoL15cXG4vLCAnJyk7XG4gICAgfVxuICAgIGlmICghbGluZSkge1xuICAgICAgcmV0dXJuIGxpbmU7XG4gICAgfVxuXG4gICAgLy8gUHJlc2VydmUgbGl0ZXJhbCBzbGFzaGVzXG4gICAgbGluZSA9IGxpbmUucmVwbGFjZSgvXFxcXC9nLCAnXFxcXFxcXFwnKTtcblxuICAgIC8vIENvbnZlcnQgbGluZWJyZWFrc1xuICAgIGxpbmUgPSBsaW5lLnJlcGxhY2UoL1xcbi9nLCAnXFxcXG4nKTtcbiAgICBsaW5lID0gbGluZS5yZXBsYWNlKC9cXHIvZywgJ1xcXFxyJyk7XG5cbiAgICAvLyBFc2NhcGUgZG91YmxlLXF1b3Rlc1xuICAgIC8vIC0gdGhpcyB3aWxsIGJlIHRoZSBkZWxpbWl0ZXIgZHVyaW5nIGV4ZWN1dGlvblxuICAgIGxpbmUgPSBsaW5lLnJlcGxhY2UoL1wiL2csICdcXFxcXCInKTtcbiAgICB0aGlzLnNvdXJjZSArPSAnICAgIDsgX19hcHBlbmQoXCInICsgbGluZSArICdcIiknICsgJ1xcbic7XG4gIH0sXG5cbiAgc2NhbkxpbmU6IGZ1bmN0aW9uIChsaW5lKSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHZhciBkID0gdGhpcy5vcHRzLmRlbGltaXRlcjtcbiAgICB2YXIgbmV3TGluZUNvdW50ID0gMDtcblxuICAgIG5ld0xpbmVDb3VudCA9IChsaW5lLnNwbGl0KCdcXG4nKS5sZW5ndGggLSAxKTtcblxuICAgIHN3aXRjaCAobGluZSkge1xuICAgIGNhc2UgJzwnICsgZDpcbiAgICBjYXNlICc8JyArIGQgKyAnXyc6XG4gICAgICB0aGlzLm1vZGUgPSBUZW1wbGF0ZS5tb2Rlcy5FVkFMO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnPCcgKyBkICsgJz0nOlxuICAgICAgdGhpcy5tb2RlID0gVGVtcGxhdGUubW9kZXMuRVNDQVBFRDtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJzwnICsgZCArICctJzpcbiAgICAgIHRoaXMubW9kZSA9IFRlbXBsYXRlLm1vZGVzLlJBVztcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJzwnICsgZCArICcjJzpcbiAgICAgIHRoaXMubW9kZSA9IFRlbXBsYXRlLm1vZGVzLkNPTU1FTlQ7XG4gICAgICBicmVhaztcbiAgICBjYXNlICc8JyArIGQgKyBkOlxuICAgICAgdGhpcy5tb2RlID0gVGVtcGxhdGUubW9kZXMuTElURVJBTDtcbiAgICAgIHRoaXMuc291cmNlICs9ICcgICAgOyBfX2FwcGVuZChcIicgKyBsaW5lLnJlcGxhY2UoJzwnICsgZCArIGQsICc8JyArIGQpICsgJ1wiKScgKyAnXFxuJztcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgZCArIGQgKyAnPic6XG4gICAgICB0aGlzLm1vZGUgPSBUZW1wbGF0ZS5tb2Rlcy5MSVRFUkFMO1xuICAgICAgdGhpcy5zb3VyY2UgKz0gJyAgICA7IF9fYXBwZW5kKFwiJyArIGxpbmUucmVwbGFjZShkICsgZCArICc+JywgZCArICc+JykgKyAnXCIpJyArICdcXG4nO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSBkICsgJz4nOlxuICAgIGNhc2UgJy0nICsgZCArICc+JzpcbiAgICBjYXNlICdfJyArIGQgKyAnPic6XG4gICAgICBpZiAodGhpcy5tb2RlID09IFRlbXBsYXRlLm1vZGVzLkxJVEVSQUwpIHtcbiAgICAgICAgdGhpcy5fYWRkT3V0cHV0KGxpbmUpO1xuICAgICAgfVxuXG4gICAgICB0aGlzLm1vZGUgPSBudWxsO1xuICAgICAgdGhpcy50cnVuY2F0ZSA9IGxpbmUuaW5kZXhPZignLScpID09PSAwIHx8IGxpbmUuaW5kZXhPZignXycpID09PSAwO1xuICAgICAgYnJlYWs7XG4gICAgZGVmYXVsdDpcbiAgICAgIC8vIEluIHNjcmlwdCBtb2RlLCBkZXBlbmRzIG9uIHR5cGUgb2YgdGFnXG4gICAgICBpZiAodGhpcy5tb2RlKSB7XG4gICAgICAgIC8vIElmICcvLycgaXMgZm91bmQgd2l0aG91dCBhIGxpbmUgYnJlYWssIGFkZCBhIGxpbmUgYnJlYWsuXG4gICAgICAgIHN3aXRjaCAodGhpcy5tb2RlKSB7XG4gICAgICAgIGNhc2UgVGVtcGxhdGUubW9kZXMuRVZBTDpcbiAgICAgICAgY2FzZSBUZW1wbGF0ZS5tb2Rlcy5FU0NBUEVEOlxuICAgICAgICBjYXNlIFRlbXBsYXRlLm1vZGVzLlJBVzpcbiAgICAgICAgICBpZiAobGluZS5sYXN0SW5kZXhPZignLy8nKSA+IGxpbmUubGFzdEluZGV4T2YoJ1xcbicpKSB7XG4gICAgICAgICAgICBsaW5lICs9ICdcXG4nO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBzd2l0Y2ggKHRoaXMubW9kZSkge1xuICAgICAgICAvLyBKdXN0IGV4ZWN1dGluZyBjb2RlXG4gICAgICAgIGNhc2UgVGVtcGxhdGUubW9kZXMuRVZBTDpcbiAgICAgICAgICB0aGlzLnNvdXJjZSArPSAnICAgIDsgJyArIGxpbmUgKyAnXFxuJztcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgICAvLyBFeGVjLCBlc2MsIGFuZCBvdXRwdXRcbiAgICAgICAgY2FzZSBUZW1wbGF0ZS5tb2Rlcy5FU0NBUEVEOlxuICAgICAgICAgIHRoaXMuc291cmNlICs9ICcgICAgOyBfX2FwcGVuZChlc2NhcGVGbignICsgc3RyaXBTZW1pKGxpbmUpICsgJykpJyArICdcXG4nO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIC8vIEV4ZWMgYW5kIG91dHB1dFxuICAgICAgICBjYXNlIFRlbXBsYXRlLm1vZGVzLlJBVzpcbiAgICAgICAgICB0aGlzLnNvdXJjZSArPSAnICAgIDsgX19hcHBlbmQoJyArIHN0cmlwU2VtaShsaW5lKSArICcpJyArICdcXG4nO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICBjYXNlIFRlbXBsYXRlLm1vZGVzLkNPTU1FTlQ6XG4gICAgICAgICAgLy8gRG8gbm90aGluZ1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIC8vIExpdGVyYWwgPCUlIG1vZGUsIGFwcGVuZCBhcyByYXcgb3V0cHV0XG4gICAgICAgIGNhc2UgVGVtcGxhdGUubW9kZXMuTElURVJBTDpcbiAgICAgICAgICB0aGlzLl9hZGRPdXRwdXQobGluZSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIC8vIEluIHN0cmluZyBtb2RlLCBqdXN0IGFkZCB0aGUgb3V0cHV0XG4gICAgICBlbHNlIHtcbiAgICAgICAgdGhpcy5fYWRkT3V0cHV0KGxpbmUpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChzZWxmLm9wdHMuY29tcGlsZURlYnVnICYmIG5ld0xpbmVDb3VudCkge1xuICAgICAgdGhpcy5jdXJyZW50TGluZSArPSBuZXdMaW5lQ291bnQ7XG4gICAgICB0aGlzLnNvdXJjZSArPSAnICAgIDsgX19saW5lID0gJyArIHRoaXMuY3VycmVudExpbmUgKyAnXFxuJztcbiAgICB9XG4gIH1cbn07XG5cbi8qKlxuICogRXNjYXBlIGNoYXJhY3RlcnMgcmVzZXJ2ZWQgaW4gWE1MLlxuICpcbiAqIFRoaXMgaXMgc2ltcGx5IGFuIGV4cG9ydCBvZiB7QGxpbmsgbW9kdWxlOnV0aWxzLmVzY2FwZVhNTH0uXG4gKlxuICogSWYgYG1hcmt1cGAgaXMgYHVuZGVmaW5lZGAgb3IgYG51bGxgLCB0aGUgZW1wdHkgc3RyaW5nIGlzIHJldHVybmVkLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBtYXJrdXAgSW5wdXQgc3RyaW5nXG4gKiBAcmV0dXJuIHtTdHJpbmd9IEVzY2FwZWQgc3RyaW5nXG4gKiBAcHVibGljXG4gKiBAZnVuY1xuICogKi9cbmV4cG9ydHMuZXNjYXBlWE1MID0gdXRpbHMuZXNjYXBlWE1MO1xuXG4vKipcbiAqIEV4cHJlc3MuanMgc3VwcG9ydC5cbiAqXG4gKiBUaGlzIGlzIGFuIGFsaWFzIGZvciB7QGxpbmsgbW9kdWxlOmVqcy5yZW5kZXJGaWxlfSwgaW4gb3JkZXIgdG8gc3VwcG9ydFxuICogRXhwcmVzcy5qcyBvdXQtb2YtdGhlLWJveC5cbiAqXG4gKiBAZnVuY1xuICovXG5cbmV4cG9ydHMuX19leHByZXNzID0gZXhwb3J0cy5yZW5kZXJGaWxlO1xuXG4vLyBBZGQgcmVxdWlyZSBzdXBwb3J0XG4vKiBpc3RhbmJ1bCBpZ25vcmUgZWxzZSAqL1xuaWYgKHJlcXVpcmUuZXh0ZW5zaW9ucykge1xuICByZXF1aXJlLmV4dGVuc2lvbnNbJy5lanMnXSA9IGZ1bmN0aW9uIChtb2R1bGUsIGZsbm0pIHtcbiAgICB2YXIgZmlsZW5hbWUgPSBmbG5tIHx8IC8qIGlzdGFuYnVsIGlnbm9yZSBuZXh0ICovIG1vZHVsZS5maWxlbmFtZTtcbiAgICB2YXIgb3B0aW9ucyA9IHtcbiAgICAgIGZpbGVuYW1lOiBmaWxlbmFtZSxcbiAgICAgIGNsaWVudDogdHJ1ZVxuICAgIH07XG4gICAgdmFyIHRlbXBsYXRlID0gZmlsZUxvYWRlcihmaWxlbmFtZSkudG9TdHJpbmcoKTtcbiAgICB2YXIgZm4gPSBleHBvcnRzLmNvbXBpbGUodGVtcGxhdGUsIG9wdGlvbnMpO1xuICAgIG1vZHVsZS5fY29tcGlsZSgnbW9kdWxlLmV4cG9ydHMgPSAnICsgZm4udG9TdHJpbmcoKSArICc7JywgZmlsZW5hbWUpO1xuICB9O1xufVxuXG4vKipcbiAqIFZlcnNpb24gb2YgRUpTLlxuICpcbiAqIEByZWFkb25seVxuICogQHR5cGUge1N0cmluZ31cbiAqIEBwdWJsaWNcbiAqL1xuXG5leHBvcnRzLlZFUlNJT04gPSBfVkVSU0lPTl9TVFJJTkc7XG5cbi8qKlxuICogTmFtZSBmb3IgZGV0ZWN0aW9uIG9mIEVKUy5cbiAqXG4gKiBAcmVhZG9ubHlcbiAqIEB0eXBlIHtTdHJpbmd9XG4gKiBAcHVibGljXG4gKi9cblxuZXhwb3J0cy5uYW1lID0gX05BTUU7XG5cbi8qIGlzdGFuYnVsIGlnbm9yZSBpZiAqL1xuaWYgKHR5cGVvZiB3aW5kb3cgIT0gJ3VuZGVmaW5lZCcpIHtcbiAgd2luZG93LmVqcyA9IGV4cG9ydHM7XG59XG4iLCIvKlxuICogRUpTIEVtYmVkZGVkIEphdmFTY3JpcHQgdGVtcGxhdGVzXG4gKiBDb3B5cmlnaHQgMjExMiBNYXR0aGV3IEVlcm5pc3NlIChtZGVAZmxlZWdpeC5vcmcpXG4gKlxuICogTGljZW5zZWQgdW5kZXIgdGhlIEFwYWNoZSBMaWNlbnNlLCBWZXJzaW9uIDIuMCAodGhlIFwiTGljZW5zZVwiKTtcbiAqIHlvdSBtYXkgbm90IHVzZSB0aGlzIGZpbGUgZXhjZXB0IGluIGNvbXBsaWFuY2Ugd2l0aCB0aGUgTGljZW5zZS5cbiAqIFlvdSBtYXkgb2J0YWluIGEgY29weSBvZiB0aGUgTGljZW5zZSBhdFxuICpcbiAqICAgICAgICAgaHR0cDovL3d3dy5hcGFjaGUub3JnL2xpY2Vuc2VzL0xJQ0VOU0UtMi4wXG4gKlxuICogVW5sZXNzIHJlcXVpcmVkIGJ5IGFwcGxpY2FibGUgbGF3IG9yIGFncmVlZCB0byBpbiB3cml0aW5nLCBzb2Z0d2FyZVxuICogZGlzdHJpYnV0ZWQgdW5kZXIgdGhlIExpY2Vuc2UgaXMgZGlzdHJpYnV0ZWQgb24gYW4gXCJBUyBJU1wiIEJBU0lTLFxuICogV0lUSE9VVCBXQVJSQU5USUVTIE9SIENPTkRJVElPTlMgT0YgQU5ZIEtJTkQsIGVpdGhlciBleHByZXNzIG9yIGltcGxpZWQuXG4gKiBTZWUgdGhlIExpY2Vuc2UgZm9yIHRoZSBzcGVjaWZpYyBsYW5ndWFnZSBnb3Zlcm5pbmcgcGVybWlzc2lvbnMgYW5kXG4gKiBsaW1pdGF0aW9ucyB1bmRlciB0aGUgTGljZW5zZS5cbiAqXG4qL1xuXG4vKipcbiAqIFByaXZhdGUgdXRpbGl0eSBmdW5jdGlvbnNcbiAqIEBtb2R1bGUgdXRpbHNcbiAqIEBwcml2YXRlXG4gKi9cblxuJ3VzZSBzdHJpY3QnO1xuXG52YXIgcmVnRXhwQ2hhcnMgPSAvW3xcXFxce30oKVtcXF1eJCsqPy5dL2c7XG5cbi8qKlxuICogRXNjYXBlIGNoYXJhY3RlcnMgcmVzZXJ2ZWQgaW4gcmVndWxhciBleHByZXNzaW9ucy5cbiAqXG4gKiBJZiBgc3RyaW5nYCBpcyBgdW5kZWZpbmVkYCBvciBgbnVsbGAsIHRoZSBlbXB0eSBzdHJpbmcgaXMgcmV0dXJuZWQuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IHN0cmluZyBJbnB1dCBzdHJpbmdcbiAqIEByZXR1cm4ge1N0cmluZ30gRXNjYXBlZCBzdHJpbmdcbiAqIEBzdGF0aWNcbiAqIEBwcml2YXRlXG4gKi9cbmV4cG9ydHMuZXNjYXBlUmVnRXhwQ2hhcnMgPSBmdW5jdGlvbiAoc3RyaW5nKSB7XG4gIC8vIGlzdGFuYnVsIGlnbm9yZSBpZlxuICBpZiAoIXN0cmluZykge1xuICAgIHJldHVybiAnJztcbiAgfVxuICByZXR1cm4gU3RyaW5nKHN0cmluZykucmVwbGFjZShyZWdFeHBDaGFycywgJ1xcXFwkJicpO1xufTtcblxudmFyIF9FTkNPREVfSFRNTF9SVUxFUyA9IHtcbiAgJyYnOiAnJmFtcDsnLFxuICAnPCc6ICcmbHQ7JyxcbiAgJz4nOiAnJmd0OycsXG4gICdcIic6ICcmIzM0OycsXG4gIFwiJ1wiOiAnJiMzOTsnXG59O1xudmFyIF9NQVRDSF9IVE1MID0gL1smPD4nXCJdL2c7XG5cbmZ1bmN0aW9uIGVuY29kZV9jaGFyKGMpIHtcbiAgcmV0dXJuIF9FTkNPREVfSFRNTF9SVUxFU1tjXSB8fCBjO1xufVxuXG4vKipcbiAqIFN0cmluZ2lmaWVkIHZlcnNpb24gb2YgY29uc3RhbnRzIHVzZWQgYnkge0BsaW5rIG1vZHVsZTp1dGlscy5lc2NhcGVYTUx9LlxuICpcbiAqIEl0IGlzIHVzZWQgaW4gdGhlIHByb2Nlc3Mgb2YgZ2VuZXJhdGluZyB7QGxpbmsgQ2xpZW50RnVuY3Rpb259cy5cbiAqXG4gKiBAcmVhZG9ubHlcbiAqIEB0eXBlIHtTdHJpbmd9XG4gKi9cblxudmFyIGVzY2FwZUZ1bmNTdHIgPVxuICAndmFyIF9FTkNPREVfSFRNTF9SVUxFUyA9IHtcXG4nXG4rICcgICAgICBcIiZcIjogXCImYW1wO1wiXFxuJ1xuKyAnICAgICwgXCI8XCI6IFwiJmx0O1wiXFxuJ1xuKyAnICAgICwgXCI+XCI6IFwiJmd0O1wiXFxuJ1xuKyAnICAgICwgXFwnXCJcXCc6IFwiJiMzNDtcIlxcbidcbisgJyAgICAsIFwiXFwnXCI6IFwiJiMzOTtcIlxcbidcbisgJyAgICB9XFxuJ1xuKyAnICAsIF9NQVRDSF9IVE1MID0gL1smPD5cXCdcIl0vZztcXG4nXG4rICdmdW5jdGlvbiBlbmNvZGVfY2hhcihjKSB7XFxuJ1xuKyAnICByZXR1cm4gX0VOQ09ERV9IVE1MX1JVTEVTW2NdIHx8IGM7XFxuJ1xuKyAnfTtcXG4nO1xuXG4vKipcbiAqIEVzY2FwZSBjaGFyYWN0ZXJzIHJlc2VydmVkIGluIFhNTC5cbiAqXG4gKiBJZiBgbWFya3VwYCBpcyBgdW5kZWZpbmVkYCBvciBgbnVsbGAsIHRoZSBlbXB0eSBzdHJpbmcgaXMgcmV0dXJuZWQuXG4gKlxuICogQGltcGxlbWVudHMge0VzY2FwZUNhbGxiYWNrfVxuICogQHBhcmFtIHtTdHJpbmd9IG1hcmt1cCBJbnB1dCBzdHJpbmdcbiAqIEByZXR1cm4ge1N0cmluZ30gRXNjYXBlZCBzdHJpbmdcbiAqIEBzdGF0aWNcbiAqIEBwcml2YXRlXG4gKi9cblxuZXhwb3J0cy5lc2NhcGVYTUwgPSBmdW5jdGlvbiAobWFya3VwKSB7XG4gIHJldHVybiBtYXJrdXAgPT0gdW5kZWZpbmVkXG4gICAgPyAnJ1xuICAgIDogU3RyaW5nKG1hcmt1cClcbiAgICAgIC5yZXBsYWNlKF9NQVRDSF9IVE1MLCBlbmNvZGVfY2hhcik7XG59O1xuZXhwb3J0cy5lc2NhcGVYTUwudG9TdHJpbmcgPSBmdW5jdGlvbiAoKSB7XG4gIHJldHVybiBGdW5jdGlvbi5wcm90b3R5cGUudG9TdHJpbmcuY2FsbCh0aGlzKSArICc7XFxuJyArIGVzY2FwZUZ1bmNTdHI7XG59O1xuXG4vKipcbiAqIE5haXZlIGNvcHkgb2YgcHJvcGVydGllcyBmcm9tIG9uZSBvYmplY3QgdG8gYW5vdGhlci5cbiAqIERvZXMgbm90IHJlY3Vyc2UgaW50byBub24tc2NhbGFyIHByb3BlcnRpZXNcbiAqIERvZXMgbm90IGNoZWNrIHRvIHNlZSBpZiB0aGUgcHJvcGVydHkgaGFzIGEgdmFsdWUgYmVmb3JlIGNvcHlpbmdcbiAqXG4gKiBAcGFyYW0gIHtPYmplY3R9IHRvICAgRGVzdGluYXRpb24gb2JqZWN0XG4gKiBAcGFyYW0gIHtPYmplY3R9IGZyb20gU291cmNlIG9iamVjdFxuICogQHJldHVybiB7T2JqZWN0fSAgICAgIERlc3RpbmF0aW9uIG9iamVjdFxuICogQHN0YXRpY1xuICogQHByaXZhdGVcbiAqL1xuZXhwb3J0cy5zaGFsbG93Q29weSA9IGZ1bmN0aW9uICh0bywgZnJvbSkge1xuICBmcm9tID0gZnJvbSB8fCB7fTtcbiAgZm9yICh2YXIgcCBpbiBmcm9tKSB7XG4gICAgdG9bcF0gPSBmcm9tW3BdO1xuICB9XG4gIHJldHVybiB0bztcbn07XG5cbi8qKlxuICogTmFpdmUgY29weSBvZiBhIGxpc3Qgb2Yga2V5IG5hbWVzLCBmcm9tIG9uZSBvYmplY3QgdG8gYW5vdGhlci5cbiAqIE9ubHkgY29waWVzIHByb3BlcnR5IGlmIGl0IGlzIGFjdHVhbGx5IGRlZmluZWRcbiAqIERvZXMgbm90IHJlY3Vyc2UgaW50byBub24tc2NhbGFyIHByb3BlcnRpZXNcbiAqXG4gKiBAcGFyYW0gIHtPYmplY3R9IHRvICAgRGVzdGluYXRpb24gb2JqZWN0XG4gKiBAcGFyYW0gIHtPYmplY3R9IGZyb20gU291cmNlIG9iamVjdFxuICogQHBhcmFtICB7QXJyYXl9IGxpc3QgTGlzdCBvZiBwcm9wZXJ0aWVzIHRvIGNvcHlcbiAqIEByZXR1cm4ge09iamVjdH0gICAgICBEZXN0aW5hdGlvbiBvYmplY3RcbiAqIEBzdGF0aWNcbiAqIEBwcml2YXRlXG4gKi9cbmV4cG9ydHMuc2hhbGxvd0NvcHlGcm9tTGlzdCA9IGZ1bmN0aW9uICh0bywgZnJvbSwgbGlzdCkge1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGxpc3QubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgcCA9IGxpc3RbaV07XG4gICAgaWYgKHR5cGVvZiBmcm9tW3BdICE9ICd1bmRlZmluZWQnKSB7XG4gICAgICB0b1twXSA9IGZyb21bcF07XG4gICAgfVxuICB9XG4gIHJldHVybiB0bztcbn07XG5cbi8qKlxuICogU2ltcGxlIGluLXByb2Nlc3MgY2FjaGUgaW1wbGVtZW50YXRpb24uIERvZXMgbm90IGltcGxlbWVudCBsaW1pdHMgb2YgYW55XG4gKiBzb3J0LlxuICpcbiAqIEBpbXBsZW1lbnRzIENhY2hlXG4gKiBAc3RhdGljXG4gKiBAcHJpdmF0ZVxuICovXG5leHBvcnRzLmNhY2hlID0ge1xuICBfZGF0YToge30sXG4gIHNldDogZnVuY3Rpb24gKGtleSwgdmFsKSB7XG4gICAgdGhpcy5fZGF0YVtrZXldID0gdmFsO1xuICB9LFxuICBnZXQ6IGZ1bmN0aW9uIChrZXkpIHtcbiAgICByZXR1cm4gdGhpcy5fZGF0YVtrZXldO1xuICB9LFxuICByZXNldDogZnVuY3Rpb24gKCkge1xuICAgIHRoaXMuX2RhdGEgPSB7fTtcbiAgfVxufTtcbiIsIm1vZHVsZS5leHBvcnRzPXtcbiAgXCJfYXJnc1wiOiBbXG4gICAgW1xuICAgICAgXCJlanNAMi42LjFcIixcbiAgICAgIFwiL1VzZXJzL2FhY3NoYWRoaWthcmkvRGVza3RvcC9wcmFjdGljZS9kYXJ3aW4tc3RyZWV0LWZvb2RcIlxuICAgIF1cbiAgXSxcbiAgXCJfZGV2ZWxvcG1lbnRcIjogdHJ1ZSxcbiAgXCJfZnJvbVwiOiBcImVqc0AyLjYuMVwiLFxuICBcIl9pZFwiOiBcImVqc0AyLjYuMVwiLFxuICBcIl9pbkJ1bmRsZVwiOiBmYWxzZSxcbiAgXCJfaW50ZWdyaXR5XCI6IFwic2hhNTEyLTB4eTRBL3R3ZnJSQ25raGZrOEVyRGk1RHFkQXNBcWVHeGh0NHhrQ1Vyc3ZoaGJRTnM3RSs0alYwQ043K05LSVkwYUhFNzIrWHZxdEJJWHpEMzFaYlhRPT1cIixcbiAgXCJfbG9jYXRpb25cIjogXCIvZWpzXCIsXG4gIFwiX3BoYW50b21DaGlsZHJlblwiOiB7fSxcbiAgXCJfcmVxdWVzdGVkXCI6IHtcbiAgICBcInR5cGVcIjogXCJ2ZXJzaW9uXCIsXG4gICAgXCJyZWdpc3RyeVwiOiB0cnVlLFxuICAgIFwicmF3XCI6IFwiZWpzQDIuNi4xXCIsXG4gICAgXCJuYW1lXCI6IFwiZWpzXCIsXG4gICAgXCJlc2NhcGVkTmFtZVwiOiBcImVqc1wiLFxuICAgIFwicmF3U3BlY1wiOiBcIjIuNi4xXCIsXG4gICAgXCJzYXZlU3BlY1wiOiBudWxsLFxuICAgIFwiZmV0Y2hTcGVjXCI6IFwiMi42LjFcIlxuICB9LFxuICBcIl9yZXF1aXJlZEJ5XCI6IFtcbiAgICBcIiNERVY6L1wiXG4gIF0sXG4gIFwiX3Jlc29sdmVkXCI6IFwiaHR0cHM6Ly9yZWdpc3RyeS5ucG1qcy5vcmcvZWpzLy0vZWpzLTIuNi4xLnRnelwiLFxuICBcIl9zcGVjXCI6IFwiMi42LjFcIixcbiAgXCJfd2hlcmVcIjogXCIvVXNlcnMvYWFjc2hhZGhpa2FyaS9EZXNrdG9wL3ByYWN0aWNlL2Rhcndpbi1zdHJlZXQtZm9vZFwiLFxuICBcImF1dGhvclwiOiB7XG4gICAgXCJuYW1lXCI6IFwiTWF0dGhldyBFZXJuaXNzZVwiLFxuICAgIFwiZW1haWxcIjogXCJtZGVAZmxlZWdpeC5vcmdcIixcbiAgICBcInVybFwiOiBcImh0dHA6Ly9mbGVlZ2l4Lm9yZ1wiXG4gIH0sXG4gIFwiYnVnc1wiOiB7XG4gICAgXCJ1cmxcIjogXCJodHRwczovL2dpdGh1Yi5jb20vbWRlL2Vqcy9pc3N1ZXNcIlxuICB9LFxuICBcImNvbnRyaWJ1dG9yc1wiOiBbXG4gICAge1xuICAgICAgXCJuYW1lXCI6IFwiVGltb3RoeSBHdVwiLFxuICAgICAgXCJlbWFpbFwiOiBcInRpbW90aHlndTk5QGdtYWlsLmNvbVwiLFxuICAgICAgXCJ1cmxcIjogXCJodHRwczovL3RpbW90aHlndS5naXRodWIuaW9cIlxuICAgIH1cbiAgXSxcbiAgXCJkZXBlbmRlbmNpZXNcIjoge30sXG4gIFwiZGVzY3JpcHRpb25cIjogXCJFbWJlZGRlZCBKYXZhU2NyaXB0IHRlbXBsYXRlc1wiLFxuICBcImRldkRlcGVuZGVuY2llc1wiOiB7XG4gICAgXCJicm93c2VyaWZ5XCI6IFwiXjEzLjEuMVwiLFxuICAgIFwiZXNsaW50XCI6IFwiXjQuMTQuMFwiLFxuICAgIFwiZ2l0LWRpcmVjdG9yeS1kZXBsb3lcIjogXCJeMS41LjFcIixcbiAgICBcImlzdGFuYnVsXCI6IFwifjAuNC4zXCIsXG4gICAgXCJqYWtlXCI6IFwiXjguMC4xNlwiLFxuICAgIFwianNkb2NcIjogXCJeMy40LjBcIixcbiAgICBcImxydS1jYWNoZVwiOiBcIl40LjAuMVwiLFxuICAgIFwibW9jaGFcIjogXCJeNS4wLjVcIixcbiAgICBcInVnbGlmeS1qc1wiOiBcIl4zLjMuMTZcIlxuICB9LFxuICBcImVuZ2luZXNcIjoge1xuICAgIFwibm9kZVwiOiBcIj49MC4xMC4wXCJcbiAgfSxcbiAgXCJob21lcGFnZVwiOiBcImh0dHBzOi8vZ2l0aHViLmNvbS9tZGUvZWpzXCIsXG4gIFwia2V5d29yZHNcIjogW1xuICAgIFwidGVtcGxhdGVcIixcbiAgICBcImVuZ2luZVwiLFxuICAgIFwiZWpzXCJcbiAgXSxcbiAgXCJsaWNlbnNlXCI6IFwiQXBhY2hlLTIuMFwiLFxuICBcIm1haW5cIjogXCIuL2xpYi9lanMuanNcIixcbiAgXCJuYW1lXCI6IFwiZWpzXCIsXG4gIFwicmVwb3NpdG9yeVwiOiB7XG4gICAgXCJ0eXBlXCI6IFwiZ2l0XCIsXG4gICAgXCJ1cmxcIjogXCJnaXQ6Ly9naXRodWIuY29tL21kZS9lanMuZ2l0XCJcbiAgfSxcbiAgXCJzY3JpcHRzXCI6IHtcbiAgICBcImNvdmVyYWdlXCI6IFwiaXN0YW5idWwgY292ZXIgbm9kZV9tb2R1bGVzL21vY2hhL2Jpbi9fbW9jaGFcIixcbiAgICBcImRldmRvY1wiOiBcImpha2UgZG9jW2Rldl1cIixcbiAgICBcImRvY1wiOiBcImpha2UgZG9jXCIsXG4gICAgXCJsaW50XCI6IFwiZXNsaW50IFxcXCIqKi8qLmpzXFxcIiBKYWtlZmlsZVwiLFxuICAgIFwidGVzdFwiOiBcImpha2UgdGVzdFwiXG4gIH0sXG4gIFwidmVyc2lvblwiOiBcIjIuNi4xXCJcbn1cbiIsIi8vIC5kaXJuYW1lLCAuYmFzZW5hbWUsIGFuZCAuZXh0bmFtZSBtZXRob2RzIGFyZSBleHRyYWN0ZWQgZnJvbSBOb2RlLmpzIHY4LjExLjEsXG4vLyBiYWNrcG9ydGVkIGFuZCB0cmFuc3BsaXRlZCB3aXRoIEJhYmVsLCB3aXRoIGJhY2t3YXJkcy1jb21wYXQgZml4ZXNcblxuLy8gQ29weXJpZ2h0IEpveWVudCwgSW5jLiBhbmQgb3RoZXIgTm9kZSBjb250cmlidXRvcnMuXG4vL1xuLy8gUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGFcbi8vIGNvcHkgb2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGVcbi8vIFwiU29mdHdhcmVcIiksIHRvIGRlYWwgaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZ1xuLy8gd2l0aG91dCBsaW1pdGF0aW9uIHRoZSByaWdodHMgdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLFxuLy8gZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yIHNlbGwgY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdFxuLy8gcGVyc29ucyB0byB3aG9tIHRoZSBTb2Z0d2FyZSBpcyBmdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG8gdGhlXG4vLyBmb2xsb3dpbmcgY29uZGl0aW9uczpcbi8vXG4vLyBUaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZSBpbmNsdWRlZFxuLy8gaW4gYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXG4vL1xuLy8gVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTU1xuLy8gT1IgSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRlxuLy8gTUVSQ0hBTlRBQklMSVRZLCBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTlxuLy8gTk8gRVZFTlQgU0hBTEwgVEhFIEFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sXG4vLyBEQU1BR0VTIE9SIE9USEVSIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1Jcbi8vIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLCBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEVcbi8vIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTiBUSEUgU09GVFdBUkUuXG5cbi8vIHJlc29sdmVzIC4gYW5kIC4uIGVsZW1lbnRzIGluIGEgcGF0aCBhcnJheSB3aXRoIGRpcmVjdG9yeSBuYW1lcyB0aGVyZVxuLy8gbXVzdCBiZSBubyBzbGFzaGVzLCBlbXB0eSBlbGVtZW50cywgb3IgZGV2aWNlIG5hbWVzIChjOlxcKSBpbiB0aGUgYXJyYXlcbi8vIChzbyBhbHNvIG5vIGxlYWRpbmcgYW5kIHRyYWlsaW5nIHNsYXNoZXMgLSBpdCBkb2VzIG5vdCBkaXN0aW5ndWlzaFxuLy8gcmVsYXRpdmUgYW5kIGFic29sdXRlIHBhdGhzKVxuZnVuY3Rpb24gbm9ybWFsaXplQXJyYXkocGFydHMsIGFsbG93QWJvdmVSb290KSB7XG4gIC8vIGlmIHRoZSBwYXRoIHRyaWVzIHRvIGdvIGFib3ZlIHRoZSByb290LCBgdXBgIGVuZHMgdXAgPiAwXG4gIHZhciB1cCA9IDA7XG4gIGZvciAodmFyIGkgPSBwYXJ0cy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgIHZhciBsYXN0ID0gcGFydHNbaV07XG4gICAgaWYgKGxhc3QgPT09ICcuJykge1xuICAgICAgcGFydHMuc3BsaWNlKGksIDEpO1xuICAgIH0gZWxzZSBpZiAobGFzdCA9PT0gJy4uJykge1xuICAgICAgcGFydHMuc3BsaWNlKGksIDEpO1xuICAgICAgdXArKztcbiAgICB9IGVsc2UgaWYgKHVwKSB7XG4gICAgICBwYXJ0cy5zcGxpY2UoaSwgMSk7XG4gICAgICB1cC0tO1xuICAgIH1cbiAgfVxuXG4gIC8vIGlmIHRoZSBwYXRoIGlzIGFsbG93ZWQgdG8gZ28gYWJvdmUgdGhlIHJvb3QsIHJlc3RvcmUgbGVhZGluZyAuLnNcbiAgaWYgKGFsbG93QWJvdmVSb290KSB7XG4gICAgZm9yICg7IHVwLS07IHVwKSB7XG4gICAgICBwYXJ0cy51bnNoaWZ0KCcuLicpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBwYXJ0cztcbn1cblxuLy8gcGF0aC5yZXNvbHZlKFtmcm9tIC4uLl0sIHRvKVxuLy8gcG9zaXggdmVyc2lvblxuZXhwb3J0cy5yZXNvbHZlID0gZnVuY3Rpb24oKSB7XG4gIHZhciByZXNvbHZlZFBhdGggPSAnJyxcbiAgICAgIHJlc29sdmVkQWJzb2x1dGUgPSBmYWxzZTtcblxuICBmb3IgKHZhciBpID0gYXJndW1lbnRzLmxlbmd0aCAtIDE7IGkgPj0gLTEgJiYgIXJlc29sdmVkQWJzb2x1dGU7IGktLSkge1xuICAgIHZhciBwYXRoID0gKGkgPj0gMCkgPyBhcmd1bWVudHNbaV0gOiBwcm9jZXNzLmN3ZCgpO1xuXG4gICAgLy8gU2tpcCBlbXB0eSBhbmQgaW52YWxpZCBlbnRyaWVzXG4gICAgaWYgKHR5cGVvZiBwYXRoICE9PSAnc3RyaW5nJykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignQXJndW1lbnRzIHRvIHBhdGgucmVzb2x2ZSBtdXN0IGJlIHN0cmluZ3MnKTtcbiAgICB9IGVsc2UgaWYgKCFwYXRoKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICByZXNvbHZlZFBhdGggPSBwYXRoICsgJy8nICsgcmVzb2x2ZWRQYXRoO1xuICAgIHJlc29sdmVkQWJzb2x1dGUgPSBwYXRoLmNoYXJBdCgwKSA9PT0gJy8nO1xuICB9XG5cbiAgLy8gQXQgdGhpcyBwb2ludCB0aGUgcGF0aCBzaG91bGQgYmUgcmVzb2x2ZWQgdG8gYSBmdWxsIGFic29sdXRlIHBhdGgsIGJ1dFxuICAvLyBoYW5kbGUgcmVsYXRpdmUgcGF0aHMgdG8gYmUgc2FmZSAobWlnaHQgaGFwcGVuIHdoZW4gcHJvY2Vzcy5jd2QoKSBmYWlscylcblxuICAvLyBOb3JtYWxpemUgdGhlIHBhdGhcbiAgcmVzb2x2ZWRQYXRoID0gbm9ybWFsaXplQXJyYXkoZmlsdGVyKHJlc29sdmVkUGF0aC5zcGxpdCgnLycpLCBmdW5jdGlvbihwKSB7XG4gICAgcmV0dXJuICEhcDtcbiAgfSksICFyZXNvbHZlZEFic29sdXRlKS5qb2luKCcvJyk7XG5cbiAgcmV0dXJuICgocmVzb2x2ZWRBYnNvbHV0ZSA/ICcvJyA6ICcnKSArIHJlc29sdmVkUGF0aCkgfHwgJy4nO1xufTtcblxuLy8gcGF0aC5ub3JtYWxpemUocGF0aClcbi8vIHBvc2l4IHZlcnNpb25cbmV4cG9ydHMubm9ybWFsaXplID0gZnVuY3Rpb24ocGF0aCkge1xuICB2YXIgaXNBYnNvbHV0ZSA9IGV4cG9ydHMuaXNBYnNvbHV0ZShwYXRoKSxcbiAgICAgIHRyYWlsaW5nU2xhc2ggPSBzdWJzdHIocGF0aCwgLTEpID09PSAnLyc7XG5cbiAgLy8gTm9ybWFsaXplIHRoZSBwYXRoXG4gIHBhdGggPSBub3JtYWxpemVBcnJheShmaWx0ZXIocGF0aC5zcGxpdCgnLycpLCBmdW5jdGlvbihwKSB7XG4gICAgcmV0dXJuICEhcDtcbiAgfSksICFpc0Fic29sdXRlKS5qb2luKCcvJyk7XG5cbiAgaWYgKCFwYXRoICYmICFpc0Fic29sdXRlKSB7XG4gICAgcGF0aCA9ICcuJztcbiAgfVxuICBpZiAocGF0aCAmJiB0cmFpbGluZ1NsYXNoKSB7XG4gICAgcGF0aCArPSAnLyc7XG4gIH1cblxuICByZXR1cm4gKGlzQWJzb2x1dGUgPyAnLycgOiAnJykgKyBwYXRoO1xufTtcblxuLy8gcG9zaXggdmVyc2lvblxuZXhwb3J0cy5pc0Fic29sdXRlID0gZnVuY3Rpb24ocGF0aCkge1xuICByZXR1cm4gcGF0aC5jaGFyQXQoMCkgPT09ICcvJztcbn07XG5cbi8vIHBvc2l4IHZlcnNpb25cbmV4cG9ydHMuam9pbiA9IGZ1bmN0aW9uKCkge1xuICB2YXIgcGF0aHMgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbChhcmd1bWVudHMsIDApO1xuICByZXR1cm4gZXhwb3J0cy5ub3JtYWxpemUoZmlsdGVyKHBhdGhzLCBmdW5jdGlvbihwLCBpbmRleCkge1xuICAgIGlmICh0eXBlb2YgcCAhPT0gJ3N0cmluZycpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0FyZ3VtZW50cyB0byBwYXRoLmpvaW4gbXVzdCBiZSBzdHJpbmdzJyk7XG4gICAgfVxuICAgIHJldHVybiBwO1xuICB9KS5qb2luKCcvJykpO1xufTtcblxuXG4vLyBwYXRoLnJlbGF0aXZlKGZyb20sIHRvKVxuLy8gcG9zaXggdmVyc2lvblxuZXhwb3J0cy5yZWxhdGl2ZSA9IGZ1bmN0aW9uKGZyb20sIHRvKSB7XG4gIGZyb20gPSBleHBvcnRzLnJlc29sdmUoZnJvbSkuc3Vic3RyKDEpO1xuICB0byA9IGV4cG9ydHMucmVzb2x2ZSh0bykuc3Vic3RyKDEpO1xuXG4gIGZ1bmN0aW9uIHRyaW0oYXJyKSB7XG4gICAgdmFyIHN0YXJ0ID0gMDtcbiAgICBmb3IgKDsgc3RhcnQgPCBhcnIubGVuZ3RoOyBzdGFydCsrKSB7XG4gICAgICBpZiAoYXJyW3N0YXJ0XSAhPT0gJycpIGJyZWFrO1xuICAgIH1cblxuICAgIHZhciBlbmQgPSBhcnIubGVuZ3RoIC0gMTtcbiAgICBmb3IgKDsgZW5kID49IDA7IGVuZC0tKSB7XG4gICAgICBpZiAoYXJyW2VuZF0gIT09ICcnKSBicmVhaztcbiAgICB9XG5cbiAgICBpZiAoc3RhcnQgPiBlbmQpIHJldHVybiBbXTtcbiAgICByZXR1cm4gYXJyLnNsaWNlKHN0YXJ0LCBlbmQgLSBzdGFydCArIDEpO1xuICB9XG5cbiAgdmFyIGZyb21QYXJ0cyA9IHRyaW0oZnJvbS5zcGxpdCgnLycpKTtcbiAgdmFyIHRvUGFydHMgPSB0cmltKHRvLnNwbGl0KCcvJykpO1xuXG4gIHZhciBsZW5ndGggPSBNYXRoLm1pbihmcm9tUGFydHMubGVuZ3RoLCB0b1BhcnRzLmxlbmd0aCk7XG4gIHZhciBzYW1lUGFydHNMZW5ndGggPSBsZW5ndGg7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICBpZiAoZnJvbVBhcnRzW2ldICE9PSB0b1BhcnRzW2ldKSB7XG4gICAgICBzYW1lUGFydHNMZW5ndGggPSBpO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG5cbiAgdmFyIG91dHB1dFBhcnRzID0gW107XG4gIGZvciAodmFyIGkgPSBzYW1lUGFydHNMZW5ndGg7IGkgPCBmcm9tUGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICBvdXRwdXRQYXJ0cy5wdXNoKCcuLicpO1xuICB9XG5cbiAgb3V0cHV0UGFydHMgPSBvdXRwdXRQYXJ0cy5jb25jYXQodG9QYXJ0cy5zbGljZShzYW1lUGFydHNMZW5ndGgpKTtcblxuICByZXR1cm4gb3V0cHV0UGFydHMuam9pbignLycpO1xufTtcblxuZXhwb3J0cy5zZXAgPSAnLyc7XG5leHBvcnRzLmRlbGltaXRlciA9ICc6JztcblxuZXhwb3J0cy5kaXJuYW1lID0gZnVuY3Rpb24gKHBhdGgpIHtcbiAgaWYgKHR5cGVvZiBwYXRoICE9PSAnc3RyaW5nJykgcGF0aCA9IHBhdGggKyAnJztcbiAgaWYgKHBhdGgubGVuZ3RoID09PSAwKSByZXR1cm4gJy4nO1xuICB2YXIgY29kZSA9IHBhdGguY2hhckNvZGVBdCgwKTtcbiAgdmFyIGhhc1Jvb3QgPSBjb2RlID09PSA0NyAvKi8qLztcbiAgdmFyIGVuZCA9IC0xO1xuICB2YXIgbWF0Y2hlZFNsYXNoID0gdHJ1ZTtcbiAgZm9yICh2YXIgaSA9IHBhdGgubGVuZ3RoIC0gMTsgaSA+PSAxOyAtLWkpIHtcbiAgICBjb2RlID0gcGF0aC5jaGFyQ29kZUF0KGkpO1xuICAgIGlmIChjb2RlID09PSA0NyAvKi8qLykge1xuICAgICAgICBpZiAoIW1hdGNoZWRTbGFzaCkge1xuICAgICAgICAgIGVuZCA9IGk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAvLyBXZSBzYXcgdGhlIGZpcnN0IG5vbi1wYXRoIHNlcGFyYXRvclxuICAgICAgbWF0Y2hlZFNsYXNoID0gZmFsc2U7XG4gICAgfVxuICB9XG5cbiAgaWYgKGVuZCA9PT0gLTEpIHJldHVybiBoYXNSb290ID8gJy8nIDogJy4nO1xuICBpZiAoaGFzUm9vdCAmJiBlbmQgPT09IDEpIHtcbiAgICAvLyByZXR1cm4gJy8vJztcbiAgICAvLyBCYWNrd2FyZHMtY29tcGF0IGZpeDpcbiAgICByZXR1cm4gJy8nO1xuICB9XG4gIHJldHVybiBwYXRoLnNsaWNlKDAsIGVuZCk7XG59O1xuXG5mdW5jdGlvbiBiYXNlbmFtZShwYXRoKSB7XG4gIGlmICh0eXBlb2YgcGF0aCAhPT0gJ3N0cmluZycpIHBhdGggPSBwYXRoICsgJyc7XG5cbiAgdmFyIHN0YXJ0ID0gMDtcbiAgdmFyIGVuZCA9IC0xO1xuICB2YXIgbWF0Y2hlZFNsYXNoID0gdHJ1ZTtcbiAgdmFyIGk7XG5cbiAgZm9yIChpID0gcGF0aC5sZW5ndGggLSAxOyBpID49IDA7IC0taSkge1xuICAgIGlmIChwYXRoLmNoYXJDb2RlQXQoaSkgPT09IDQ3IC8qLyovKSB7XG4gICAgICAgIC8vIElmIHdlIHJlYWNoZWQgYSBwYXRoIHNlcGFyYXRvciB0aGF0IHdhcyBub3QgcGFydCBvZiBhIHNldCBvZiBwYXRoXG4gICAgICAgIC8vIHNlcGFyYXRvcnMgYXQgdGhlIGVuZCBvZiB0aGUgc3RyaW5nLCBzdG9wIG5vd1xuICAgICAgICBpZiAoIW1hdGNoZWRTbGFzaCkge1xuICAgICAgICAgIHN0YXJ0ID0gaSArIDE7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAoZW5kID09PSAtMSkge1xuICAgICAgLy8gV2Ugc2F3IHRoZSBmaXJzdCBub24tcGF0aCBzZXBhcmF0b3IsIG1hcmsgdGhpcyBhcyB0aGUgZW5kIG9mIG91clxuICAgICAgLy8gcGF0aCBjb21wb25lbnRcbiAgICAgIG1hdGNoZWRTbGFzaCA9IGZhbHNlO1xuICAgICAgZW5kID0gaSArIDE7XG4gICAgfVxuICB9XG5cbiAgaWYgKGVuZCA9PT0gLTEpIHJldHVybiAnJztcbiAgcmV0dXJuIHBhdGguc2xpY2Uoc3RhcnQsIGVuZCk7XG59XG5cbi8vIFVzZXMgYSBtaXhlZCBhcHByb2FjaCBmb3IgYmFja3dhcmRzLWNvbXBhdGliaWxpdHksIGFzIGV4dCBiZWhhdmlvciBjaGFuZ2VkXG4vLyBpbiBuZXcgTm9kZS5qcyB2ZXJzaW9ucywgc28gb25seSBiYXNlbmFtZSgpIGFib3ZlIGlzIGJhY2twb3J0ZWQgaGVyZVxuZXhwb3J0cy5iYXNlbmFtZSA9IGZ1bmN0aW9uIChwYXRoLCBleHQpIHtcbiAgdmFyIGYgPSBiYXNlbmFtZShwYXRoKTtcbiAgaWYgKGV4dCAmJiBmLnN1YnN0cigtMSAqIGV4dC5sZW5ndGgpID09PSBleHQpIHtcbiAgICBmID0gZi5zdWJzdHIoMCwgZi5sZW5ndGggLSBleHQubGVuZ3RoKTtcbiAgfVxuICByZXR1cm4gZjtcbn07XG5cbmV4cG9ydHMuZXh0bmFtZSA9IGZ1bmN0aW9uIChwYXRoKSB7XG4gIGlmICh0eXBlb2YgcGF0aCAhPT0gJ3N0cmluZycpIHBhdGggPSBwYXRoICsgJyc7XG4gIHZhciBzdGFydERvdCA9IC0xO1xuICB2YXIgc3RhcnRQYXJ0ID0gMDtcbiAgdmFyIGVuZCA9IC0xO1xuICB2YXIgbWF0Y2hlZFNsYXNoID0gdHJ1ZTtcbiAgLy8gVHJhY2sgdGhlIHN0YXRlIG9mIGNoYXJhY3RlcnMgKGlmIGFueSkgd2Ugc2VlIGJlZm9yZSBvdXIgZmlyc3QgZG90IGFuZFxuICAvLyBhZnRlciBhbnkgcGF0aCBzZXBhcmF0b3Igd2UgZmluZFxuICB2YXIgcHJlRG90U3RhdGUgPSAwO1xuICBmb3IgKHZhciBpID0gcGF0aC5sZW5ndGggLSAxOyBpID49IDA7IC0taSkge1xuICAgIHZhciBjb2RlID0gcGF0aC5jaGFyQ29kZUF0KGkpO1xuICAgIGlmIChjb2RlID09PSA0NyAvKi8qLykge1xuICAgICAgICAvLyBJZiB3ZSByZWFjaGVkIGEgcGF0aCBzZXBhcmF0b3IgdGhhdCB3YXMgbm90IHBhcnQgb2YgYSBzZXQgb2YgcGF0aFxuICAgICAgICAvLyBzZXBhcmF0b3JzIGF0IHRoZSBlbmQgb2YgdGhlIHN0cmluZywgc3RvcCBub3dcbiAgICAgICAgaWYgKCFtYXRjaGVkU2xhc2gpIHtcbiAgICAgICAgICBzdGFydFBhcnQgPSBpICsgMTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICBpZiAoZW5kID09PSAtMSkge1xuICAgICAgLy8gV2Ugc2F3IHRoZSBmaXJzdCBub24tcGF0aCBzZXBhcmF0b3IsIG1hcmsgdGhpcyBhcyB0aGUgZW5kIG9mIG91clxuICAgICAgLy8gZXh0ZW5zaW9uXG4gICAgICBtYXRjaGVkU2xhc2ggPSBmYWxzZTtcbiAgICAgIGVuZCA9IGkgKyAxO1xuICAgIH1cbiAgICBpZiAoY29kZSA9PT0gNDYgLyouKi8pIHtcbiAgICAgICAgLy8gSWYgdGhpcyBpcyBvdXIgZmlyc3QgZG90LCBtYXJrIGl0IGFzIHRoZSBzdGFydCBvZiBvdXIgZXh0ZW5zaW9uXG4gICAgICAgIGlmIChzdGFydERvdCA9PT0gLTEpXG4gICAgICAgICAgc3RhcnREb3QgPSBpO1xuICAgICAgICBlbHNlIGlmIChwcmVEb3RTdGF0ZSAhPT0gMSlcbiAgICAgICAgICBwcmVEb3RTdGF0ZSA9IDE7XG4gICAgfSBlbHNlIGlmIChzdGFydERvdCAhPT0gLTEpIHtcbiAgICAgIC8vIFdlIHNhdyBhIG5vbi1kb3QgYW5kIG5vbi1wYXRoIHNlcGFyYXRvciBiZWZvcmUgb3VyIGRvdCwgc28gd2Ugc2hvdWxkXG4gICAgICAvLyBoYXZlIGEgZ29vZCBjaGFuY2UgYXQgaGF2aW5nIGEgbm9uLWVtcHR5IGV4dGVuc2lvblxuICAgICAgcHJlRG90U3RhdGUgPSAtMTtcbiAgICB9XG4gIH1cblxuICBpZiAoc3RhcnREb3QgPT09IC0xIHx8IGVuZCA9PT0gLTEgfHxcbiAgICAgIC8vIFdlIHNhdyBhIG5vbi1kb3QgY2hhcmFjdGVyIGltbWVkaWF0ZWx5IGJlZm9yZSB0aGUgZG90XG4gICAgICBwcmVEb3RTdGF0ZSA9PT0gMCB8fFxuICAgICAgLy8gVGhlIChyaWdodC1tb3N0KSB0cmltbWVkIHBhdGggY29tcG9uZW50IGlzIGV4YWN0bHkgJy4uJ1xuICAgICAgcHJlRG90U3RhdGUgPT09IDEgJiYgc3RhcnREb3QgPT09IGVuZCAtIDEgJiYgc3RhcnREb3QgPT09IHN0YXJ0UGFydCArIDEpIHtcbiAgICByZXR1cm4gJyc7XG4gIH1cbiAgcmV0dXJuIHBhdGguc2xpY2Uoc3RhcnREb3QsIGVuZCk7XG59O1xuXG5mdW5jdGlvbiBmaWx0ZXIgKHhzLCBmKSB7XG4gICAgaWYgKHhzLmZpbHRlcikgcmV0dXJuIHhzLmZpbHRlcihmKTtcbiAgICB2YXIgcmVzID0gW107XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCB4cy5sZW5ndGg7IGkrKykge1xuICAgICAgICBpZiAoZih4c1tpXSwgaSwgeHMpKSByZXMucHVzaCh4c1tpXSk7XG4gICAgfVxuICAgIHJldHVybiByZXM7XG59XG5cbi8vIFN0cmluZy5wcm90b3R5cGUuc3Vic3RyIC0gbmVnYXRpdmUgaW5kZXggZG9uJ3Qgd29yayBpbiBJRThcbnZhciBzdWJzdHIgPSAnYWInLnN1YnN0cigtMSkgPT09ICdiJ1xuICAgID8gZnVuY3Rpb24gKHN0ciwgc3RhcnQsIGxlbikgeyByZXR1cm4gc3RyLnN1YnN0cihzdGFydCwgbGVuKSB9XG4gICAgOiBmdW5jdGlvbiAoc3RyLCBzdGFydCwgbGVuKSB7XG4gICAgICAgIGlmIChzdGFydCA8IDApIHN0YXJ0ID0gc3RyLmxlbmd0aCArIHN0YXJ0O1xuICAgICAgICByZXR1cm4gc3RyLnN1YnN0cihzdGFydCwgbGVuKTtcbiAgICB9XG47XG4iLCIvLyBzaGltIGZvciB1c2luZyBwcm9jZXNzIGluIGJyb3dzZXJcbnZhciBwcm9jZXNzID0gbW9kdWxlLmV4cG9ydHMgPSB7fTtcblxuLy8gY2FjaGVkIGZyb20gd2hhdGV2ZXIgZ2xvYmFsIGlzIHByZXNlbnQgc28gdGhhdCB0ZXN0IHJ1bm5lcnMgdGhhdCBzdHViIGl0XG4vLyBkb24ndCBicmVhayB0aGluZ3MuICBCdXQgd2UgbmVlZCB0byB3cmFwIGl0IGluIGEgdHJ5IGNhdGNoIGluIGNhc2UgaXQgaXNcbi8vIHdyYXBwZWQgaW4gc3RyaWN0IG1vZGUgY29kZSB3aGljaCBkb2Vzbid0IGRlZmluZSBhbnkgZ2xvYmFscy4gIEl0J3MgaW5zaWRlIGFcbi8vIGZ1bmN0aW9uIGJlY2F1c2UgdHJ5L2NhdGNoZXMgZGVvcHRpbWl6ZSBpbiBjZXJ0YWluIGVuZ2luZXMuXG5cbnZhciBjYWNoZWRTZXRUaW1lb3V0O1xudmFyIGNhY2hlZENsZWFyVGltZW91dDtcblxuZnVuY3Rpb24gZGVmYXVsdFNldFRpbW91dCgpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3NldFRpbWVvdXQgaGFzIG5vdCBiZWVuIGRlZmluZWQnKTtcbn1cbmZ1bmN0aW9uIGRlZmF1bHRDbGVhclRpbWVvdXQgKCkge1xuICAgIHRocm93IG5ldyBFcnJvcignY2xlYXJUaW1lb3V0IGhhcyBub3QgYmVlbiBkZWZpbmVkJyk7XG59XG4oZnVuY3Rpb24gKCkge1xuICAgIHRyeSB7XG4gICAgICAgIGlmICh0eXBlb2Ygc2V0VGltZW91dCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgY2FjaGVkU2V0VGltZW91dCA9IHNldFRpbWVvdXQ7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjYWNoZWRTZXRUaW1lb3V0ID0gZGVmYXVsdFNldFRpbW91dDtcbiAgICAgICAgfVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgY2FjaGVkU2V0VGltZW91dCA9IGRlZmF1bHRTZXRUaW1vdXQ7XG4gICAgfVxuICAgIHRyeSB7XG4gICAgICAgIGlmICh0eXBlb2YgY2xlYXJUaW1lb3V0ID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgICBjYWNoZWRDbGVhclRpbWVvdXQgPSBjbGVhclRpbWVvdXQ7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjYWNoZWRDbGVhclRpbWVvdXQgPSBkZWZhdWx0Q2xlYXJUaW1lb3V0O1xuICAgICAgICB9XG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjYWNoZWRDbGVhclRpbWVvdXQgPSBkZWZhdWx0Q2xlYXJUaW1lb3V0O1xuICAgIH1cbn0gKCkpXG5mdW5jdGlvbiBydW5UaW1lb3V0KGZ1bikge1xuICAgIGlmIChjYWNoZWRTZXRUaW1lb3V0ID09PSBzZXRUaW1lb3V0KSB7XG4gICAgICAgIC8vbm9ybWFsIGVudmlyb21lbnRzIGluIHNhbmUgc2l0dWF0aW9uc1xuICAgICAgICByZXR1cm4gc2V0VGltZW91dChmdW4sIDApO1xuICAgIH1cbiAgICAvLyBpZiBzZXRUaW1lb3V0IHdhc24ndCBhdmFpbGFibGUgYnV0IHdhcyBsYXR0ZXIgZGVmaW5lZFxuICAgIGlmICgoY2FjaGVkU2V0VGltZW91dCA9PT0gZGVmYXVsdFNldFRpbW91dCB8fCAhY2FjaGVkU2V0VGltZW91dCkgJiYgc2V0VGltZW91dCkge1xuICAgICAgICBjYWNoZWRTZXRUaW1lb3V0ID0gc2V0VGltZW91dDtcbiAgICAgICAgcmV0dXJuIHNldFRpbWVvdXQoZnVuLCAwKTtcbiAgICB9XG4gICAgdHJ5IHtcbiAgICAgICAgLy8gd2hlbiB3aGVuIHNvbWVib2R5IGhhcyBzY3Jld2VkIHdpdGggc2V0VGltZW91dCBidXQgbm8gSS5FLiBtYWRkbmVzc1xuICAgICAgICByZXR1cm4gY2FjaGVkU2V0VGltZW91dChmdW4sIDApO1xuICAgIH0gY2F0Y2goZSl7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICAvLyBXaGVuIHdlIGFyZSBpbiBJLkUuIGJ1dCB0aGUgc2NyaXB0IGhhcyBiZWVuIGV2YWxlZCBzbyBJLkUuIGRvZXNuJ3QgdHJ1c3QgdGhlIGdsb2JhbCBvYmplY3Qgd2hlbiBjYWxsZWQgbm9ybWFsbHlcbiAgICAgICAgICAgIHJldHVybiBjYWNoZWRTZXRUaW1lb3V0LmNhbGwobnVsbCwgZnVuLCAwKTtcbiAgICAgICAgfSBjYXRjaChlKXtcbiAgICAgICAgICAgIC8vIHNhbWUgYXMgYWJvdmUgYnV0IHdoZW4gaXQncyBhIHZlcnNpb24gb2YgSS5FLiB0aGF0IG11c3QgaGF2ZSB0aGUgZ2xvYmFsIG9iamVjdCBmb3IgJ3RoaXMnLCBob3BmdWxseSBvdXIgY29udGV4dCBjb3JyZWN0IG90aGVyd2lzZSBpdCB3aWxsIHRocm93IGEgZ2xvYmFsIGVycm9yXG4gICAgICAgICAgICByZXR1cm4gY2FjaGVkU2V0VGltZW91dC5jYWxsKHRoaXMsIGZ1biwgMCk7XG4gICAgICAgIH1cbiAgICB9XG5cblxufVxuZnVuY3Rpb24gcnVuQ2xlYXJUaW1lb3V0KG1hcmtlcikge1xuICAgIGlmIChjYWNoZWRDbGVhclRpbWVvdXQgPT09IGNsZWFyVGltZW91dCkge1xuICAgICAgICAvL25vcm1hbCBlbnZpcm9tZW50cyBpbiBzYW5lIHNpdHVhdGlvbnNcbiAgICAgICAgcmV0dXJuIGNsZWFyVGltZW91dChtYXJrZXIpO1xuICAgIH1cbiAgICAvLyBpZiBjbGVhclRpbWVvdXQgd2Fzbid0IGF2YWlsYWJsZSBidXQgd2FzIGxhdHRlciBkZWZpbmVkXG4gICAgaWYgKChjYWNoZWRDbGVhclRpbWVvdXQgPT09IGRlZmF1bHRDbGVhclRpbWVvdXQgfHwgIWNhY2hlZENsZWFyVGltZW91dCkgJiYgY2xlYXJUaW1lb3V0KSB7XG4gICAgICAgIGNhY2hlZENsZWFyVGltZW91dCA9IGNsZWFyVGltZW91dDtcbiAgICAgICAgcmV0dXJuIGNsZWFyVGltZW91dChtYXJrZXIpO1xuICAgIH1cbiAgICB0cnkge1xuICAgICAgICAvLyB3aGVuIHdoZW4gc29tZWJvZHkgaGFzIHNjcmV3ZWQgd2l0aCBzZXRUaW1lb3V0IGJ1dCBubyBJLkUuIG1hZGRuZXNzXG4gICAgICAgIHJldHVybiBjYWNoZWRDbGVhclRpbWVvdXQobWFya2VyKTtcbiAgICB9IGNhdGNoIChlKXtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIC8vIFdoZW4gd2UgYXJlIGluIEkuRS4gYnV0IHRoZSBzY3JpcHQgaGFzIGJlZW4gZXZhbGVkIHNvIEkuRS4gZG9lc24ndCAgdHJ1c3QgdGhlIGdsb2JhbCBvYmplY3Qgd2hlbiBjYWxsZWQgbm9ybWFsbHlcbiAgICAgICAgICAgIHJldHVybiBjYWNoZWRDbGVhclRpbWVvdXQuY2FsbChudWxsLCBtYXJrZXIpO1xuICAgICAgICB9IGNhdGNoIChlKXtcbiAgICAgICAgICAgIC8vIHNhbWUgYXMgYWJvdmUgYnV0IHdoZW4gaXQncyBhIHZlcnNpb24gb2YgSS5FLiB0aGF0IG11c3QgaGF2ZSB0aGUgZ2xvYmFsIG9iamVjdCBmb3IgJ3RoaXMnLCBob3BmdWxseSBvdXIgY29udGV4dCBjb3JyZWN0IG90aGVyd2lzZSBpdCB3aWxsIHRocm93IGEgZ2xvYmFsIGVycm9yLlxuICAgICAgICAgICAgLy8gU29tZSB2ZXJzaW9ucyBvZiBJLkUuIGhhdmUgZGlmZmVyZW50IHJ1bGVzIGZvciBjbGVhclRpbWVvdXQgdnMgc2V0VGltZW91dFxuICAgICAgICAgICAgcmV0dXJuIGNhY2hlZENsZWFyVGltZW91dC5jYWxsKHRoaXMsIG1hcmtlcik7XG4gICAgICAgIH1cbiAgICB9XG5cblxuXG59XG52YXIgcXVldWUgPSBbXTtcbnZhciBkcmFpbmluZyA9IGZhbHNlO1xudmFyIGN1cnJlbnRRdWV1ZTtcbnZhciBxdWV1ZUluZGV4ID0gLTE7XG5cbmZ1bmN0aW9uIGNsZWFuVXBOZXh0VGljaygpIHtcbiAgICBpZiAoIWRyYWluaW5nIHx8ICFjdXJyZW50UXVldWUpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBkcmFpbmluZyA9IGZhbHNlO1xuICAgIGlmIChjdXJyZW50UXVldWUubGVuZ3RoKSB7XG4gICAgICAgIHF1ZXVlID0gY3VycmVudFF1ZXVlLmNvbmNhdChxdWV1ZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgcXVldWVJbmRleCA9IC0xO1xuICAgIH1cbiAgICBpZiAocXVldWUubGVuZ3RoKSB7XG4gICAgICAgIGRyYWluUXVldWUoKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGRyYWluUXVldWUoKSB7XG4gICAgaWYgKGRyYWluaW5nKSB7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdmFyIHRpbWVvdXQgPSBydW5UaW1lb3V0KGNsZWFuVXBOZXh0VGljayk7XG4gICAgZHJhaW5pbmcgPSB0cnVlO1xuXG4gICAgdmFyIGxlbiA9IHF1ZXVlLmxlbmd0aDtcbiAgICB3aGlsZShsZW4pIHtcbiAgICAgICAgY3VycmVudFF1ZXVlID0gcXVldWU7XG4gICAgICAgIHF1ZXVlID0gW107XG4gICAgICAgIHdoaWxlICgrK3F1ZXVlSW5kZXggPCBsZW4pIHtcbiAgICAgICAgICAgIGlmIChjdXJyZW50UXVldWUpIHtcbiAgICAgICAgICAgICAgICBjdXJyZW50UXVldWVbcXVldWVJbmRleF0ucnVuKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcXVldWVJbmRleCA9IC0xO1xuICAgICAgICBsZW4gPSBxdWV1ZS5sZW5ndGg7XG4gICAgfVxuICAgIGN1cnJlbnRRdWV1ZSA9IG51bGw7XG4gICAgZHJhaW5pbmcgPSBmYWxzZTtcbiAgICBydW5DbGVhclRpbWVvdXQodGltZW91dCk7XG59XG5cbnByb2Nlc3MubmV4dFRpY2sgPSBmdW5jdGlvbiAoZnVuKSB7XG4gICAgdmFyIGFyZ3MgPSBuZXcgQXJyYXkoYXJndW1lbnRzLmxlbmd0aCAtIDEpO1xuICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID4gMSkge1xuICAgICAgICBmb3IgKHZhciBpID0gMTsgaSA8IGFyZ3VtZW50cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgYXJnc1tpIC0gMV0gPSBhcmd1bWVudHNbaV07XG4gICAgICAgIH1cbiAgICB9XG4gICAgcXVldWUucHVzaChuZXcgSXRlbShmdW4sIGFyZ3MpKTtcbiAgICBpZiAocXVldWUubGVuZ3RoID09PSAxICYmICFkcmFpbmluZykge1xuICAgICAgICBydW5UaW1lb3V0KGRyYWluUXVldWUpO1xuICAgIH1cbn07XG5cbi8vIHY4IGxpa2VzIHByZWRpY3RpYmxlIG9iamVjdHNcbmZ1bmN0aW9uIEl0ZW0oZnVuLCBhcnJheSkge1xuICAgIHRoaXMuZnVuID0gZnVuO1xuICAgIHRoaXMuYXJyYXkgPSBhcnJheTtcbn1cbkl0ZW0ucHJvdG90eXBlLnJ1biA9IGZ1bmN0aW9uICgpIHtcbiAgICB0aGlzLmZ1bi5hcHBseShudWxsLCB0aGlzLmFycmF5KTtcbn07XG5wcm9jZXNzLnRpdGxlID0gJ2Jyb3dzZXInO1xucHJvY2Vzcy5icm93c2VyID0gdHJ1ZTtcbnByb2Nlc3MuZW52ID0ge307XG5wcm9jZXNzLmFyZ3YgPSBbXTtcbnByb2Nlc3MudmVyc2lvbiA9ICcnOyAvLyBlbXB0eSBzdHJpbmcgdG8gYXZvaWQgcmVnZXhwIGlzc3Vlc1xucHJvY2Vzcy52ZXJzaW9ucyA9IHt9O1xuXG5mdW5jdGlvbiBub29wKCkge31cblxucHJvY2Vzcy5vbiA9IG5vb3A7XG5wcm9jZXNzLmFkZExpc3RlbmVyID0gbm9vcDtcbnByb2Nlc3Mub25jZSA9IG5vb3A7XG5wcm9jZXNzLm9mZiA9IG5vb3A7XG5wcm9jZXNzLnJlbW92ZUxpc3RlbmVyID0gbm9vcDtcbnByb2Nlc3MucmVtb3ZlQWxsTGlzdGVuZXJzID0gbm9vcDtcbnByb2Nlc3MuZW1pdCA9IG5vb3A7XG5wcm9jZXNzLnByZXBlbmRMaXN0ZW5lciA9IG5vb3A7XG5wcm9jZXNzLnByZXBlbmRPbmNlTGlzdGVuZXIgPSBub29wO1xuXG5wcm9jZXNzLmxpc3RlbmVycyA9IGZ1bmN0aW9uIChuYW1lKSB7IHJldHVybiBbXSB9XG5cbnByb2Nlc3MuYmluZGluZyA9IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwcm9jZXNzLmJpbmRpbmcgaXMgbm90IHN1cHBvcnRlZCcpO1xufTtcblxucHJvY2Vzcy5jd2QgPSBmdW5jdGlvbiAoKSB7IHJldHVybiAnLycgfTtcbnByb2Nlc3MuY2hkaXIgPSBmdW5jdGlvbiAoZGlyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwcm9jZXNzLmNoZGlyIGlzIG5vdCBzdXBwb3J0ZWQnKTtcbn07XG5wcm9jZXNzLnVtYXNrID0gZnVuY3Rpb24oKSB7IHJldHVybiAwOyB9O1xuIiwiKGZ1bmN0aW9uKHNlbGYpIHtcbiAgJ3VzZSBzdHJpY3QnO1xuXG4gIGlmIChzZWxmLmZldGNoKSB7XG4gICAgcmV0dXJuXG4gIH1cblxuICB2YXIgc3VwcG9ydCA9IHtcbiAgICBzZWFyY2hQYXJhbXM6ICdVUkxTZWFyY2hQYXJhbXMnIGluIHNlbGYsXG4gICAgaXRlcmFibGU6ICdTeW1ib2wnIGluIHNlbGYgJiYgJ2l0ZXJhdG9yJyBpbiBTeW1ib2wsXG4gICAgYmxvYjogJ0ZpbGVSZWFkZXInIGluIHNlbGYgJiYgJ0Jsb2InIGluIHNlbGYgJiYgKGZ1bmN0aW9uKCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgbmV3IEJsb2IoKVxuICAgICAgICByZXR1cm4gdHJ1ZVxuICAgICAgfSBjYXRjaChlKSB7XG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgfVxuICAgIH0pKCksXG4gICAgZm9ybURhdGE6ICdGb3JtRGF0YScgaW4gc2VsZixcbiAgICBhcnJheUJ1ZmZlcjogJ0FycmF5QnVmZmVyJyBpbiBzZWxmXG4gIH1cblxuICBpZiAoc3VwcG9ydC5hcnJheUJ1ZmZlcikge1xuICAgIHZhciB2aWV3Q2xhc3NlcyA9IFtcbiAgICAgICdbb2JqZWN0IEludDhBcnJheV0nLFxuICAgICAgJ1tvYmplY3QgVWludDhBcnJheV0nLFxuICAgICAgJ1tvYmplY3QgVWludDhDbGFtcGVkQXJyYXldJyxcbiAgICAgICdbb2JqZWN0IEludDE2QXJyYXldJyxcbiAgICAgICdbb2JqZWN0IFVpbnQxNkFycmF5XScsXG4gICAgICAnW29iamVjdCBJbnQzMkFycmF5XScsXG4gICAgICAnW29iamVjdCBVaW50MzJBcnJheV0nLFxuICAgICAgJ1tvYmplY3QgRmxvYXQzMkFycmF5XScsXG4gICAgICAnW29iamVjdCBGbG9hdDY0QXJyYXldJ1xuICAgIF1cblxuICAgIHZhciBpc0RhdGFWaWV3ID0gZnVuY3Rpb24ob2JqKSB7XG4gICAgICByZXR1cm4gb2JqICYmIERhdGFWaWV3LnByb3RvdHlwZS5pc1Byb3RvdHlwZU9mKG9iailcbiAgICB9XG5cbiAgICB2YXIgaXNBcnJheUJ1ZmZlclZpZXcgPSBBcnJheUJ1ZmZlci5pc1ZpZXcgfHwgZnVuY3Rpb24ob2JqKSB7XG4gICAgICByZXR1cm4gb2JqICYmIHZpZXdDbGFzc2VzLmluZGV4T2YoT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKG9iaikpID4gLTFcbiAgICB9XG4gIH1cblxuICBmdW5jdGlvbiBub3JtYWxpemVOYW1lKG5hbWUpIHtcbiAgICBpZiAodHlwZW9mIG5hbWUgIT09ICdzdHJpbmcnKSB7XG4gICAgICBuYW1lID0gU3RyaW5nKG5hbWUpXG4gICAgfVxuICAgIGlmICgvW15hLXowLTlcXC0jJCUmJyorLlxcXl9gfH5dL2kudGVzdChuYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignSW52YWxpZCBjaGFyYWN0ZXIgaW4gaGVhZGVyIGZpZWxkIG5hbWUnKVxuICAgIH1cbiAgICByZXR1cm4gbmFtZS50b0xvd2VyQ2FzZSgpXG4gIH1cblxuICBmdW5jdGlvbiBub3JtYWxpemVWYWx1ZSh2YWx1ZSkge1xuICAgIGlmICh0eXBlb2YgdmFsdWUgIT09ICdzdHJpbmcnKSB7XG4gICAgICB2YWx1ZSA9IFN0cmluZyh2YWx1ZSlcbiAgICB9XG4gICAgcmV0dXJuIHZhbHVlXG4gIH1cblxuICAvLyBCdWlsZCBhIGRlc3RydWN0aXZlIGl0ZXJhdG9yIGZvciB0aGUgdmFsdWUgbGlzdFxuICBmdW5jdGlvbiBpdGVyYXRvckZvcihpdGVtcykge1xuICAgIHZhciBpdGVyYXRvciA9IHtcbiAgICAgIG5leHQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICB2YXIgdmFsdWUgPSBpdGVtcy5zaGlmdCgpXG4gICAgICAgIHJldHVybiB7ZG9uZTogdmFsdWUgPT09IHVuZGVmaW5lZCwgdmFsdWU6IHZhbHVlfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChzdXBwb3J0Lml0ZXJhYmxlKSB7XG4gICAgICBpdGVyYXRvcltTeW1ib2wuaXRlcmF0b3JdID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiBpdGVyYXRvclxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBpdGVyYXRvclxuICB9XG5cbiAgZnVuY3Rpb24gSGVhZGVycyhoZWFkZXJzKSB7XG4gICAgdGhpcy5tYXAgPSB7fVxuXG4gICAgaWYgKGhlYWRlcnMgaW5zdGFuY2VvZiBIZWFkZXJzKSB7XG4gICAgICBoZWFkZXJzLmZvckVhY2goZnVuY3Rpb24odmFsdWUsIG5hbWUpIHtcbiAgICAgICAgdGhpcy5hcHBlbmQobmFtZSwgdmFsdWUpXG4gICAgICB9LCB0aGlzKVxuICAgIH0gZWxzZSBpZiAoQXJyYXkuaXNBcnJheShoZWFkZXJzKSkge1xuICAgICAgaGVhZGVycy5mb3JFYWNoKGZ1bmN0aW9uKGhlYWRlcikge1xuICAgICAgICB0aGlzLmFwcGVuZChoZWFkZXJbMF0sIGhlYWRlclsxXSlcbiAgICAgIH0sIHRoaXMpXG4gICAgfSBlbHNlIGlmIChoZWFkZXJzKSB7XG4gICAgICBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhoZWFkZXJzKS5mb3JFYWNoKGZ1bmN0aW9uKG5hbWUpIHtcbiAgICAgICAgdGhpcy5hcHBlbmQobmFtZSwgaGVhZGVyc1tuYW1lXSlcbiAgICAgIH0sIHRoaXMpXG4gICAgfVxuICB9XG5cbiAgSGVhZGVycy5wcm90b3R5cGUuYXBwZW5kID0gZnVuY3Rpb24obmFtZSwgdmFsdWUpIHtcbiAgICBuYW1lID0gbm9ybWFsaXplTmFtZShuYW1lKVxuICAgIHZhbHVlID0gbm9ybWFsaXplVmFsdWUodmFsdWUpXG4gICAgdmFyIG9sZFZhbHVlID0gdGhpcy5tYXBbbmFtZV1cbiAgICB0aGlzLm1hcFtuYW1lXSA9IG9sZFZhbHVlID8gb2xkVmFsdWUrJywnK3ZhbHVlIDogdmFsdWVcbiAgfVxuXG4gIEhlYWRlcnMucHJvdG90eXBlWydkZWxldGUnXSA9IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICBkZWxldGUgdGhpcy5tYXBbbm9ybWFsaXplTmFtZShuYW1lKV1cbiAgfVxuXG4gIEhlYWRlcnMucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICBuYW1lID0gbm9ybWFsaXplTmFtZShuYW1lKVxuICAgIHJldHVybiB0aGlzLmhhcyhuYW1lKSA/IHRoaXMubWFwW25hbWVdIDogbnVsbFxuICB9XG5cbiAgSGVhZGVycy5wcm90b3R5cGUuaGFzID0gZnVuY3Rpb24obmFtZSkge1xuICAgIHJldHVybiB0aGlzLm1hcC5oYXNPd25Qcm9wZXJ0eShub3JtYWxpemVOYW1lKG5hbWUpKVxuICB9XG5cbiAgSGVhZGVycy5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24obmFtZSwgdmFsdWUpIHtcbiAgICB0aGlzLm1hcFtub3JtYWxpemVOYW1lKG5hbWUpXSA9IG5vcm1hbGl6ZVZhbHVlKHZhbHVlKVxuICB9XG5cbiAgSGVhZGVycy5wcm90b3R5cGUuZm9yRWFjaCA9IGZ1bmN0aW9uKGNhbGxiYWNrLCB0aGlzQXJnKSB7XG4gICAgZm9yICh2YXIgbmFtZSBpbiB0aGlzLm1hcCkge1xuICAgICAgaWYgKHRoaXMubWFwLmhhc093blByb3BlcnR5KG5hbWUpKSB7XG4gICAgICAgIGNhbGxiYWNrLmNhbGwodGhpc0FyZywgdGhpcy5tYXBbbmFtZV0sIG5hbWUsIHRoaXMpXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgSGVhZGVycy5wcm90b3R5cGUua2V5cyA9IGZ1bmN0aW9uKCkge1xuICAgIHZhciBpdGVtcyA9IFtdXG4gICAgdGhpcy5mb3JFYWNoKGZ1bmN0aW9uKHZhbHVlLCBuYW1lKSB7IGl0ZW1zLnB1c2gobmFtZSkgfSlcbiAgICByZXR1cm4gaXRlcmF0b3JGb3IoaXRlbXMpXG4gIH1cblxuICBIZWFkZXJzLnByb3RvdHlwZS52YWx1ZXMgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgaXRlbXMgPSBbXVxuICAgIHRoaXMuZm9yRWFjaChmdW5jdGlvbih2YWx1ZSkgeyBpdGVtcy5wdXNoKHZhbHVlKSB9KVxuICAgIHJldHVybiBpdGVyYXRvckZvcihpdGVtcylcbiAgfVxuXG4gIEhlYWRlcnMucHJvdG90eXBlLmVudHJpZXMgPSBmdW5jdGlvbigpIHtcbiAgICB2YXIgaXRlbXMgPSBbXVxuICAgIHRoaXMuZm9yRWFjaChmdW5jdGlvbih2YWx1ZSwgbmFtZSkgeyBpdGVtcy5wdXNoKFtuYW1lLCB2YWx1ZV0pIH0pXG4gICAgcmV0dXJuIGl0ZXJhdG9yRm9yKGl0ZW1zKVxuICB9XG5cbiAgaWYgKHN1cHBvcnQuaXRlcmFibGUpIHtcbiAgICBIZWFkZXJzLnByb3RvdHlwZVtTeW1ib2wuaXRlcmF0b3JdID0gSGVhZGVycy5wcm90b3R5cGUuZW50cmllc1xuICB9XG5cbiAgZnVuY3Rpb24gY29uc3VtZWQoYm9keSkge1xuICAgIGlmIChib2R5LmJvZHlVc2VkKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobmV3IFR5cGVFcnJvcignQWxyZWFkeSByZWFkJykpXG4gICAgfVxuICAgIGJvZHkuYm9keVVzZWQgPSB0cnVlXG4gIH1cblxuICBmdW5jdGlvbiBmaWxlUmVhZGVyUmVhZHkocmVhZGVyKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKGZ1bmN0aW9uKHJlc29sdmUsIHJlamVjdCkge1xuICAgICAgcmVhZGVyLm9ubG9hZCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXNvbHZlKHJlYWRlci5yZXN1bHQpXG4gICAgICB9XG4gICAgICByZWFkZXIub25lcnJvciA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZWplY3QocmVhZGVyLmVycm9yKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICBmdW5jdGlvbiByZWFkQmxvYkFzQXJyYXlCdWZmZXIoYmxvYikge1xuICAgIHZhciByZWFkZXIgPSBuZXcgRmlsZVJlYWRlcigpXG4gICAgdmFyIHByb21pc2UgPSBmaWxlUmVhZGVyUmVhZHkocmVhZGVyKVxuICAgIHJlYWRlci5yZWFkQXNBcnJheUJ1ZmZlcihibG9iKVxuICAgIHJldHVybiBwcm9taXNlXG4gIH1cblxuICBmdW5jdGlvbiByZWFkQmxvYkFzVGV4dChibG9iKSB7XG4gICAgdmFyIHJlYWRlciA9IG5ldyBGaWxlUmVhZGVyKClcbiAgICB2YXIgcHJvbWlzZSA9IGZpbGVSZWFkZXJSZWFkeShyZWFkZXIpXG4gICAgcmVhZGVyLnJlYWRBc1RleHQoYmxvYilcbiAgICByZXR1cm4gcHJvbWlzZVxuICB9XG5cbiAgZnVuY3Rpb24gcmVhZEFycmF5QnVmZmVyQXNUZXh0KGJ1Zikge1xuICAgIHZhciB2aWV3ID0gbmV3IFVpbnQ4QXJyYXkoYnVmKVxuICAgIHZhciBjaGFycyA9IG5ldyBBcnJheSh2aWV3Lmxlbmd0aClcblxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdmlldy5sZW5ndGg7IGkrKykge1xuICAgICAgY2hhcnNbaV0gPSBTdHJpbmcuZnJvbUNoYXJDb2RlKHZpZXdbaV0pXG4gICAgfVxuICAgIHJldHVybiBjaGFycy5qb2luKCcnKVxuICB9XG5cbiAgZnVuY3Rpb24gYnVmZmVyQ2xvbmUoYnVmKSB7XG4gICAgaWYgKGJ1Zi5zbGljZSkge1xuICAgICAgcmV0dXJuIGJ1Zi5zbGljZSgwKVxuICAgIH0gZWxzZSB7XG4gICAgICB2YXIgdmlldyA9IG5ldyBVaW50OEFycmF5KGJ1Zi5ieXRlTGVuZ3RoKVxuICAgICAgdmlldy5zZXQobmV3IFVpbnQ4QXJyYXkoYnVmKSlcbiAgICAgIHJldHVybiB2aWV3LmJ1ZmZlclxuICAgIH1cbiAgfVxuXG4gIGZ1bmN0aW9uIEJvZHkoKSB7XG4gICAgdGhpcy5ib2R5VXNlZCA9IGZhbHNlXG5cbiAgICB0aGlzLl9pbml0Qm9keSA9IGZ1bmN0aW9uKGJvZHkpIHtcbiAgICAgIHRoaXMuX2JvZHlJbml0ID0gYm9keVxuICAgICAgaWYgKCFib2R5KSB7XG4gICAgICAgIHRoaXMuX2JvZHlUZXh0ID0gJydcbiAgICAgIH0gZWxzZSBpZiAodHlwZW9mIGJvZHkgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHRoaXMuX2JvZHlUZXh0ID0gYm9keVxuICAgICAgfSBlbHNlIGlmIChzdXBwb3J0LmJsb2IgJiYgQmxvYi5wcm90b3R5cGUuaXNQcm90b3R5cGVPZihib2R5KSkge1xuICAgICAgICB0aGlzLl9ib2R5QmxvYiA9IGJvZHlcbiAgICAgIH0gZWxzZSBpZiAoc3VwcG9ydC5mb3JtRGF0YSAmJiBGb3JtRGF0YS5wcm90b3R5cGUuaXNQcm90b3R5cGVPZihib2R5KSkge1xuICAgICAgICB0aGlzLl9ib2R5Rm9ybURhdGEgPSBib2R5XG4gICAgICB9IGVsc2UgaWYgKHN1cHBvcnQuc2VhcmNoUGFyYW1zICYmIFVSTFNlYXJjaFBhcmFtcy5wcm90b3R5cGUuaXNQcm90b3R5cGVPZihib2R5KSkge1xuICAgICAgICB0aGlzLl9ib2R5VGV4dCA9IGJvZHkudG9TdHJpbmcoKVxuICAgICAgfSBlbHNlIGlmIChzdXBwb3J0LmFycmF5QnVmZmVyICYmIHN1cHBvcnQuYmxvYiAmJiBpc0RhdGFWaWV3KGJvZHkpKSB7XG4gICAgICAgIHRoaXMuX2JvZHlBcnJheUJ1ZmZlciA9IGJ1ZmZlckNsb25lKGJvZHkuYnVmZmVyKVxuICAgICAgICAvLyBJRSAxMC0xMSBjYW4ndCBoYW5kbGUgYSBEYXRhVmlldyBib2R5LlxuICAgICAgICB0aGlzLl9ib2R5SW5pdCA9IG5ldyBCbG9iKFt0aGlzLl9ib2R5QXJyYXlCdWZmZXJdKVxuICAgICAgfSBlbHNlIGlmIChzdXBwb3J0LmFycmF5QnVmZmVyICYmIChBcnJheUJ1ZmZlci5wcm90b3R5cGUuaXNQcm90b3R5cGVPZihib2R5KSB8fCBpc0FycmF5QnVmZmVyVmlldyhib2R5KSkpIHtcbiAgICAgICAgdGhpcy5fYm9keUFycmF5QnVmZmVyID0gYnVmZmVyQ2xvbmUoYm9keSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcigndW5zdXBwb3J0ZWQgQm9keUluaXQgdHlwZScpXG4gICAgICB9XG5cbiAgICAgIGlmICghdGhpcy5oZWFkZXJzLmdldCgnY29udGVudC10eXBlJykpIHtcbiAgICAgICAgaWYgKHR5cGVvZiBib2R5ID09PSAnc3RyaW5nJykge1xuICAgICAgICAgIHRoaXMuaGVhZGVycy5zZXQoJ2NvbnRlbnQtdHlwZScsICd0ZXh0L3BsYWluO2NoYXJzZXQ9VVRGLTgnKVxuICAgICAgICB9IGVsc2UgaWYgKHRoaXMuX2JvZHlCbG9iICYmIHRoaXMuX2JvZHlCbG9iLnR5cGUpIHtcbiAgICAgICAgICB0aGlzLmhlYWRlcnMuc2V0KCdjb250ZW50LXR5cGUnLCB0aGlzLl9ib2R5QmxvYi50eXBlKVxuICAgICAgICB9IGVsc2UgaWYgKHN1cHBvcnQuc2VhcmNoUGFyYW1zICYmIFVSTFNlYXJjaFBhcmFtcy5wcm90b3R5cGUuaXNQcm90b3R5cGVPZihib2R5KSkge1xuICAgICAgICAgIHRoaXMuaGVhZGVycy5zZXQoJ2NvbnRlbnQtdHlwZScsICdhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWQ7Y2hhcnNldD1VVEYtOCcpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoc3VwcG9ydC5ibG9iKSB7XG4gICAgICB0aGlzLmJsb2IgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIHJlamVjdGVkID0gY29uc3VtZWQodGhpcylcbiAgICAgICAgaWYgKHJlamVjdGVkKSB7XG4gICAgICAgICAgcmV0dXJuIHJlamVjdGVkXG4gICAgICAgIH1cblxuICAgICAgICBpZiAodGhpcy5fYm9keUJsb2IpIHtcbiAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHRoaXMuX2JvZHlCbG9iKVxuICAgICAgICB9IGVsc2UgaWYgKHRoaXMuX2JvZHlBcnJheUJ1ZmZlcikge1xuICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUobmV3IEJsb2IoW3RoaXMuX2JvZHlBcnJheUJ1ZmZlcl0pKVxuICAgICAgICB9IGVsc2UgaWYgKHRoaXMuX2JvZHlGb3JtRGF0YSkge1xuICAgICAgICAgIHRocm93IG5ldyBFcnJvcignY291bGQgbm90IHJlYWQgRm9ybURhdGEgYm9keSBhcyBibG9iJylcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKG5ldyBCbG9iKFt0aGlzLl9ib2R5VGV4dF0pKVxuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIHRoaXMuYXJyYXlCdWZmZXIgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgaWYgKHRoaXMuX2JvZHlBcnJheUJ1ZmZlcikge1xuICAgICAgICAgIHJldHVybiBjb25zdW1lZCh0aGlzKSB8fCBQcm9taXNlLnJlc29sdmUodGhpcy5fYm9keUFycmF5QnVmZmVyKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJldHVybiB0aGlzLmJsb2IoKS50aGVuKHJlYWRCbG9iQXNBcnJheUJ1ZmZlcilcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMudGV4dCA9IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIHJlamVjdGVkID0gY29uc3VtZWQodGhpcylcbiAgICAgIGlmIChyZWplY3RlZCkge1xuICAgICAgICByZXR1cm4gcmVqZWN0ZWRcbiAgICAgIH1cblxuICAgICAgaWYgKHRoaXMuX2JvZHlCbG9iKSB7XG4gICAgICAgIHJldHVybiByZWFkQmxvYkFzVGV4dCh0aGlzLl9ib2R5QmxvYilcbiAgICAgIH0gZWxzZSBpZiAodGhpcy5fYm9keUFycmF5QnVmZmVyKSB7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUocmVhZEFycmF5QnVmZmVyQXNUZXh0KHRoaXMuX2JvZHlBcnJheUJ1ZmZlcikpXG4gICAgICB9IGVsc2UgaWYgKHRoaXMuX2JvZHlGb3JtRGF0YSkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ2NvdWxkIG5vdCByZWFkIEZvcm1EYXRhIGJvZHkgYXMgdGV4dCcpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHRoaXMuX2JvZHlUZXh0KVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChzdXBwb3J0LmZvcm1EYXRhKSB7XG4gICAgICB0aGlzLmZvcm1EYXRhID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnRleHQoKS50aGVuKGRlY29kZSlcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLmpzb24gPSBmdW5jdGlvbigpIHtcbiAgICAgIHJldHVybiB0aGlzLnRleHQoKS50aGVuKEpTT04ucGFyc2UpXG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXNcbiAgfVxuXG4gIC8vIEhUVFAgbWV0aG9kcyB3aG9zZSBjYXBpdGFsaXphdGlvbiBzaG91bGQgYmUgbm9ybWFsaXplZFxuICB2YXIgbWV0aG9kcyA9IFsnREVMRVRFJywgJ0dFVCcsICdIRUFEJywgJ09QVElPTlMnLCAnUE9TVCcsICdQVVQnXVxuXG4gIGZ1bmN0aW9uIG5vcm1hbGl6ZU1ldGhvZChtZXRob2QpIHtcbiAgICB2YXIgdXBjYXNlZCA9IG1ldGhvZC50b1VwcGVyQ2FzZSgpXG4gICAgcmV0dXJuIChtZXRob2RzLmluZGV4T2YodXBjYXNlZCkgPiAtMSkgPyB1cGNhc2VkIDogbWV0aG9kXG4gIH1cblxuICBmdW5jdGlvbiBSZXF1ZXN0KGlucHV0LCBvcHRpb25zKSB7XG4gICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge31cbiAgICB2YXIgYm9keSA9IG9wdGlvbnMuYm9keVxuXG4gICAgaWYgKGlucHV0IGluc3RhbmNlb2YgUmVxdWVzdCkge1xuICAgICAgaWYgKGlucHV0LmJvZHlVc2VkKSB7XG4gICAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0FscmVhZHkgcmVhZCcpXG4gICAgICB9XG4gICAgICB0aGlzLnVybCA9IGlucHV0LnVybFxuICAgICAgdGhpcy5jcmVkZW50aWFscyA9IGlucHV0LmNyZWRlbnRpYWxzXG4gICAgICBpZiAoIW9wdGlvbnMuaGVhZGVycykge1xuICAgICAgICB0aGlzLmhlYWRlcnMgPSBuZXcgSGVhZGVycyhpbnB1dC5oZWFkZXJzKVxuICAgICAgfVxuICAgICAgdGhpcy5tZXRob2QgPSBpbnB1dC5tZXRob2RcbiAgICAgIHRoaXMubW9kZSA9IGlucHV0Lm1vZGVcbiAgICAgIGlmICghYm9keSAmJiBpbnB1dC5fYm9keUluaXQgIT0gbnVsbCkge1xuICAgICAgICBib2R5ID0gaW5wdXQuX2JvZHlJbml0XG4gICAgICAgIGlucHV0LmJvZHlVc2VkID0gdHJ1ZVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnVybCA9IFN0cmluZyhpbnB1dClcbiAgICB9XG5cbiAgICB0aGlzLmNyZWRlbnRpYWxzID0gb3B0aW9ucy5jcmVkZW50aWFscyB8fCB0aGlzLmNyZWRlbnRpYWxzIHx8ICdvbWl0J1xuICAgIGlmIChvcHRpb25zLmhlYWRlcnMgfHwgIXRoaXMuaGVhZGVycykge1xuICAgICAgdGhpcy5oZWFkZXJzID0gbmV3IEhlYWRlcnMob3B0aW9ucy5oZWFkZXJzKVxuICAgIH1cbiAgICB0aGlzLm1ldGhvZCA9IG5vcm1hbGl6ZU1ldGhvZChvcHRpb25zLm1ldGhvZCB8fCB0aGlzLm1ldGhvZCB8fCAnR0VUJylcbiAgICB0aGlzLm1vZGUgPSBvcHRpb25zLm1vZGUgfHwgdGhpcy5tb2RlIHx8IG51bGxcbiAgICB0aGlzLnJlZmVycmVyID0gbnVsbFxuXG4gICAgaWYgKCh0aGlzLm1ldGhvZCA9PT0gJ0dFVCcgfHwgdGhpcy5tZXRob2QgPT09ICdIRUFEJykgJiYgYm9keSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignQm9keSBub3QgYWxsb3dlZCBmb3IgR0VUIG9yIEhFQUQgcmVxdWVzdHMnKVxuICAgIH1cbiAgICB0aGlzLl9pbml0Qm9keShib2R5KVxuICB9XG5cbiAgUmVxdWVzdC5wcm90b3R5cGUuY2xvbmUgPSBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gbmV3IFJlcXVlc3QodGhpcywgeyBib2R5OiB0aGlzLl9ib2R5SW5pdCB9KVxuICB9XG5cbiAgZnVuY3Rpb24gZGVjb2RlKGJvZHkpIHtcbiAgICB2YXIgZm9ybSA9IG5ldyBGb3JtRGF0YSgpXG4gICAgYm9keS50cmltKCkuc3BsaXQoJyYnKS5mb3JFYWNoKGZ1bmN0aW9uKGJ5dGVzKSB7XG4gICAgICBpZiAoYnl0ZXMpIHtcbiAgICAgICAgdmFyIHNwbGl0ID0gYnl0ZXMuc3BsaXQoJz0nKVxuICAgICAgICB2YXIgbmFtZSA9IHNwbGl0LnNoaWZ0KCkucmVwbGFjZSgvXFwrL2csICcgJylcbiAgICAgICAgdmFyIHZhbHVlID0gc3BsaXQuam9pbignPScpLnJlcGxhY2UoL1xcKy9nLCAnICcpXG4gICAgICAgIGZvcm0uYXBwZW5kKGRlY29kZVVSSUNvbXBvbmVudChuYW1lKSwgZGVjb2RlVVJJQ29tcG9uZW50KHZhbHVlKSlcbiAgICAgIH1cbiAgICB9KVxuICAgIHJldHVybiBmb3JtXG4gIH1cblxuICBmdW5jdGlvbiBwYXJzZUhlYWRlcnMocmF3SGVhZGVycykge1xuICAgIHZhciBoZWFkZXJzID0gbmV3IEhlYWRlcnMoKVxuICAgIC8vIFJlcGxhY2UgaW5zdGFuY2VzIG9mIFxcclxcbiBhbmQgXFxuIGZvbGxvd2VkIGJ5IGF0IGxlYXN0IG9uZSBzcGFjZSBvciBob3Jpem9udGFsIHRhYiB3aXRoIGEgc3BhY2VcbiAgICAvLyBodHRwczovL3Rvb2xzLmlldGYub3JnL2h0bWwvcmZjNzIzMCNzZWN0aW9uLTMuMlxuICAgIHZhciBwcmVQcm9jZXNzZWRIZWFkZXJzID0gcmF3SGVhZGVycy5yZXBsYWNlKC9cXHI/XFxuW1xcdCBdKy9nLCAnICcpXG4gICAgcHJlUHJvY2Vzc2VkSGVhZGVycy5zcGxpdCgvXFxyP1xcbi8pLmZvckVhY2goZnVuY3Rpb24obGluZSkge1xuICAgICAgdmFyIHBhcnRzID0gbGluZS5zcGxpdCgnOicpXG4gICAgICB2YXIga2V5ID0gcGFydHMuc2hpZnQoKS50cmltKClcbiAgICAgIGlmIChrZXkpIHtcbiAgICAgICAgdmFyIHZhbHVlID0gcGFydHMuam9pbignOicpLnRyaW0oKVxuICAgICAgICBoZWFkZXJzLmFwcGVuZChrZXksIHZhbHVlKVxuICAgICAgfVxuICAgIH0pXG4gICAgcmV0dXJuIGhlYWRlcnNcbiAgfVxuXG4gIEJvZHkuY2FsbChSZXF1ZXN0LnByb3RvdHlwZSlcblxuICBmdW5jdGlvbiBSZXNwb25zZShib2R5SW5pdCwgb3B0aW9ucykge1xuICAgIGlmICghb3B0aW9ucykge1xuICAgICAgb3B0aW9ucyA9IHt9XG4gICAgfVxuXG4gICAgdGhpcy50eXBlID0gJ2RlZmF1bHQnXG4gICAgdGhpcy5zdGF0dXMgPSBvcHRpb25zLnN0YXR1cyA9PT0gdW5kZWZpbmVkID8gMjAwIDogb3B0aW9ucy5zdGF0dXNcbiAgICB0aGlzLm9rID0gdGhpcy5zdGF0dXMgPj0gMjAwICYmIHRoaXMuc3RhdHVzIDwgMzAwXG4gICAgdGhpcy5zdGF0dXNUZXh0ID0gJ3N0YXR1c1RleHQnIGluIG9wdGlvbnMgPyBvcHRpb25zLnN0YXR1c1RleHQgOiAnT0snXG4gICAgdGhpcy5oZWFkZXJzID0gbmV3IEhlYWRlcnMob3B0aW9ucy5oZWFkZXJzKVxuICAgIHRoaXMudXJsID0gb3B0aW9ucy51cmwgfHwgJydcbiAgICB0aGlzLl9pbml0Qm9keShib2R5SW5pdClcbiAgfVxuXG4gIEJvZHkuY2FsbChSZXNwb25zZS5wcm90b3R5cGUpXG5cbiAgUmVzcG9uc2UucHJvdG90eXBlLmNsb25lID0gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIG5ldyBSZXNwb25zZSh0aGlzLl9ib2R5SW5pdCwge1xuICAgICAgc3RhdHVzOiB0aGlzLnN0YXR1cyxcbiAgICAgIHN0YXR1c1RleHQ6IHRoaXMuc3RhdHVzVGV4dCxcbiAgICAgIGhlYWRlcnM6IG5ldyBIZWFkZXJzKHRoaXMuaGVhZGVycyksXG4gICAgICB1cmw6IHRoaXMudXJsXG4gICAgfSlcbiAgfVxuXG4gIFJlc3BvbnNlLmVycm9yID0gZnVuY3Rpb24oKSB7XG4gICAgdmFyIHJlc3BvbnNlID0gbmV3IFJlc3BvbnNlKG51bGwsIHtzdGF0dXM6IDAsIHN0YXR1c1RleHQ6ICcnfSlcbiAgICByZXNwb25zZS50eXBlID0gJ2Vycm9yJ1xuICAgIHJldHVybiByZXNwb25zZVxuICB9XG5cbiAgdmFyIHJlZGlyZWN0U3RhdHVzZXMgPSBbMzAxLCAzMDIsIDMwMywgMzA3LCAzMDhdXG5cbiAgUmVzcG9uc2UucmVkaXJlY3QgPSBmdW5jdGlvbih1cmwsIHN0YXR1cykge1xuICAgIGlmIChyZWRpcmVjdFN0YXR1c2VzLmluZGV4T2Yoc3RhdHVzKSA9PT0gLTEpIHtcbiAgICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCdJbnZhbGlkIHN0YXR1cyBjb2RlJylcbiAgICB9XG5cbiAgICByZXR1cm4gbmV3IFJlc3BvbnNlKG51bGwsIHtzdGF0dXM6IHN0YXR1cywgaGVhZGVyczoge2xvY2F0aW9uOiB1cmx9fSlcbiAgfVxuXG4gIHNlbGYuSGVhZGVycyA9IEhlYWRlcnNcbiAgc2VsZi5SZXF1ZXN0ID0gUmVxdWVzdFxuICBzZWxmLlJlc3BvbnNlID0gUmVzcG9uc2VcblxuICBzZWxmLmZldGNoID0gZnVuY3Rpb24oaW5wdXQsIGluaXQpIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24ocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgICB2YXIgcmVxdWVzdCA9IG5ldyBSZXF1ZXN0KGlucHV0LCBpbml0KVxuICAgICAgdmFyIHhociA9IG5ldyBYTUxIdHRwUmVxdWVzdCgpXG5cbiAgICAgIHhoci5vbmxvYWQgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIG9wdGlvbnMgPSB7XG4gICAgICAgICAgc3RhdHVzOiB4aHIuc3RhdHVzLFxuICAgICAgICAgIHN0YXR1c1RleHQ6IHhoci5zdGF0dXNUZXh0LFxuICAgICAgICAgIGhlYWRlcnM6IHBhcnNlSGVhZGVycyh4aHIuZ2V0QWxsUmVzcG9uc2VIZWFkZXJzKCkgfHwgJycpXG4gICAgICAgIH1cbiAgICAgICAgb3B0aW9ucy51cmwgPSAncmVzcG9uc2VVUkwnIGluIHhociA/IHhoci5yZXNwb25zZVVSTCA6IG9wdGlvbnMuaGVhZGVycy5nZXQoJ1gtUmVxdWVzdC1VUkwnKVxuICAgICAgICB2YXIgYm9keSA9ICdyZXNwb25zZScgaW4geGhyID8geGhyLnJlc3BvbnNlIDogeGhyLnJlc3BvbnNlVGV4dFxuICAgICAgICByZXNvbHZlKG5ldyBSZXNwb25zZShib2R5LCBvcHRpb25zKSlcbiAgICAgIH1cblxuICAgICAgeGhyLm9uZXJyb3IgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgcmVqZWN0KG5ldyBUeXBlRXJyb3IoJ05ldHdvcmsgcmVxdWVzdCBmYWlsZWQnKSlcbiAgICAgIH1cblxuICAgICAgeGhyLm9udGltZW91dCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICByZWplY3QobmV3IFR5cGVFcnJvcignTmV0d29yayByZXF1ZXN0IGZhaWxlZCcpKVxuICAgICAgfVxuXG4gICAgICB4aHIub3BlbihyZXF1ZXN0Lm1ldGhvZCwgcmVxdWVzdC51cmwsIHRydWUpXG5cbiAgICAgIGlmIChyZXF1ZXN0LmNyZWRlbnRpYWxzID09PSAnaW5jbHVkZScpIHtcbiAgICAgICAgeGhyLndpdGhDcmVkZW50aWFscyA9IHRydWVcbiAgICAgIH0gZWxzZSBpZiAocmVxdWVzdC5jcmVkZW50aWFscyA9PT0gJ29taXQnKSB7XG4gICAgICAgIHhoci53aXRoQ3JlZGVudGlhbHMgPSBmYWxzZVxuICAgICAgfVxuXG4gICAgICBpZiAoJ3Jlc3BvbnNlVHlwZScgaW4geGhyICYmIHN1cHBvcnQuYmxvYikge1xuICAgICAgICB4aHIucmVzcG9uc2VUeXBlID0gJ2Jsb2InXG4gICAgICB9XG5cbiAgICAgIHJlcXVlc3QuaGVhZGVycy5mb3JFYWNoKGZ1bmN0aW9uKHZhbHVlLCBuYW1lKSB7XG4gICAgICAgIHhoci5zZXRSZXF1ZXN0SGVhZGVyKG5hbWUsIHZhbHVlKVxuICAgICAgfSlcblxuICAgICAgeGhyLnNlbmQodHlwZW9mIHJlcXVlc3QuX2JvZHlJbml0ID09PSAndW5kZWZpbmVkJyA/IG51bGwgOiByZXF1ZXN0Ll9ib2R5SW5pdClcbiAgICB9KVxuICB9XG4gIHNlbGYuZmV0Y2gucG9seWZpbGwgPSB0cnVlXG59KSh0eXBlb2Ygc2VsZiAhPT0gJ3VuZGVmaW5lZCcgPyBzZWxmIDogdGhpcyk7XG4iLCJjb25zdCBzdG9yZSA9ICdkYXJ3aW4tc3RyZWV0LWZvb2QnO1xuY29uc3QgdmVyc2lvbiA9IDE7XG5jb25zdCB2ZW5kb3JTdG9yZU5hbWUgPSAndmVuZG9ycyc7XG5cbmNsYXNzIERCSGFuZGxlciB7XG5cdGNvbnN0cnVjdG9yKCkge1xuXG5cdFx0dGhpcy5wZW5kaW5nQWN0aW9ucyA9IFtdO1xuXHRcdHRoaXMuY29ubmVjdCgpO1xuXG5cdFx0dGhpcy5zYXZlRGF0YSA9IHRoaXMuc2F2ZURhdGEuYmluZCh0aGlzKTtcblx0XHR0aGlzLmdldEFsbERhdGEgPSB0aGlzLmdldEFsbERhdGEuYmluZCh0aGlzKTtcblx0XHR0aGlzLl9nZXRBbGxEYXRhRm9yUHJvbWlzZSA9IHRoaXMuX2dldEFsbERhdGFGb3JQcm9taXNlLmJpbmQodGhpcyk7XG5cdH1cblxuXHRlcnJvckhhbmRsZXIoZXZ0KSB7XG5cdFx0Y29uc29sZS5lcnJvcignREIgRXJyb3InLCBldnQudGFyZ2V0LmVycm9yKTtcblx0fVxuXG5cdHVwZ3JhZGVEQihldnQpIHtcblx0XHRjb25zdCBkYiA9IGV2dC50YXJnZXQucmVzdWx0O1xuXG5cdFx0aWYoZXZ0Lm9sZFZlcnNpb24gPCAxKSB7XG5cdFx0XHRjb25zdCB2ZW5kb3JTdG9yZSA9IGRiLmNyZWF0ZU9iamVjdFN0b3JlKHZlbmRvclN0b3JlTmFtZSwge2tleVBhdGg6ICdpZCd9KTtcblx0XHRcdHZlbmRvclN0b3JlLmNyZWF0ZUluZGV4KCduYW1lJywgJ25hbWUnLCB7dW5pcXVlOiB0cnVlfSk7XG5cdFx0fVxuXHR9XG5cblx0Y29ubmVjdCgpIHtcblx0XHRjb25zdCBjb25uUmVxdWVzdCA9IGluZGV4ZWREQi5vcGVuKHN0b3JlLCB2ZXJzaW9uKTtcblxuXHRcdGNvbm5SZXF1ZXN0LmFkZEV2ZW50TGlzdGVuZXIoJ3N1Y2Nlc3MnLCAoZXZ0KSA9PiB7XG5cdFx0XHR0aGlzLmRiID0gZXZ0LnRhcmdldC5yZXN1bHQ7XG5cdFx0XHR0aGlzLmRiLmFkZEV2ZW50TGlzdGVuZXIoJ2Vycm9yJywgdGhpcy5lcnJvckhhbmRsZXIpO1xuXG5cdFx0XHRpZih0aGlzLnBlbmRpbmdBY3Rpb25zKSB7XG5cdFx0XHRcdHdoaWxlKHRoaXMucGVuZGluZ0FjdGlvbnMubGVuZ3RoIDwgMCkge1xuXHRcdFx0XHRcdHRoaXMucGVuZGluZ0FjdGlvbnMucG9wKCkoKTtcblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdH0pO1xuXG5cdFx0Y29ublJlcXVlc3QuYWRkRXZlbnRMaXN0ZW5lcigndXBncmFkZW5lZWRlZCcsIHRoaXMudXBncmFkZURCKTtcblxuXHRcdGNvbm5SZXF1ZXN0LmFkZEV2ZW50TGlzdGVuZXIoJ2Vycm9yJywgdGhpcy5lcnJvckhhbmRsZXIpO1xuXHR9XG5cblx0c2F2ZURhdGEoZGF0YSkge1xuXHRcdGlmKCF0aGlzLmRiKSB7XG5cdFx0XHR0aGlzLnBlbmRpbmdBY3Rpb25zLnB1c2goKCkgPT4gdGhpcy5zYXZlRGF0YShkYXRhKSk7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXG5cdFx0Y29uc3QgZGF0YUFyciA9IEFycmF5LmlzQXJyYXkoZGF0YSlcblx0XHRcdD8gZGF0YVxuXHRcdFx0OiBbZGF0YV07XG5cblx0XHRjb25zdCB0cmFuc2FjdGlvbiA9IHRoaXMuZGIudHJhbnNhY3Rpb24odmVuZG9yU3RvcmVOYW1lLCAncmVhZHdyaXRlJyk7XG5cdFx0dmFyIHZlbmRvclN0b3JlID0gdHJhbnNhY3Rpb24ub2JqZWN0U3RvcmUodmVuZG9yU3RvcmVOYW1lKTtcblxuXHRcdGRhdGFBcnIuZm9yRWFjaCgodmVuZG9yRGF0YSkgPT4gdmVuZG9yU3RvcmVcblx0XHRcdC5nZXQodmVuZG9yRGF0YS5pZClcblx0XHRcdC5vbnN1Y2Nlc3MgPSAoZXZ0KSA9PiB7XG5cdFx0XHRcdGlmKGV2dC50YXJnZXQucmVzdWx0KSB7XG5cdFx0XHRcdFx0aWYoSlNPTi5zdHJpbmdpZnkoZXZ0LnRhcmdldC5yZXN1bHQpICE9PSBKU09OLnN0cmluZ2lmeSh2ZW5kb3JEYXRhKSkge1xuXHRcdFx0XHRcdFx0dmVuZG9yU3RvcmUucHV0KHZlbmRvckRhdGEpO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0XHR2ZW5kb3JTdG9yZS5hZGQodmVuZG9yRGF0YSk7XG5cdFx0XHRcdH1cblx0XHRcdH0pO1xuXG5cdH1cblxuXHRfZ2V0QWxsRGF0YUZvclByb21pc2UocmVzb2x2ZSwgcmVqZWN0KSB7XG5cdFx0aWYoIXRoaXMuZGIpIHtcblx0XHRcdHRoaXMucGVuZGluZ0FjdGlvbnMucHVzaCgoKSA9PiB0aGlzLl9nZXRBbGxEYXRhRm9yUHJvbWlzZShyZXNvbHZlLCByZWplY3QpKTtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cdFx0Y29uc3QgdmVuZG9yRGF0YSA9IFtdO1xuXHRcdGNvbnN0IHZlbmRvclN0b3JlID0gdGhpcy5kYi50cmFuc2FjdGlvbih2ZW5kb3JTdG9yZU5hbWUpLm9iamVjdFN0b3JlKHZlbmRvclN0b3JlTmFtZSk7XG5cdFx0Y29uc3QgY3Vyc29yID0gdmVuZG9yU3RvcmUub3BlbkN1cnNvcigpO1xuXHRcdFxuXHRcdGN1cnNvci5vbnN1Y2Nlc3MgPSAoZXZ0KSA9PiB7XG5cdFx0XHRjb25zdCBjdXJzb3IgPSBldnQudGFyZ2V0LnJlc3VsdDtcblx0XHRcdGlmKGN1cnNvcikge1xuXHRcdFx0XHR2ZW5kb3JEYXRhLnB1c2goY3Vyc29yLnZhbHVlKTtcblx0XHRcdFx0cmV0dXJuIGN1cnNvci5jb250aW51ZSgpO1xuXHRcdFx0fVxuXHRcdFx0cmVzb2x2ZSh2ZW5kb3JEYXRhKTtcblx0XHR9O1xuXG5cdFx0Y3Vyc29yLm9uZXJyb3IgPSAoZXZ0KSA9PiByZWplY3QoZXZ0LnRhcmdldC5lcnJvcik7XG5cdH1cblxuXHRnZXRBbGxEYXRhKCkge1xuXHRcdHJldHVybiBuZXcgUHJvbWlzZSh0aGlzLl9nZXRBbGxEYXRhRm9yUHJvbWlzZSk7XG5cdH1cblxuXG59XG5cbmV4cG9ydCBkZWZhdWx0IERCSGFuZGxlcjtcbiIsImltcG9ydCBlanMgZnJvbSAnZWpzJztcbmltcG9ydCB0aW1lQ29udmVydCBmcm9tICcuL3RpbWUtY29udmVydCc7XG5cbmNvbnN0IGRheXMgPSBbJ1N1bmRheScsICdNb25kYXknLCAnVHVlc2RheScsICdXZWRuZXNkYXknLCAnVGh1cnNkYXknLCAnRnJpZGF5JywgJ1NhdHVyZGF5J107XG5sZXQgdGVtcGxhdGVTdHJpbmcgPSB1bmRlZmluZWQ7XG5sZXQgdGVtcGxhdGUgPSB1bmRlZmluZWQ7XG5sZXQgdGFyZ2V0ID0gdW5kZWZpbmVkO1xuXG5jb25zdCBnZXRUYXJnZXQgPSAoKSA9PiB7XG5cdGlmKCF0YXJnZXQpIHtcblx0XHR0YXJnZXQgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKCdtYWluJyk7XG5cdH1cblx0cmV0dXJuIHRhcmdldDtcbn07XG5cbmNvbnN0IHJlbmRlckRheSA9IChkYXRhKSA9PiB7XG5cdGlmKCF0ZW1wbGF0ZSkge1xuXHRcdHRlbXBsYXRlU3RyaW5nID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2RheVRlbXBsYXRlJykuaW5uZXJIVE1MO1xuXHRcdHRlbXBsYXRlID0gZWpzLmNvbXBpbGUodGVtcGxhdGVTdHJpbmcpO1xuXHR9XG5cblx0cmV0dXJuIHRlbXBsYXRlKGRhdGEpO1xufTtcblxuZnVuY3Rpb24gZHJhd0RheShkYXksIHZlbmRvcnMpIHtcblx0dmFyIG9wZW4gPSBbXTtcblxuXHR2ZW5kb3JzLmZvckVhY2goKHZlbmRvcikgPT4ge1xuXHRcdHZhciBvcGVuSW5kZXggPSB2ZW5kb3IubG9jYXRpb25zLmZpbmRJbmRleChcblx0XHRcdChsb2NhdGlvbikgPT4gbG9jYXRpb24uZGF5c1tkYXldLm9wZW5cblx0XHQpO1xuXG5cdFx0aWYob3BlbkluZGV4ID49IDApIHtcblx0XHRcdHZhciBvcGVuTG9jYXRpb24gPSB2ZW5kb3IubG9jYXRpb25zW29wZW5JbmRleF07XG5cdFx0XHR2YXIgb3BlbkRheSA9IG9wZW5Mb2NhdGlvbi5kYXlzW2RheV07XG5cblx0XHRcdG9wZW4ucHVzaChPYmplY3QuYXNzaWduKFxuXHRcdFx0XHR7fSxcblx0XHRcdFx0dmVuZG9yLFxuXHRcdFx0XHR7XG5cdFx0XHRcdFx0b3BlbkxvY2F0aW9uLFxuXHRcdFx0XHRcdG9wZW5EYXk6IHtcblx0XHRcdFx0XHRcdGRheTogb3BlbkRheS5kYXksXG5cdFx0XHRcdFx0XHRzdGFydDogdGltZUNvbnZlcnQob3BlbkRheS5zdGFydCksXG5cdFx0XHRcdFx0XHRlbmQ6IHRpbWVDb252ZXJ0KG9wZW5EYXkuZW5kKVxuXHRcdFx0XHRcdH1cblx0XHRcdFx0fVxuXHRcdFx0KSk7XG5cdFx0fVxuXG5cdH0pO1xuXG5cdGNvbnN0IGNvbnRlbnQgPSByZW5kZXJEYXkoe1xuXHRcdGRheTogZGF5c1tkYXldLFxuXHRcdGRheUluZGV4OiBkYXksXG5cdFx0dmVuZG9yczogb3BlblxuXHR9KTtcblxuXHRnZXRUYXJnZXQoKS5pbm5lckhUTUwgKz0gY29udGVudDtcbn1cblxuZnVuY3Rpb24gZHJhd0RheXMoZGF5RGF0YSkge1xuXHRnZXRUYXJnZXQoKS5pbm5lckhUTUwgPSBudWxsO1xuXG5cdHZhciBub3cgPSBuZXcgRGF0ZSgpO1xuXHR2YXIgdG9kYXkgPSBub3cuZ2V0RGF5KCk7XG5cblx0ZHJhd0RheSh0b2RheSwgZGF5RGF0YSk7XG5cblxufVxuXG5leHBvcnQgZGVmYXVsdCBkcmF3RGF5cztcbiIsIlxuY29uc3QgdXJsID0gJ2h0dHBzOi8vb3BlbmRhdGEuYXJjZ2lzLmNvbS9kYXRhc2V0cy9mNjJjYmZiZjExNDk0NDk1OTg0MDk3ZWY4ZWQ2YThhOV8wLmdlb2pzb24nO1xuXG5mdW5jdGlvbiBsb2FkTGlzdCgpIHtcblx0cmV0dXJuIGZldGNoKHVybClcblx0XHQudGhlbigocmVzcG9uc2UpID0+IHJlc3BvbnNlLmpzb24oKSlcblx0XHQudGhlbigoZGF0YSkgPT4gZGF0YS5mZWF0dXJlc1xuXHRcdFx0XHQ/IGRhdGEuZmVhdHVyZXMubWFwKChmZWF0dXJlKSA9PiBmZWF0dXJlLnByb3BlcnRpZXMpXG5cdFx0XHRcdDogdW5kZWZpbmVkXG5cdFx0KTtcblxufTtcblxuZXhwb3J0IGRlZmF1bHQgbG9hZExpc3Q7XG4iLCJpbXBvcnQgJ3doYXR3Zy1mZXRjaCc7XG5pbXBvcnQgbG9hZExpc3QgZnJvbSAnLi9sb2FkLWxpc3QnO1xuaW1wb3J0IHRpZHlMaXN0IGZyb20gJy4vdGlkeS1saXN0JztcbmltcG9ydCBkcmF3RGF5cyBmcm9tICcuL2RyYXctZGF5cyc7XG5pbXBvcnQgREJIYW5kbGVyIGZyb20gJy4vZGItaGFuZGxlcic7XG5cbmNvbnN0IGRiSGFuZGxlciA9IG5ldyBEQkhhbmRsZXIoKTtcblxuZGJIYW5kbGVyLmdldEFsbERhdGEoKVxuXHQudGhlbihkcmF3RGF5cyk7XG5cbmNvbnN0IGZldGNoVmVuZG9ycyA9IGxvYWRMaXN0KClcblx0LnRoZW4odGlkeUxpc3QpO1xuXG5mZXRjaFZlbmRvcnMudGhlbihkcmF3RGF5cyk7XG5mZXRjaFZlbmRvcnMudGhlbihkYkhhbmRsZXIuc2F2ZURhdGEpO1xuaWYgKCdzZXJ2aWNlV29ya2VyJyBpbiBuYXZpZ2F0b3IpIHtcbiAgd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoJ2xvYWQnLCBmdW5jdGlvbigpIHtcbiAgICBuYXZpZ2F0b3Iuc2VydmljZVdvcmtlci5yZWdpc3Rlcignc3cuanMnKS50aGVuKGZ1bmN0aW9uKHJlZ2lzdHJhdGlvbikge1xuICAgICAgLy8gUmVnaXN0cmF0aW9uIHdhcyBzdWNjZXNzZnVsXG4gICAgICBjb25zb2xlLmxvZygnU2VydmljZVdvcmtlciByZWdpc3RyYXRpb24gc3VjY2Vzc2Z1bCB3aXRoIHNjb3BlOiAnLCByZWdpc3RyYXRpb24uc2NvcGUpO1xuICAgIH0sIGZ1bmN0aW9uKGVycikge1xuICAgICAgLy8gcmVnaXN0cmF0aW9uIGZhaWxlZCA6KFxuICAgICAgY29uc29sZS5sb2coJ1NlcnZpY2VXb3JrZXIgcmVnaXN0cmF0aW9uIGZhaWxlZDogJywgZXJyKTtcbiAgICB9KTtcbiAgfSk7XG59XG4iLCJcbmNvbnN0IGRheXMgPSB7XG5cdCdTdW5kYXknOiAnU3VuJyxcblx0J01vbmRheSc6ICdNb24nLFxuXHQnVHVlc2RheSc6ICdUdWVzJyxcblx0J1dlZG5lc2RheSc6ICdXZWQnLFxuXHQnVGh1cnNkYXknOiAnVGh1cnMnLFxuXHQnRnJpZGF5JzogJ0ZyaScsXG5cdCdTYXR1cmRheSc6ICdTYXQnXG59O1xuXG5cbmZ1bmN0aW9uIHRpZHlMaXN0KGxpc3REYXRhKSB7XG5cdHJldHVybiBsaXN0RGF0YS5maWx0ZXIoKHJlY29yZCwgaW5kZXgpID0+IGxpc3REYXRhLmZpbmRJbmRleCgoZmluZFJlY29yZCkgPT4gZmluZFJlY29yZC5OYW1lID09PSByZWNvcmQuTmFtZSkgPT09IGluZGV4KVxuXHRcdC5tYXAoKHJlY29yZCkgPT4gKHtcblx0XHRcdGlkOiByZWNvcmQuT0JKRUNUSUQsXG5cdFx0XHRuYW1lOiByZWNvcmQuTmFtZSxcblx0XHRcdHdlYnNpdGU6IHJlY29yZC5XZWJzaXRlLFxuXHRcdFx0dHlwZTogcmVjb3JkLlR5cGUsXG5cdFx0XHRsb2NhdGlvbnM6IGxpc3REYXRhLmZpbHRlcigobG9jYXRpb25SZWNvcmQpID0+IGxvY2F0aW9uUmVjb3JkLk5hbWUgPT09IHJlY29yZC5OYW1lKVxuXHRcdFx0XHQubWFwKChsb2NhdGlvblJlY29yZCkgPT4gKHtcblx0XHRcdFx0XHRuYW1lOiBsb2NhdGlvblJlY29yZC5Mb2NhdGlvbixcblx0XHRcdFx0XHRvcGVuVGltZXM6IGxvY2F0aW9uUmVjb3JkLk9wZW5fVGltZXNfRGVzY3JpcHRpb24sXG5cdFx0XHRcdFx0ZGF5czogT2JqZWN0LmtleXMoZGF5cylcblx0XHRcdFx0XHRcdC5tYXAoKGRheSkgPT4gKHtcblx0XHRcdFx0XHRcdFx0ZGF5LFxuXHRcdFx0XHRcdFx0XHRvcGVuOiByZWNvcmRbZGF5XSA9PT0gJ1llcycsXG5cdFx0XHRcdFx0XHRcdHN0YXJ0OiByZWNvcmRbYCR7ZGF5c1tkYXldfV9TdGFydGBdLFxuXHRcdFx0XHRcdFx0XHRlbmQ6IHJlY29yZFtgJHtkYXlzW2RheV19X0VuZGBdXG5cdFx0XHRcdFx0XHR9KSlcblx0XHRcdFx0fSkpXG5cdFx0fSkpO1xufVxuXG5leHBvcnQgZGVmYXVsdCB0aWR5TGlzdDtcbiIsIlxuLyoqXG4qIENvbnZlcnQgYSAyNCBob3VyIHRpbWUgdG8gMTIgaG91clxuKiBmcm9tIGh0dHBzOi8vc3RhY2tvdmVyZmxvdy5jb20vcXVlc3Rpb25zLzEzODk4NDIzL2phdmFzY3JpcHQtY29udmVydC0yNC1ob3VyLXRpbWUtb2YtZGF5LXN0cmluZy10by0xMi1ob3VyLXRpbWUtd2l0aC1hbS1wbS1hbmQtbm9cbiogQHBhcmFtIHtzdHJpbmd9IHRpbWUgQSAyNCBob3VyIHRpbWUgc3RyaW5nXG4qIEByZXR1cm4ge3N0cmluZ30gQSBmb3JtYXR0ZWQgMTIgaG91ciB0aW1lIHN0cmluZ1xuKiovXG5mdW5jdGlvbiB0Q29udmVydCAodGltZSkge1xuXHQvLyBDaGVjayBjb3JyZWN0IHRpbWUgZm9ybWF0IGFuZCBzcGxpdCBpbnRvIGNvbXBvbmVudHNcblx0dGltZSA9IHRpbWUudG9TdHJpbmcgKCkubWF0Y2ggKC9eKFswMV1cXGR8MlswLTNdKShbMC01XVxcZCkkLykgfHwgW3RpbWVdO1xuXG5cdGlmICh0aW1lLmxlbmd0aCA+IDEpIHsgLy8gSWYgdGltZSBmb3JtYXQgY29ycmVjdFxuXHRcdGNvbnN0IHN1ZmZpeCA9IHRpbWVbMV0gPCAxMiA/ICdBTScgOiAnUE0nOyAvLyBTZXQgQU0vUE1cblx0XHRjb25zdCBob3VycyA9IHRpbWVbMV0gJSAxMiB8fCAxMjsgLy8gQWRqdXN0IGhvdXJzXG5cdFx0Y29uc3QgbWludXRlcyA9IHRpbWVbMl07XG5cblx0XHRyZXR1cm4gYCR7aG91cnN9OiR7bWludXRlc30ke3N1ZmZpeH1gO1xuXHR9XG5cdHJldHVybiB0aW1lO1xufVxuXG5leHBvcnQgZGVmYXVsdCB0Q29udmVydDtcbiJdfQ==
