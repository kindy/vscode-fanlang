import {
  Definition,
  DocumentSymbol,
  Hover,
  Location,
  MarkupKind,
  SymbolKind,
  Range,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { parse } from "./fan.peg";

export { parse };

export type Grammar = {
  grammar: string;
  s: number;
  e: number;
  rules: Array<RuleDef>;
};
type RuleDef = {
  ruledef: RuleName;
  s: number;
  e: number;
  alts: Array<Rule>;
};
type RuleName = {
  name: string;
  s: number;
  e: number;
};
type Rule = RuleCore & {
  s: number;
  e: number;
  q?: RuleQuant;
};
type RuleQuant = {
  s: number;
  e: number;
  type: "quant";
  range: string;
  sep?: RuleQuantSep;
};
type RuleQuantSep = {
  type: "quant-sep";
  marker: string;
  rule: Rule;

  s: number;
  e: number;
};

type RuleCore =
  | {
      rule: "parts";
      parts: Array<Rule>;
    }
  | {
      rule: "+" | "-";
    }
  | {
      rule: "ref";
      ref: string;
      /** modifiers */
      m: string;
    }
  | {
      rule: "lit-s" | "lit-re";
      val: string;
    };

type LeafNode = Rule | RuleName | RuleQuantSep;

const isName = (val: any): val is RuleName => "name" in val;
const isQuantSep = (val: any): val is RuleQuantSep => val?.type === "quant-sep";

export class Fan {
  constructor(public d: TextDocument, public g: Grammar) {
    // this.d = d;
    // this.g = g;
  }

  getSymbols(): DocumentSymbol[] {
    const range = {
      start: this.d.positionAt(this.g.s),
      end: this.d.positionAt(this.g.e),
    };
    let gs: DocumentSymbol = {
      kind: SymbolKind.Class,
      name: this.g.grammar,
      range,
      selectionRange: range,

      children: this.g.rules.map((rule) => {
        const range = {
          start: this.d.positionAt(rule.s),
          end: this.d.positionAt(rule.e),
        };

        return {
          kind: SymbolKind.Method,
          name: rule.ruledef.name,
          range,
          selectionRange: {
            start: this.d.positionAt(rule.ruledef.s),
            end: this.d.positionAt(rule.ruledef.e),
          },
        };
      }),
    };

    return [gs];
  }

  getHover(pos: number): Hover | null {
    const desc = (r: Rule): string => {
      if (r.rule === "parts") {
        return "";
      } else if (r.rule === "ref") {
        return `ref to \`${r.ref}\``;
      } else {
        return r.rule;
      }
    };

    const o = this.getLeafNodeAtPos(pos);

    if (!o) {
      return null;
    }

    const mk = (
      value: string,
      range?: { s: number; e: number } | undefined
    ): Hover => ({
      contents: {
        kind: MarkupKind.Markdown,
        value,
      },
      range: range
        ? {
            start: this.d.positionAt(range.s),
            end: this.d.positionAt(range.e),
          }
        : undefined,
    });

    const h = isName(o)
      ? mk(`rule ${o.name}`, o)
      : isQuantSep(o)
      ? (console.log('sep', o), mk(desc(o.rule), o.rule))
      : mk(desc(o), o.rule == "lit-re" ? o : undefined);

    return h;
  }

  getDefinition(pos: number): Definition | null {
    const o = this.getLeafNodeAtPos(pos);

    if (!o) {
      return null;
    }

    const name = this.getRuleNameInNode(o);

    if (name) {
      const def = this.g.rules.find((r) => r.ruledef.name === name);

      if (def) {
        return {
          uri: this.d.uri,
          range: {
            start: this.d.positionAt(def.ruledef.s),
            end: this.d.positionAt(def.ruledef.e),
          },
        };
      }
    }

    return null;
  }

  getRuleNameInNode(node: LeafNode): string | null {
    return isName(node)
      ? node.name
      : isQuantSep(node)
      ? node.rule.rule === "ref"
        ? node.rule.ref
        : null
      : node.rule === "ref"
      ? node.ref
      : null;
  }

  getReferences(pos: number): Location[] | null {
    const node = this.getLeafNodeAtPos(pos);

    if (!node) {
      return null;
    }

    const name = this.getRuleNameInNode(node);

    if (name) {
      const uri = this.d.uri;
      let locs: Location[] = [];

      const def = this.g.rules.find((r) => r.ruledef.name === name);

      if (def) {
        locs.push({
          uri,
          range: {
            start: this.d.positionAt(def.ruledef.s),
            end: this.d.positionAt(def.ruledef.e),
          },
        });

        const p = (r: Rule) => {
          if (r.rule === "parts") {
            ps(r.parts);
          } else if (r.rule === "ref" && r.ref === name) {
            locs.push({
              uri,
              range: {
                start: this.d.positionAt(r.s),
                end: this.d.positionAt(r.e),
              },
            });
          }
        };
        const ps = (rs: Rule[]) => {
          for (const r of rs) {
            p(r);
          }
        };

        for (const rule of this.g.rules) {
          ps(rule.alts);
        }
      }

      return locs;
    }

    return null;
  }

  getLeafNodeAtPos(pos: number): LeafNode | null {
    let o: LeafNode | null = null;

    const isIn = (o: { s: number; e: number }): boolean =>
      pos >= o.s && pos <= o.e;

    const p = (r: Rule): boolean => {
      if (pos < r.s) {
        return true;
      }

      if (r.rule === "parts") {
        let ret = ps(r.parts);

        if (!ret && r.q?.sep && isIn(r.q.sep)) {
          o = r.q.sep;
          ret = true;
        }

        return ret;
      } else {
        if (isIn(r)) {
          o = r.q?.sep && isIn(r.q.sep) ? r.q.sep : r;
          return true;
        }
      }

      return false;
    };
    const ps = (rs: Rule[]): boolean => {
      for (const r of rs) {
        if (p(r)) {
          return true;
        }
      }

      return false;
    };

    for (const rule of this.g.rules) {
      if (pos < rule.s) {
        break;
      }

      if (isIn(rule)) {
        if (isIn(rule.ruledef)) {
          o = rule.ruledef;
          break;
        }

        ps(rule.alts);

        break;
      }
    }

    return o;
  }

  static process(d: TextDocument) {
    const src = d.getText();
    let g: Grammar | null = null;
    try {
      g = parse(src);
    } catch (ex) {
      console.error("parse fail", ex);
      return undefined;
    }

    return new Fan(d, g);
  }
}
