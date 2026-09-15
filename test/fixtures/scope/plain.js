const axios = require('axios');

module.exports.handler = async (req) => {
  axios.defaults.headers.common.Authorization = req.headers.authorization;
  return axios.get('/me');
};
