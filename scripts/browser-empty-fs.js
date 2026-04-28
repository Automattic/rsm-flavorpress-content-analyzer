export function readFile(_path, callback) {
  callback(new Error("fs.readFile is unavailable in browser builds."));
}

export default {
  readFile,
};
