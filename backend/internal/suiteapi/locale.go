package suiteapi

import (
	"context"
	"net/http"
	"strings"
)

// DefaultLocale is the platform's fallback UI/error locale. Clario360 is a
// KSA-first product, so Arabic is the default whenever no locale signal is
// present on a request.
const DefaultLocale = "ar"

type localeKey struct{}

// ContextWithLocale returns a copy of ctx carrying the normalized locale
// ("ar" or "en").
func ContextWithLocale(ctx context.Context, locale string) context.Context {
	return context.WithValue(ctx, localeKey{}, normalizeLocale(locale))
}

// LocaleFromContext returns the normalized locale ("ar" or "en") stored on the
// context, falling back to DefaultLocale when none is present (e.g. when the
// LocaleMiddleware has not run for this request).
func LocaleFromContext(ctx context.Context) string {
	if ctx != nil {
		if loc, ok := ctx.Value(localeKey{}).(string); ok && loc != "" {
			return loc
		}
	}
	return DefaultLocale
}

// LocaleMiddleware resolves the request locale and stores it on the context so
// downstream handlers (and WriteError) can localize responses. It is a chi v5
// compatible middleware (func(http.Handler) http.Handler) and should be mounted
// early in the router chain.
//
// Resolution order: ?locale= query param, then the X-Locale header, then
// Accept-Language, then the KSA default (Arabic). The result is normalized to
// "ar" or "en".
func LocaleMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := ContextWithLocale(r.Context(), ResolveLocale(r))
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// ResolveLocale determines the locale for a request without consulting the
// context, following ?locale= -> X-Locale -> Accept-Language -> DefaultLocale.
// It is exported so response helpers can honor per-request locale even when the
// LocaleMiddleware is not mounted on a given route.
func ResolveLocale(r *http.Request) string {
	if r == nil {
		return DefaultLocale
	}
	if v := strings.TrimSpace(r.URL.Query().Get("locale")); v != "" {
		return normalizeLocale(v)
	}
	if v := strings.TrimSpace(r.Header.Get("X-Locale")); v != "" {
		return normalizeLocale(v)
	}
	if v := strings.TrimSpace(r.Header.Get("Accept-Language")); v != "" {
		return normalizeLocale(v)
	}
	return DefaultLocale
}

// normalizeLocale collapses any locale or Accept-Language tag to the platform's
// two supported locales: "en" for English tags, otherwise "ar" (the KSA
// default).
func normalizeLocale(locale string) string {
	locale = strings.ToLower(strings.TrimSpace(locale))
	if locale == "" {
		return DefaultLocale
	}
	// Accept-Language may carry a weighted list ("en-US,ar;q=0.8"); inspect the
	// first (highest-priority) tag.
	if i := strings.IndexAny(locale, ",;"); i >= 0 {
		locale = strings.TrimSpace(locale[:i])
	}
	switch {
	case strings.HasPrefix(locale, "en"):
		return "en"
	case strings.HasPrefix(locale, "ar"):
		return "ar"
	default:
		return DefaultLocale
	}
}
