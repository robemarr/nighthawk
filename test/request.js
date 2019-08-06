/* global describe, it */
var Request = require('../lib/request');
var assert = require('assert');

describe('Request', function () {
	it('should have the correct protocol', function () {
		var r = new Request();
		assert.equal(r.protocol, 'https');
		assert.equal(r.secure, true);
	});
	it('should have the correct hostname', function () {
		var r = new Request();
		assert.equal(r.hostname, window.location.hostname);
	});
});
