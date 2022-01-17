// https://github.com/bitfocus/companion/wiki/instance_skel
try {
	var io = require('./node_modules/socket.io-client');
} catch (e) {
	console.error('ViStream: Socket.io should be installed via `npm install` before using this module');
}
const zlib = require('zlib');
var instance_skel = require('../../instance_skel');

// REQUIRED: constructor
function instance (system, id, config) {
	var self = this;

	// super-constructor
	instance_skel.apply(this, arguments);
	socket_init(self);

	return self;
}

// REQUIRED: Return config fields for web config
instance.prototype.config_fields = function () {
	var self = this;
	return [
		{
			type: 'text',
			id: 'info',
			width: 12,
			label: 'Information',
			value: 'This is a ViStream integration, <br>Click \'Save\' before setting up buttons'
		},
		{
			type: 'textinput',
			id: 'token',
			label: 'Token (Copy from cuelist module on ViStream platform)',
			default: '',
			required: true/*,
			regex: /^[^\/]+\/\d+\/[^\/]$/
            */
		}
	]
};

// Set up actions, needs data from modules to be availabe
instance.prototype.actions = function (system) {
	var self = this;
	var actions = {};
	if (self.config.vistream_modules) {
		var choices = [];
		var defaultchoice = null;
		self.config.vistream_modules.forEach(element => {
			defaultchoice = defaultchoice ?? element.id;
			choices.push({ id: element.id, label: element.name });
		});

		actions['sendToVistream'] = {
			label: 'Toggle/Enable/Disable Vistream Module',
			options: [
				{
					type: 'dropdown',
					label: 'Module',
					id: 'moduleid',
					width: 6,
					default: defaultchoice,
					choices: choices
				},
				{
					type: 'dropdown',
					label: 'Action',
					id: 'action',
					width: 6,
					default: 'toggle',
					choices: [
						{ id: 'toggle', label: 'Toggle' },
						{ id: 'enable', label: 'Enable' },
						{ id: 'disable', label: 'Disable' }
					]
				}
			]
		}
	}
	self.setActions(actions);
}

// define presets, could be retrieved from xhr request
instance.prototype.init_presets = function () {
	var self = this;
	var presets = [];

	if (self.config.vistream_modules) {
		self.config.vistream_modules.forEach(e => {
				presets.push({
					category: 'Toggle modules',
					label: 'Toggle module' + e.name,
					bank: {
						style: 'text',
						text: `toggle\\n${e.name}\\n`,
						size: 'auto',
						color: self.rgb(0, 0, 0),
						bgcolor: self.rgb(255, 255, 0),
						latch: false
					},
					actions: [
						{
							action: 'sendToVistream',
							options: {
								moduleid: e.id,
								action: 'toggle'
							}
						}
					],
					feedbacks: [
						{
							type: 'module_state',
							options: {
								moduleid: e.id,
							}
						}
					]
				});

				presets.push({
					category: 'Enable modules',
					label: 'Enable module' + e.name,
					bank: {
						style: 'text',
						text: `enable\\n${e.name}\\n`,
						size: 'auto',
						color: self.rgb(255, 255, 255),
						bgcolor: self.rgb(0, 255, 0),
						latch: false
					},
					actions: [
						{
							action: 'sendToVistream',
							options: {
								moduleid: e.id,
								action: 'enable'
							}
						}
					]
				});

				presets.push({
					category: 'Disable modules',
					label: 'Disable module' + e.name,
					bank: {
						style: 'text',
						text: `disable\\n${e.name}\\n`,
						size: 'auto',
						color: self.rgb(255, 255, 255),
						bgcolor: self.rgb(255, 0, 0),
						latch: false
					},
					actions: [
						{
							action: 'sendToVistream',
							options: {
								moduleid: e.id,
								action: 'disable'
							}
						}
					]
				});
			}
		)
	}

	self.setPresetDefinitions(presets);
}

// register feedback handler
instance.prototype.init_feedbacks = function () {
	var self = this;
	var feedbacks = {};
	if (self.config.vistream_modules) {
		var choices = [];
		var defaultchoice = null;
		self.config.vistream_modules.forEach(element => {
			defaultchoice = defaultchoice ?? element.id;
			choices.push({ id: element.id, label: element.name });
		});

		feedbacks['module_state'] = {
			label: 'Update state',
			description: 'Updates button text and bg color',
			options: [
				{
					type: 'dropdown',
					label: 'Module',
					id: 'moduleid',
					width: 12,
					default: defaultchoice,
					choices: choices
				}
			]
		};
	}
	self.setFeedbackDefinitions(feedbacks);
}

// helper to create the required config fields from the toke that has been saved to config
function parse_token(config) {
	if (config.token === "") {
		return config;
	}
	var parts = config.token.split('/');
	if (parts.length != 3) return config;
	config.baseUrl = 'https://vs2.vistream.online/';
	config.talk = parts[0];
	config.modId = parts[1];
	config.viewPass = parts[2];
	config.endPoint = config.baseUrl + parts[0] + '/mod/' + parts[1] + '/';
	
	return config;
}

// helper to retrieve modules list and(re-)initialize all state after config edit event
function set_config (self) {
	if (self.config.token === "") {
		return;
	}
	var url = self.config.endPoint + 'list?pass=' + self.config.viewPass;

	self.system.emit('rest_get', url, function (err, result) {
		if (err !== null) {
			self.log('error', 'HTTP POST Request failed (' + result.error.code + ')');
			self.status(self.STATUS_ERROR, result.error.code);
		} else {
  		console.log('requested modules list with success')
			self.config.vistream_modules = result.data;
			self.init_presets();
			self.actions();
			self.init_feedbacks();
			self.checkFeedbacks('module_state');
		}
	});
	return self.config;
}

// helper to establish the socket connection
function socket_init (self) {
	if (self.init_in_progress) {
		console.log('Websocket init already in progress');

		return;
	}
	self.init_in_progress = true;

	if (self.io !== undefined) {
		delete self.io;
	}

	if (!self.config.baseUrl && self.config.token) {
		self.config = parse_token(self.config);
	}
	if (!self.config.baseUrl) {
		self.init_in_progress = false;
		console.log('Websocket connection not yet possible, missing baseUrl config');

		return;
	}

	console.log('Websocket conecting to ' + self.config.baseUrl);

	try {
		self.io = io(
			self.config.baseUrl,
			{
				'path': '/update/' + self.config.talk + '/companion'
			}
		);
		self.io.off('vs').on('vs', function (data) {
			console.log('Websocket received data');
			var json = (typeof (data) == 'object') ? JSON.parse(utf8ToString(zlib.deflateRawSync(new Uint8Array(data)).decompress())) : JSON.parse(data);
			if (!self.config.vistream_modules) {
				return;
			}
			for (var i = 0; i < self.config.vistream_modules.length; i++) {
				if (self.config.vistream_modules[i].id == json.id) {
					self.config.vistream_modules[i].online = json.online;
					break;
				}
			}
			self.checkFeedbacks('module_state');
			self.status(self.STATUS_OK);
		});
		self.io.off('connect').on('connect', function (data) {
			console.log('Websocket connected');
			set_config(self);
			self.status(self.STATE_OK);
			self.init_in_progress = false;
		});
		self.io.off('disconnect').on('disconnect', function (data) {
			console.log('Websocket disconnected');
			self.status(self.STATUS_ERROR);
			self.init_in_progress = false;
		});
		self.io.off('connect_error').on("connect_error", (e) => {
			console.log('Websocket error: ' + e.message);
			self.status(self.STATUS_ERROR);
			self.init_in_progress = false;
		});
	} catch (e) {
		console.log('Error while conecting websocket: ' + e.message);
		self.init_in_progress = false;
	}
}

// REQUIRED: whenever users click save in the modules config, this gets triggered with new config
instance.prototype.updateConfig = function (config) {
	config = parse_token(config);
	console.log('Config updated');
	this.config = config;
	socket_init(this);
};

// REQUIRED: this is called when companion initialized the module, all set up should be triggered here
instance.prototype.init = function () {
	var self = this;

	debug = self.debug;
	log = self.log;

	socket_init(self);
};

// REQUIRED: drop all websockets and stuff here, before unloading
instance.prototype.destroy = function () {
	var self = this;
	if (self.io !== undefined) {
		self.io.close();
		delete self.io;
	}

	console.log('destroy');
};

// receive and use feedback events here
instance.prototype.feedback = function (feedback, bank) {
	var self = this;
	console.log('Feedback triggered: ', feedback);
	if (feedback.type === 'module_state') {
		let e = self.config.vistream_modules.find(x => x.id == feedback.options.moduleid);
		return {
			text: `${(e.online === '1' ? 'disable' : 'enable')}\\n${e.name}\\n`,
			color: self.rgb(255, 255, 255),
			bgcolor: (e.online === '1' ? self.rgb(255, 0, 0) : self.rgb(0, 255, 0))
		};
	}
}

// call an action from user interactions
instance.prototype.action = function (action) {
	var self = this, opt = action.options;

	switch (action.action) {

		case 'sendToVistream':

			let modulename = '';
			modulename = self.config.vistream_modules.find(x => x.id == opt.moduleid).mod;

			let url = self.config.endPoint + opt.action +'?pass=' + self.config.viewPass + `&module=${modulename}&dataid=${opt.moduleid}`;

			self.system.emit('rest_get', url, function (err, result) {
					if (err !== null) {
						self.log('error', 'HTTP POST Request failed (' + result.error.code + ')');
						self.status(self.STATUS_ERROR, result.error.code);
					} else {
						console.log('Action sent');
						self.status(self.STATUS_OK);
					}
				}
			);

			break;
	}
};

instance_skel.extendedBy(instance);
exports = module.exports = instance;
