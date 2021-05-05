start
    = unit_grammar_declaration

s = WS+

_ = WS*

BLANK "Blank" = " "

WS "WS"
  = "\t"
  / "\v"
  / "\f"
  / "\n"
  / " "
  / "\u00A0"
  / "\uFEFF"
  / Zs
  / "#" [^\n]* [\n]

Zs = [\u0020\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]

unit_grammar_declaration
  = _ 'unit' s 'grammar' s n:$(type_name) terminator+
  rules:grammar_body {
    return {grammar: n, s: location().start.offset, e: location().end.offset, rules};
  }

type_name = $(([a-zA-Z:])+)

terminator "Term"
  = [;\n]

grammar_body = grammar_statement*

grammar_statement
  = r:rule_definition terminator? {
    return r;
  }

rule_definition = n:rule_head b:rule_body {
  return {
    ruledef: n.name,
    s: n.s,
    e_name: n.e,
    e: location().end.offset,
    alts: b,
  }
}

rule_head = s:$(_) n:$(rule_name) s2:$(BLANK* ':' _) {
  return {name: n, s: location().start.offset + s.length, e: location().end.offset - s2.length};
}

rule_body = alternatives

alternatives = _ '|'? _ a:production b:( _ '|' _ production )* {
  return [a, ...b.map(x => x[3])];
}

production = a:rule_part b:(s rule_part)* {
  // console.log('production', b);

  return b.length ? {rule: 'parts', parts: [a, ...b.map(x=>x[1])], s: location().start.offset, e: location().end.offset} : a;
}

rule_part = a:subrule q:$(rule_quantifier?) {
  const {start: {offset: s}, end: {offset: e}} = location();
  return {...a, s, e, q};
}

subrule "SubRule"
  = atomic_subrule
  / bracketed_group

atomic_subrule
  = c:[+-] {return {rule: c}}
  / named_subrule
  / literal_string {return {rule: 'lit-s', val: text()}}
  / literal_regex {return {rule: 'lit-re', val: text()}}

literal_string
  = single_quoted_string
  / double_quoted_literal_string

single_quoted_string "SingleString" = ['] ([^\\']+ / [\\] .)* [']

double_quoted_literal_string "DoubleString"
  = ["] ([^\\"]+ / [\\] .)* ["]

named_subrule
  = m:$(rule_modifier*) n:$(rule_name) !(BLANK* ':') {
    // console.log('named_subrule', m, n);
    return {rule: 'ref', ref: n, m};
  }

literal_regex "LitRegex" = '/' ([^\\/]+ / [\\] .)* '/'

bracketed_group = '(' _ p:production _ ')' {
  return p;
}

rule_modifier = [.]

rule_quantifier "RuleQuant"
  = '(' (
    DIGIT+ ('..' DIGIT* )?
    / '..' DIGIT+
    / 's' '?'?
    / '?'
  ) ')' (s separator_marker s separator_subrule)?

separator_marker = '%' '%'?

separator_subrule = atomic_subrule

DIGIT "Digit" = [0-9]

rule_name "RuleName" = [a-zA-Z0-9_-]+
