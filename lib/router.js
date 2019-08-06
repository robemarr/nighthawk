'use strict';
/**
 * @file router.js
 * @author Wes Todd
 * @module nighthawk
 */

// Requirements
var BaseRouter = require('router');
var inherits = require('inherits');
var url = require('url');
var interceptClicks = require('intercept-link-clicks');
var interceptSubmits = require('@robmarr/intercept-form-submits');
var Request = require('./request');
var Response = require('./response');
var supported = require('./supports-push-state');

// Lazy load query string parser
var qs = {};
var _qs;
var depPrinted = false;
Object.defineProperty(qs, 'parse', {
	get: function () {
		_qs = _qs || require('q' + 's');
		return _qs.parse;
	}
});

/**
 * Router
 *
 * @constructor Router
 * @memberof module:nighthawk
 * @augments module:router.Router
 * @param {Object} [options]
 * @param {String} [options.base] - The base path for this router to match against
 * @param {String} [options.parseQuerystring] - Should we parse the querystring
 */
var Router = module.exports = function Router (options) {
	if (!(this instanceof Router)) {
		return new Router(options);
	}

	// Options is optional
	var opts = options || {};

	// Set the base path
	this.base(opts.base || null);

	// Keep the currently matched location
	this.currentLocation = null;

	// Local variables
	this.locals = Object.create(null);

	// Call parent constructor
	var r = BaseRouter.call(this, opts);

	// Parse query string
	if (opts.queryParser) {
		r.use(function parseQuerystring (req, res, next) {
			req.query = opts.queryParser(req._parsedUrl.query);
			next();
		});
	} else if (opts.parseQuerystring) {
		// This is deprecated, will remove from docs and
		// then fully remove in 3.0, but no good dep warning
		// mechanism exists in the browser, just just
		// wrapping the warning in a env check
		if (process && process.env && process.env.NODE_ENV !== 'production' && !depPrinted) {
			depPrinted = true;
			console.warn(
				'The parseQuerystring option is deprecated and will be removed in v3.0.0.  ' +
				'Use queryParser and pass a parsing function.  ex. queryParser: require(\'qs\').parse'
			);
		}
		r.use(function parseQuerystring (req, res, next) {
			req.query = qs.parse(req._parsedUrl.query);
			next();
		});
	}

	// Replace and reload on unhandled request
	this._reloadOnUnhandled = !!opts.reloadOnUnhandled;

	// A couple of internal vars
	this._stopInterceptingClicks = null;

	return r;
};
inherits(Router, BaseRouter);

/**
 * Set the base path for this router
 *
 * @function base
 * @memberof module:nighthawk.Router
 * @instance
 * @param {String} path - The new base path
 */
Router.prototype.base = function (path) {
	if (typeof path === 'undefined') {
		return this._base;
	}
	this._base = path;
};

/**
 * Start listening for route changes
 *
 * @function listen
 * @memberof module:nighthawk.Router
 * @instance
 * @param {Object} [options]
 * @param {Boolean} [options.popstate] - Should we bind to the popstate event?
 * @param {Boolean} [options.interceptClicks] - Should we bind to the window's click event?
 * @param {Boolean} [options.interceptSubmits] - Should we bind to the window's submit event?
 * @param {Boolean} [options.dispatch] - Should we dispatch a route right away?
 */
Router.prototype.listen = function (options) {
	// Default options
	var opts = options || {};

	// Watch for popstate?
	if (supported && opts.popstate !== false) {
		// Pre-bind the popstate listener so we can properly remove it later
		this.onPopstate = this.onPopstate.bind(this);

		// Bind the event
		window.addEventListener('popstate', this.onPopstate, false);
	}

	// Intercept all clicks?
	if (supported && opts.interceptClicks !== false) {
		this._stopInterceptingClicks = interceptClicks(this.onClick.bind(this));
	}

	// Intercept all submits
	if (supported && opts.interceptSubmits !== false) {
		this._stopInterceptSubmits = interceptSubmits(this.onSubmit.bind(this));
	}

	// Dispatch at start?
	if (opts.dispatch !== false) {
		this._processGetRequest({
			pathname: window.location.pathname,
			search: window.location.search,
			hash: window.location.hash
		}, true);
	}
};

/**
 * Handler for the popstate event
 *
 * @function onPopstate
 * @memberof module:nighthawk.Router
 * @instance
 * @param {Event} e
 */
Router.prototype.onPopstate = function (e) {
	this._processGetRequest(e.state || {
		pathname: window.location.pathname,
		search: window.location.search,
		hash: window.location.hash
	}, true);
};

/**
 * Handler for all click events
 *
 * @function onClick
 * @memberof module:nighthawk.Router
 * @instance
 * @param {Event} e
 * @param {Element} el - The clicked link element
 */
Router.prototype.onClick = function (e, el) {
	// Make sure the base is present if set
	if (this._base && el.pathname.indexOf(this._base) !== 0) {
		return;
	}

	// We are all good to parse the route
	e.preventDefault();

	// Run the route matching
	this._processGetRequest({
		pathname: el.pathname,
		search: el.search,
		hash: el.hash
	}, false);
};

/**
 * Handler for all submit events
 *
 * @function onSubmit
 * @memberof module:nighthawk.Router
 * @instance
 * @param {Event} e
 * @param {Element} el - The clicked link element
 */
Router.prototype.onSubmit = function (e, el) {
	// parse the form action
	var a = document.createElement('a');
	a.href = el.action;
	// Make sure the base is present if set
	if (this._base && a.pathname.indexOf(this._base) !== 0) {
		return;
	}

	// We are all good to parse the route
	e.preventDefault();
	// Run the route matching
	this._processGetRequest({
		pathname: a.pathname,
		search: a.search,
		hash: a.hash
	}, false);
};

/**
 * Change the page route
 *
 * @function changeRoute
 * @memberof module:nighthawk.Router
 * @instance
 * @param {String} url - The new url for the page
 */
Router.prototype.changeRoute = function (_url) {
	this._processGetRequest(url.parse(_url), false);
};

/**
 * Produces a url object with all missing values defaulted
 *
 * @function _normalizeUrl
 * @memberof module:nighthawk.Router
 * @instance
 * @private
 * @param {Object} url - The new url for the page
 * @param {String} url.pathname - The path part of the url
 * @param {String} url.search - The search part of the url
 * @param {String} url.hash - The hash part of the url
 * @param {String} url.path - The pathname with the base url removed
 */
Router.prototype._normalizeUrl = function (url) {
	// Normalize the url object
	url.search = url.search || '';
	url.hash = url.hash || '';

	// Strip the base off before routing
	var path = url.pathname;
	if (this._base) {
		path = path.replace(this._base, '');
	}
	url.path = (path === '' ? '/' : path);
	return url;
};

Router.prototype._updateLocation = function (url, replace) {
	var original = url.pathname + url.search + url.hash;
	var next = url.path + url.search;
	var prev = this.currentLocation;
	var prevState = (window.history && window.history.state) || {};
	if (this.currentLocation === next) {
		return false;
	}
	this.currentLocation = next;
	if (supported) {
		var _url = Object.assign({}, url);
		delete _url.path;
		if (replace) {
			window.history.replaceState(_url, null, original);
		} else {
			window.history.pushState(_url, null, original);
			Object.defineProperty(document, 'referrer', {
				get: function () { return prev || document.referrer; },
				configurable: true
			});
		}
	}
	return {prevLocation: prev, prevState: prevState};
};

/**
 * Create a Request and Response Object for the url
 *
 * @function _createRequestResponse
 * @memberof module:nighthawk.Router
 * @instance
 * @private
 * @param {Object} url - The new url for the page
 * @param {String} url.pathname - The path part of the url
 * @param {String} url.search - The search part of the url
 * @param {String} url.hash - The hash part of the url
 */
Router.prototype._createRequestResponse = function (url) {
	var req = new Request();
	var res = new Response();
	req.app = this;
	req.originalUrl = url.pathname + url.search + url.hash;
	req.baseUrl = this._base;
	req.path = url.path;
	req.url = this.currentLocation + url.hash;
	res.app = this;
	return {req: req, res: res};
};

/**
 * match and respond to route changes
 *
 * @function _routeMatching
 * @memberof module:nighthawk.Router
 * @instance
 * @private
 * @param {Object} req - The new Request for the page
 * @param {String} res - The new Response for the page
 * @param {String} prevLocation - The previous location
 * @param {String} prevState - the previous history state
 */
Router.prototype._routeMatching = function (req, res, prevLocation, prevState) {
	function handler (error) {
		if (error) throw error;
		if (this._reloadOnUnhandled) {
			if (supported) {
				window.history.replaceState(prevState, null, prevLocation);
			}
			window.location = req.originalUrl;
		}
	}
	this(req, res, handler.bind(this));
};

/**
 * Process a url
 *
 * @function _processGetRequest
 * @memberof module:nighthawk.Router
 * @instance
 * @private
 * @param {Object} url - The new url for the page
 * @param {String} url.pathname - The path part of the url
 * @param {String} url.search - The search part of the url
 * @param {String} url.hash - The hash part of the url
 * @param {Boolean} replace - Should this replace or push?
 */
Router.prototype._processGetRequest = function (_url, replace) {
	// Normalize the url object
	var url = this._normalizeUrl(_url);
	var update = this._updateLocation(url, replace);
	// If the update is valid process it
	if (update) {
		// Create the request and  object
		var result = this._createRequestResponse(url);
		var req = result.req;
		var res = result.res;
		req.method = 'GET';

		// Run the route matching
		this._routeMatching(req, res, update.prevLocation, update.prevState);
	}
};

/**
 * Stops listening on the window events
 *
 * @function destroy
 * @memberof module:nighthawk.Router
 * @instance
 */
Router.prototype.destroy = function () {
	window.removeEventListener('popstate', this.onPopstate, false);
	if (typeof this._stopInterceptingClicks === 'function') {
		this._stopInterceptingClicks();
	}
	if (typeof this._stopInterceptingSubmits === 'function') {
		this._stopInterceptingSubmits();
	}
};
