import * as fs from "fs";
import { parse, Grammar } from "./fan";

function test() {
  const words = {};

  let src = `
unit grammar ORJS::Grammar;

program:
    .shebang(?)
    - statement(s?) %% .semicolon

`;
  src = fs.readFileSync(__dirname + "/../../samples/Grammar.fan", "utf-8");

  let ret: Grammar = parse(src);

  console.log("got", JSON.stringify(ret, undefined, " "));

  console.log("words", words);
}

test();
