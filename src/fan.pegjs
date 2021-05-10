start
    = unit_grammar_declaration

unit_grammar_declaration
  = _ 'unit' s 'grammar' s n:$(type_name) terminator
  rules:grammar_body EOF {
    return {grammar: n, s: location().start.offset, e: location().end.offset, rules};
  }

type_name = $(([a-zA-Z:])+)

grammar_body = grammar_statement*

grammar_statement
  = r:rule_definition terminator? {
    return r;
  }

rule_definition = n:rule_head b:rule_body {
  return {
    ruledef: n,
    s: n.s,
    e: location().end.offset,
    alts: b,
  }
}

rule_head = _ n:rule_name BLANK* ':' _ {
  return n;
}

rule_body = alternatives

alternatives = _ '|'? _ a:production b:( _ '|' _ production )* {
  return [a, ...b.map(x => x[3])];
}

production = a:rule_part b:(_ rule_part)* {
  // console.log('production', b);

  return b.length ? {rule: 'parts', parts: [a, ...b.map(x=>x[1])], s: location().start.offset, e: location().end.offset} : a;
}

rule_part = a:subrule q:rule_quantifier? {
  const {start: {offset: s}, end: {offset: e}} = location();
  return {...a, s, e, q};
}

subrule "SubRule"
  = atomic_subrule
  / bracketed_group

atomic_subrule
  = _ c:[+-] _ {return {rule: c}}
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
  = m:$(rule_modifier*) n:rule_name !(BLANK* ':') {
    // console.log('named_subrule', m, n);
    return {rule: 'ref', ref: n.name, m};
  }

literal_regex "LitRegex" = '/' ([^\\/]+ / [\\] .)* '/'

bracketed_group = '(' _ p:production _ ')' {
  return p;
}

rule_modifier = [.]

rule_quantifier "RuleQuant"
  = _ '(' range:$(
    DIGIT+ ('..' DIGIT* )?
    / '..' DIGIT+
    / 's' '?'?
    / '?'
  ) ')' _ sep:separator? {
    return {type: "quant", range, sep, s: location().start.offset, e: location().end.offset};
  }

separator = marker:$(separator_marker) _ rule:separator_subrule {
  return {type: "quant-sep", marker, rule, s: location().start.offset, e: location().end.offset};
}

separator_marker = '%' '%'?

separator_subrule = a:atomic_subrule {
  const {start: {offset: s}, end: {offset: e}} = location();
  return {...a, s, e};
}

DIGIT "Digit" = [0-9]

rule_name "RuleName" = n:$([a-zA-Z0-9_-]+) {
  return {name: n, s: location().start.offset, e: location().end.offset};
}

s = WS+

_ = WS*

BLANK "Blank" = " "

WS "WS"
  = "\t"
  / "\v"
  / "\f"
  / "\n"
  / " "
  / "\uFEFF"
  / Zs
  / "#" [^\r\n]* [\r]?[\n]

Zs = [\u0020\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]

// EOF: https://groups.google.com/g/pegjs/c/-Vz4F1k-FyQ
EOF = !.

EOL = '\r'? '\n'

terminator "Terminator"
  = non_semicolon_terminator
  / _ ';' _

non_semicolon_terminator
  = _ &( WS* ( ( (',' WS*)? '}' ) / EOF ) )
  / &{ /* {TODO: check '}' */ return true; } WS* &(EOL / EOF ) _
