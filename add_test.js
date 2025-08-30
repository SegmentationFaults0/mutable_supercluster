import { readFileSync } from "fs";
import Supercluster from "./index.js";

const getId = (point) => point.pointId;
const places = JSON.parse(
  readFileSync(new URL("./test/fixtures/places.json", import.meta.url)),
);

const index = new Supercluster({ getId, log: true, maxZoom: 4 }).load(
  structuredClone(places.features).slice(0, 10),
);
index.printClusterData();

console.log("-----\nADD 1\n-----");
index.addPoint(places.features[10]);
index.printClusterData();

console.log("-----\nADD 2\n-----");
index.addPoint(places.features[11]);
index.printClusterData();

console.log("-----\nADD 3\n-----");
index.addPoint(places.features[12]);
index.printClusterData();

console.log("-----\nADD 4\n-----");
index.addPoint(places.features[13]);
index.printClusterData();

console.log("done");
