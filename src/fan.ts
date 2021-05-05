import {
  Definition,
  DocumentSymbol,
  Hover,
  Location,
  MarkupKind,
  SymbolKind,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import {parse} from './fan.peg';

export {parse};

export type Grammar = {
  grammar: string;
  s: number;
  e: number;
  rules: Array<RuleDef>;
};
type RuleDef = {
  ruledef: string;
  s: number;
  /** name 的 pos */
  e_name: number;
  e: number;
  alts: Array<Rule>;
};
type Rule = RuleCore & {
  s: number;
  e: number;
  q: any;
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
          name: rule.ruledef,
          range,
          selectionRange: {
            start: this.d.positionAt(rule.s),
            end: this.d.positionAt(rule.e_name),
          },
        };
      }),
    };

    // this.g.
    // SymbolKind.Array;
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

    const o = this.getRuleAtPos(pos);

    if (!o) {
      return null;
    }

    const h: Hover = {
      contents: {
        kind: MarkupKind.Markdown,
        value: desc(o),
      },
    };

    return h;
  }

  getDefinition(pos: number): Definition | null {
    const o = this.getRuleAtPos(pos);

    if (!o) {
      return null;
    }

    if (o.rule === "ref") {
      const def = this.g.rules.find((r) => r.ruledef === o.ref);

      if (def) {
        return {
          uri: this.d.uri,
          range: {
            start: this.d.positionAt(def.s),
            end: this.d.positionAt(def.e_name),
          },
        };
      }
    }

    return null;
  }

  getReferences(pos: number): Location[] | null {
    const o = this.getRuleAtPos(pos);

    if (!o) {
      return null;
    }

    if (o.rule === "ref") {
      const name = o.ref;
      const uri = this.d.uri;
      let locs: Location[] = [];

      const def = this.g.rules.find((r) => r.ruledef === name);

      if (def) {
        locs.push({
          uri,
          range: {
            start: this.d.positionAt(def.s),
            end: this.d.positionAt(def.e_name),
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

  getRuleAtPos(pos: number): Rule | null {
    let o: Rule | null = null;

    const p = (r: Rule): boolean => {
      if (pos < r.s) {
        return true;
      }

      if (r.rule === "parts") {
        return ps(r.parts);
      } else {
        if (pos >= r.s && pos <= r.e) {
          o = r;
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

      if (pos >= rule.s && pos <= rule.e) {
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
