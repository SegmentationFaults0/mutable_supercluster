import terser from "@rollup/plugin-terser";
import resolve from "@rollup/plugin-node-resolve";

const config = (file, plugins) => ({
  input: "index.js",
  output: {
    name: "mutable-supercluster",
    format: "umd",
    indent: false,
    file,
  },
  plugins,
});

export default [
  config("dist/mutable-supercluster.js", [resolve()]),
  config("dist/mutable-supercluster.min.js", [resolve(), terser()]),
];
