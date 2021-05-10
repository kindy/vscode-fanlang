import {
  Definition,
  DocumentSymbol,
  Hover,
  Location,
  MarkupKind,
  SymbolKind,
  Range,
  Diagnostic,
  DiagnosticSeverity,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { parse } from "./fan.peg";
import { ConnectionType, Documents } from "./server";

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

interface LangService {
  type: "grammar" | "action";

  checkDoc(c: ConnectionType): void;
  getSymbols(): DocumentSymbol[];
  getHover(pos: number): Hover | null;
  getDefinition(pos: number): Definition | null;
  getReferences(pos: number): Location[] | null;
}

export type FanLS = LangService;

export class Fan {
  constructor(public d: TextDocument, public docs: Documents) {}

  static process(d: TextDocument, docs: Documents): FanLS | undefined {
    const src = d.getText();

    let m: RegExpMatchArray | null = null;

    if ((m = src.match(/^unit grammar ([a-zA-Z:0-9_-]+);/m))) {
      let g: Grammar | null = null;
      try {
        g = parse(src);
      } catch (ex) {
        console.error("parse fail", ex);
        return undefined;
      }

      return new GrammarFan(d, docs, g);
    } else if ((m = src.match(/^unit class ([a-zA-Z:0-9_-]+) is Actions;/m))) {
      const methods: ActionMethod[] = [];

      for (const { index = -1, [1]: name } of src.matchAll(
        /^method ([a-zA-Z0-9_-]+) \(.*?\) \{$/gm
      )) {
        methods.push({ name, s: index, e: index + name.length });
      }

      return new ActionFan(d, docs, {
        name: m[1],
        s: 0,
        e: src.length,
        methods,
      });
    }
  }
}

class GrammarFan extends Fan implements LangService {
  type = "grammar" as const;

  private _actionFan: ActionFan | null = null;
  actionMethods: Map<string, ActionMethod> = new Map();

  get actionFan() {
    return this._actionFan;
  }
  set actionFan(v: ActionFan | null) {
    this._actionFan = v;

    const methods = new Map<string, ActionMethod>();
    if (v) {
      for (const meth of v.g.methods) {
        methods.set(meth.name, meth);
      }
    }

    this.actionMethods = methods;
  }

  constructor(d: TextDocument, docs: Documents, public g: Grammar) {
    super(d, docs);
  }

  checkDoc(c: ConnectionType) {
    const actionDoc = this.docs.all().find((doc) => doc.fan?.type === "action");

    if (!actionDoc) {
      this.actionFan = null;
      return;
    }

    const actionFan = actionDoc.fan as ActionFan;

    this.actionFan = actionFan;

    const methods = this.actionMethods;

    const diagnostics: Diagnostic[] = [];
    for (const rule of this.g.rules) {
      if (methods.has(rule.ruledef.name)) {
        const meth = methods.get(rule.ruledef.name)!;

        diagnostics.push({
          range: {
            start: this.d.positionAt(rule.ruledef.s),
            end: this.d.positionAt(rule.ruledef.e),
          },
          severity: DiagnosticSeverity.Hint,
          message: "Has Action Method",
          relatedInformation: [
            {
              location: {
                uri: actionDoc.uri,
                range: {
                  start: actionDoc.positionAt(meth.s),
                  end: actionDoc.positionAt(meth.e),
                },
              },
              message: `${meth.name}()`,
            },
          ],
        });
      }
    }

    c.sendDiagnostics({
      uri: this.d.uri,
      version: this.d.version,
      diagnostics,
    });
  }

  getSymbols(): DocumentSymbol[] {
    const methods = this.actionMethods;
    const range = {
      start: this.d.positionAt(this.g.s),
      end: this.d.positionAt(this.g.e),
    };

    let gs: DocumentSymbol = {
      kind: SymbolKind.Class,
      name: this.g.grammar,
      detail:
        "Grammar" + (this.actionFan ? ` ~~ ${this.actionFan.g.name}` : ""),
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
          detail: methods.has(rule.ruledef.name) ? ":action" : undefined,
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
      ? (console.log("sep", o), mk(desc(o.rule), o.rule))
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
}

type ActionMethod = { name: string; s: number; e: number };

class ActionFan extends Fan implements LangService {
  type = "action" as const;

  private _grammarFan: GrammarFan | null = null;
  ruledefs: Map<string, RuleDef> = new Map();

  get grammarFan() {
    return this._grammarFan;
  }
  set grammarFan(v: GrammarFan | null) {
    this._grammarFan = v;

    const ruledefs = new Map<string, RuleDef>();
    if (v) {
      for (const rule of v.g.rules) {
        ruledefs.set(rule.ruledef.name, rule);
      }
    }

    this.ruledefs = ruledefs;
  }

  constructor(
    d: TextDocument,
    docs: Documents,
    public g: { name: string; s: number; e: number; methods: ActionMethod[] }
  ) {
    super(d, docs);
  }

  checkDoc(c: ConnectionType) {
    const grammarDoc = this.docs
      .all()
      .find((doc) => doc.fan?.type === "grammar");

    if (!grammarDoc) {
      this.grammarFan = null;
      return;
    }

    const grammarFan = grammarDoc.fan as GrammarFan;

    this.grammarFan = grammarFan;
  }

  getSymbols(): DocumentSymbol[] {
    const rules = this.ruledefs;
    const range = {
      start: this.d.positionAt(this.g.s),
      end: this.d.positionAt(this.g.e),
    };

    let cls: DocumentSymbol = {
      kind: SymbolKind.Class,
      name: this.g.name,
      detail:
        "Action" + (this.grammarFan ? ` ~~ ${this.grammarFan.g.grammar}` : ""),
      range,
      selectionRange: range,

      children: this.g.methods.map((meth) => {
        const hasRule = rules.has(meth.name);
        const range = {
          start: this.d.positionAt(meth.s),
          end: this.d.positionAt(meth.e),
        };

        return {
          kind: SymbolKind.Method,
          name: meth.name,
          detail: hasRule ? ":rule" : undefined,
          range,
          selectionRange: {
            start: this.d.positionAt(meth.s),
            end: this.d.positionAt(meth.e),
          },
        };
      }),
    };

    return [cls];
  }

  getHover(pos: number): Hover | null {
    return null;
  }
  getDefinition(pos: number): Definition | null {
    return null;
  }
  getReferences(pos: number): Location[] | null {
    return null;
  }
}
