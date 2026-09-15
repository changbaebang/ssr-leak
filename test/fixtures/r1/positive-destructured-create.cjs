const { create } = require('axios');

const api = create();

module.exports.withToken = function withToken(req) {
  api.defaults.headers.common.Authorization = req.headers.authorization;
};
