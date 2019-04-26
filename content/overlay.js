/**
 * Namespaces
 */
if (typeof(extensions) === 'undefined') extensions = {};
if (typeof(extensions.scss_compiler) === 'undefined') extensions.scss_compiler = {
	version: '1.0'
};

(function() {
	
    var $       		= require("ko/dom"),
		self 			= this,
		search 			= false,
		notify			= require("notify/notify"),
		shell			= require("ko/shell"),
		editor 			= require("ko/editor"),
		output 			= true,
		notification 	= false,
		prefs 			= Components.classes["@mozilla.org/preferences-service;1"]
						.getService(Components.interfaces.nsIPrefService).getBranch("extensions.scss_compiler.");
		
	if (!('extensions' in	ko)) ko.extensions = {};
	var myExt = "scss_compiler@babobski.com";
	if (!(myExt in ko.extensions)) ko.extensions[myExt] = {};
	if (!('myapp' in ko.extensions[myExt])) ko.extensions[myExt].myapp = {};
	var sassData = ko.extensions[myExt].myapp;
	
	ko.views.manager.topView.removeEventListener(
		'keypress',
		extensions.scss_compiler._onKeyPress, true
	);
	window.removeEventListener("komodo-post-startup", self._StartUpAction, false);
	window.removeEventListener('file_saved', self.run_SCSS);
	window.removeEventListener("view_opened", self.getVars, false);
		
	this.run_SCSS = () => {
		var currView	= require('ko/views').current(),
			d 			= currView.get('koDoc'),
			run   		= 'sass ';
			
		if (d === null || d.file === null) {
			return false;
		}
		
		var fileExt = d.file.ext;
		
		if (fileExt == '.sass' || fileExt == '.scss') {
			var path = d.file.displayPath,
				useFileWatcher = prefs.getBoolPref('useFilewatcher');
			if (useFileWatcher) {
				path = prefs.getCharPref('filewatcher');
			}
			
			var replacePaths 	= prefs.getCharPref('replaceFolders'),
				replaceWith 	= prefs.getCharPref('replaceWith'),
				fileExReg 		= new RegExp('\\' + fileExt, 'g'),
				outputPath 		= path.replace(fileExReg, '.css'); // Replace file ext
			
			if (replacePaths.length > 0 && replaceWith.length > 0) {
				if (replacePaths.indexOf(',') !== -1) {
					var paths = replacePaths.split(',');
					for (var i = 0; i < paths.length; i++) {
						var replaceReg = new RegExp(paths[i], 'g');
						outputPath = outputPath.replace(replaceReg, replaceWith);
					} 
				} else {
					outputPath = outputPath.replace(new RegExp(replacePaths, 'g'), replaceWith);
				}
			}
			
			run = run + path + ' ' + outputPath + ' --scss --style compressed';
			shell.exec(
				run,
				 {
					"runIn": (output ? 'command-output-window' : 'no-console'),
					"openOutputWindow": false,
				},
				(error, stdout, stderr) => {
					if (error !== null) {
						ko.uilayout.toggleTab('console-widget', false);
						console.error(stderr);
						self._notifcation('SASS error compiling file', true);
					} else {
						self._notifcation('SASS compiled file');
						self.pupblishFile(outputPath, path);
						if (ko.uilayout.isPaneShown('workspace_bottom_area')) {
							ko.uilayout.togglePane('workspace_bottom_area');
						}
					}
				}
			);
		}
	};
	
	this.pupblishFile = (css, sass) => {
		var configurations = ko.publishing.getConfigurations(),
			parser = ko.uriparse;
		
		for (var i = 0; i < configurations.length; i++) {
			var currConfig 	= configurations[i],
				localUri 	= parser.displayPath(currConfig.local_uri);
				
			if (css.indexOf(localUri) !== -1) {
				var path = parser.pathToURI(css),
					cssMap = path + '.map';
				
				
				ko.publishing.forcePush(path);
				ko.publishing.forcePush(cssMap);
				ko.publishing.forcePush(parser.pathToURI(sass));
			}
		}
	};
	
	this.getVars = () => {
		var d 		= ko.views.manager.currentView.document || ko.views.manager.currentView.koDoc,
			file 	= d.file;
	
		if (!file) {
			return false;
		}
	
		if (file.ext === '.sass' || file.ext === '.scss') {
			try {
				self._getVars();
			} catch(e) {
				console.log(e);
			}
		}
		return false;
	};
	
	this._getVars = () => {

		var d = ko.views.manager.currentView.document || ko.views.manager.currentView.koDoc;
		if (d === null || d.file === null) {
			return false;
		}
		
		var fileExt = d.file.ext;
		if (fileExt == '.sass' || fileExt == '.scss') {
			var	fileContent 	= self._getContent(d),
				file 			= fileContent.file,
				buffer 			= fileContent.buffer,
				base 			= fileContent.base,
				path 			= fileContent.path;
	
	
			if (!file || !path) {
				return;
			}
		
			outputSass = self._process_sass(path, base, buffer, file.ext);
			
			var allVars = self._getVariables(outputSass);
			var mixins = self._getMixins(outputSass);
			
			sassData.vars = allVars;
			sassData.mixins = mixins;
			if (sassData.vars === undefined) {
				sassData.vars = [ "$No_vars_found" ];
				self._notifcation('SASS: No SASS vars found');
			}
				 
		} else {
			return;
		}
	};
	
	this._getVariables = (buffer) => {
		var bufferVars = '',
			allVars,
			output = [];

		if (buffer.match(/\$[\sa-z0-9_-\s]+:/i)) {
			bufferVars = buffer.match(/\$[\sa-z0-9_-\s]+:[^;,\r\n]+/gi);
			allVars = bufferVars.toString().split(',');

			allVars.forEach(function(value, i) {
				var VarAndValues 	= value.split(':'),
					val 			= VarAndValues[0].replace(/\s+/, ''),
					comm 			= VarAndValues[1].replace(/^\s+/, '');
				if (!self._in_array(val, output)) {
					output.push({
						"value": val,
						"comment": comm
					});
				}
			})

			return JSON.stringify(output);
		}

	}
	
	this._getMixins = (buffer) => {
		var bufferVars = '',
			allVars,
			output = [],
			matchPatern = /@mixin\s+([^(]+)\(([^)]+)\)/gi;

		if (buffer.match(/@mixin\s+[^(]+\([^)]+\)/i)) {
			bufferVars = buffer.match(matchPatern);
			
			
			for (var i = 0; i < bufferVars.length; i++) {
				var variable = bufferVars[i];
					matchPatern = /@mixin\s+([^(]+)\(([^)]+)\)/gi;
				var newMatches = matchPatern.exec(variable);
				
				if (newMatches.length === 3) {
					output.push({
						"value": newMatches[1],
						"comment": newMatches[2]
					});
				}
			}

			return JSON.stringify(output);
		}

	};
	
	this._getContent = (doc) => {
		var file 		= doc.file,
			buffer 		= doc.buffer,
			base 		= (file) ? file.baseName : null,
			filePath 	= (file) ? file.URI : null,
			path 		= '',
			output 		= {};

		if (prefs.getBoolPref('useFilewatcher')) {
			path = prefs.getCharPref('filewatcher');
			base = path.substr(self._last_slash(path) + 1, path.length);
			buffer = self._readFile(path, '')[0];
		}

		if (!path) {
			path = filePath;
		} else {
			base = path.substr(self._last_slash(path) + 1, path.length);
			buffer = self._readFile(path, '')[0];
		}

		output.file = file;
		output.buffer = buffer;
		output.base = base;
		output.path = path;

		return output;
	}
	
	this._process_imports = (imports, rootPath, fileExt) => {
		
		var buffer 			= '',
			newContent 		= '',
			matchImports 	= /(@import\s*['"][^"]+['"];|@import\s+\W[^"]+\W\s+['"][^"]+["'];)/,
			matchValue 		= /['"](.*?)['"]/,
			quotes 			= /['"]+/g;

		if (imports !== -1) {
			imports.forEach(function(value, i) {
				//if is regular @import
				if (value.match(/@import\s*['"][^"]+['"];/) !== null) {
					if (value.match(matchValue) !== null) {
						var xf = value.match(matchValue);
						//console.log(xf);
						var fileName = xf.toString().split(',')[1].replace(quotes, ''); // Too much recursion
							
						if (/(.sass|.scss)$/i.test(fileName) === false) {
							fileName = fileName + fileExt;
						}
						
						if (/\.css$/i.test(fileName) || /css\?family/.test(fileName)) {
							buffer = buffer + value;
						} else {
							newContent = self._readFile(rootPath, fileName);
							buffer = buffer + newContent[0];
	
							if (newContent.toString().match(matchImports) !== null) {
								var cleanScss = self._strip_comments(buffer);
								newImport = self._split_on_imports(cleanScss);
								buffer = self._process_imports(newImport, newContent[1], fileExt);
							}
						}
					}
				}

				
				//if isn't @import it's less/css
				if (value.match(/@import\s*['"][^"]+['"];/) == null && value.match(/@import\s+\W[^"]+\W\s+['"][^"]+["'];/) == null) {
					buffer = buffer + value;
				}
			});
		}

	return buffer;
	}
	
	this._get_imports = (content) => {
		var cleanSassCss 	= self._strip_comments(content), 
			newImports 		= self._split_on_imports(cleanSassCss);
			return newImports;
	}
	
	this._process_sass = (path, base, buffer, fileExt) => {
		var rootPath 	= path.replace(base, ''),
			sassCss 	= String(buffer),
			SASS 		= '';
			
			sass_imports = self._get_imports(sassCss);
			SASS = self._process_imports(sass_imports, rootPath, fileExt);
			
			return SASS;
	}
	
	this._strip_comments = (string) => {
		var patern = /\/\/@import\s+['"][^\n']+['"];|\/\/@import\s+\W[^"]+\W\s+['"][^";\n]+["'];/g;
		return string.toString().replace(patern , '' ); 
	}
	
	this._split_on_imports = (cleansass) => {
		var patern = /(@import\s*['"][^"';]+['"];|@import\s+\W[^"\n]+\W\s+['"][^''";]+["'];)/g;
		return cleansass.split(patern);
	}
	
	this._readFile = (root, filepath, prefix = false) => {

		var fileName,
			fullUrl 	= root + filepath,
			fileUrl 	= self._parse_uri(fullUrl),
			newRoot 	= '',
			output 		= [],
			backPatern 	= /\.\.\/+/;

		//figure out ftp path if ../ in path
		if (filepath.search(backPatern) !== -1) {

			output 		= self._parse_backDirectories(fullUrl, filepath, root);
			
			fileName 	= output.fileName;
			fileUrl 	= output.fileUrl;

		} else {
			fileName = '';
			fileName = fileUrl.substring(self._last_slash(fileUrl) + 1, fileUrl.length);
		}

		newRoot = fileUrl.replace(fileName, '');

		var reader = Components.classes["@activestate.com/koFileEx;1"]
			.createInstance(Components.interfaces.koIFileEx),
			placeholder;
			
		if (sassData.needPrefixes !== undefined) {
			if (self._in_array(fileUrl, sassData.needPrefixes)) {
				prefix = true;
			}
		}
			
		if (prefix) {
			fileUrl = self._get_prefixd_url(fileUrl);
		}

		reader.path = fileUrl;
		output 		= [];

		try {
			reader.open("r");
			placeholder = reader.readfile();
			reader.close();
			output[0] = placeholder;
			output[1] = newRoot;

		} catch (e) {
			if (prefix === false) {
				output = self._readFile(root, filepath, true);
			} else {
				self._notifcation('SASS ERROR: Reading file: ' + fileUrl, true);
				self._updateStatusBar('SASS ERROR: Reading file: ' + fileUrl);
				console.error(e.message);
			}
			
		}

		return output;
	}
	
	this._parse_backDirectories = (fullUrl, filePath, root) => {
		var url 			= self._parse_uri(fullUrl),
			backDirectorys 	= filePath.match(/\.\.\//g),
			fileName 		= url.substr(self._last_slash(url) + 1, url.length),
			fileBase 		= filePath.replace(/\.\.\//g, '');
			base 			= root;
			
		for (var x = 0; x < backDirectorys.length + 1; x++) {
			base = base.substr(0, self._last_slash(base));
			if (x === backDirectorys.length) {
				base = base + '/';
			}
		}
		
		return {
			fileUrl: base + fileBase,
			fileName: fileName
		};
	}

	this._in_array = (search, array) => {
		for (i = 0; i < array.length; i++) {
			if (array[i] == search) {
				return true;
			}
		}
		return false;
	}
	
	this._get_prefixd_url = (uri) => {
		var base 	= uri.substr(0, self._last_slash(uri) + 1),
			file 	= uri.substr((self._last_slash(uri) + 1), uri.length),
			output 	= base + '_' + file;
		
		if (sassData.needPrefixes === undefined) {
			sassData.needPrefixes = [uri];
		} else {
			if (!self._in_array(uri, sassData.needPrefixes)) {
				sassData.needPrefixes.push(uri);
			}
		}
		
		return output;
	}

	this._last_slash = (uri) => {
		if (/\//.test(uri)) {
			return uri.lastIndexOf('/');
		} else {
			return uri.lastIndexOf('\\');
		}
	}

	this._parse_uri = (uri) => {
		if (/\\/.test(uri)) {
			uri = uri.replace(/\//g, '\\');
			ko.uriparse.getMappedPath(uri);
		}

		return uri;
	}
	
	this._calculateXpos = () => {
		var currentWindowPos = editor.getCursorWindowPosition(true);
			
		return currentWindowPos.x;
	}

	this._calculateYpos = () => {
		var currentWindowPos 	= editor.getCursorWindowPosition(true),
			defaultTextHeight 	= (ko.views.manager.currentView.scimoz.textHeight(0) - 10);
			//adjustY =+ prefs.getIntPref('tooltipY');
			
			defaultTextHeight = defaultTextHeight; // + adjustY
		
		return (currentWindowPos.y + defaultTextHeight);
	}

	insertSassVar = () => {
		var scimoz 		= ko.views.manager.currentView.scimoz,
			currentLine =	scimoz.lineFromPosition(scimoz.currentPos),
			input 		= $('#sass_auto');

		if (input.length > 0) {
			var val = input.value();

			if (val.length > 0) {
				scimoz.insertText(scimoz.currentPos, val);
				scimoz.gotoPos(scimoz.currentPos + val.length);
			}
			input.parent().remove();
			ko.views.manager.currentView.setFocus();
			
			setTimeout( () => {
				if (scimoz.lineFromPosition(scimoz.currentPos) > currentLine) {
					scimoz.homeExtend();
					scimoz.charLeftExtend();
					scimoz.replaceSel('');
				}
				
			}, 50);
		}
	}

	abortSassVarCompletion = () => {
		var comp = $('#sass_wrapper');

		if (comp.length > 0) {
			comp.remove();
			ko.views.manager.currentView.setFocus();
		}
	}

	blurSassComletion = () => {
		clearSassCompletion = setTimeout( () => {
			abortSassVarCompletion();
		}, 1000);
	}

	focusSassCompletion = () => {
		if (typeof clearSassCompletion !== 'undefined') {
			clearTimeout(clearSassCompletion);
		}
	}

	this._autocomplete = () => {
		var completions 	= sassData.vars,
			mainWindow 		= document.getElementById('komodo_main'),
			popup 			= document.getElementById('sass_wrapper'),
			autocomplete 	= document.createElement('textbox'),
			currentView 	= ko.views.manager.currentView,
			x 				= self._calculateXpos(),
			y 				= self._calculateYpos();
			
		//console.log('showing autocomplete');
		
		if (popup == null) {
			popup = document.createElement('tooltip');
			popup.setAttribute('id', 'sass_wrapper');
			autocomplete.setAttribute('id', 'sass_auto');
			autocomplete.setAttribute('type', 'autocomplete');
			autocomplete.setAttribute('showcommentcolumn', 'true');
			autocomplete.setAttribute('autocompletesearch', 'scss-autocomplete');
			autocomplete.setAttribute('highlightnonmatches', 'true');
			autocomplete.setAttribute('ontextentered', 'insertSassVar()');
			autocomplete.setAttribute('ontextreverted', 'abortSassVarCompletion()');
			autocomplete.setAttribute('ignoreblurwhilesearching', 'true');
			autocomplete.setAttribute('minresultsforpopup', '0');
			autocomplete.setAttribute('onblur', 'blurSassComletion()');
			autocomplete.setAttribute('onfocus', 'focusSassCompletion()');
			popup.appendChild(autocomplete);

			mainWindow.appendChild(popup);
		}

		if (typeof completions === 'undefined') {
			self._notifcation('No vars set, going find some!');
			self._getVars();
			return false;
		}


		if (completions.length > 0) {
			autocomplete.setAttribute('autocompletesearchparam', completions);
			popup.openPopup(mainWindow, "", x, y, false, false);
			autocomplete.focus();
			autocomplete.value = "$";
			autocomplete.open = true;
		}
	}
	
	this._autocompleteMixins = () => {
		var completions 	= sassData.mixins,
			mainWindow 		= document.getElementById('komodo_main'),
			popup 			= document.getElementById('sass_wrapper'),
			autocomplete 	= document.createElement('textbox'),
			currentView 	= ko.views.manager.currentView,
			x 				= self._calculateXpos(),
			y 				= self._calculateYpos();
			
		//console.log('showing autocomplete');
		
		if (popup == null) {
			popup = document.createElement('tooltip');
			popup.setAttribute('id', 'sass_wrapper');
			autocomplete.setAttribute('id', 'sass_auto');
			autocomplete.setAttribute('type', 'autocomplete');
			autocomplete.setAttribute('showcommentcolumn', 'true');
			autocomplete.setAttribute('autocompletesearch', 'scss-autocomplete');
			autocomplete.setAttribute('highlightnonmatches', 'true');
			autocomplete.setAttribute('ontextentered', 'insertSassVar()');
			autocomplete.setAttribute('ontextreverted', 'abortSassVarCompletion()');
			autocomplete.setAttribute('ignoreblurwhilesearching', 'true');
			autocomplete.setAttribute('minresultsforpopup', '0');
			autocomplete.setAttribute('onblur', 'blurSassComletion()');
			autocomplete.setAttribute('onfocus', 'focusSassCompletion()');
			popup.appendChild(autocomplete);

			mainWindow.appendChild(popup);
		}

		if (typeof completions === 'undefined') {
			self._notifcation('No mixins set, going find some!');
			self._getVars();
			return false;
		}


		if (completions.length > 0) {
			autocomplete.setAttribute('autocompletesearchparam', completions);
			popup.openPopup(mainWindow, "", x, y, false, false);
			autocomplete.focus();
			autocomplete.value = "$";
			autocomplete.open = true;
		}
	};
	
	this._checkForSearch = () => {
		if (search) {
			self.getVars(true);
			search = false;
		}
	}
	
	this.varCompletion = () => {
		var editor_pane = ko.views.manager.topView;

		this._onKeyPress = (e) => {
			//console.log('key press function');
			if (!editor_pane.currentView) {
				return;
			}
			
			var currentView = ko.views.manager.currentView;
			if (!currentView) {
				return;
			}
			
			var language = currentView.language;
			if (!language) {
				return;
			}
			if (language !== 'Sass' && language !== 'SCSS') {
				return;
			}
			
			var scimoz = currentView.scimoz;
			if (e.shiftKey && e.charCode == 36 && !e.altKey && !e.metaKey) {
				var d 		= currentView.document || currentView.koDoc,
					file 	= d.file;

				if (!file) {
					self._notifcation('Please save the file first', true);
					return;
				}
				
				if ( !scimoz || ! scimoz.focus) {
					return false;
				}

				if (file.ext == '.sass' || file.ext == '.scss') {
					var currentLine 		= scimoz.lineFromPosition(scimoz.currentPos),
						currentLineStart 	= scimoz.lineLength(currentLine);
						
					//console.log('Want to show autocomplete');

					try {
						if (currentLineStart > 3) {
							e.preventDefault();
							e.stopPropagation();
							if (scimoz.selText.length > 0) {
								scimoz.replaceSel('');
							}
							self._autocomplete();
						} else {
							search = true;
						}
					} catch (e) {

					}
				}
			}
		}

		editor_pane.addEventListener('keypress', self._onKeyPress, true);
	};

	
	this._notifcation = ($message, error) => {
		$message 	= $message || false;
		error 		= error || false;
		
		if (!notification) {
			notification = true;
			var icon = error ? 'chrome://scss_compiler/content/sass-error-icon.png' : 'chrome://scss_compiler/content/sass-icon.png';
			if (!("Notification" in window)) {
				alert("This browser does not support system notifications");
			}
			
			else if (Notification.permission === "granted") {
				var options = {
				body: $message,
				icon: icon
				};
				var n = new Notification('SASS Compiler', options);
				setTimeout(function(){
					n.close.bind(n);
					notification = false;
				}, 5000); 
			}
			
			else if (Notification.permission !== 'denied') {
				Notification.requestPermission(function (permission) {
				if (permission === "granted") {
					var options = {
						 body: $message,
						 icon: icon
					 };
					 var n = new Notification('SASS Compiler', options);
					setTimeout( () => {
						n.close.bind(n);
						notification = false;
					}, 5000); 
				}
				});
			}
		} else {
			setTimeout(() => {
				self._notifcation($message, error);
			}, 200);
		}
	};
	
	this.scssEnableFileWatcher = () => {
		var d 	= ko.views.manager.currentView.document || ko.views.manager.currentView.koDoc;
		if (d === null || d.file === null) {
			return false;
		}
		prefs.setBoolPref('useFilewatcher', true);
		prefs.setCharPref('filewatcher', d.file.displayPath);
		self._notifcation('SCSS File watcher enabled');
	};
	
	this.scssDisableFileWatcher = function() {
		prefs.setBoolPref('useFilewatcher', false);
		prefs.setCharPref('filewatcher', '');
		self._notifcation('SCSS File watcher disabled');
	};
	
	this._StartUpAction = function() {
		self.varCompletion();
	};
	
	this._addDynamicToolbarButton = () => {
		const db = require('ko/dynamic-button');

		const view = () => {
			var langs = ['Sass', 'SCSS'],
				currView = ko.views.manager.currentView;
			return currView &&  currView !== "New Tab" && langs.indexOf(currView.language) !== -1;
		};
		
		const button = db.register({
			label: "Sass Compiler",
			tooltip: "Sass Compiler",
			icon: "file-code-o",
			events: [
				"current_view_changed",
			],
			menuitems: [
				{
					label: "Enable File Watcher for current file",
					name: "enable_file_watcher_for_current_file",
					command: () => {
						extensions.scss_compiler.scssEnableFileWatcher();
					}
				},
				{
					label: "Disable File Watcher",
					name: "disable_file_watcher",
					command: () => {
						extensions.scss_compiler.scssDisableFileWatcher();
					}
				},
				{
					label: "Get $ variables",
					name: "Get_variables",
					command: () => {
						extensions.scss_compiler.getVars();
					}
				},
			],
			isEnabled: () => {
				return view();
			},
		});
	};
	self._addDynamicToolbarButton();
	
	window.addEventListener("komodo-post-startup", self._StartUpAction, false);
    window.addEventListener('file_saved', self.run_SCSS);
	window.addEventListener("view_opened", self.getVars, false);

}).apply(extensions.scss_compiler);
