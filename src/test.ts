import * as fs from "fs";
import * as peg from "peggy";
import {
  // parse,
  Grammar,
} from "./fan";

const { parse } = peg.generate(
  fs.readFileSync(__dirname + "/fan.pegjs", "utf-8"),
  {
    trace: true,
  }
) as {
  parse(input: string, options?: peg.ParserOptions): Grammar;
  SyntaxError: any;
};

function test() {
  let src = `
unit grammar ORJS::Grammar;

program:
    .shebang(?)
    - statement(s?) %% .semicolon

`;
  src = fs.readFileSync(__dirname + "/../samples/Grammar.fan", "utf-8");

  let ret: Grammar = parse(src);

  console.log("got", JSON.stringify(ret, undefined, " "));
}

test();
