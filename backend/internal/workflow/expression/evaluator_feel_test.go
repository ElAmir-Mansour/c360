package expression

import (
	"strings"
	"testing"
	"time"
)

// TestEvaluator_Arithmetic exercises the additive FEEL arithmetic operators with
// correct precedence and parentheses.
func TestEvaluator_Arithmetic(t *testing.T) {
	eval := NewEvaluator()

	tests := []struct {
		name       string
		expression string
		data       map[string]interface{}
		want       interface{}
	}{
		{name: "addition int", expression: "a + b", data: map[string]interface{}{"a": int64(2), "b": int64(3)}, want: int64(5)},
		{name: "subtraction int", expression: "a - b", data: map[string]interface{}{"a": int64(10), "b": int64(4)}, want: int64(6)},
		{name: "multiplication int", expression: "a * b", data: map[string]interface{}{"a": int64(6), "b": int64(7)}, want: int64(42)},
		{name: "division yields float", expression: "a / b", data: map[string]interface{}{"a": int64(10), "b": int64(4)}, want: float64(2.5)},
		{name: "modulo int", expression: "a % b", data: map[string]interface{}{"a": int64(10), "b": int64(3)}, want: int64(1)},
		{name: "precedence mul before add", expression: "2 + 3 * 4", data: map[string]interface{}{}, want: int64(14)},
		{name: "parens override precedence", expression: "(2 + 3) * 4", data: map[string]interface{}{}, want: int64(20)},
		{name: "mixed float", expression: "a * 2.0", data: map[string]interface{}{"a": int64(3)}, want: float64(6)},
		{name: "negative literal preserved", expression: "a + -5", data: map[string]interface{}{"a": int64(10)}, want: int64(5)},
		{name: "unary minus on var", expression: "-a", data: map[string]interface{}{"a": int64(7)}, want: int64(-7)},
		{name: "chained subtraction left-assoc", expression: "10 - 3 - 2", data: map[string]interface{}{}, want: int64(5)},
		{name: "string concat", expression: "a + b", data: map[string]interface{}{"a": "foo", "b": "bar"}, want: "foobar"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := eval.EvaluateValue(tt.expression, tt.data)
			if err != nil {
				t.Fatalf("EvaluateValue(%q) error = %v", tt.expression, err)
			}
			if got != tt.want {
				t.Errorf("EvaluateValue(%q) = %v (%T), want %v (%T)", tt.expression, got, got, tt.want, tt.want)
			}
		})
	}
}

// TestEvaluator_ArithmeticInConditions verifies arithmetic composes with the
// existing comparison/boolean operators (the primary condition use case).
func TestEvaluator_ArithmeticInConditions(t *testing.T) {
	eval := NewEvaluator()

	tests := []struct {
		name       string
		expression string
		data       map[string]interface{}
		want       bool
	}{
		{name: "arith then compare", expression: "a + b > 10", data: map[string]interface{}{"a": int64(6), "b": int64(5)}, want: true},
		{name: "arith then compare false", expression: "a * 2 == 8", data: map[string]interface{}{"a": int64(3)}, want: false},
		{name: "arith both sides", expression: "a + 1 == b - 1", data: map[string]interface{}{"a": int64(4), "b": int64(6)}, want: true},
		{name: "percentage discount rule", expression: "variables.total - variables.total * 0.1 <= 900", data: map[string]interface{}{"variables": map[string]interface{}{"total": int64(1000)}}, want: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := eval.Evaluate(tt.expression, tt.data)
			if err != nil {
				t.Fatalf("Evaluate(%q) error = %v", tt.expression, err)
			}
			if got != tt.want {
				t.Errorf("Evaluate(%q) = %v, want %v", tt.expression, got, tt.want)
			}
		})
	}
}

// TestEvaluator_DivZeroFailsClosed verifies arithmetic errors fail closed.
func TestEvaluator_DivZeroFailsClosed(t *testing.T) {
	eval := NewEvaluator()
	for _, expr := range []string{"a / 0", "a % 0"} {
		if _, err := eval.EvaluateValue(expr, map[string]interface{}{"a": int64(5)}); err == nil {
			t.Errorf("expected error for %q (division/modulo by zero)", expr)
		}
	}
	// arithmetic on non-numeric operands fails closed.
	if _, err := eval.EvaluateValue("a * b", map[string]interface{}{"a": "x", "b": int64(2)}); err == nil {
		t.Error("expected error for multiplication of string by number")
	}
}

// TestEvaluator_Functions covers the string/numeric function library.
func TestEvaluator_Functions(t *testing.T) {
	eval := NewEvaluator()

	tests := []struct {
		name       string
		expression string
		data       map[string]interface{}
		want       interface{}
	}{
		{name: "len string", expression: "len(a)", data: map[string]interface{}{"a": "hello"}, want: int64(5)},
		{name: "len list", expression: "len(a)", data: map[string]interface{}{"a": []interface{}{1, 2, 3}}, want: int64(3)},
		{name: "contains substring", expression: "contains(a, 'ell')", data: map[string]interface{}{"a": "hello"}, want: true},
		{name: "contains list", expression: "contains(a, 2)", data: map[string]interface{}{"a": []interface{}{int64(1), int64(2)}}, want: true},
		{name: "startsWith", expression: "startsWith(a, 'he')", data: map[string]interface{}{"a": "hello"}, want: true},
		{name: "endsWith", expression: "endsWith(a, 'lo')", data: map[string]interface{}{"a": "hello"}, want: true},
		{name: "lower", expression: "lower(a)", data: map[string]interface{}{"a": "HeLLo"}, want: "hello"},
		{name: "upper", expression: "upper(a)", data: map[string]interface{}{"a": "abc"}, want: "ABC"},
		{name: "trim", expression: "trim(a)", data: map[string]interface{}{"a": "  x  "}, want: "x"},
		{name: "abs int", expression: "abs(a)", data: map[string]interface{}{"a": int64(-9)}, want: int64(9)},
		{name: "abs float", expression: "abs(a)", data: map[string]interface{}{"a": float64(-2.5)}, want: float64(2.5)},
		{name: "min varargs", expression: "min(3, 1, 2)", data: map[string]interface{}{}, want: float64(1)},
		{name: "max varargs", expression: "max(3, 1, 9, 2)", data: map[string]interface{}{}, want: float64(9)},
		{name: "min list", expression: "min(a)", data: map[string]interface{}{"a": []interface{}{int64(5), int64(2), int64(8)}}, want: float64(2)},
		{name: "round default", expression: "round(a)", data: map[string]interface{}{"a": float64(2.6)}, want: float64(3)},
		{name: "round places", expression: "round(a, 2)", data: map[string]interface{}{"a": float64(3.14159)}, want: float64(3.14)},
		{name: "floor", expression: "floor(a)", data: map[string]interface{}{"a": float64(2.9)}, want: int64(2)},
		{name: "ceil", expression: "ceil(a)", data: map[string]interface{}{"a": float64(2.1)}, want: int64(3)},
		{name: "nested calls", expression: "upper(trim(a))", data: map[string]interface{}{"a": " ab "}, want: "AB"},
		{name: "function in condition", expression: "len(a) > 3", data: map[string]interface{}{"a": "abcd"}, want: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := eval.EvaluateValue(tt.expression, tt.data)
			if err != nil {
				t.Fatalf("EvaluateValue(%q) error = %v", tt.expression, err)
			}
			if got != tt.want {
				t.Errorf("EvaluateValue(%q) = %v (%T), want %v (%T)", tt.expression, got, got, tt.want, tt.want)
			}
		})
	}
}

// TestEvaluator_FunctionsFailClosed verifies malformed calls fail closed.
func TestEvaluator_FunctionsFailClosed(t *testing.T) {
	eval := NewEvaluator()
	bad := []string{
		"len()",            // wrong arity
		"len(a, b)",        // wrong arity
		"unknownFn(a)",     // unknown function
		"upper(5)",         // wrong arg type
		"startsWith(a)",    // missing arg
		"round(a, 99)",     // places out of range
		"min()",            // empty
		"contains(5, 'x')", // first arg not string/list
	}
	data := map[string]interface{}{"a": "hi", "b": "yo"}
	for _, expr := range bad {
		if _, err := eval.EvaluateValue(expr, data); err == nil {
			t.Errorf("expected error for malformed call %q", expr)
		}
	}
}

// TestEvaluator_NotIn covers the negated membership operator.
func TestEvaluator_NotIn(t *testing.T) {
	eval := NewEvaluator()
	tests := []struct {
		expr string
		data map[string]interface{}
		want bool
	}{
		{"a not in ['x','y']", map[string]interface{}{"a": "z"}, true},
		{"a not in ['x','y']", map[string]interface{}{"a": "x"}, false},
		{"a not in [1,2,3]", map[string]interface{}{"a": int64(4)}, true},
	}
	for _, tt := range tests {
		got, err := eval.Evaluate(tt.expr, tt.data)
		if err != nil {
			t.Fatalf("Evaluate(%q) error = %v", tt.expr, err)
		}
		if got != tt.want {
			t.Errorf("Evaluate(%q) = %v, want %v", tt.expr, got, tt.want)
		}
	}
	// A variable literally named "not" still works as a path (backward-compat).
	got, err := eval.Evaluate("not == true", map[string]interface{}{"not": true})
	if err != nil {
		t.Fatalf("path named 'not' error = %v", err)
	}
	if !got {
		t.Error("expected variable named 'not' to be usable as a path")
	}
}

// TestEvaluator_Ternary covers the if-then-else conditional.
func TestEvaluator_Ternary(t *testing.T) {
	eval := NewEvaluator()
	tests := []struct {
		expr string
		data map[string]interface{}
		want interface{}
	}{
		{"a > 5 ? 'big' : 'small'", map[string]interface{}{"a": int64(10)}, "big"},
		{"a > 5 ? 'big' : 'small'", map[string]interface{}{"a": int64(1)}, "small"},
		{"a > 5 ? a * 2 : a", map[string]interface{}{"a": int64(6)}, int64(12)},
		{"a ? (b ? 1 : 2) : 3", map[string]interface{}{"a": true, "b": false}, int64(2)},
	}
	for _, tt := range tests {
		got, err := eval.EvaluateValue(tt.expr, tt.data)
		if err != nil {
			t.Fatalf("EvaluateValue(%q) error = %v", tt.expr, err)
		}
		if got != tt.want {
			t.Errorf("EvaluateValue(%q) = %v (%T), want %v (%T)", tt.expr, got, got, tt.want, tt.want)
		}
	}
}

// TestEvaluator_DateTime covers the date/time helpers with a pinned clock.
func TestEvaluator_DateTime(t *testing.T) {
	eval := NewEvaluator()

	fixed := time.Date(2026, 7, 2, 12, 0, 0, 0, time.UTC)
	orig := nowFunc
	nowFunc = func() time.Time { return fixed }
	defer func() { nowFunc = orig }()

	t.Run("now returns pinned clock", func(t *testing.T) {
		v, err := eval.EvaluateValue("now()", nil)
		if err != nil {
			t.Fatal(err)
		}
		if got := v.(time.Time); !got.Equal(fixed) {
			t.Errorf("now() = %v, want %v", got, fixed)
		}
	})

	t.Run("date compare before", func(t *testing.T) {
		got, err := eval.Evaluate("date('2026-01-01') < date('2026-12-31')", nil)
		if err != nil {
			t.Fatal(err)
		}
		if !got {
			t.Error("expected 2026-01-01 < 2026-12-31")
		}
	})

	t.Run("date ordering operators", func(t *testing.T) {
		got, err := eval.Evaluate("date(a) >= date('2026-07-02')", map[string]interface{}{"a": "2026-07-03"})
		if err != nil {
			t.Fatal(err)
		}
		if !got {
			t.Error("expected 2026-07-03 >= 2026-07-02")
		}
	})

	t.Run("duration add then compare", func(t *testing.T) {
		// now() + 24h should be after now().
		got, err := eval.Evaluate("after(addDuration(now(), duration('24h')), now())", nil)
		if err != nil {
			t.Fatal(err)
		}
		if !got {
			t.Error("expected now()+24h after now()")
		}
	})

	t.Run("day duration form", func(t *testing.T) {
		got, err := eval.Evaluate("before(now(), addDuration(now(), duration('7d')))", nil)
		if err != nil {
			t.Fatal(err)
		}
		if !got {
			t.Error("expected now() before now()+7d")
		}
	})

	t.Run("daysBetween", func(t *testing.T) {
		v, err := eval.EvaluateValue("daysBetween(date('2026-07-02'), date('2026-07-09'))", nil)
		if err != nil {
			t.Fatal(err)
		}
		if v != int64(7) {
			t.Errorf("daysBetween = %v, want 7", v)
		}
	})

	t.Run("SLA breach rule", func(t *testing.T) {
		// created + 3d < now?  created is 5 days ago => breached (true).
		data := map[string]interface{}{
			"variables": map[string]interface{}{"created_at": "2026-06-27T12:00:00Z"},
		}
		got, err := eval.Evaluate("before(addDuration(date(variables.created_at), duration('3d')), now())", data)
		if err != nil {
			t.Fatal(err)
		}
		if !got {
			t.Error("expected SLA breach (created+3d before now)")
		}
	})

	t.Run("bad date fails closed", func(t *testing.T) {
		if _, err := eval.EvaluateValue("date('not-a-date')", nil); err == nil {
			t.Error("expected error for unparseable date")
		}
	})
}

// TestEvaluator_BackwardCompat_Injection verifies that injection-shaped and
// malformed inputs still fail closed after the FEEL upgrade (the parser rejects
// them; no host access is possible).
func TestEvaluator_BackwardCompat_Injection(t *testing.T) {
	eval := NewEvaluator()
	data := map[string]interface{}{"a": int64(1), "b": int64(2)}

	bad := []string{
		"a == 1; DROP TABLE users", // semicolon + SQL => tokenizes ';' path fails
		"a @ b",                    // unexpected char
		"a == ==",                  // dangling operator
		"a +",                      // trailing arithmetic operator
		"a * / b",                  // two operators
		"?? a",                     // stray ternary punctuation
		"a ? b",                    // ternary missing else
		"fn(",                      // unterminated call
		"[1, 2",                    // unterminated array
		"a === b",                  // '=' after '==' is unexpected
		"__proto__.polluted",       // path resolves to nothing / not a map => error
		"`rm -rf`",                 // backtick => unexpected char
	}
	for _, expr := range bad {
		if _, err := eval.Evaluate(expr, data); err == nil {
			t.Errorf("expected fail-closed error for %q", expr)
		}
	}
}

// TestEvaluator_MaxDepthEval guards evaluation-time recursion (deeply nested
// ternary/arithmetic still bounded by the parser's maxDepth).
func TestEvaluator_MaxDepthEval(t *testing.T) {
	eval := NewEvaluator()
	deep := strings.Repeat("(", 30) + "a" + strings.Repeat(")", 30)
	if _, err := eval.Evaluate(deep, map[string]interface{}{"a": true}); err == nil {
		t.Error("expected max-depth error for deeply nested parens")
	}
}
