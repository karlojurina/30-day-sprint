// node --import ./world-tests/v4-ts-resolve.mjs ...: lets node load src/lib/world-v4/*.ts,
// whose relative imports have no extension ("./rail"), by trying ".ts".
import { register } from "node:module";
register(
  "data:text/javascript," +
    encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx); }
  catch (e) {
    if ((spec.startsWith("./") || spec.startsWith("../")) && !/\\.[a-z]+$/.test(spec)) return next(spec + ".ts", ctx);
    throw e;
  }
}`),
  import.meta.url,
);
