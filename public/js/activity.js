(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("../../lib/activity"));
  } else {
    root.QazAkxActivity = factory(root.QazAkxActivityCore);
  }
})(typeof self !== "undefined" ? self : this, function (core) {
  return core;
});
