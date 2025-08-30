import { readFileSync } from "fs";
import Supercluster from "./index.js";

const getId = (point) => point.pointId;
const places = JSON.parse(
  readFileSync(new URL("./test/fixtures/places.json", import.meta.url)),
);

const index = new Supercluster({ getId, log: true, maxZoom: 4 }).load(
  structuredClone(places.features).slice(10, 14),
);

index.addPoint(places.features[14]);

console.log("done");
