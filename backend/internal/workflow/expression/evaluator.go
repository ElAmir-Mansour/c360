package expression

import (
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
	"unicode"
)

// Evaluator evaluates expressions against a data context.
// It uses a recursive descent parser to safely evaluate workflow transition
// conditions and decision-table cell expressions without any access to the Go
// runtime.
//
// GRAMMAR (a safe FEEL subset). The comparison/boolean/in/array grammar is the
// original one; arithmetic, a small function library, date/time helpers and a
// ternary were layered ADDITIVELY between the existing precedence levels so that
// every previously-valid expression parses to the identical AST and evaluates to
// the identical result:
//
//	expr        -> ternary
//	ternary     -> or_expr ( "?" expr ":" expr )?
//	or_expr     -> and_expr ( "||" and_expr )*
//	and_expr    -> cmp_expr ( "&&" cmp_expr )*
//	cmp_expr    -> additive ( ("=="|"!="|">"|"<"|">="|"<="|"in"|"not in") additive )?
//	additive    -> multiplicative ( ("+"|"-") multiplicative )*
//	multiplicative -> unary ( ("*"|"/"|"%") unary )*
//	unary       -> ("!"|"-") unary | postfix
//	postfix     -> primary
//	primary     -> "(" expr ")" | array | call | path | literal
//	call        -> ident "(" ( expr ("," expr)* )? ")"
type Evaluator struct {
	maxLength int // max expression length
	maxDepth  int // max nesting depth
}

// NewEvaluator creates a new Evaluator with safe defaults.
func NewEvaluator() *Evaluator {
	return &Evaluator{
		maxLength: 1000,
		maxDepth:  10,
	}
}

// Evaluate parses and evaluates an expression against provided data.
// data is a map structured as:
//
//	{"variables": {...}, "steps": {"stepId": {"output": {...}}}, "trigger": {"data": {...}}}
//
// Returns true/false based on the boolean truthiness of the expression result,
// or an error if the expression is invalid or evaluation fails. Evaluation is
// fail-closed: any tokenize/parse/eval error is surfaced (the caller treats it
// as "condition not satisfied" only after logging), never silently swallowed.
func (e *Evaluator) Evaluate(expression string, data map[string]interface{}) (bool, error) {
	result, err := e.EvaluateValue(expression, data)
	if err != nil {
		return false, err
	}
	return toBool(result), nil
}

// EvaluateValue parses and evaluates an expression and returns the RAW result
// value (not coerced to a boolean). It is used by the decision-table executor,
// which needs typed input/output values, and by callers that want the exact FEEL
// value. Boolean callers use Evaluate, which wraps this and applies toBool.
func (e *Evaluator) EvaluateValue(expression string, data map[string]interface{}) (interface{}, error) {
	if expression == "" {
		return nil, fmt.Errorf("empty expression")
	}
	if len(expression) > e.maxLength {
		return nil, fmt.Errorf("expression exceeds maximum length of %d characters", e.maxLength)
	}

	tokens, err := tokenize(expression)
	if err != nil {
		return nil, fmt.Errorf("tokenize error: %w", err)
	}

	parser := &parser{
		tokens:   tokens,
		pos:      0,
		maxDepth: e.maxDepth,
	}

	node, err := parser.parseExpr(0)
	if err != nil {
		return nil, fmt.Errorf("parse error: %w", err)
	}

	if parser.pos < len(parser.tokens) {
		return nil, fmt.Errorf("unexpected token at position %d: %q", parser.pos, parser.tokens[parser.pos].value)
	}

	ev := &evalState{maxDepth: e.maxDepth * 20}
	result, err := ev.eval(node, data, 0)
	if err != nil {
		return nil, fmt.Errorf("eval error: %w", err)
	}

	return result, nil
}

// ---------- Token types ----------

type tokenKind int

const (
	tkString   tokenKind = iota // single-quoted string literal
	tkNumber                    // integer or float
	tkBool                      // true / false
	tkNull                      // null
	tkIdent                     // identifier (part of a dotted path)
	tkDot                       // .
	tkEq                        // ==
	tkNe                        // !=
	tkGt                        // >
	tkGe                        // >=
	tkLt                        // <
	tkLe                        // <=
	tkAnd                       // &&
	tkOr                        // ||
	tkNot                       // !
	tkIn                        // in
	tkNotIn                     // not in (synthesized)
	tkLParen                    // (
	tkRParen                    // )
	tkLBrack                    // [
	tkRBrack                    // ]
	tkComma                     // ,
	tkPlus                      // +
	tkMinus                     // -
	tkStar                      // *
	tkSlash                     // /
	tkPercent                   // %
	tkQuestion                  // ?
	tkColon                     // :
)

type token struct {
	kind  tokenKind
	value string
}

// ---------- Tokenizer ----------

func tokenize(expr string) ([]token, error) {
	var tokens []token
	i := 0
	runes := []rune(expr)
	n := len(runes)

	for i < n {
		ch := runes[i]

		// skip whitespace
		if unicode.IsSpace(ch) {
			i++
			continue
		}

		// single-quoted string
		if ch == '\'' {
			j := i + 1
			for j < n && runes[j] != '\'' {
				if runes[j] == '\\' {
					j++ // skip escaped char
				}
				j++
			}
			if j >= n {
				return nil, fmt.Errorf("unterminated string literal starting at position %d", i)
			}
			val := string(runes[i+1 : j])
			tokens = append(tokens, token{kind: tkString, value: val})
			i = j + 1
			continue
		}

		// two-character operators
		if i+1 < n {
			two := string(runes[i : i+2])
			switch two {
			case "==":
				tokens = append(tokens, token{kind: tkEq, value: two})
				i += 2
				continue
			case "!=":
				tokens = append(tokens, token{kind: tkNe, value: two})
				i += 2
				continue
			case ">=":
				tokens = append(tokens, token{kind: tkGe, value: two})
				i += 2
				continue
			case "<=":
				tokens = append(tokens, token{kind: tkLe, value: two})
				i += 2
				continue
			case "&&":
				tokens = append(tokens, token{kind: tkAnd, value: two})
				i += 2
				continue
			case "||":
				tokens = append(tokens, token{kind: tkOr, value: two})
				i += 2
				continue
			}
		}

		// NUMBERS.
		//
		// BACKWARD-COMPAT: the original tokenizer treated a leading '-' before a
		// digit as part of a NEGATIVE NUMBER LITERAL. We must keep that exact
		// behaviour so every existing expression is unchanged, WHILE also
		// supporting binary subtraction (a - b). We disambiguate by position:
		// a '-<digit>' sequence is a negative literal ONLY when '-' is in a
		// PREFIX position (start of expression, or right after an operator /
		// '(' / '[' / ','). Otherwise '-' is the subtraction operator and the
		// digits form a positive literal. This yields IDENTICAL ASTs for all
		// pre-existing expressions (which never used binary '+'/'-') because in
		// those, any '-<digit>' only ever appeared in prefix position.
		if unicode.IsDigit(ch) {
			j := i
			for j < n && (unicode.IsDigit(runes[j]) || runes[j] == '.') {
				j++
			}
			tokens = append(tokens, token{kind: tkNumber, value: string(runes[i:j])})
			i = j
			continue
		}
		if ch == '-' && i+1 < n && unicode.IsDigit(runes[i+1]) && numberSignIsPrefix(tokens) {
			j := i + 1
			for j < n && (unicode.IsDigit(runes[j]) || runes[j] == '.') {
				j++
			}
			tokens = append(tokens, token{kind: tkNumber, value: string(runes[i:j])})
			i = j
			continue
		}

		// single-character operators / punctuation
		switch ch {
		case '>':
			tokens = append(tokens, token{kind: tkGt, value: ">"})
			i++
			continue
		case '<':
			tokens = append(tokens, token{kind: tkLt, value: "<"})
			i++
			continue
		case '!':
			tokens = append(tokens, token{kind: tkNot, value: "!"})
			i++
			continue
		case '(':
			tokens = append(tokens, token{kind: tkLParen, value: "("})
			i++
			continue
		case ')':
			tokens = append(tokens, token{kind: tkRParen, value: ")"})
			i++
			continue
		case '[':
			tokens = append(tokens, token{kind: tkLBrack, value: "["})
			i++
			continue
		case ']':
			tokens = append(tokens, token{kind: tkRBrack, value: "]"})
			i++
			continue
		case ',':
			tokens = append(tokens, token{kind: tkComma, value: ","})
			i++
			continue
		case '.':
			tokens = append(tokens, token{kind: tkDot, value: "."})
			i++
			continue
		case '+':
			tokens = append(tokens, token{kind: tkPlus, value: "+"})
			i++
			continue
		case '-':
			tokens = append(tokens, token{kind: tkMinus, value: "-"})
			i++
			continue
		case '*':
			tokens = append(tokens, token{kind: tkStar, value: "*"})
			i++
			continue
		case '/':
			tokens = append(tokens, token{kind: tkSlash, value: "/"})
			i++
			continue
		case '%':
			tokens = append(tokens, token{kind: tkPercent, value: "%"})
			i++
			continue
		case '?':
			tokens = append(tokens, token{kind: tkQuestion, value: "?"})
			i++
			continue
		case ':':
			tokens = append(tokens, token{kind: tkColon, value: ":"})
			i++
			continue
		}

		// identifiers and keywords (true, false, null, in, not)
		if unicode.IsLetter(ch) || ch == '_' {
			j := i
			for j < n && (unicode.IsLetter(runes[j]) || unicode.IsDigit(runes[j]) || runes[j] == '_') {
				j++
			}
			word := string(runes[i:j])
			switch word {
			case "true", "false":
				tokens = append(tokens, token{kind: tkBool, value: word})
			case "null":
				tokens = append(tokens, token{kind: tkNull, value: word})
			case "in":
				tokens = append(tokens, token{kind: tkIn, value: word})
			case "not":
				// "not in" is the negated membership operator. We only treat a
				// bare "not" as the operator when it is IMMEDIATELY followed by
				// the "in" keyword (skipping whitespace); otherwise "not" is a
				// normal identifier (a variable/path named "not" stays valid,
				// preserving backward-compat). Look ahead for "in".
				k := j
				for k < n && unicode.IsSpace(runes[k]) {
					k++
				}
				if k+1 < n && runes[k] == 'i' && runes[k+1] == 'n' &&
					(k+2 >= n || !(unicode.IsLetter(runes[k+2]) || unicode.IsDigit(runes[k+2]) || runes[k+2] == '_')) {
					tokens = append(tokens, token{kind: tkNotIn, value: "not in"})
					i = k + 2
					continue
				}
				tokens = append(tokens, token{kind: tkIdent, value: word})
			default:
				tokens = append(tokens, token{kind: tkIdent, value: word})
			}
			i = j
			continue
		}

		return nil, fmt.Errorf("unexpected character %q at position %d", string(ch), i)
	}

	return tokens, nil
}

// numberSignIsPrefix reports whether a '-' at the current tokenizer position is
// in a PREFIX position (so '-<digit>' should be lexed as a negative literal,
// preserving the original behaviour) rather than a binary subtraction operator.
// It is prefix when there is no preceding token or the preceding token is an
// operator / '(' / '[' / ',' — never after a value (number/string/ident/')'/']').
func numberSignIsPrefix(tokens []token) bool {
	if len(tokens) == 0 {
		return true
	}
	switch tokens[len(tokens)-1].kind {
	case tkNumber, tkString, tkBool, tkNull, tkIdent, tkRParen, tkRBrack:
		return false
	default:
		return true
	}
}

// ---------- AST node types ----------

type nodeKind int

const (
	ndLiteral  nodeKind = iota // literal value (string, number, bool, nil)
	ndPath                     // dotted path reference
	ndArray                    // array literal [a, b, c]
	ndBinaryOp                 // binary op: ==, !=, >, <, >=, <=, in, not in, &&, ||, + - * / %
	ndUnaryOp                  // unary op: ! or - (numeric negation)
	ndTernary                  // cond ? a : b
	ndCall                     // function call: fn(args...)
)

type astNode struct {
	kind     nodeKind
	value    interface{} // for ndLiteral
	segments []string    // for ndPath: ["steps", "triage", "output", "is_valid"]
	op       string      // for ndBinaryOp / ndUnaryOp
	left     *astNode    // for ndBinaryOp, ndUnaryOp (operand), ndTernary (condition)
	right    *astNode    // for ndBinaryOp, ndTernary (then-branch)
	third    *astNode    // for ndTernary (else-branch)
	elements []*astNode  // for ndArray / ndCall (args)
	fn       string      // for ndCall
}

// ---------- Parser ----------

type parser struct {
	tokens   []token
	pos      int
	maxDepth int
}

func (p *parser) peek() *token {
	if p.pos >= len(p.tokens) {
		return nil
	}
	return &p.tokens[p.pos]
}

func (p *parser) advance() token {
	t := p.tokens[p.pos]
	p.pos++
	return t
}

func (p *parser) expect(kind tokenKind) (token, error) {
	t := p.peek()
	if t == nil {
		return token{}, fmt.Errorf("unexpected end of expression, expected token kind %d", kind)
	}
	if t.kind != kind {
		return token{}, fmt.Errorf("expected token kind %d but got %q", kind, t.value)
	}
	return p.advance(), nil
}

// parseExpr is the entry point: expr -> ternary
func (p *parser) parseExpr(depth int) (*astNode, error) {
	if depth > p.maxDepth {
		return nil, fmt.Errorf("maximum nesting depth of %d exceeded", p.maxDepth)
	}
	return p.parseTernary(depth)
}

// ternary -> or_expr ( "?" expr ":" expr )?
func (p *parser) parseTernary(depth int) (*astNode, error) {
	cond, err := p.parseOr(depth)
	if err != nil {
		return nil, err
	}
	t := p.peek()
	if t == nil || t.kind != tkQuestion {
		return cond, nil
	}
	p.advance() // consume '?'
	thenNode, err := p.parseExpr(depth + 1)
	if err != nil {
		return nil, err
	}
	if _, err := p.expect(tkColon); err != nil {
		return nil, fmt.Errorf("ternary expression missing ':'")
	}
	elseNode, err := p.parseExpr(depth + 1)
	if err != nil {
		return nil, err
	}
	return &astNode{kind: ndTernary, left: cond, right: thenNode, third: elseNode}, nil
}

// or_expr -> and_expr ( "||" and_expr )*
func (p *parser) parseOr(depth int) (*astNode, error) {
	left, err := p.parseAnd(depth)
	if err != nil {
		return nil, err
	}
	for {
		t := p.peek()
		if t == nil || t.kind != tkOr {
			break
		}
		p.advance()
		right, err := p.parseAnd(depth)
		if err != nil {
			return nil, err
		}
		left = &astNode{kind: ndBinaryOp, op: "||", left: left, right: right}
	}
	return left, nil
}

// and_expr -> cmp_expr ( "&&" cmp_expr )*
func (p *parser) parseAnd(depth int) (*astNode, error) {
	left, err := p.parseCmp(depth)
	if err != nil {
		return nil, err
	}
	for {
		t := p.peek()
		if t == nil || t.kind != tkAnd {
			break
		}
		p.advance()
		right, err := p.parseCmp(depth)
		if err != nil {
			return nil, err
		}
		left = &astNode{kind: ndBinaryOp, op: "&&", left: left, right: right}
	}
	return left, nil
}

// cmp_expr -> additive ( ("=="|"!="|">"|"<"|">="|"<="|"in"|"not in") additive )?
func (p *parser) parseCmp(depth int) (*astNode, error) {
	left, err := p.parseAdditive(depth)
	if err != nil {
		return nil, err
	}
	t := p.peek()
	if t == nil {
		return left, nil
	}
	switch t.kind {
	case tkEq, tkNe, tkGt, tkGe, tkLt, tkLe, tkIn, tkNotIn:
		op := p.advance()
		right, err := p.parseAdditive(depth)
		if err != nil {
			return nil, err
		}
		return &astNode{kind: ndBinaryOp, op: opString(op), left: left, right: right}, nil
	}
	return left, nil
}

// additive -> multiplicative ( ("+"|"-") multiplicative )*
func (p *parser) parseAdditive(depth int) (*astNode, error) {
	left, err := p.parseMultiplicative(depth)
	if err != nil {
		return nil, err
	}
	for {
		t := p.peek()
		if t == nil || (t.kind != tkPlus && t.kind != tkMinus) {
			break
		}
		op := p.advance()
		right, err := p.parseMultiplicative(depth)
		if err != nil {
			return nil, err
		}
		left = &astNode{kind: ndBinaryOp, op: op.value, left: left, right: right}
	}
	return left, nil
}

// multiplicative -> unary ( ("*"|"/"|"%") unary )*
func (p *parser) parseMultiplicative(depth int) (*astNode, error) {
	left, err := p.parseUnary(depth)
	if err != nil {
		return nil, err
	}
	for {
		t := p.peek()
		if t == nil || (t.kind != tkStar && t.kind != tkSlash && t.kind != tkPercent) {
			break
		}
		op := p.advance()
		right, err := p.parseUnary(depth)
		if err != nil {
			return nil, err
		}
		left = &astNode{kind: ndBinaryOp, op: op.value, left: left, right: right}
	}
	return left, nil
}

// unary -> ("!"|"-") unary | primary
func (p *parser) parseUnary(depth int) (*astNode, error) {
	t := p.peek()
	if t == nil {
		return nil, fmt.Errorf("unexpected end of expression")
	}
	switch t.kind {
	case tkNot:
		p.advance()
		operand, err := p.parseUnary(depth + 1)
		if err != nil {
			return nil, err
		}
		return &astNode{kind: ndUnaryOp, op: "!", left: operand}, nil
	case tkMinus:
		p.advance()
		operand, err := p.parseUnary(depth + 1)
		if err != nil {
			return nil, err
		}
		return &astNode{kind: ndUnaryOp, op: "-", left: operand}, nil
	}
	return p.parsePrimary(depth)
}

// primary -> "(" expr ")" | array | call | path | literal
func (p *parser) parsePrimary(depth int) (*astNode, error) {
	t := p.peek()
	if t == nil {
		return nil, fmt.Errorf("unexpected end of expression")
	}

	switch t.kind {
	case tkLParen:
		p.advance()
		inner, err := p.parseExpr(depth + 1)
		if err != nil {
			return nil, err
		}
		if _, err := p.expect(tkRParen); err != nil {
			return nil, fmt.Errorf("missing closing parenthesis")
		}
		return inner, nil

	case tkLBrack:
		return p.parseArray(depth)

	case tkString:
		tok := p.advance()
		return &astNode{kind: ndLiteral, value: tok.value}, nil

	case tkNumber:
		tok := p.advance()
		return numberLiteralNode(tok.value)

	case tkBool:
		tok := p.advance()
		return &astNode{kind: ndLiteral, value: tok.value == "true"}, nil

	case tkNull:
		p.advance()
		return &astNode{kind: ndLiteral, value: nil}, nil

	case tkIdent:
		return p.parseIdentOrCall(depth)

	default:
		return nil, fmt.Errorf("unexpected token: %q", t.value)
	}
}

// numberLiteralNode builds a literal node from a number token, preserving the
// int64/float64 distinction the original parser used (so equality/comparison
// coercion behaves exactly as before).
func numberLiteralNode(v string) (*astNode, error) {
	if strings.Contains(v, ".") {
		f, err := strconv.ParseFloat(v, 64)
		if err != nil {
			return nil, fmt.Errorf("invalid number: %s", v)
		}
		return &astNode{kind: ndLiteral, value: f}, nil
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return nil, fmt.Errorf("invalid number: %s", v)
	}
	return &astNode{kind: ndLiteral, value: n}, nil
}

// parseIdentOrCall handles the two cases that begin with an identifier:
//   - fn(...) : an identifier IMMEDIATELY followed by '(' is a function call.
//   - path    : otherwise a dotted path (the original behaviour, unchanged).
//
// ("not in" is recognised at tokenize time as a single tkNotIn operator, so it
// never reaches here as a value.)
func (p *parser) parseIdentOrCall(depth int) (*astNode, error) {
	if p.pos+1 < len(p.tokens) && p.tokens[p.pos+1].kind == tkLParen {
		return p.parseCall(depth)
	}
	return p.parsePath()
}

// parseCall -> ident "(" ( expr ("," expr)* )? ")"
func (p *parser) parseCall(depth int) (*astNode, error) {
	nameTok, err := p.expect(tkIdent)
	if err != nil {
		return nil, err
	}
	if _, err := p.expect(tkLParen); err != nil {
		return nil, fmt.Errorf("expected '(' after function name %q", nameTok.value)
	}
	var args []*astNode
	// empty arg list?
	if t := p.peek(); t != nil && t.kind == tkRParen {
		p.advance()
		return &astNode{kind: ndCall, fn: nameTok.value, elements: args}, nil
	}
	for {
		arg, err := p.parseExpr(depth + 1)
		if err != nil {
			return nil, err
		}
		args = append(args, arg)
		t := p.peek()
		if t == nil {
			return nil, fmt.Errorf("unterminated argument list for %q", nameTok.value)
		}
		if t.kind == tkRParen {
			p.advance()
			break
		}
		if t.kind != tkComma {
			return nil, fmt.Errorf("expected ',' or ')' in call to %q, got %q", nameTok.value, t.value)
		}
		p.advance()
	}
	return &astNode{kind: ndCall, fn: nameTok.value, elements: args}, nil
}

// parsePath -> identifier ("." identifier)*
func (p *parser) parsePath() (*astNode, error) {
	tok, err := p.expect(tkIdent)
	if err != nil {
		return nil, err
	}
	segments := []string{tok.value}
	for {
		t := p.peek()
		if t == nil || t.kind != tkDot {
			break
		}
		p.advance() // consume dot
		ident, err := p.expect(tkIdent)
		if err != nil {
			return nil, fmt.Errorf("expected identifier after '.'")
		}
		segments = append(segments, ident.value)
	}
	return &astNode{kind: ndPath, segments: segments}, nil
}

// parseArray -> "[" value ("," value)* "]"
func (p *parser) parseArray(depth int) (*astNode, error) {
	if _, err := p.expect(tkLBrack); err != nil {
		return nil, err
	}

	var elements []*astNode

	// handle empty array
	t := p.peek()
	if t != nil && t.kind == tkRBrack {
		p.advance()
		return &astNode{kind: ndArray, elements: elements}, nil
	}

	for {
		elem, err := p.parseExpr(depth + 1)
		if err != nil {
			return nil, err
		}
		elements = append(elements, elem)

		t := p.peek()
		if t == nil {
			return nil, fmt.Errorf("unterminated array literal")
		}
		if t.kind == tkRBrack {
			p.advance()
			break
		}
		if t.kind != tkComma {
			return nil, fmt.Errorf("expected ',' or ']' in array, got %q", t.value)
		}
		p.advance() // consume comma
	}

	return &astNode{kind: ndArray, elements: elements}, nil
}

// opString returns the canonical operator string for a comparison token,
// mapping tkNotIn to "not in".
func opString(op token) string {
	if op.kind == tkNotIn {
		return "not in"
	}
	return op.value
}

// ---------- Evaluator ----------

// evalState carries evaluation-time bounds (recursion budget) so deeply nested
// or maliciously crafted ASTs cannot exhaust the stack.
type evalState struct {
	maxDepth int
}

func (ev *evalState) eval(node *astNode, data map[string]interface{}, depth int) (interface{}, error) {
	if depth > ev.maxDepth {
		return nil, fmt.Errorf("maximum evaluation depth of %d exceeded", ev.maxDepth)
	}
	switch node.kind {
	case ndLiteral:
		return node.value, nil

	case ndPath:
		return resolvePath(node.segments, data)

	case ndArray:
		var result []interface{}
		for _, elem := range node.elements {
			val, err := ev.eval(elem, data, depth+1)
			if err != nil {
				return nil, err
			}
			result = append(result, val)
		}
		return result, nil

	case ndUnaryOp:
		operand, err := ev.eval(node.left, data, depth+1)
		if err != nil {
			return nil, err
		}
		switch node.op {
		case "!":
			return !toBool(operand), nil
		case "-":
			return negate(operand)
		default:
			return nil, fmt.Errorf("unknown unary operator: %s", node.op)
		}

	case ndTernary:
		cond, err := ev.eval(node.left, data, depth+1)
		if err != nil {
			return nil, err
		}
		if toBool(cond) {
			return ev.eval(node.right, data, depth+1)
		}
		return ev.eval(node.third, data, depth+1)

	case ndCall:
		return ev.evalCall(node, data, depth)

	case ndBinaryOp:
		return ev.evalBinaryOp(node, data, depth)

	default:
		return nil, fmt.Errorf("unknown node kind: %d", node.kind)
	}
}

func (ev *evalState) evalBinaryOp(node *astNode, data map[string]interface{}, depth int) (interface{}, error) {
	// short-circuit for && and ||
	if node.op == "&&" {
		leftVal, err := ev.eval(node.left, data, depth+1)
		if err != nil {
			return nil, err
		}
		if !toBool(leftVal) {
			return false, nil
		}
		rightVal, err := ev.eval(node.right, data, depth+1)
		if err != nil {
			return nil, err
		}
		return toBool(rightVal), nil
	}
	if node.op == "||" {
		leftVal, err := ev.eval(node.left, data, depth+1)
		if err != nil {
			return nil, err
		}
		if toBool(leftVal) {
			return true, nil
		}
		rightVal, err := ev.eval(node.right, data, depth+1)
		if err != nil {
			return nil, err
		}
		return toBool(rightVal), nil
	}

	leftVal, err := ev.eval(node.left, data, depth+1)
	if err != nil {
		return nil, err
	}
	rightVal, err := ev.eval(node.right, data, depth+1)
	if err != nil {
		return nil, err
	}

	switch node.op {
	case "==":
		return compareEqual(leftVal, rightVal), nil
	case "!=":
		return !compareEqual(leftVal, rightVal), nil
	case ">":
		return compareOrdered(leftVal, rightVal, ">")
	case ">=":
		return compareOrdered(leftVal, rightVal, ">=")
	case "<":
		return compareOrdered(leftVal, rightVal, "<")
	case "<=":
		return compareOrdered(leftVal, rightVal, "<=")
	case "in":
		return evalIn(leftVal, rightVal)
	case "not in":
		found, err := evalIn(leftVal, rightVal)
		if err != nil {
			return nil, err
		}
		return !found, nil
	case "+":
		return evalAdd(leftVal, rightVal)
	case "-":
		return evalArith(leftVal, rightVal, "-")
	case "*":
		return evalArith(leftVal, rightVal, "*")
	case "/":
		return evalArith(leftVal, rightVal, "/")
	case "%":
		return evalArith(leftVal, rightVal, "%")
	default:
		return nil, fmt.Errorf("unknown operator: %s", node.op)
	}
}

// resolvePath walks the data map using the dotted path segments.
func resolvePath(segments []string, data map[string]interface{}) (interface{}, error) {
	var current interface{} = data
	for _, seg := range segments {
		m, ok := current.(map[string]interface{})
		if !ok {
			return nil, fmt.Errorf("cannot resolve path segment %q: not a map", seg)
		}
		val, exists := m[seg]
		if !exists {
			return nil, fmt.Errorf("path segment %q not found", seg)
		}
		current = val
	}
	return current, nil
}

// toBool converts a value to a boolean for logical evaluation.
func toBool(v interface{}) bool {
	if v == nil {
		return false
	}
	switch val := v.(type) {
	case bool:
		return val
	case string:
		return val != ""
	case int64:
		return val != 0
	case int:
		return val != 0
	case float64:
		return val != 0
	default:
		return true
	}
}

// compareEqual does a deep equality comparison, coercing numeric types.
func compareEqual(a, b interface{}) bool {
	if a == nil && b == nil {
		return true
	}
	if a == nil || b == nil {
		return false
	}

	// normalize numbers to float64 for comparison
	af, aIsNum := toFloat64(a)
	bf, bIsNum := toFloat64(b)
	if aIsNum && bIsNum {
		return af == bf
	}

	// compare booleans
	ab, aIsBool := a.(bool)
	bb, bIsBool := b.(bool)
	if aIsBool && bIsBool {
		return ab == bb
	}

	// compare strings
	as, aIsStr := a.(string)
	bs, bIsStr := b.(string)
	if aIsStr && bIsStr {
		return as == bs
	}

	// compare times
	at, aIsTime := a.(time.Time)
	bt, bIsTime := b.(time.Time)
	if aIsTime && bIsTime {
		return at.Equal(bt)
	}

	return fmt.Sprintf("%v", a) == fmt.Sprintf("%v", b)
}

// compareOrdered compares two ordered values with the given operator. Numeric
// values are coerced via float64 (original behaviour). As an ADDITIVE extension,
// two time.Time values (produced by the date helpers) and two strings are also
// orderable; anything else remains an error (fail-closed), exactly as before.
func compareOrdered(a, b interface{}, op string) (bool, error) {
	// time comparison (additive)
	at, aIsTime := a.(time.Time)
	bt, bIsTime := b.(time.Time)
	if aIsTime && bIsTime {
		switch op {
		case ">":
			return at.After(bt), nil
		case ">=":
			return at.After(bt) || at.Equal(bt), nil
		case "<":
			return at.Before(bt), nil
		case "<=":
			return at.Before(bt) || at.Equal(bt), nil
		}
	}

	af, aOk := toFloat64(a)
	bf, bOk := toFloat64(b)
	if aOk && bOk {
		switch op {
		case ">":
			return af > bf, nil
		case ">=":
			return af >= bf, nil
		case "<":
			return af < bf, nil
		case "<=":
			return af <= bf, nil
		}
	}

	// string ordering (additive)
	as, aIsStr := a.(string)
	bs, bIsStr := b.(string)
	if aIsStr && bIsStr {
		switch op {
		case ">":
			return as > bs, nil
		case ">=":
			return as >= bs, nil
		case "<":
			return as < bs, nil
		case "<=":
			return as <= bs, nil
		}
	}

	return false, fmt.Errorf("cannot compare non-numeric values with %s", op)
}

// evalIn checks if leftVal is contained in rightVal (which must be a slice).
func evalIn(leftVal, rightVal interface{}) (bool, error) {
	arr, ok := rightVal.([]interface{})
	if !ok {
		return false, fmt.Errorf("right-hand side of 'in' must be an array")
	}
	for _, elem := range arr {
		if compareEqual(leftVal, elem) {
			return true, nil
		}
	}
	return false, nil
}

// negate applies numeric negation, preserving int64/float64.
func negate(v interface{}) (interface{}, error) {
	switch n := v.(type) {
	case int64:
		return -n, nil
	case int:
		return -int64(n), nil
	case float64:
		return -n, nil
	case float32:
		return -float64(n), nil
	default:
		return nil, fmt.Errorf("cannot negate non-numeric value of type %T", v)
	}
}

// evalAdd implements '+'. Numeric operands add; two strings concatenate (a safe,
// commonly-expected FEEL behaviour). Mixed types fail closed.
func evalAdd(a, b interface{}) (interface{}, error) {
	as, aIsStr := a.(string)
	bs, bIsStr := b.(string)
	if aIsStr && bIsStr {
		return as + bs, nil
	}
	return evalArith(a, b, "+")
}

// evalArith implements the numeric binary operators. Both operands must be
// numeric; if both were integral (int/int64) the result stays int64 for + - *
// and % so integer expressions keep integer semantics, otherwise float64. It is
// fail-closed on non-numeric operands and division/modulo by zero.
func evalArith(a, b interface{}, op string) (interface{}, error) {
	af, aOk := toFloat64(a)
	bf, bOk := toFloat64(b)
	if !aOk || !bOk {
		return nil, fmt.Errorf("cannot apply %s to non-numeric operands (%T, %T)", op, a, b)
	}
	bothInt := isIntegral(a) && isIntegral(b)

	switch op {
	case "+":
		if bothInt {
			return int64(af) + int64(bf), nil
		}
		return af + bf, nil
	case "-":
		if bothInt {
			return int64(af) - int64(bf), nil
		}
		return af - bf, nil
	case "*":
		if bothInt {
			return int64(af) * int64(bf), nil
		}
		return af * bf, nil
	case "/":
		if bf == 0 {
			return nil, fmt.Errorf("division by zero")
		}
		return af / bf, nil // division always yields float (FEEL semantics)
	case "%":
		if int64(bf) == 0 {
			return nil, fmt.Errorf("modulo by zero")
		}
		if bothInt {
			return int64(af) % int64(bf), nil
		}
		return math.Mod(af, bf), nil
	default:
		return nil, fmt.Errorf("unknown arithmetic operator: %s", op)
	}
}

// isIntegral reports whether v is a Go integer type (used to keep integer
// arithmetic integral).
func isIntegral(v interface{}) bool {
	switch v.(type) {
	case int, int64, int32:
		return true
	default:
		return false
	}
}

// toFloat64 attempts to convert a value to float64.
func toFloat64(v interface{}) (float64, bool) {
	switch val := v.(type) {
	case float64:
		return val, true
	case int64:
		return float64(val), true
	case int:
		return float64(val), true
	case int32:
		return float64(val), true
	case float32:
		return float64(val), true
	default:
		return 0, false
	}
}
