module.exports = new Proxy({}, {
  get: (_target, key) => String(key),
});
